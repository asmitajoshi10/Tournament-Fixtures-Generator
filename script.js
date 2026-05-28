// Master list of 10 available tournament sports branches
const SPORTS_LIST = [
    "Cricket", "Football", "Basketball", "Badminton", "Volleyball", 
    "Table Tennis", "Athletics", "Chess", "Kabaddi", "Tug of War"
];

// Available operational hours slots parsing from 8-9 AM to 8-9 PM
const MASTER_HOURS = [
    "08:00-09:00 AM", "09:00-10:00 AM", "10:00-11:00 AM", "11:00-12:00 PM",
    "12:00-01:00 PM", "01:00-02:00 PM", "02:00-03:00 PM", "03:00-04:00 PM",
    "04:00-05:00 PM", "05:00-06:00 PM", "06:00-07:00 PM", "07:00-08:00 PM",
    "08:00-09:00 PM"
];

window.onload = function() {
    const todayStr = new Date().toISOString().split('T')[0];
    document.getElementById('start-date').value = todayStr;
    document.getElementById('end-date').value = todayStr;
    buildTimeSlotCheckboxes();
};

function buildTimeSlotCheckboxes() {
    const container = document.getElementById('timeslots-checkbox-container');
    container.innerHTML = "";
    MASTER_HOURS.forEach((slot) => {
        container.innerHTML += `
            <label class="timeslot-box">
                <input type="checkbox" name="selected-slots" value="${slot}" checked>
                <span>${slot}</span>
            </label>
        `;
    });
}

function goToStep2() {
    const teamCount = parseInt(document.getElementById('team-count').value);
    const profileContainer = document.getElementById('dynamic-team-profiles-container');
    profileContainer.innerHTML = ""; 

    for (let i = 1; i <= teamCount; i++) {
        let sportsCheckboxesHtml = SPORTS_LIST.map(sport => `
            <label class="checkbox-label">
                <input type="checkbox" class="team-${i}-sport" value="${sport}" checked>
                <span>${sport}</span>
            </label>
        `).join('');

        profileContainer.innerHTML += `
            <div class="team-profile-row">
                <label>Team ${i} Specifications:</label>
                <input type="text" id="team-name-${i}" value="NITD Team ${i}" style="width: 100%; margin-bottom: 10px;">
                <label style="color:#94a3b8; text-transform:none; font-weight:normal;">Registered Sports Branches:</label>
                <div class="sports-checkbox-group">
                    ${sportsCheckboxesHtml}
                </div>
            </div>
        `;
    }
    document.getElementById('step-1-card').classList.add('hidden');
    document.getElementById('step-2-card').classList.remove('hidden');
}

function backToStep1() {
    document.getElementById('step-2-card').classList.add('hidden');
    document.getElementById('step-1-card').classList.remove('hidden');
}

function goToStep3() {
    document.getElementById('step-2-card').classList.add('hidden');
    document.getElementById('step-3-card').classList.remove('hidden');
}

function backToStep2() {
    document.getElementById('step-3-card').classList.add('hidden');
    document.getElementById('step-2-card').classList.remove('hidden');
}

function getDatesRange(start, end) {
    let dates = [];
    let current = new Date(start);
    let last = new Date(end);
    
    if (current > last) {
        let temp = current;
        current = last;
        last = temp;
    }

    while (current <= last) {
        dates.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
    }
    return dates;
}

/* ========================================================
   TRUE PARALLEL MULTI-SPORT SCHEDULING ENGINE (ASYNC POLL)
   ======================================================= */
function generateAntiCollisionFixtures() {
    const format = document.getElementById('tournament-type').value;
    const teamCount = parseInt(document.getElementById('team-count').value);
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    const displayArea = document.getElementById('bracket-container');

    const activeTimeBoxes = document.getElementsByName('selected-slots');
    let allowedTimeSlots = [];
    for(let box of activeTimeBoxes) {
        if(box.checked) allowedTimeSlots.push(box.value);
    }

    if(allowedTimeSlots.length === 0) {
        alert("🚨 Please choose at least one active time slot.");
        return;
    }

    let registeredTeams = [];
    for (let i = 1; i <= teamCount; i++) {
        let nameInput = document.getElementById(`team-name-${i}`).value;
        let checkedSports = [];
        let sportBoxes = document.getElementsByClassName(`team-${i}-sport`);
        for(let box of sportBoxes) {
            if(box.checked) checkedSports.push(box.value);
        }
        registeredTeams.push({ name: nameInput, sports: checkedSports });
    }

    displayArea.innerHTML = `<h3 style="color:#818cf8;">⚡ Initiating Async Generation Process on Server...</h3>`;
    displayArea.scrollIntoView({ behavior: 'smooth' });

    fetch('http://localhost:5000/api/schedule/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, registeredTeams, startDate, endDate, allowedTimeSlots })
    })
    .then(response => {
        if (!response.ok) throw new Error("Server rejected generation request");
        return response.json();
    })
    .then(data => {
        const taskId = data.taskId;
        displayArea.innerHTML = `<h3 style="color:#60a5fa;">⏳ Task created (${taskId}). Computing parallel matches in background...</h3>`;
        pollTaskStatus(taskId, startDate, endDate, allowedTimeSlots);
    })
    .catch(err => {
        console.error(err);
        displayArea.innerHTML = `<h3 style="color:#ef4444;">🚨 Server Communication Failed. Check if server.js is running.</h3>`;
    });
}

