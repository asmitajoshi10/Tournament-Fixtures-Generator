# Full-Stack Multi-Sport Tournament Scheduler Engine

A full-stack web application designed to automate tournament scheduling. The core engine solves a complex resource-allocation problem: scheduling matches for multiple teams across 10 different sports without causing time-slot conflicts for players or the sports venues.

---

## The Problem This Project Solves
Manually scheduling a multi-sport tournament is a logistical nightmare prone to the **Pigeonhole Principle** flaws. 
1. **Venue Collisions:** Two different sports cannot occupy the same ground/court at the same time.
2. **Team Collisions:** A team cannot play Football and Cricket simultaneously if their matches are scheduled in the same time slot.
3. **Sport Clumping:** Standard sequential scheduling groups all matches of one sport together (e.g., Day 1 is only Cricket, Day 4 is only Chess), creating a monotonous event timeline.

This engine automates the entire process, enforcing **Parallel Resource Allocation** constraints and randomizing match distribution for a balanced tournament calendar.

---

## How It Works: The User Inputs
The frontend interface collects five critical configuration parameters from the user and sends them to the backend API as a structured JSON payload:

1. **Tournament Format:** Selection between `Round Robin` (every team plays every other team within a sport) or `Knockout`.
2. **Registered Teams List:** An array of participating teams, where each team profile includes its unique name and the specific sports they are registered to play.
3. **Start & End Dates:** Chronological dates defining the exact calendar window of the tournament.
4. **Operating Time Slots:** The specific times during the day when matches are allowed to take place (e.g., `09:00 AM`, `11:00 AM`, `04:00 PM`).

---

## Distributed System Architecture

To scale this application for enterprise multi-user environments, the infrastructure features a decoupled data acceleration layer and concurrent request safeguards. The API gateway balances incoming requests against an in-memory coordination pool, allowing high-throughput matrix evaluation without starving incoming server threads.

---

## The Backend Execution Pipeline
When the backend receives the input data, it processes it through a strict logical pipeline to generate the final matrix:

### 1. Multi-Admin Data Guard (Distributed Mutex)
Before entering the computation framework, the route triggers a concurrency safeguard utilizing Redis Mutex Locks. If a separate administrator tries to execute a compilation simultaneously, the system intercepts the race condition and returns a `429 Too Many Requests` block. The lock includes a self-healing 30-second Time-To-Live (TTL) to prevent system deadlocks if a server node crashes mid-execution.

### 2. Asynchronous Task Coordination
To prevent intensive $O(N^2)$ round-robin calculations from blocking the Node.js event loop, the execution lifecycle is completely decoupled from the HTTP request-response cycle. The API instantly returns a `202 Accepted` receipt with a unique `taskId`. The heavy workload is handed to a background worker, allowing the UI to poll the task state smoothly without thread starvation.

### 3. Dynamic Grid Generation
The engine calculates the total calendar days from the date range and multiplies each day by the allowed time slots. This builds a linear timeline matrix of independent tournament slots (e.g., `Day1_09:00 AM`, `Day1_11:00 AM`, `Day2_09:00 AM`).

### 4. Algorithmic Match Pairing
The backend filters teams by sport and compiles the raw matchup pairings. For Round Robin, it utilizes nested loops ($O(N^2)$ complexity) to ensure every team plays one another.

### 5. Fisher-Yates Randomization Layer
To prevent sport clumping, the raw match pool is shuffled using the Fisher-Yates algorithm. This shuffles the order of matchups entirely (e.g., alternating between Badminton, Football, and Chess), creating a visually balanced and distributed tournament grid.

### 6. Per-Team Collision Shield
The engine iterates through the randomized match queue and evaluates the timeline slots sequentially. Before locking a match into a time slot, it audits two constraints:
- **Ground Availability:** Is this sport's venue already booked for this specific time slot?
- **Player Availability:** Is either Team A or Team B already scheduled to play *any* sport during this specific time slot?

If a conflict is detected, the engine skips that time slot and tests the next one until a safe slot is found.

### 7. Cloud Persistence & Caching Acceleration
Once the schedule is completely aligned, the finalized blueprint is saved securely to a multi-shard MongoDB Atlas cloud cluster using automated Mongoose schemas. Concurrently, the payload is mirrored to an in-memory Redis Cloud cache layer with a 24-hour expiration matrix. Subsequent fetch requests bypass database disk I/O entirely, serving sub-millisecond schedules directly from memory.

### 8. Resilient Graceful Degradation
The cache reading architecture implements an automated circuit fallback pattern. If the remote Redis Cloud tier experiences a network disruption or goes offline entirely, the backend intercepts the failure, logs a system warning, and dynamically switches to a fallback route directly through MongoDB Atlas. Users experience zero runtime disruption.

---

## Tech Stack
- **Frontend:** HTML5, CSS3, Vanilla JavaScript (Dynamic DOM manipulation & polling async lifecycle tracking)
- **Backend:** Node.js, Express.js (Decoupled background worker & REST API architecture)
- **Database Store:** MongoDB Atlas (Cloud Hosted Multi-Shard Replica Set via Mongoose)
- **Memory & Coordination Layer:** Redis Cloud (Distributed Mutex Locking, Key-Value Caching, & Task Status Tracking)
- **Secret Management:** Dotenvx (Encrypted Environment Variable Matrix)

---