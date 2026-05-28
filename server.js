// server.js
const redisClient = require('./config/redis'); // Active Redis Cloud client instance
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// 💡 1. Initialize Express first so 'app' is defined before any routes use it!
const app = express();
app.use(express.json());
app.use(cors());

// ==========================================
// 2. DATABASE CONNECTIVITY (Standard Driver Format)
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
// FISHER-YATES REALLOCATION SHUFFLE
// ==========================================
function fisherYatesShuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// ==========================================
// 3. THE REST API ENDPOINTS
// ==========================================

// 👉 NEW: GET Endpoint to fetch schedule instantly using Redis Caching with DB Fallback
app.get('/api/schedule/latest', async (req, res) => {
    let cachedSchedule = null;

    try {
        cachedSchedule = await redisClient.get('schedule:latest');
    } catch (redisError) {
        console.warn('⚠️ Redis connection lost. Falling back to MongoDB...');
    }
    
    if (cachedSchedule) {
        console.log('🎯 REDIS CACHE HIT: Serving schedule instantly from memory!');
        return res.status(200).json({ source: 'Redis Cache', ...JSON.parse(cachedSchedule) });
    }

    try {
        console.log('🧩 REDIS CACHE MISS: Looking up document in MongoDB Atlas...');
        const latestDbSchedule = await Schedule.findOne().sort({ generatedAt: -1 });

        if (!latestDbSchedule) {
            return res.status(404).json({ error: "No tournament schedules found in database." });
        }

        const payload = {
            scheduleId: latestDbSchedule._id,
            fixtures: latestDbSchedule.fixtures,
            startDate: latestDbSchedule.startDate,
            endDate: latestDbSchedule.endDate
        };

        try {
            await redisClient.setEx('schedule:latest', 86400, JSON.stringify(payload)); // Cache for 24 hours
        } catch (e) {}

        return res.status(200).json({ source: 'MongoDB Database', ...payload });

    } catch (dbError) {
        console.error(dbError);
        res.status(500).json({ error: "Internal Server Read Failure" });
    }
});

// 👉 NEW: ASYNC TASK COORDINATOR STATUS CHECK
app.get('/api/schedule/task/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;
        const taskData = await redisClient.get(`task:${taskId}`);
        
        if (!taskData) {
            return res.status(404).json({ error: "Task not found or expired." });
        }
        
        res.status(200).json(JSON.parse(taskData));
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch task status" });
    }
});

// 👉 NEW: ASYNC SCHEDULE GENERATOR WITH MULTI-ADMIN DATA GUARD LOCK
app.post('/api/schedule/generate', async (req, res) => {
    const lockKey = 'lock:schedule_generation';
    
    // Multi-Admin Data Guard check using Redis Mutex
    const acquireLock = await redisClient.set(lockKey, 'LOCKED', {
        NX: true,
        EX: 30
    });

    if (!acquireLock) {
        console.log('🛑 DATA GUARD BLOCK: Another admin is currently generating a schedule!');
        return res.status(429).json({ 
            error: "Another administrator is currently generating a tournament schedule. Please wait a moment." 
        });
    }

    const taskId = `gen_${Date.now()}`;
    await redisClient.setEx(`task:${taskId}`, 300, JSON.stringify({ status: "processing", progress: 0 }));

    // Return instant tracking token to frontend client
    res.status(202).json({
        message: "Schedule generation background process initiated successfully.",
        taskId: taskId
    });

    // Delegate processing to background async coordinator thread
    setImmediate(async () => {
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

            let balancedPairingsQueue = fisherYatesShuffle(masterPairingsPool);
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

            const responsePayload = {
                scheduleId: savedSchedule._id,
                fixtures: finalScheduledFixtures,
                overflowMatchesCount,
                dateRangeList,
                dynamicMatrixColumns
            };

            await redisClient.setEx('schedule:latest', 86400, JSON.stringify(responsePayload)); 
            await redisClient.setEx(`task:${taskId}`, 300, JSON.stringify({ status: "completed", result: responsePayload }));

            console.log(`✅ BACKGROUND TASK SUCCESS: Schedule ${taskId} processed completely.`);

        } catch (backgroundError) {
            console.error("🚨 Background Worker processing failure:", backgroundError);
            await redisClient.setEx(`task:${taskId}`, 300, JSON.stringify({ status: "failed", error: backgroundError.message }));
        } finally {
            // Release Data Guard lock
            await redisClient.del(lockKey);
            console.log('🔑 DATA GUARD RELEASED: Lock removed safely.');
        }
    });
});

app.listen(5000, () => console.log('🚀 Arena Server running on http://localhost:5000'));