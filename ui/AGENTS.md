# UI Dashboard

This directory contains the Frontend Dashboard for the `vi_gen` project.

## Stack
- React 18
- Vite (Bundler and Dev Server)
- TailwindCSS (Styling)
- Lucide React (Icons)

## Responsibilities
- Provides a clean, modern user interface for submitting video generation prompts.
- Polls the backend API Gateway to fetch real-time updates on job progress.
- Displays the generated videos, audio clips, generated image galleries, and the LLM-written script to the user upon job completion.
- Communicates with the backend via `VITE_API_URL` which defaults to `http://localhost:3000`.

## Agent Guidelines
- When adding new components, try to utilize standard Tailwind utility classes to match the existing aesthetic.
- The UI is containerized via Docker and runs via `npm run dev -- --host` on port `5173`.
