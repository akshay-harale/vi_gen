import os
import json
import time
import redis
import requests

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
API_URL = os.getenv("API_URL", "http://localhost:3000")

def main():
    print(f"Starting Video Render Worker... Connecting to {REDIS_URL}")
    r = redis.from_url(REDIS_URL)

    while True:
        try:
            # Block until an item is available in the queue, timeout 5 seconds
            result = r.blpop("job_queue", timeout=5)
            if result:
                _, message = result
                job_data = json.loads(message)
                job_id = job_data.get("jobId")
                prompt = job_data.get("prompt")

                print(f"[Worker] Picked up job {job_id} with prompt: '{prompt}'")
                
                # Update status to PROCESSING
                try:
                    requests.post(f"{API_URL}/api/jobs/{job_id}/status", json={"status": "PROCESSING"})
                except Exception as e:
                    print(f"Error updating API: {e}")

                # Simulate work
                time.sleep(2)

                print(f"[Worker] Completed job {job_id}")
                # Update status to COMPLETED
                try:
                    requests.post(f"{API_URL}/api/jobs/{job_id}/status", json={"status": "COMPLETED"})
                except Exception as e:
                    print(f"Error updating API: {e}")
                    
        except Exception as e:
            print(f"Worker loop error: {e}")
            time.sleep(1)

if __name__ == "__main__":
    main()
