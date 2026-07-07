import os
import json
import logging

# Configure standard logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('Worker')
import time
import ssl
import urllib3
import requests
import httpx
import redis
import psycopg2
import subprocess
from typing import TypedDict, List, Dict, Any
from langgraph.graph import StateGraph, END
from together import Together
from moviepy import ImageClip, AudioFileClip, concatenate_videoclips
import imaplib
import email
import re
from instagrapi import Client
from instagrapi.mixins.challenge import ChallengeChoice
from PIL import Image, ImageDraw
from pygments import highlight
from pygments.lexers import get_lexer_by_name, get_lexer_for_filename
from pygments.formatters import ImageFormatter
from pygments.styles import get_style_by_name
import io

# --- SSL BYPASS FOR CORPORATE VPN ---
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
ssl._create_default_https_context = ssl._create_unverified_context

old_create_default_context = ssl.create_default_context
def new_create_default_context(*args, **kwargs):
    ctx = old_create_default_context(*args, **kwargs)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx
ssl.create_default_context = new_create_default_context

old_request = requests.Session.request
def new_request(*args, **kwargs):
    kwargs['verify'] = False
    return old_request(*args, **kwargs)
requests.Session.request = new_request

old_httpx_client_init = httpx.Client.__init__
def new_httpx_client_init(self, *args, **kwargs):
    kwargs['verify'] = False
    old_httpx_client_init(self, *args, **kwargs)
httpx.Client.__init__ = new_httpx_client_init

# --- HUGGINGFACE FILENAME & HANG PATCH ---
# Models are now pre-downloaded in the Dockerfile! 
# We just need to patch huggingface_hub to return the pre-downloaded paths.
from huggingface_hub import file_download
old_hf_hub_download = file_download.hf_hub_download
def new_hf_hub_download(*args, **kwargs):
    fname = kwargs.get('filename')
    if not fname and len(args) > 1:
        fname = args[1]
    if fname in ['kokoro-v0_19.pth', 'kokoro-v1_0.pth']:
        return '/app/kokoro-v1_0.pth'
    if fname == 'voices/af_heart.pt' or fname == 'af_heart.pt':
        return '/app/af_heart.pt'
    return old_hf_hub_download(*args, **kwargs)
file_download.hf_hub_download = new_hf_hub_download
# ------------------------------------

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
DB_URL = os.getenv("DB_URL", "postgres://user:pass@localhost:5432/videodb")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama").lower()
LLM_MODEL = os.getenv("LLM_MODEL", "qwen3:8b")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
API_URL = os.getenv("API_URL", "http://localhost:3000")
TOGETHER_API_KEY = os.getenv("TOGETHER_API_KEY")
IMAGE_MODEL = os.getenv("IMAGE_MODEL", "stabilityai/stable-diffusion-xl-base-1.0")

IG_USERNAME = os.getenv("IG_USERNAME", "")
IG_PASSWORD = os.getenv("IG_PASSWORD", "")
GMAIL_USERNAME = os.getenv("GMAIL_USERNAME", "")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")

class WorkflowState(TypedDict):
    job_id: str
    prompt: str
    segments: List[Dict[str, str]]
    audio_paths: List[str]
    image_paths: List[str]
    output_video_path: str
    error: str

