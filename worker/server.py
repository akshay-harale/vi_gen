import os
import json
import soundfile as sf
import numpy as np
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading
from utils import (
    logger, get_all_settings_from_db, overlay_code_snippet, 
    TOGETHER_API_KEY, IMAGE_MODEL
)
from nodes import tts_pipeline

class WorkerHTTPServer(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_POST(self):
        try:
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            if self.path == '/regenerate-audio':
                job_id = data.get('job_id')
                index = int(data.get('index'))
                text = data.get('text')
                
                out_path = f"/app/output/{job_id}_{index}.wav"
                logger.info(f"[HTTP API] Regenerating audio for {job_id} segment {index} with text length {len(text)}")
                
                generator = tts_pipeline(text, voice='af_heart', speed=1)
                all_audio = []
                for gs, ps, audio in generator:
                    all_audio.append(audio)
                
                if all_audio:
                    final_audio = np.concatenate(all_audio)
                    sf.write(out_path, final_audio, 24000)
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": True}).encode('utf-8'))
                else:
                    raise Exception("Audio generation returned empty array")

            elif self.path == '/regenerate-image':
                job_id = data.get('job_id')
                index = int(data.get('index'))
                image_prompt = data.get('image_prompt')
                code_snippet = data.get('code_snippet')
                code_language = data.get('code_language', 'text')
                only_overlay = data.get('only_overlay', False)
                
                out_path = f"/app/output/{job_id}_{index}.jpg"
                raw_path = f"/app/output/{job_id}_{index}_raw.jpg"
                
                # Check fast path for code overlay updates
                if only_overlay and os.path.exists(raw_path):
                    logger.info(f"[HTTP API] Fast overlay only for {job_id} segment {index}")
                    import shutil
                    shutil.copyfile(raw_path, out_path)
                    if code_snippet:
                        overlay_code_snippet(raw_path, out_path, code_snippet, code_language)
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": True}).encode('utf-8'))
                    return
                
                # Full regeneration path
                db_settings = get_all_settings_from_db()
                together_api_key = db_settings.get("together_api_key", TOGETHER_API_KEY)
                image_model = db_settings.get("image_model", IMAGE_MODEL)
                
                logger.info(f"[HTTP API] Full image regeneration for {job_id} segment {index} with prompt length {len(image_prompt)}")
                
                import requests
                payload = {
                    "prompt": image_prompt,
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
                res_data = response.json()
                
                image_obj = res_data.get("data", [{}])[0]
                img_bytes = None
                if image_obj.get("b64_json"):
                    import base64
                    img_bytes = base64.b64decode(image_obj["b64_json"])
                elif image_obj.get("url"):
                    img_bytes = requests.get(image_obj["url"]).content
                
                if img_bytes:
                    # Write to raw path
                    with open(raw_path, "wb") as f:
                        f.write(img_bytes)
                    # Copy to out path
                    import shutil
                    shutil.copyfile(raw_path, out_path)
                    # Apply overlay
                    if code_snippet:
                        overlay_code_snippet(raw_path, out_path, code_snippet, code_language)
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": True}).encode('utf-8'))
                else:
                    raise Exception("No image data found in Together response")
            else:
                self.send_response(404)
                self.end_headers()
        except Exception as e:
            logger.error(f"[HTTP API Error] {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))

def start_http_server():
    server = HTTPServer(('0.0.0.0', 5001), WorkerHTTPServer)
    logger.info("Starting Worker HTTP server on port 5001...")
    server.serve_forever()
