import os
import json
import time
import redis
import threading
from langgraph.graph import StateGraph, END

from utils import (
    logger, REDIS_URL, WorkflowState, get_db_connection, 
    get_job_from_db, update_job_status
)
from nodes import (
    generate_script_segments, generate_audio, generate_images, 
    compile_video, upload_to_instagram
)
from server import start_http_server

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

def main():
    logger.info(f"Starting Video Render Worker (LangGraph)... Connecting to {REDIS_URL}")
    r = redis.from_url(REDIS_URL)
    
    conn = get_db_connection()
    if not conn:
        logger.info("Waiting for database...")
        time.sleep(5)
        conn = get_db_connection()

    # Start built-in HTTP server thread
    threading.Thread(target=start_http_server, daemon=True).start()

    app = build_graph()
    os.makedirs("/app/output", exist_ok=True)

    while True:
        try:
            result = r.blpop("job_queue", timeout=5)
            if result:
                _, message = result
                job_data = json.loads(message)
                job_id = job_data.get("jobId")
                action = job_data.get("action")
                
                # Fetch job details from DB
                job_details = get_job_from_db(job_id)
                if not job_details:
                    logger.error(f"[Worker] Job {job_id} not found in DB")
                    continue
                
                prompt = job_details.get("prompt")
                script_str = job_details.get("script")
                
                logger.info(f"[Worker] Picked up job {job_id} (action: {action or 'standard'})")
                
                if action == "recompile":
                    segments = json.loads(script_str) if script_str else []
                    initial_step_status = {
                        "script": "completed",
                        "audio": "completed",
                        "images": "completed",
                        "compile": "pending",
                        "upload": "pending"
                    }
                    
                    if conn:
                        try:
                            with conn.cursor() as cur:
                                cur.execute(
                                    "UPDATE jobs SET status = 'PROCESSING', step_status = %s WHERE id = %s",
                                    (json.dumps(initial_step_status), job_id)
                                )
                        except Exception as e:
                            logger.error(f"Error resetting steps for recompile: {e}")
                            
                    initial_state = {
                        "job_id": job_id,
                        "prompt": prompt,
                        "segments": segments,
                        "audio_paths": [f"/app/output/{job_id}_{idx}.wav" for idx in range(len(segments))],
                        "image_paths": [f"/app/output/{job_id}_{idx}.jpg" for idx in range(len(segments))],
                        "output_video_path": "",
                        "error": ""
                    }
                else:
                    # Pre-populate all steps as pending
                    initial_step_status = {
                        "script": "pending",
                        "audio": "pending",
                        "images": "pending",
                        "compile": "pending",
                        "upload": "pending"
                    }
                    
                    if conn:
                        try:
                            with conn.cursor() as cur:
                                cur.execute(
                                    "UPDATE jobs SET status = 'PROCESSING', step_status = %s WHERE id = %s",
                                    (json.dumps(initial_step_status), job_id)
                                )
                        except Exception as e:
                            logger.error(f"Error initializing job steps: {e}")
                    
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