def generate_script_segments(state: WorkflowState) -> WorkflowState:
    logger.info(f"[Node: Script] Generating script for {state['job_id']} using {LLM_PROVIDER} ({LLM_MODEL})")
    system_prompt = """You are a video script writer creating content for YouTube Shorts or Instagram Reels (Vertical 9:16 format). 
Based on the prompt, generate a JSON object with a list of 'segments'.
Each segment should have:
- 'text': the narration text (keep it engaging and concise, 2-3 sentences max per segment)
- 'image_prompt': a highly detailed, descriptive prompt for an AI image generator to create a visual for this segment. (e.g. "A blurry cinematic shot of a glowing server room").
- 'code_snippet' (optional): If the segment involves programming concepts, provide the exact code block. IMPORTANT: Code will be displayed on a vertical phone screen. You MUST format the code with short lines (maximum 35 characters per line) by adding line breaks and proper indentation. Keep it under 8 lines total.
- 'code_language' (optional): The programming language for the code snippet (e.g. "java").

IMPORTANT: The images will be generated in a vertical 9:16 aspect ratio. Instruct the image generator to compose the shot vertically.

Respond ONLY with valid JSON.
Example format:
{
  "segments": [
    {
      "text": "...", 
      "image_prompt": "A vertical composition of a dark IDE screen...",
      "code_snippet": "List<String> lines =\n    Files.readAllLines(\n        Paths.get(\"file.txt\")\n    );",
      "code_language": "java"
    }
  ]
}
"""

    max_retries = 3
    for attempt in range(max_retries):
        try:
            if LLM_PROVIDER == "openai":
                headers = {"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"}
                payload = {
                    "model": LLM_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": state['prompt']}
                    ],
                    "response_format": {"type": "json_object"},
                    "max_tokens": 4000
                }
                res = requests.post("https://api.openai.com/v1/chat/completions", json=payload, headers=headers)
                res.raise_for_status()
                output = res.json()["choices"][0]["message"]["content"]
                
            elif LLM_PROVIDER == "together":
                headers = {"Authorization": f"Bearer {TOGETHER_API_KEY}", "Content-Type": "application/json"}
                payload = {
                    "model": LLM_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": state['prompt']}
                    ],
                    "response_format": {"type": "json_object"},
                    "max_tokens": 4000
                }
                res = requests.post("https://api.together.xyz/v1/chat/completions", json=payload, headers=headers)
                res.raise_for_status()
                output = res.json()["choices"][0]["message"]["content"]
                
            else: # Default to ollama
                res = requests.post(f"{OLLAMA_URL}/api/generate", json={
                    "model": LLM_MODEL,
                    "prompt": f"{system_prompt}\n\nPrompt: {state['prompt']}",
                    "stream": False,
                    "format": "json"
                })
                res.raise_for_status()
                output = res.json().get("response", "{}")
            
            # Clean up possible markdown wrappers
            output = output.strip()
            if output.startswith("```json"):
                output = output[7:]
            elif output.startswith("```"):
                output = output[3:]
            if output.endswith("```"):
                output = output[:-3]
            output = output.strip()
            
            logger.info(f"<- LLM Raw Output (Attempt {attempt+1}):\n{output}")
            
            # Parse JSON
            parsed = json.loads(output)
            
            if isinstance(parsed, dict) and "segments" in parsed:
                segments = parsed["segments"]
            elif isinstance(parsed, list):
                segments = parsed
            else:
                segments = [parsed]
                
            state["segments"] = segments
            return state
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON on attempt {attempt+1}: {e}")
            if attempt == max_retries - 1:
                state["error"] = f"Failed to generate valid JSON after {max_retries} attempts: {str(e)}"
                return state
        except Exception as e:
            logger.error(f"API request failed on attempt {attempt+1}: {e}")
            if attempt == max_retries - 1:
                state["error"] = str(e)
                return state
    return state

import soundfile as sf
import numpy as np
from kokoro import KPipeline
import torch

# Initialize Kokoro Pipeline globally
tts_pipeline = KPipeline(lang_code='a')

def generate_audio(state: WorkflowState) -> WorkflowState:
    if state.get("error"): return state
    logger.info(f"[Node: Audio] Generating audio via Kokoro for {state['job_id']}")
    
    audio_paths = []
    for idx, seg in enumerate(state.get("segments", [])):
        text = seg.get("text", "")
        if not text:
            continue
        out_path = f"/app/output/{state['job_id']}_{idx}.wav"
        
        try:
            generator = tts_pipeline(text, voice='af_heart', speed=1)
            all_audio = []
            for i, (gs, ps, audio) in enumerate(generator):
                all_audio.append(audio)
            
            if not all_audio:
                continue
                
            final_audio = np.concatenate(all_audio)
            sf.write(out_path, final_audio, 24000)
            
            audio_paths.append(out_path)
            logger.info(f"[Node: Audio] Generated audio for segment {idx+1}/{len(state.get('segments', []))}")
        except Exception as e:
            logger.error(f"Kokoro failed for segment {idx}: {e}")
            state["error"] = str(e)
            return state
            
    state["audio_paths"] = audio_paths
    return state

