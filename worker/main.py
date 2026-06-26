import os
import json
import time
import redis
import psycopg2
import requests

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
DB_URL = os.getenv("DB_URL", "postgres://user:pass@localhost:5432/videodb")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")

class BaseVideoGenerator:
    def generate(self, script: str, output_path: str):
        raise NotImplementedError("Subclasses must implement generate()")

class PoCVideoGenerator(BaseVideoGenerator):
    def generate(self, script: str, output_path: str):
        # We import moviepy here to avoid issues if it fails to load early
        from moviepy.editor import TextClip, ColorClip, CompositeVideoClip, AudioFileClip
        import textwrap

        job_id = os.path.basename(output_path).replace(".mp4", "")
        print(f"Generating PoC video at {output_path}")
        
        # Wrap text to ~45 chars so it fits nicely
        safe_script = script[:1000] + ("..." if len(script) > 1000 else "")
        wrapped_text = "\n".join(textwrap.wrap(safe_script, width=45))
        
        # Generate Audio via Piper TTS
        audio_path = f"/app/output/{job_id}.wav"
        print("Generating TTS audio with Piper...")
        subprocess.run(
            ["piper", "--model", "/app/voice.onnx", "--output_file", audio_path],
            input=safe_script.encode("utf-8")
        )
        
        try:
            audio_clip = AudioFileClip(audio_path)
            duration = audio_clip.duration
            
            # Create text clip without a fixed height so it can be as tall as needed
            txt_clip = TextClip(wrapped_text, fontsize=35, color='white', align='center')
            
            bg_clip = ColorClip(size=(1280, 720), color=(0, 0, 139), duration=duration)
            
            # Scroll from bottom to top over the exact duration of the audio
            def get_pos(t):
                progress = t / duration
                y = 720 - progress * (720 + txt_clip.h)
                return 'center', y
                
            txt_clip = txt_clip.set_position(get_pos).set_duration(duration)
            video = CompositeVideoClip([bg_clip, txt_clip]).set_audio(audio_clip)
            video.write_videofile(output_path, fps=24, codec="libx264", audio_codec="aac")
        except Exception as e:
            print(f"MoviePy error (often ImageMagick related): {e}")
            # Fallback if ImageMagick is not installed or fails
            try:
                audio_clip = AudioFileClip(audio_path)
                fallback_duration = audio_clip.duration
                bg_clip = ColorClip(size=(1280, 720), color=(0, 0, 139), duration=fallback_duration).set_audio(audio_clip)
                bg_clip.write_videofile(output_path, fps=24, codec="libx264", audio_codec="aac")
            except Exception as inner_e:
                print(f"Fallback audio failed: {inner_e}")
                bg_clip = ColorClip(size=(1280, 720), color=(0, 0, 139), duration=5)
                bg_clip.write_videofile(output_path, fps=24, codec="libx264", audio=False)


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

def generate_script(prompt):
    print(f"Generating script using Ollama model {OLLAMA_MODEL}...")
    full_prompt = f"Create a detailed scene-by-scene script for a video about: {prompt}"
    
    try:
        response = requests.post(f"{OLLAMA_URL}/api/generate", json={
            "model": OLLAMA_MODEL,
            "prompt": full_prompt,
            "stream": False
        })
        response.raise_for_status()
        data = response.json()
        return data.get("response", "")
    except Exception as e:
        print(f"Error calling Ollama: {e}")
        return f"Error generating script: {e}"

def main():
    print(f"Starting Video Render Worker... Connecting to {REDIS_URL} and {DB_URL}")
    r = redis.from_url(REDIS_URL)
    
    conn = get_db_connection()
    if not conn:
        print("Waiting for database...")
        time.sleep(5)
        conn = get_db_connection()

    video_generator = PoCVideoGenerator()

    # Ensure output directory exists
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

                script = generate_script(prompt)
                print(f"[Worker] Generated Script for {job_id}:\n{script}\n")

                # Generate Video
                output_path = f"/app/output/{job_id}.mp4"
                video_url = f"/output/{job_id}.mp4"
                video_generator.generate(script, output_path)

                print(f"[Worker] Completed job {job_id}")
                update_job_status(conn, job_id, "COMPLETED", script=script, video_url=video_url)
                    
        except Exception as e:
            print(f"Worker loop error: {e}")
            time.sleep(1)
            if conn and conn.closed != 0:
                 conn = get_db_connection()

if __name__ == "__main__":
    main()
