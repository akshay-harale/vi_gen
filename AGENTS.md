# Root Project Workspace

This is the root directory of the `vi_gen` AI video generation pipeline. This project is a multi-service architecture containerized via Docker Compose.

## Directory Structure
- `/api`: The API Gateway (Node.js/Express). Handles user requests, interacts with the PostgreSQL DB, and pushes video rendering jobs into Redis.
- `/ui`: The Frontend Dashboard (React/Vite). A web UI where users can submit prompts and monitor the status of their rendering jobs.
- `/worker`: The Python rendering worker (LangGraph). This is where the heavy lifting occurs: generating LLM scripts, generating TTS audio (Kokoro), generating images (Together AI), compiling video (MoviePy), and optionally auto-uploading to Instagram.
- `/.env`: The configuration file holding all API keys, database URLs, and social credentials.
- `/docker-compose.yml`: Defines the orchestration for all microservices, including the `postgres-db`, `redis-queue`, `ui`, `api-gateway`, and `video-render-worker`.

## Primary Agent Instructions
When modifying configuration, ALWAYS ensure that the `.env` dependencies are correctly passed into the `docker-compose.yml` for the relevant services, as containers cannot read the host's `.env` without explicit mapping.
