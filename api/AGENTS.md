# API Gateway

This directory contains the Node.js/Express API gateway for the `vi_gen` project.

## Responsibilities
- **Endpoint Routing**: Exposes REST endpoints (e.g., POST `/jobs`) for the frontend UI to submit video rendering prompts.
- **Job Queueing**: Takes user prompts and pushes them into the Redis queue (`redis-queue:6379`) so the Python worker can pick them up asynchronously.
- **Database Management**: Interacts with the PostgreSQL database (`postgres-db:5432`) to create new job records and query the current status of jobs so the UI can display live progress.
- **Initialization Script**: Contains `scripts/init_db.js` which is responsible for initially creating the `jobs` table in the database when the Docker Compose stack spins up.

## Agent Guidelines
- Environment variables (`REDIS_URL`, `DB_URL`, `PORT`) are managed via Docker Compose.
- When modifying database schemas, ensure that both `scripts/init_db.js` and the Python worker's DB queries are updated in tandem.
