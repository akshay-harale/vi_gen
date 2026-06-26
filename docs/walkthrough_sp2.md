# Sprint 2: Database & State Management Completed

We have successfully integrated PostgreSQL into our pipeline, moving away from the in-memory mock database!

## What Changed

### 1. API Gateway connected to PostgreSQL
- The Node.js API now uses the `pg` library to connect to the `postgres-db` service.
- On startup, the API ensures the `jobs` table is created.
- `POST /api/jobs` now inserts a new job into the database with a `PENDING` status before queueing it in Redis.
- `GET /api/jobs/:id` fetches the real-time job status directly from the database.

### 2. Python Worker connects to PostgreSQL
- The worker script now establishes a direct connection to PostgreSQL using `psycopg2`.
- When a job is picked up from Redis, the worker immediately updates the database status to `PROCESSING`.
- After simulating work, the worker updates the database status to `COMPLETED`.
- We removed the API webhook endpoint because direct database access from the worker is more robust for our architecture.

## Verification

We ran an end-to-end test of the full pipeline using `curl` commands to the API.

1. **Submitted Job**: Sent a POST request to create a job.
2. **Tracked Lifecycle**: Polled the API and saw the status go from `PENDING` -> `PROCESSING` -> `COMPLETED`. The worker correctly processed the Redis event and updated the PostgreSQL rows directly.

The backend infrastructure is now much more solid! We are ready to move on to Sprint 3: LLM Integration.
