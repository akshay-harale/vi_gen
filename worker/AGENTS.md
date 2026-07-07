# Video Render Worker

This directory contains the Python worker that forms the core engine of the `vi_gen` pipeline.

## Architecture
The worker is built using **LangGraph** (a state machine library for LLMs) to orchestrate the video generation process as a sequential workflow graph. 
The main script is `main.py`, and it runs an infinite loop popping jobs from the Redis queue.

## Node Pipeline
The LangGraph pipeline (`build_graph()`) consists of the following nodes:
1. **`generate_script_segments`**: Uses an LLM (Ollama, OpenAI, or Together AI) to generate a multi-segment script based on the user prompt. It outputs narration text, image prompts, and optional code snippets.
2. **`generate_audio`**: Iterates through each segment and calls the `Kokoro` TTS model to generate `.wav` files for the narration.
3. **`generate_images`**: Calls the Together AI API (`black-forest-labs/FLUX.1.1-pro` or similar) to generate vertical 9:16 background images. **Code Overlay**: If a segment contains a `code_snippet`, this node uses `Pygments` to render a syntax-highlighted PNG of the code and `Pillow` (PIL) to perfectly overlay it onto the AI-generated background.
4. **`compile_video`**: Uses `moviepy` (v2.x) to stitch the images and audio clips together into a final `.mp4` video.
5. **`upload_to_instagram`**: An optional node that uses `instagrapi` to upload the final video as an Instagram Reel. It features an automated email challenge resolver via IMAP if Instagram triggers a security block.

## Dependencies & Docker
- System dependencies (like `imagemagick`, `espeak-ng`) are installed via the Dockerfile to support MoviePy and Kokoro TTS.
- HuggingFace models for Kokoro are pre-downloaded via `download_models.py` during the Docker build process to avoid runtime hangs.
- All file outputs (audio, images, and the final video) are written to the `/app/output` directory, which is volume-mapped to the host in `docker-compose.yml`.