function pollTaskStatus(taskId, startDate, endDate, allowedTimeSlots) {
    const displayArea = document.getElementById('bracket-container');
    
    const interval = setInterval(() => {
        fetch(`http://localhost:5000/api/schedule/task/${taskId}`)
            .then(res => res.json())
            .then(task => {
                if (task.status === "completed") {
                    clearInterval(interval);
                    renderMatrixTable(task.result, startDate, endDate, allowedTimeSlots);
                } else if (task.status === "failed") {
                    clearInterval(interval);
                    displayArea.innerHTML = `<h3 style="color:#ef4444;">🚨 Background Task Failed: ${task.error}</h3>`;
                } else {
                    displayArea.innerHTML = `<h3 style="color:#60a5fa;">⏳ Server is compiling schedule columns... Please wait...</h3>`;
                }
            })
            .catch(err => {
                clearInterval(interval);
                console.error("Polling error:", err);
                displayArea.innerHTML = `<h3 style="color:#ef4444;">🚨 Lost connection while tracking background task.</h3>`;
            });
    }, 1000);
}

function renderMatrixTable(backendData, startDate, endDate, allowedTimeSlots) {
    const displayArea = document.getElementById('bracket-container');
    const { fixtures, overflowMatchesCount, dateRangeList, dynamicMatrixColumns } = backendData;

    let tableHtml = `
        <div class="matrix-wrapper">
            <h2>📊 Master Multi-Day Fixtures Matrix (Fetched from Database)</h2>
            <p style="color: #22c55e; margin-bottom: 5px; font-weight: bold;">💾 Saved Document ID: ${backendData.scheduleId}</p>
            <p style="color: #94a3b8; margin-bottom: 15px;">Tournament Window: ${startDate} to ${endDate} (${dateRangeList.length} Day(s) Active)</p>
    `;

    if (overflowMatchesCount > 0) {
        tableHtml += `
            <div style="background: #7f1d1d; border: 1px solid #ef4444; padding: 12px; border-radius: 6px; margin-bottom: 15px; color: #fca5a5; font-size:0.95rem;">
                ⚠️ <strong>Scheduling Alert:</strong> ${overflowMatchesCount} match pairings could not fit without team conflicts. Please extend your dates.
            </div>
        `;
    }

    tableHtml += `
            <table class="matrix-table">
                <thead>
                    <tr>
                        <th rowspan="2" style="vertical-align: middle; min-width: 140px;">Sports Branches ↓</th>
    `;

    dateRangeList.forEach((dateString, idx) => {
        tableHtml += `<th colspan="${allowedTimeSlots.length}" style="background-color: #312e81;">Day ${idx + 1} (${dateString})</th>`;
    });

    tableHtml += `</tr><tr>`;

    dateRangeList.forEach(() => {
        allowedTimeSlots.forEach(timeString => {
            let briefTime = timeString.split(' ')[0]; 
            tableHtml += `<th style="font-size:0.85rem; padding: 8px 4px;">${briefTime}</th>`;
        });
    });

    tableHtml += `</tr></thead><tbody>`;

    SPORTS_LIST.forEach(sport => {
        tableHtml += `<tr><td class="sport-row-header">${sport}</td>`;

        dynamicMatrixColumns.forEach(col => {
            let matchedFixture = fixtures.find(f => f.sport === sport && f.columnId === col.columnId);

            tableHtml += `<td>`;
            if (matchedFixture) {
                tableHtml += `
                    <div class="match-cell-box" style="font-size: 0.85rem;">
                        <span style="color:#f8fafc; font-weight:bold;">${matchedFixture.teamA}</span>
                        <div style="color: #818cf8; font-size: 0.75rem; margin:1px 0;">vs</div>
                        <span style="color:#f8fafc; font-weight:bold;">${matchedFixture.teamB}</span>
                    </div>
                `;
            } else {
                tableHtml += `<span class="empty-cell-text">-</span>`;
            }
            tableHtml += `</td>`;
        });

        tableHtml += `</tr>`;
    });

    tableHtml += `</tbody></table></div>`;
    displayArea.innerHTML = tableHtml;
}
