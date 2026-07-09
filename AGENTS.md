# Root Project Workspace

This is the root directory of the `vi_gen` AI video generation pipeline. This project is a multi-service architecture containerized via Docker Compose.

## Directory Structure
- `/api`: The API Gateway (Node.js/Express). Handles user requests, interacts with the PostgreSQL DB, and pushes video rendering jobs into Redis.
- `/ui`: The Frontend Dashboard (React/Vite). A web UI where users can submit prompts and monitor the status of their rendering jobs.
  - `/src/components`: Modal layouts (`SettingsPanel.tsx`, `LLMSettingsPanel.tsx`, `TimelineEditorModal.tsx`).
  - `/src/types.ts`: TS Interfaces for shared models.
  - `/src/App.tsx`: Main UI orchestration shell.
- `/worker`: The Python rendering worker (LangGraph). This is where the heavy lifting occurs.
  - `utils.py`: Database connection pools, environment settings, Pygments code overlays, and SSL bypass utilities.
  - `nodes.py`: LangGraph workflow execution nodes.
  - `server.py`: Background daemon HTTPServer listening on port `5001` for quick, in-memory segment-level regenerations.
  - `main.py`: Entry point for Redis listener consumer and state graph compiler.
- `/.env`: The configuration file holding all API keys, database URLs, and social credentials.
- `/docker-compose.yml`: Defines the orchestration for all microservices, including the `postgres-db`, `redis-queue`, `ui`, `api-gateway`, and `video-render-worker`.

## Primary Agent Instructions
When modifying configuration, ALWAYS ensure that the `.env` dependencies are correctly passed into the `docker-compose.yml` for the relevant services, as containers cannot read the host's `.env` without explicit mapping.

