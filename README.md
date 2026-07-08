# VI Gen: AI Video Generation Pipeline

VI Gen is an automated pipeline that takes a simple text prompt and generates a fully produced, multi-segment video complete with dynamic AI-generated images and a natural AI voiceover.


## Application Interface Preview

Below is a preview of the ViGen Studio interface, showcasing the high-contrast technical schematic dashboard, dynamic prompt configuration, multi-stage pipeline progress visualizer, and togglable light/dark themes:

| 🖥️ Main Dashboard Layout | ⚙️ Dynamic System Prompt Settings |
|:---:|:---:|
| ![Main Dashboard](docs/home.png) | ![System Prompt Settings](docs/settings.png) |

| 🔄 Active Job Synthesis / Progress Tracking | 📽️ Completed Build Preview & Live Stage Visualizer |
|:---:|:---:|
| ![Active Job Progress](docs/in_progress.png) | ![Completed Video View](docs/view.png) |

| 🌗 Swiss Cream vs. Stark Mono Theme Toggle |
|:---:|
| ![Theme Customization](docs/theme.png) |

## Architecture


The project is broken down into a microservices architecture:
- **UI (Vite/React)**: A web interface to submit prompts and monitor job progress.
- **API Gateway (Express)**: Manages job creation and fetches job status from the database.
- **Redis Queue**: A lightweight message broker to queue rendering jobs.
- **Postgres Database**: Persistent storage for job metadata, status, and generated scripts.
- **Worker (Python/LangGraph)**: The core engine that processes jobs using a state graph.

### The Worker Pipeline (LangGraph)
1. **Script Generation**: Calls an LLM (Ollama, OpenAI, or Together AI) to write a detailed 4-5 segment script with corresponding image prompts.
2. **Audio Synthesis**: Uses [Kokoro](https://github.com/hexgrad/kokoro) TTS (an open-weight model) to generate highly realistic voiceovers locally.
3. **Image Generation**: Calls the Together AI API (`IMAGE_MODEL`) to generate dynamic visuals for each segment.
4. **Video Compilation**: Uses MoviePy to stitch the audio and images into a final `.mp4` video perfectly synchronized to the voiceover.

## Prerequisites

- **Docker** and **Docker Compose**
- **Ollama** (Optional, if using `ollama` as your LLM provider)
- **API Keys**:
  - Together AI API Key (Required for Image Generation and optional for Script Generation)
  - OpenAI API Key (Optional, if using `openai` as your LLM provider)

## Configuration

Environment variables are securely managed using a `.env` file at the root of your project.

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_PROVIDER` | The LLM engine to use for writing scripts (`ollama`, `openai`, `together`). | `ollama` |
| `LLM_MODEL` | The specific text model name. Examples: `qwen3:8b` (Ollama), `gpt-4o` (OpenAI), `google/gemma-4-31B-it` (Together). | `qwen3:8b` |
| `IMAGE_MODEL` | The specific image model name. Examples: `stabilityai/stable-diffusion-xl-base-1.0`, `black-forest-labs/FLUX.1-schnell` | `stabilityai/stable-diffusion-xl-base-1.0` |
| `TOGETHER_API_KEY` | Required for image generation. | *(Your Key)* |
| `OPENAI_API_KEY` | Required only if `LLM_PROVIDER=openai`. | *(Your Key)* |
| `OLLAMA_URL` | The endpoint for your local Ollama instance. | `http://host.docker.internal:11434` |
| `IG_USERNAME` | Optional. Required for automatic Instagram Reels upload. | *(Your Instagram Username)* |
| `IG_PASSWORD` | Optional. Required for automatic Instagram Reels upload. | *(Your Instagram Password)* |
| `GMAIL_USERNAME` | Optional. Required for bypassing Instagram email verification challenge. | *(Your Gmail address)* |
| `GMAIL_APP_PASSWORD` | Optional. App Password for Gmail IMAP access. | *(Your Gmail App Password)* |

## Getting Started

1. **Configure API Keys**
   Create a `.env` file in the root of your project (or edit the existing one) and add your environment variables:
   ```env
   LLM_PROVIDER=together
   LLM_MODEL=google/gemma-4-31B-it
   IMAGE_MODEL=stabilityai/stable-diffusion-xl-base-1.0
   TOGETHER_API_KEY=your_together_key_here
   OPENAI_API_KEY=your_openai_key_here
   OLLAMA_URL=http://host.docker.internal:11434
   IG_USERNAME=your_ig_username
   IG_PASSWORD=your_ig_password
   GMAIL_USERNAME=your_gmail@gmail.com
   GMAIL_APP_PASSWORD=your_gmail_app_password
   ```
   
2. **Build and Run**
   Start the entire stack in detached mode:
   ```bash
   docker-compose up --build -d
   ```

3. **Access the Application**
   - **UI**: Open your browser and navigate to `http://localhost:5173`
   - **API Gateway**: Running on `http://localhost:3000`

4. **Monitor Worker Logs**
   To watch the AI generate your video in real-time:
   ```bash
   docker-compose logs -f video-render-worker
   ```

## Output
All generated videos are saved locally in the `./output` directory relative to your project root.
