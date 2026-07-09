import os
import json
import logging
import ssl
import urllib3
import requests
import httpx
import psycopg2
from typing import TypedDict, List, Dict, Any
from huggingface_hub import file_download
from PIL import Image, ImageDraw
from pygments import highlight
from pygments.lexers import get_lexer_by_name
from pygments.formatters import ImageFormatter
from pygments.styles import get_style_by_name
import io

# Configure standard logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('Worker')

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

# --- ENV & DATABASE STRINGS ---
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

def get_db_connection():
    try:
        conn = psycopg2.connect(DB_URL)
        conn.autocommit = True
        return conn
    except Exception as e:
        logger.error(f"Failed to connect to Database: {e}")
        return None

def get_system_prompt_from_db():
    conn = get_db_connection()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT value FROM settings WHERE key = 'system_prompt'")
            row = cur.fetchone()
            if row:
                return row[0]
    except Exception as e:
        logger.error(f"Error fetching system prompt from DB: {e}")
    finally:
        if conn:
            conn.close()
    return None

def get_all_settings_from_db():
    conn = get_db_connection()
    settings = {}
    if not conn:
        return settings
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT key, value FROM settings")
            rows = cur.fetchall()
            for row in rows:
                settings[row[0]] = row[1]
    except Exception as e:
        logger.error(f"Error fetching all settings from DB: {e}")
    finally:
        if conn:
            conn.close()
    return settings

def get_job_from_db(job_id):
    conn = get_db_connection()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT prompt, script FROM jobs WHERE id = %s", (job_id,))
            row = cur.fetchone()
            if row:
                return {
                    "prompt": row[0],
                    "script": row[1]
                }
    except Exception as e:
        logger.error(f"Error fetching job {job_id} from DB: {e}")
    finally:
        if conn:
            conn.close()
    return None

def update_step_status(job_id, step, status):
    conn = get_db_connection()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE jobs SET step_status = COALESCE(step_status, '{}'::jsonb) || %s WHERE id = %s",
                (json.dumps({step: status}), job_id)
            )
    except Exception as e:
        logger.error(f"Error updating step status for {job_id} ({step} -> {status}): {e}")
    finally:
        if conn:
            conn.close()

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

def overlay_code_snippet(bg_path, out_path, code_snippet, code_language):
    try:
        logger.info(f"Overlaying code snippet on background {bg_path} -> {out_path}")
        try:
            lexer = get_lexer_by_name(code_language)
        except Exception:
            lexer = get_lexer_by_name("text")
            
        wrapped_lines = []
        for line in code_snippet.split('\n'):
            if len(line) > 40:
                import textwrap
                wrapped_lines.extend(textwrap.wrap(line, width=40))
            else:
                wrapped_lines.append(line)
        wrapped_snippet = '\n'.join(wrapped_lines)
            
        style = get_style_by_name('monokai')
        formatter = ImageFormatter(font_name='Liberation Mono', font_size=52, style=style, line_numbers=False)
        code_png_data = highlight(wrapped_snippet, lexer, formatter)
        
        code_img = Image.open(io.BytesIO(code_png_data)).convert("RGBA")
        
        bg = Image.open(bg_path).convert("RGBA")
        
        max_width = bg.width - 40
        if code_img.width > max_width:
            ratio = max_width / code_img.width
            new_h = int(code_img.height * ratio)
            code_img = code_img.resize((max_width, new_h), Image.Resampling.LANCZOS)
            
        x = (bg.width - code_img.width) // 2
        y = (bg.height - code_img.height) // 2
        
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
        logger.info("Code overlaid successfully")
        return True
    except Exception as e:
        logger.error(f"Failed to overlay code snippet: {e}")
        return False
