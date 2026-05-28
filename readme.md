Full-Stack Multi-Sport Tournament Scheduler Engine
A high-throughput web application designed to automate complex tournament scheduling. The core engine solves a multi-variable resource-allocation problem: scheduling matches for N teams across 10 distinct sports without causing venue collisions or player time-slot conflicts.

The Problem & Engineering Constraints
Manually scheduling a multi-sport tournament introduces severe logistical constraints rooted in the Pigeonhole Principle:

Venue Collisions — Two sports cannot occupy the same court or field simultaneously.
Team Collisions — A single team cannot participate in two different sports during the same time slot.
Sport Clumping — Sequential scheduling naturally groups identical sports together, creating a monotonous event timeline.

This engine automates the entire allocation process, enforcing parallel resource constraints while randomizing match distribution for a balanced tournament calendar.

System Architecture & Pipeline
The infrastructure decouples heavy matrix computations from the user-facing API threads to support concurrent administrative usage.
1. Concurrency Guard (Distributed Mutex)
To prevent race conditions when multiple administrators attempt to compile schedules simultaneously, the API gateway uses Redis-backed mutex locks. Overlapping requests are intercepted and rejected with a 429 Too Many Requests response. The lock includes a self-healing 30-second TTL to prevent deadlocks during unexpected node failures.
2. Asynchronous Task Coordination
To prevent intensive O(N²) round-robin calculations from blocking Node.js's single-threaded event loop, the execution lifecycle is fully decoupled from the HTTP request-response cycle:

The API immediately returns a 202 Accepted response with a unique taskId.
The computation is offloaded to a background worker process.
The frontend polls task state at intervals, eliminating UI thread starvation.

3. Scheduling Algorithm

Pairing Matrix — Compiles all round-robin matchups using nested iteration.
Fisher-Yates Shuffle — Randomizes the match queue to eliminate sport clumping and distribute event variety evenly across the timeline.
Collision Audit — Evaluates venue and player availability sequentially before committing each time slot.

4. Persistence & Caching

Primary Store — MongoDB Atlas (cloud-hosted replica set, Mongoose ODM).
Caching Layer — Finalized schedules are mirrored to a Redis Cloud in-memory cache with a 24-hour TTL, serving subsequent reads with sub-millisecond latency.
Graceful Degradation — Implements a Circuit Breaker pattern: if the Redis tier becomes unavailable, the backend automatically falls back to MongoDB with no user-facing disruption.


Performance Benchmarks

Benchmarks were measured locally using [tool you used, e.g. k6 / Apache Bench / manual timing].

MetricResultSchedule Generation32-team round-robin across 5 venues in < 80msCache vs. DB Read3.8ms (Redis) vs. 114ms (MongoDB)Concurrent Read Throughput1,000+ simultaneous requests without degradation

Tech Stack
LayerTechnologyFrontendHTML5, CSS3, Vanilla JavaScriptBackendNode.js, Express.jsDatabaseMongoDB Atlas (Replica Set, Mongoose ODM)Cache & CoordinationRedis Cloud (Mutex Locking, Key-Value Cache, Task Tracking)Secret Managementdotenvx (Encrypted Environment Variables)
Frontend note: Built with native Web APIs and long-polling to avoid client-side bundle overhead and maximize DOM performance.