def generate_images(state: WorkflowState) -> WorkflowState:
    if state.get("error"): return state
    logger.info(f"[Node: Images] Generating images via Together AI for {state['job_id']}")
    
    if not TOGETHER_API_KEY:
        state["error"] = "Missing TOGETHER_API_KEY"
        return state
        
    client = Together(api_key=TOGETHER_API_KEY)
    image_paths = []
    
    for idx, seg in enumerate(state.get("segments", [])):
        img_prompt = seg.get("image_prompt", "")
        out_path = f"/app/output/{state['job_id']}_{idx}.jpg"
        try:
            payload = {
                "prompt": img_prompt,
                "model": IMAGE_MODEL,
                "width": 576,
                "height": 1024,
                "response_format": "b64_json"
                # Not sending 'steps' at all to avoid the 400 error
            }
            
            headers = {
                "Authorization": f"Bearer {TOGETHER_API_KEY}",
                "Content-Type": "application/json"
            }
            
            response = requests.post("https://api.together.xyz/v1/images/generations", json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            
            # Extract image either from base64 or URL
            image_obj = data.get("data", [{}])[0]
            if image_obj.get("b64_json"):
                import base64
                with open(out_path, 'wb') as handler:
                    handler.write(base64.b64decode(image_obj["b64_json"]))
            elif image_obj.get("url"):
                img_data = requests.get(image_obj["url"]).content
                with open(out_path, 'wb') as handler:
                    handler.write(img_data)
            else:
                raise Exception(f"No image data found in response object: {image_obj}")
                
            # If the segment contains code, overlay it using Pygments and PIL
            code_snippet = seg.get("code_snippet")
            code_language = seg.get("code_language", "text")
            if code_snippet:
                try:
                    logger.info(f"Overlaying code snippet for {state['job_id']} segment {idx}")
                    try:
                        lexer = get_lexer_by_name(code_language)
                    except Exception:
                        lexer = get_lexer_by_name("text")
                        
                    # Manually wrap very long lines as a fallback
                    wrapped_lines = []
                    for line in code_snippet.split('\n'):
                        if len(line) > 40:
                            import textwrap
                            # wrap preserves existing indents if possible, but we just want to forcefully wrap long lines
                            wrapped_lines.extend(textwrap.wrap(line, width=40))
                        else:
                            wrapped_lines.append(line)
                    wrapped_snippet = '\n'.join(wrapped_lines)
                        
                    style = get_style_by_name('monokai')
                    formatter = ImageFormatter(font_name='Liberation Mono', font_size=52, style=style, line_numbers=False)
                    code_png_data = highlight(wrapped_snippet, lexer, formatter)
                    
                    code_img = Image.open(io.BytesIO(code_png_data)).convert("RGBA")
                    
                    # Open the background image
                    bg = Image.open(out_path).convert("RGBA")
                    
                    # Resize code image if it's wider than the background (with 40px padding)
                    max_width = bg.width - 40
                    if code_img.width > max_width:
                        ratio = max_width / code_img.width
                        new_h = int(code_img.height * ratio)
                        code_img = code_img.resize((max_width, new_h), Image.Resampling.LANCZOS)
                        
                    # Center the code image
                    x = (bg.width - code_img.width) // 2
                    y = (bg.height - code_img.height) // 2
                    
                    # Create a semi-transparent black box behind the code
                    draw = ImageDraw.Draw(bg, 'RGBA')
                    padding = 20
                    draw.rectangle(
                        [x - padding, y - padding, x + code_img.width + padding, y + code_img.height + padding],
                        fill=(0, 0, 0, 180),
                        outline=(255, 255, 255, 50),
                        width=2
                    )
                    
                    bg.paste(code_img, (x, y), code_img)
                    bg.convert("RGB").save(out_path)
                    logger.info(f"Code overlaid successfully for {state['job_id']} segment {idx}")
                except Exception as e:
                    logger.error(f"Failed to overlay code: {e}")
            
            image_paths.append(out_path)
            logger.info(f"[Node: Images] Generated image for segment {idx+1}/{len(state.get('segments', []))}")
        except Exception as e:
            logger.error(f"Image generation failed for segment {idx}: {e}")
            if hasattr(e, 'response') and e.response is not None:
                logger.info(f"Response Body: {e.response.text}")
            state["error"] = str(e)
            return state

    state["image_paths"] = image_paths
    return state

def compile_video(state: WorkflowState) -> WorkflowState:
    if state.get("error"): return state
    logger.info(f"[Node: Compile] Compiling final video for {state['job_id']}")
    
    audio_paths = state.get("audio_paths", [])
    image_paths = state.get("image_paths", [])
    
    if len(audio_paths) != len(image_paths):
        state["error"] = "Mismatch in audio/image counts"
        return state
        
    try:
        clips = []
        for a_path, i_path in zip(audio_paths, image_paths):
            audio_clip = AudioFileClip(a_path)
            # Make the image clip last exactly as long as the audio
            img_clip = ImageClip(i_path).with_duration(audio_clip.duration).with_audio(audio_clip)
            clips.append(img_clip)
            
        final_video = concatenate_videoclips(clips, method="compose")
        out_path = f"/app/output/{state['job_id']}.mp4"
        
        # We can suppress moviepy's internal stdout to keep logs clean, but it's okay for now
        final_video.write_videofile(out_path, fps=24, codec="libx264", audio_codec="aac")
        
        state["output_video_path"] = out_path
        logger.info(f"[Node: Compile] Video compiled successfully to {out_path}")
    except Exception as e:
        logger.error(f"Video compilation failed: {e}")
        state["error"] = str(e)
        
    return state

def get_code_from_email(username):
    logger.info("Attempting to fetch Instagram verification code from Gmail...")
    try:
        mail = imaplib.IMAP4_SSL("imap.gmail.com")
        mail.login(GMAIL_USERNAME, GMAIL_APP_PASSWORD)
        mail.select("inbox")
        
        # Search for recent emails from Instagram
        result, data = mail.search(None, '(FROM "security@mail.instagram.com")')
        
        if not data[0]:
            logger.error("No emails found from Instagram.")
            return False
            
        # Get the latest email
        latest_email_id = data[0].split()[-1]
        result, message_data = mail.fetch(latest_email_id, '(RFC822)')
        
        raw_email = message_data[0][1]
        msg = email.message_from_bytes(raw_email)
        
        # Extract the code using regex
        subject = msg["Subject"]
        if subject:
            match = re.search(r'^(\d{6})', subject)
            if match:
                code = match.group(1)
                logger.info(f"Successfully extracted code {code} from email subject.")
                return code
                
        # If not in subject, check body
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    body = part.get_payload(decode=True).decode()
                    match = re.search(r'\b(\d{6})\b', body)
                    if match:
                        code = match.group(1)
                        logger.info(f"Successfully extracted code {code} from email body.")
                        return code
        else:
            body = msg.get_payload(decode=True).decode()
            match = re.search(r'\b(\d{6})\b', body)
            if match:
                code = match.group(1)
                logger.info(f"Successfully extracted code {code} from email body.")
                return code
                
        logger.error("Could not find a 6-digit code in the email.")
        return False
        
    except Exception as e:
        logger.error(f"Failed to fetch code from email: {e}")
        return False

def challenge_code_handler(username, choice):
    if choice == ChallengeChoice.EMAIL:
        logger.info("Instagram requested an EMAIL challenge.")
        return get_code_from_email(username)
    elif choice == ChallengeChoice.SMS:
        logger.warning("Instagram requested an SMS challenge, which we cannot automate.")
        return False
    return False

def upload_to_instagram(state: WorkflowState) -> WorkflowState:
    if state.get("error"): return state
    logger.info(f"[Node: Upload] Uploading video to Instagram for {state['job_id']}")
    
    if not IG_USERNAME or not IG_PASSWORD:
        state["error"] = "Missing Instagram credentials in .env"
        return state
        
    video_path = state.get("output_video_path")
    if not video_path or not os.path.exists(video_path):
        state["error"] = "No compiled video found to upload"
        return state
        
    try:
        thumbnail_path = state.get("image_paths")[0] if state.get("image_paths") else None
        
        cl = Client()
        cl.challenge_code_handler = challenge_code_handler
        
        logger.info(f"Logging in to Instagram as {IG_USERNAME}...")
        cl.login(IG_USERNAME, IG_PASSWORD)
        
        caption = state.get("segments", [])[0].get("text", "Automated Video") if state.get("segments") else "Automated Video"
        caption += "\n\n#shorts #reels #ai"
        
        logger.info(f"Uploading Reel with caption: {caption}")
        media = cl.clip_upload(
            path=video_path,
            caption=caption,
            thumbnail=thumbnail_path
        )
        logger.info(f"[Node: Upload] Successfully uploaded to Instagram! Media ID: {media.pk}")
    except Exception as e:
        logger.error(f"[Error] Instagram upload failed: {e}")
        state["error"] = f"Instagram Upload Error: {str(e)}"
        
    return state

def build_graph():
    workflow = StateGraph(WorkflowState)
    workflow.add_node("script", generate_script_segments)
    workflow.add_node("audio", generate_audio)
    workflow.add_node("image", generate_images)
    workflow.add_node("compile", compile_video)
    workflow.add_node("upload", upload_to_instagram)
    
    workflow.add_edge("script", "audio")
    workflow.add_edge("audio", "image")
    workflow.add_edge("image", "compile")
    workflow.add_edge("compile", "upload")
    workflow.add_edge("upload", END)
    
    workflow.set_entry_point("script")
    return workflow.compile()

def get_db_connection():
    try:
        conn = psycopg2.connect(DB_URL)
        conn.autocommit = True
        return conn
    except Exception as e:
        logger.error(f"Failed to connect to Database: {e}")
        return None

def update_job_status(conn, job_id, status, script=None, video_url=None):
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            if script and video_url:
                cur.execute("UPDATE jobs SET status = %s, script = %s, video_url = %s WHERE id = %s", (status, script, video_url, job_id))
            elif script:
                cur.execute("UPDATE jobs SET status = %s, script = %s WHERE id = %s", (status, script, job_id))
            elif video_url:
                cur.execute("UPDATE jobs SET status = %s, video_url = %s WHERE id = %s", (status, video_url, job_id))
            else:
                cur.execute("UPDATE jobs SET status = %s WHERE id = %s", (status, job_id))
            logger.info(f"[Worker DB] Updated job {job_id} to {status}")
    except Exception as e:
        logger.error(f"Error updating DB: {e}")

def main():
    logger.info(f"Starting Video Render Worker (LangGraph)... Connecting to {REDIS_URL}")
    r = redis.from_url(REDIS_URL)
    
    conn = get_db_connection()
    if not conn:
        logger.info("Waiting for database...")
        time.sleep(5)
        conn = get_db_connection()

    app = build_graph()
    os.makedirs("/app/output", exist_ok=True)

    while True:
        try:
            result = r.blpop("job_queue", timeout=5)
            if result:
                _, message = result
                job_data = json.loads(message)
                job_id = job_data.get("jobId")
                prompt = job_data.get("prompt")

                logger.info(f"[Worker] Picked up job {job_id} with prompt: '{prompt}'")
                update_job_status(conn, job_id, "PROCESSING")

                initial_state = {
                    "job_id": job_id,
                    "prompt": prompt,
                    "segments": [],
                    "audio_paths": [],
                    "image_paths": [],
                    "output_video_path": "",
                    "error": ""
                }
                
                final_state = app.invoke(initial_state)
                
                if final_state.get("error"):
                    logger.error(f"[Worker] Job {job_id} FAILED with error: {final_state['error']}")
                    script_str = json.dumps(final_state.get("segments", []), indent=2) if final_state.get("segments") else None
                    video_url = f"/output/{job_id}.mp4" if final_state.get("output_video_path") else None
                    update_job_status(conn, job_id, "FAILED", script=script_str, video_url=video_url)
                else:
                    logger.info(f"[Worker] Completed job {job_id}")
                    # Convert JSON segments back to string for DB
                    script_str = json.dumps(final_state.get("segments", []), indent=2)
                    video_url = f"/output/{job_id}.mp4"
                    update_job_status(conn, job_id, "COMPLETED", script=script_str, video_url=video_url)
                    
        except Exception as e:
            logger.error(f"Worker loop error: {e}")
            time.sleep(1)
            if conn and conn.closed != 0:
                 conn = get_db_connection()

if __name__ == "__main__":
    main()
