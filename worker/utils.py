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
from PIL import Image, ImageDraw, ImageFont
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

def draw_cheatsheet_image(data, out_path):
    try:
        import textwrap
        
        # Dimensions: 9:16 vertical video frame
        w, h = 576, 1024
        img = Image.new("RGB", (w, h), color=(10, 10, 10)) # Premium deep dark background
        draw = ImageDraw.Draw(img)
        
        # Fonts
        font_path_bold = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
        font_path_mono = "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf"
        font_path_reg = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
        
        # Fallback to default if font paths don't exist
        try:
            title_font = ImageFont.truetype(font_path_bold, 28)
            subtitle_font = ImageFont.truetype(font_path_reg, 14)
            header_font = ImageFont.truetype(font_path_bold, 16)
            label_font = ImageFont.truetype(font_path_bold, 14)
            value_font = ImageFont.truetype(font_path_mono, 12)
            bullet_font = ImageFont.truetype(font_path_reg, 14)
        except Exception:
            title_font = ImageFont.load_default()
            subtitle_font = ImageFont.load_default()
            header_font = ImageFont.load_default()
            label_font = ImageFont.load_default()
            value_font = ImageFont.load_default()
            bullet_font = ImageFont.load_default()
            
        title = data.get("title", "CHEATSHEET SUMMARY").upper()
        subtitle = data.get("subtitle", "Key details and comparisons")
        
        # 1. Draw Title Box
        # Title Accent Header
        draw.rectangle([20, 30, w - 20, 34], fill=(43, 102, 255)) # Accent bar
        
        # Title text
        draw.text((25, 45), title, fill=(255, 255, 255), font=title_font)
        
        # Subtitle text
        draw.text((25, 85), subtitle, fill=(180, 180, 180), font=subtitle_font)
        
        # Divider line
        draw.line([20, 115, w - 20, 115], fill=(50, 50, 50), width=1)
        
        # 2. Draw content based on type (Comparison Table vs Bullet List)
        columns = data.get("columns")
        items = data.get("items")
        bullets = data.get("bullets")
        
        if columns and items:
            # Draw Comparison Layout (Table)
            aspect_header = "Aspect"
            col1_header = columns[0]
            col2_header = columns[1]
            
            y_offset = 140
            
            # Draw table headers
            draw.text((30, y_offset), aspect_header, fill=(130, 130, 255), font=header_font)
            draw.text((180, y_offset), col1_header, fill=(255, 255, 255), font=header_font)
            draw.text((380, y_offset), col2_header, fill=(255, 255, 255), font=header_font)
            
            y_offset += 30
            draw.line([20, y_offset, w - 20, y_offset], fill=(60, 60, 60), width=1)
            y_offset += 15
            
            # Draw items rows
            for item in items[:5]: # Max 5 items
                lbl = item.get("label", "")
                val1 = item.get("val1", "")
                val2 = item.get("val2", "")
                
                # Draw Aspect label
                draw.text((30, y_offset), lbl, fill=(180, 180, 180), font=label_font)
                
                # Wrap values to fit column widths
                val1_lines = textwrap.wrap(val1, width=22)
                val2_lines = textwrap.wrap(val2, width=22)
                
                max_lines = max(len(val1_lines), len(val2_lines), 1)
                
                # Draw Column 1 wrapped value
                for line_idx, line in enumerate(val1_lines):
                    draw.text((180, y_offset + line_idx * 16), line, fill=(220, 220, 220), font=value_font)
                    
                # Draw Column 2 wrapped value
                for line_idx, line in enumerate(val2_lines):
                    draw.text((380, y_offset + line_idx * 16), line, fill=(220, 220, 220), font=value_font)
                    
                y_offset += max_lines * 16 + 20
                draw.line([20, y_offset - 10, w - 20, y_offset - 10], fill=(40, 40, 40), width=1)
                
        elif bullets:
            # Draw List Card Layout
            y_offset = 150
            for b_idx, bullet in enumerate(bullets[:5]): # Max 5 bullets
                card_top = y_offset
                card_bottom = card_top + 100
                
                draw.rectangle([20, card_top, w - 20, card_bottom], fill=(20, 20, 20), outline=(40, 40, 40), width=1)
                
                # Draw bullet indicator (small square)
                draw.rectangle([35, card_top + 20, 43, card_top + 28], fill=(43, 102, 255))
                
                # Wrap text
                wrapped_lines = textwrap.wrap(bullet, width=52)
                for line_idx, line in enumerate(wrapped_lines[:3]):
                    draw.text((60, card_top + 15 + line_idx * 18), line, fill=(240, 240, 240), font=bullet_font)
                    
                y_offset += 120
                
        # 3. Draw Detailed Example block at the bottom if present
        example_code = data.get("example_code")
        example_language = data.get("example_language", "text")
        
        if example_code:
            logger.info("Cheatsheet has example code. Generating pygments highlighted block...")
            example_y = max(y_offset + 30, 520) if (columns and items) else 520
            
            try:
                from pygments import highlight
                from pygments.lexers import get_lexer_by_name
                from pygments.formatters import ImageFormatter
                from pygments.styles import get_style_by_name
                import io
                
                try:
                    lexer = get_lexer_by_name(example_language)
                except Exception:
                    lexer = get_lexer_by_name("text")
                    
                # Wrap long code lines to fit nicely in 536 width
                wrapped_lines = []
                for line in example_code.split('\n'):
                    if len(line) > 36:
                        wrapped_lines.extend(textwrap.wrap(line, width=36))
                    else:
                        wrapped_lines.append(line)
                wrapped_snippet = '\n'.join(wrapped_lines[:8]) # Max 8 lines
                
                style = get_style_by_name('monokai')
                formatter = ImageFormatter(font_name='Liberation Mono', font_size=28, style=style, line_numbers=False)
                code_png_data = highlight(wrapped_snippet, lexer, formatter)
                
                code_img = Image.open(io.BytesIO(code_png_data)).convert("RGBA")
                
                card_x = 20
                card_w = w - 40 # 536
                card_h = code_img.height + 40
                
                # Draw section title
                draw.text((card_x + 5, example_y - 25), "CODE EXAMPLE //", fill=(130, 130, 255), font=header_font)
                
                # Draw card background & border
                draw.rectangle(
                    [card_x, example_y, card_x + card_w, example_y + card_h],
                    fill=(20, 20, 20),
                    outline=(60, 60, 60),
                    width=1
                )
                
                # Center code image inside the card container
                code_x = card_x + (card_w - code_img.width) // 2
                code_y = example_y + 20
                
                # Paste the syntax-highlighted code block image
                img.paste(code_img, (code_x, code_y), code_img)
                logger.info("Cheatsheet example code block pasted successfully")
            except Exception as e:
                logger.error(f"Failed to render cheatsheet example code: {e}")

        # 4. Draw Footer Brand Overlay
        footer_top = h - 80
        draw.line([20, footer_top, w - 20, footer_top], fill=(50, 50, 50), width=1)
        draw.text((25, footer_top + 20), "TECHNICAL REFERENCE SUMMARY", fill=(100, 100, 100), font=subtitle_font)
        draw.rectangle([w - 40, footer_top + 22, w - 20, footer_top + 34], fill=(43, 102, 255)) # tiny end block
        
        # Save image
        img.save(out_path)
        logger.info(f"Programmatic cheatsheet drawn successfully at {out_path}")
        return True
    except Exception as e:
        logger.error(f"Failed to draw cheatsheet image: {e}")
        return False

def is_job_cancelled(job_id) -> bool:
    conn = get_db_connection()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT status FROM jobs WHERE id = %s", (job_id,))
            row = cur.fetchone()
            if row and row[0] == "CANCELLED":
                return True
    except Exception as e:
        logger.error(f"Error checking job cancellation status: {e}")
    finally:
        if conn:
            conn.close()
    return False
