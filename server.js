require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ==========================================
// 1. DATABASE CONNECTIVITY (Standard Driver Format)
// ==========================================
const cloudURI = process.env.DATABASE_URL;

mongoose.connect(cloudURI)
  .then(() => console.log('🍃 Connected to MongoDB Atlas Cloud Successfully!'))
  .catch(err => console.error('🚨 Shard Database connection error:', err));

const ScheduleSchema = new mongoose.Schema({
    startDate: String,
    endDate: String,
    generatedAt: { type: Date, default: Date.now },
    fixtures: [{
        sport: String,
        teamA: String,
        teamB: String,
        columnId: String,
        dateLabel: String,
        timeLabel: String,
        dayIndex: Number
    }]
});

const Schedule = mongoose.model('Schedule', ScheduleSchema);

const SPORTS_LIST = ["Cricket", "Football", "Basketball", "Badminton", "Volleyball", "Table Tennis", "Athletics", "Chess", "Kabaddi", "Tug of War"];

function getDatesRange(start, end) {
    let dates = [];
    let current = new Date(start);
    let last = new Date(end);
    if (current > last) { [current, last] = [last, current]; }
    while (current <= last) {
        dates.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
    }
    return dates;
}

// ==========================================
// FISHER-YATES REAFALLOCATION SHUFFLE
// ==========================================
function fisherYatesShuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// ==========================================
// 2. THE REST API ENDPOINT 
// ==========================================
app.post('/api/schedule/generate', async (req, res) => {
    try {
        const { format, registeredTeams, startDate, endDate, allowedTimeSlots } = req.body;
        const dateRangeList = getDatesRange(startDate, endDate);

        let dynamicMatrixColumns = [];
        dateRangeList.forEach((dateString, index) => {
            allowedTimeSlots.forEach(timeString => {
                dynamicMatrixColumns.push({
                    dayIndex: index + 1,
                    dateLabel: dateString,
                    timeLabel: timeString,
                    columnId: `Day${index + 1}_${timeString}`
                });
            });
        });

        // Compile raw pairing pools
        let masterPairingsPool = [];
        SPORTS_LIST.forEach(sport => {
            let competingTeams = registeredTeams.filter(team => team.sports.includes(sport));
            
            if (format === "round-robin") {
                for (let i = 0; i < competingTeams.length; i++) {
                    for (let j = i + 1; j < competingTeams.length; j++) {
                        masterPairingsPool.push({ sport, teamA: competingTeams[i].name, teamB: competingTeams[j].name });
                    }
                }
            } else {
                for (let i = 0; i < competingTeams.length; i += 2) {
                    if (competingTeams[i+1]) {
                        masterPairingsPool.push({ sport, teamA: competingTeams[i].name, teamB: competingTeams[i+1].name });
                    }
                }
            }
        });

        // Apply randomization to distribute sports naturally across the calendar days
        let balancedPairingsQueue = fisherYatesShuffle(masterPairingsPool);

        // Process through team collision checks
        let finalScheduledFixtures = [];
        let overflowMatchesCount = 0;

        balancedPairingsQueue.forEach(match => {
            let assignedColumnObj = null;

            for (let c = 0; c < dynamicMatrixColumns.length; c++) {
                let evalCol = dynamicMatrixColumns[c];

                let isSportFieldBusy = finalScheduledFixtures.some(s => s.columnId === evalCol.columnId && s.sport === match.sport);
                let areTeamsPersonallyBusy = finalScheduledFixtures.some(s => 
                    s.columnId === evalCol.columnId && (s.teamA === match.teamA || s.teamB === match.teamA || s.teamA === match.teamB || s.teamB === match.teamB)
                );

                if (!isSportFieldBusy && !areTeamsPersonallyBusy) {
                    assignedColumnObj = evalCol;
                    break; 
                }
            }

            if (assignedColumnObj) {
                finalScheduledFixtures.push({
                    sport: match.sport,
                    teamA: match.teamA,
                    teamB: match.teamB,
                    columnId: assignedColumnObj.columnId,
                    dateLabel: assignedColumnObj.dateLabel,
                    timeLabel: assignedColumnObj.timeLabel,
                    dayIndex: assignedColumnObj.dayIndex
                });
            } else {
                overflowMatchesCount++;
            }
        });

        const savedSchedule = new Schedule({
            startDate,
            endDate,
            fixtures: finalScheduledFixtures
        });
        await savedSchedule.save();

        res.status(200).json({
            scheduleId: savedSchedule._id,
            fixtures: finalScheduledFixtures,
            overflowMatchesCount,
            dateRangeList,
            dynamicMatrixColumns
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Processing Failure" });
    }
});

app.listen(5000, () => console.log('🚀 Arena Server running on http://localhost:5000'));