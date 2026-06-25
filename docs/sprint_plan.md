# Sprint-wise Implementation Plan

This document outlines the iterative development plan for the Vi Gen project.

## Sprint 1: The Bedrock (Pipeline Validation with Mock Data)
**Goal:** Create boilerplate for all services, stitch them together, and validate the end-to-end pipeline using mock data.

- **Infrastructure:** Update `docker-compose.yml` to include the UI service alongside API, Worker, Redis, Postgres, and Ollama.
- **API Gateway:** Basic Node.js server with a `POST /jobs` endpoint (returns a mock job ID) and a `GET /jobs/:id` endpoint. Pushes a mock job to Redis.
- **Python Worker:** Basic Python script that polls Redis for jobs, waits for 2 seconds (mocking work), and logs completion.
- **UI:** A simple React app to submit a video generation prompt and poll for status.
- **Execution:** We will run UI and API locally for fast iteration, and Redis/Postgres via Docker. 

## Sprint 2: Database & State Management
**Goal:** Implement actual database persistence to track job status.

- **Postgres:** Define `jobs` table schema (`id`, `prompt`, `status`, `created_at`, `video_url`).
- **API Gateway:** Write job to DB on creation (Status: PENDING).
- **Python Worker:** Update job status in DB when picking up a job (PROCESSING) and upon completion (COMPLETED/FAILED).

## Sprint 3: LLM Integration (Ollama)
**Goal:** Connect the Python worker to the local Ollama service.

- **Python Worker:** Instead of sleeping, the worker will take the user's prompt and query the `ollama-llm` service to generate a detailed video script or scene descriptions.

## Sprint 4: Video Generation (GPU)
**Goal:** Implement the heavy video rendering logic.

- **Python Worker:** Integrate the video generation library to use the GPU.
- **Storage:** Save the generated video to the local `./output` folder and update the DB with the file path.
- **API Gateway:** Serve the static video files to the UI.

## Sprint 5: UI Polish & Polish Features
**Goal:** Build a premium, dynamic UI.

- **UI:** Add rich aesthetics (dark mode, glassmorphism, micro-animations). Show a live-updating queue, processing indicators, and a video player.

## Sprint 6: Full Docker Integration & Testing
**Goal:** Final end-to-end testing fully within Docker.

- **Docker:** Ensure the UI is built and served properly within a Docker container.
- **Testing:** Perform integration tests verifying the full flow under Docker.
