import os
import json
import time
import redis
import psycopg2
import requests
import subprocess
from typing import TypedDict, List, Dict, Any
from langgraph.graph import StateGraph, END
from together import Together
from moviepy.editor import ImageClip, AudioFileClip, concatenate_videoclips

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
DB_URL = os.getenv("DB_URL", "postgres://user:pass@localhost:5432/videodb")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")
API_URL = os.getenv("API_URL", "http://localhost:3000")
TOGETHER_API_KEY = os.getenv("TOGETHER_API_KEY")

class WorkflowState(TypedDict):
    job_id: str
    prompt: str
    segments: List[Dict[str, str]]
    audio_paths: List[str]
    image_paths: List[str]
    output_video_path: str
    error: str

def generate_script_segments(state: WorkflowState) -> WorkflowState:
    print(f"[Node: Script] Generating script for {state['job_id']}")
    system_prompt = (
        "You are an expert video script writer. "
        "Create a comprehensive, highly detailed script for a video about the user's prompt. "
        "You MUST output exactly 4 to 5 segments. "
        "Return ONLY a JSON array containing 4 to 5 objects. Each object must have exactly two keys: "
        "'text' (the spoken voiceover, which should be long and detailed) and 'image_prompt' (a visual description to generate an image). "
        "Example format:\n"
        "[\n"
        "  {\"text\": \"First long segment explaining the introduction...\", \"image_prompt\": \"Visual for intro\"},\n"
        "  {\"text\": \"Second long segment explaining the core concept...\", \"image_prompt\": \"Visual for core concept\"},\n"
        "  {\"text\": \"Third long segment explaining details...\", \"image_prompt\": \"Visual for details\"},\n"
        "  {\"text\": \"Fourth long segment for the conclusion...\", \"image_prompt\": \"Visual for conclusion\"}\n"
        "]\n"
        "Do not include markdown blocks or any other text outside the JSON array."
    )
    
    try:
        response = requests.post(f"{OLLAMA_URL}/api/generate", json={
            "model": OLLAMA_MODEL,
            "prompt": f"{system_prompt}\n\nPrompt: {state['prompt']}",
            "stream": False,
            "format": "json" # Force JSON output if model supports it
        })
        response.raise_for_status()
        output = response.json().get("response", "[]")
        
        # Clean up possible markdown wrappers
        output = output.strip()
        if output.startswith("```json"):
            output = output[7:]
        elif output.startswith("```"):
            output = output[3:]
        if output.endswith("```"):
            output = output[:-3]
        output = output.strip()
        
        print(f"<- LLM Raw Output:\n{output}")
        
        # Parse JSON
        segments = json.loads(output)
        
        # If the LLM returned an object containing the array instead of a direct array
        if isinstance(segments, dict):
            for key, val in segments.items():
                if isinstance(val, list):
                    segments = val
                    break
            else:
                segments = [segments] # Fallback: treat the dict itself as a single segment
                
        state["segments"] = segments
    except Exception as e:
        print(f"[Error] Failed to generate script: {e}")
        state["error"] = str(e)
    return state

import soundfile as sf
import numpy as np
from kokoro import KPipeline
import torch

# Initialize Kokoro Pipeline globally
tts_pipeline = KPipeline(lang_code='a')

def generate_audio(state: WorkflowState) -> WorkflowState:
    if state.get("error"): return state
    print(f"[Node: Audio] Generating audio via Kokoro for {state['job_id']}")
    
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
        except Exception as e:
            print(f"[Error] Kokoro failed for segment {idx}: {e}")
            state["error"] = str(e)
            return state
            
    state["audio_paths"] = audio_paths
    return state

def generate_images(state: WorkflowState) -> WorkflowState:
    if state.get("error"): return state
    print(f"[Node: Images] Generating images via Together AI for {state['job_id']}")
    
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
                "model": "black-forest-labs/FLUX.2-pro",
                "width": 1024,
                "height": 576,
                "response_format": "b64_json"
                # Not sending 'steps' at all to avoid the 400 error
            }
            
            headers = {
                "Authorization": f"Bearer {TOGETHER_API_KEY}",
                "Content-Type": "application/json"
            }
            
            print(f"-> Sending Together request for segment {idx}:\n{payload}")
            
            response = requests.post("https://api.together.xyz/v1/images/generations", json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            
            print(f"<- Received Together response for segment {idx}:\n{data}")
            
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
                
            image_paths.append(out_path)
        except Exception as e:
            print(f"[Error] Image generation failed for segment {idx}: {e}")
            if hasattr(e, 'response') and e.response is not None:
                print(f"Response Body: {e.response.text}")
            state["error"] = str(e)
            return state

    state["image_paths"] = image_paths
    return state

def compile_video(state: WorkflowState) -> WorkflowState:
    if state.get("error"): return state
    print(f"[Node: Compile] Compiling final video for {state['job_id']}")
    
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
            img_clip = ImageClip(i_path).set_duration(audio_clip.duration).set_audio(audio_clip)
            clips.append(img_clip)
            
        final_video = concatenate_videoclips(clips, method="compose")
        out_path = f"/app/output/{state['job_id']}.mp4"
        final_video.write_videofile(out_path, fps=24, codec="libx264", audio_codec="aac")
        
        state["output_video_path"] = out_path
    except Exception as e:
        print(f"[Error] Video compilation failed: {e}")
        state["error"] = str(e)
        
    return state

def build_graph():
    workflow = StateGraph(WorkflowState)
    workflow.add_node("script", generate_script_segments)
    workflow.add_node("audio", generate_audio)
    workflow.add_node("image", generate_images)
    workflow.add_node("compile", compile_video)
    
    workflow.add_edge("script", "audio")
    workflow.add_edge("audio", "image")
    workflow.add_edge("image", "compile")
    workflow.add_edge("compile", END)
    
    workflow.set_entry_point("script")
    return workflow.compile()

def get_db_connection():
    try:
        conn = psycopg2.connect(DB_URL)
        conn.autocommit = True
        return conn
    except Exception as e:
        print(f"Failed to connect to Database: {e}")
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
            print(f"[Worker DB] Updated job {job_id} to {status}")
    except Exception as e:
        print(f"Error updating DB: {e}")

def main():
    print(f"Starting Video Render Worker (LangGraph)... Connecting to {REDIS_URL}")
    r = redis.from_url(REDIS_URL)
    
    conn = get_db_connection()
    if not conn:
        print("Waiting for database...")
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

                print(f"[Worker] Picked up job {job_id} with prompt: '{prompt}'")
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
                    print(f"[Worker] Job {job_id} FAILED with error: {final_state['error']}")
                    update_job_status(conn, job_id, "FAILED")
                else:
                    print(f"[Worker] Completed job {job_id}")
                    # Convert JSON segments back to string for DB
                    script_str = json.dumps(final_state.get("segments", []), indent=2)
                    video_url = f"/output/{job_id}.mp4"
                    update_job_status(conn, job_id, "COMPLETED", script=script_str, video_url=video_url)
                    
        except Exception as e:
            print(f"Worker loop error: {e}")
            time.sleep(1)
            if conn and conn.closed != 0:
                 conn = get_db_connection()

if __name__ == "__main__":
    main()
