import os
import json
import logging
import requests
import imaplib
import email
import re
import soundfile as sf
import numpy as np
from kokoro import KPipeline
from instagrapi import Client
from instagrapi.mixins.challenge import ChallengeChoice
from moviepy import ImageClip, AudioFileClip, concatenate_videoclips
from utils import (
    logger, WorkflowState, get_all_settings_from_db, get_system_prompt_from_db, 
    update_step_status, overlay_code_snippet, draw_cheatsheet_image, is_job_cancelled, LLM_PROVIDER, LLM_MODEL, 
    OPENAI_API_KEY, TOGETHER_API_KEY, OLLAMA_URL, IMAGE_MODEL, IG_USERNAME, 
    IG_PASSWORD, GMAIL_USERNAME, GMAIL_APP_PASSWORD
)

# Initialize Kokoro Pipeline globally
tts_pipeline = KPipeline(lang_code='a')

def generate_script_segments(state: WorkflowState) -> WorkflowState:
    if state.get("error"): return state
    if is_job_cancelled(state['job_id']):
        state["error"] = "CANCELLED"
        update_step_status(state['job_id'], 'script', 'failed')
        return state
    if state.get("segments"):
        logger.info(f"[Node: Script] Segments already present, skipping generation")
        update_step_status(state['job_id'], 'script', 'completed')
        return state

    db_settings = get_all_settings_from_db()
    llm_provider = db_settings.get("llm_provider", LLM_PROVIDER).lower()
    llm_model = db_settings.get("llm_model", LLM_MODEL)
    openai_api_key = db_settings.get("openai_api_key", OPENAI_API_KEY)
    together_api_key = db_settings.get("together_api_key", TOGETHER_API_KEY)
    ollama_url = db_settings.get("ollama_url", OLLAMA_URL)

    logger.info(f"[Node: Script] Generating script for {state['job_id']} using {llm_provider} ({llm_model})")
    update_step_status(state['job_id'], 'script', 'processing')
    
    # Load system prompt from database
    system_prompt = get_system_prompt_from_db()
    if not system_prompt:
        logger.info("Using hardcoded system prompt fallback")
        system_prompt = """You are a video script writer creating content for YouTube Shorts or Instagram Reels (Vertical 9:16 format). 
Based on the prompt, generate a JSON object with a list of 'segments'.
Each segment should have:
- 'text': the narration text (keep it engaging and concise, 2-3 sentences max per segment)
- 'image_prompt': a highly detailed, descriptive prompt for an AI image generator to create a visual for this segment.
  VISUAL THEME: The visual aesthetic must represent a clean, high-contrast engineering schematic, 2D technical vector diagram, or blueprint layout (e.g. "A minimal 2D vector blueprint diagram of... crisp white lines on a pure black background, blueprint schematic aesthetics, hardware details, high-contrast technical line art"). Avoid detailed real-world photos, photorealism, and blurry 3D environments.
- 'code_snippet' (optional): If the segment involves programming concepts, provide the exact code block. IMPORTANT: Code will be displayed on a vertical phone screen. You MUST format the code with short lines (maximum 35 characters per line) by adding line breaks and proper indentation. Keep it under 8 lines total.
- 'code_language' (optional): The programming language for the code snippet (e.g. "java").

IMPORTANT: The images will be generated in a vertical 9:16 aspect ratio. Instruct the image generator to compose the shot vertically.

Respond ONLY with valid JSON.
Example format:
{
  "segments": [
    {
      "text": "...", 
      "image_prompt": "A minimal 2D vector schematic blueprint diagram of a filesystem structure with dark background, crisp white lines...",
      "code_snippet": "List<String> lines =\n    Files.readAllLines(\n        Paths.get(\"file.txt\")\n    );",
      "code_language": "java"
    }
  ]
}
"""

    max_retries = 3
    for attempt in range(max_retries):
        try:
            if llm_provider == "openai":
                headers = {"Authorization": f"Bearer {openai_api_key}", "Content-Type": "application/json"}
                payload = {
                    "model": llm_model,
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
                
            elif llm_provider == "together":
                headers = {"Authorization": f"Bearer {together_api_key}", "Content-Type": "application/json"}
                payload = {
                    "model": llm_model,
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
                res = requests.post(f"{ollama_url}/api/generate", json={
                    "model": llm_model,
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
            update_step_status(state['job_id'], 'script', 'completed')
            return state
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON on attempt {attempt+1}: {e}")
            if attempt == max_retries - 1:
                state["error"] = f"Failed to generate valid JSON after {max_retries} attempts: {str(e)}"
                update_step_status(state['job_id'], 'script', 'failed')
                return state
        except Exception as e:
            logger.error(f"API request failed on attempt {attempt+1}: {e}")
            if attempt == max_retries - 1:
                state["error"] = str(e)
                update_step_status(state['job_id'], 'script', 'failed')
                return state
    update_step_status(state['job_id'], 'script', 'failed')
    return state

def generate_audio(state: WorkflowState) -> WorkflowState:
    if state.get("error"): return state
    if is_job_cancelled(state['job_id']):
        state["error"] = "CANCELLED"
        update_step_status(state['job_id'], 'audio', 'failed')
        return state
    
    audio_paths = state.get("audio_paths", [])
    if audio_paths and all(os.path.exists(p) for p in audio_paths):
        logger.info(f"[Node: Audio] Audio files already present, skipping generation")
        update_step_status(state['job_id'], 'audio', 'completed')
        return state
        
    logger.info(f"[Node: Audio] Generating audio via Kokoro for {state['job_id']}")
    update_step_status(state['job_id'], 'audio', 'processing')
    
    audio_paths = []
    for idx, seg in enumerate(state.get("segments", [])):
        if is_job_cancelled(state['job_id']):
            state["error"] = "CANCELLED"
            break
        text = seg.get("text", "")
        if not text:
            continue
        out_path = f"/app/output/{state['job_id']}_{idx}.wav"
        
        # Segment cache check
        if os.path.exists(out_path):
            logger.info(f"Audio file {out_path} already exists, skipping")
            audio_paths.append(out_path)
            continue
        
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
            update_step_status(state['job_id'], 'audio', 'failed')
            return state
            
    if state.get("error") == "CANCELLED":
        update_step_status(state['job_id'], 'audio', 'failed')
        return state
        
    state["audio_paths"] = audio_paths
    update_step_status(state['job_id'], 'audio', 'completed')
    return state

def generate_images(state: WorkflowState) -> WorkflowState:
    if state.get("error"): return state
    if is_job_cancelled(state['job_id']):
        state["error"] = "CANCELLED"
        update_step_status(state['job_id'], 'images', 'failed')
        return state
    
    image_paths = state.get("image_paths", [])
    if image_paths and all(os.path.exists(p) for p in image_paths):
        logger.info(f"[Node: Images] Image files already present, skipping generation")
        update_step_status(state['job_id'], 'images', 'completed')
        return state

    logger.info(f"[Node: Images] Generating images via Together AI for {state['job_id']}")
    update_step_status(state['job_id'], 'images', 'processing')
    
    db_settings = get_all_settings_from_db()
    together_api_key = db_settings.get("together_api_key", TOGETHER_API_KEY)
    image_model = db_settings.get("image_model", IMAGE_MODEL)
    
    if not together_api_key:
        state["error"] = "Missing TOGETHER_API_KEY"
        update_step_status(state['job_id'], 'images', 'failed')
        return state
        
    image_paths = []
    
    for idx, seg in enumerate(state.get("segments", [])):
        if is_job_cancelled(state['job_id']):
            state["error"] = "CANCELLED"
            break
        out_path = f"/app/output/{state['job_id']}_{idx}.jpg"
        
        # Segment cache check
        if os.path.exists(out_path):
            logger.info(f"Image file {out_path} already exists, skipping")
            image_paths.append(out_path)
            continue
        
        # Intercept if cheatsheet segment
        if seg.get("is_cheatsheet"):
            logger.info(f"[Node: Images] Segment {idx} is a cheatsheet. Drawing programmatically...")
            cheatsheet_data = seg.get("cheatsheet_data", {})
            success = draw_cheatsheet_image(cheatsheet_data, out_path)
            if not success:
                raise Exception(f"Failed to generate cheatsheet image for segment {idx}")
            
            raw_path = f"/app/output/{state['job_id']}_{idx}_raw.jpg"
            import shutil
            shutil.copyfile(out_path, raw_path)
            
            image_paths.append(out_path)
            logger.info(f"[Node: Images] Generated cheatsheet for segment {idx+1}/{len(state.get('segments', []))}")
            continue
            
        img_prompt = seg.get("image_prompt", "")
        try:
            payload = {
                "prompt": img_prompt,
                "model": image_model,
                "width": 576,
                "height": 1024,
                "response_format": "b64_json"
            }
            
            headers = {
                "Authorization": f"Bearer {together_api_key}",
                "Content-Type": "application/json"
            }
            
            response = requests.post("https://api.together.xyz/v1/images/generations", json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            
            # Save raw base image (without code overlay)
            raw_path = f"/app/output/{state['job_id']}_{idx}_raw.jpg"
            image_obj = data.get("data", [{}])[0]
            if image_obj.get("b64_json"):
                import base64
                img_bytes = base64.b64decode(image_obj["b64_json"])
                with open(raw_path, 'wb') as handler:
                    handler.write(img_bytes)
            elif image_obj.get("url"):
                img_bytes = requests.get(image_obj["url"]).content
                with open(raw_path, 'wb') as handler:
                    handler.write(img_bytes)
            else:
                raise Exception(f"No image data found in response object: {image_obj}")
                
            # Copy to out_path for overlay
            import shutil
            shutil.copyfile(raw_path, out_path)
            
            code_snippet = seg.get("code_snippet")
            code_language = seg.get("code_language", "text")
            if code_snippet:
                overlay_code_snippet(raw_path, out_path, code_snippet, code_language)
            
            image_paths.append(out_path)
            logger.info(f"[Node: Images] Generated image for segment {idx+1}/{len(state.get('segments', []))}")
        except Exception as e:
            logger.error(f"Image generation failed for segment {idx}: {e}")
            if hasattr(e, 'response') and e.response is not None:
                logger.info(f"Response Body: {e.response.text}")
            state["error"] = str(e)
            update_step_status(state['job_id'], 'images', 'failed')
            return state

    if state.get("error") == "CANCELLED":
        update_step_status(state['job_id'], 'images', 'failed')
        return state

    state["image_paths"] = image_paths
    update_step_status(state['job_id'], 'images', 'completed')
    return state

def compile_video(state: WorkflowState) -> WorkflowState:
    if state.get("error"): return state
    if is_job_cancelled(state['job_id']):
        state["error"] = "CANCELLED"
        update_step_status(state['job_id'], 'compile', 'failed')
        return state
    logger.info(f"[Node: Compile] Compiling final video for {state['job_id']}")
    update_step_status(state['job_id'], 'compile', 'processing')
    
    audio_paths = state.get("audio_paths", [])
    image_paths = state.get("image_paths", [])
    
    if len(audio_paths) != len(image_paths):
        state["error"] = "Mismatch in audio/image counts"
        update_step_status(state['job_id'], 'compile', 'failed')
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
        
        final_video.write_videofile(out_path, fps=24, codec="libx264", audio_codec="aac")
        
        state["output_video_path"] = out_path
        logger.info(f"[Node: Compile] Video compiled successfully to {out_path}")
        update_step_status(state['job_id'], 'compile', 'completed')
    except Exception as e:
        logger.error(f"Video compilation failed: {e}")
        state["error"] = str(e)
        update_step_status(state['job_id'], 'compile', 'failed')
        
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
    if is_job_cancelled(state['job_id']):
        state["error"] = "CANCELLED"
        update_step_status(state['job_id'], 'upload', 'failed')
        return state
    logger.info(f"[Node: Upload] Uploading video to Instagram for {state['job_id']}")
    update_step_status(state['job_id'], 'upload', 'processing')
    
    if not IG_USERNAME or not IG_PASSWORD:
        logger.info("Instagram upload disabled (missing credentials in .env). Skipping upload step.")
        update_step_status(state['job_id'], 'upload', 'skipped')
        return state
        
    video_path = state.get("output_video_path")
    if not video_path or not os.path.exists(video_path):
        state["error"] = "No compiled video found to upload"
        update_step_status(state['job_id'], 'upload', 'failed')
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
        update_step_status(state['job_id'], 'upload', 'completed')
    except Exception as e:
        logger.error(f"[Error] Instagram upload failed: {e}")
        state["error"] = f"Instagram Upload Error: {str(e)}"
        update_step_status(state['job_id'], 'upload', 'failed')
        
    return state
