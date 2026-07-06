import os
import urllib.request
import ssl
import shutil
import subprocess

def download_file(url, path, desc):
    if os.path.exists(path):
        print(f"{desc} already exists.")
        return
    print(f"Downloading {desc}...")
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(url, context=ctx) as response, open(path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
        print(f"Successfully downloaded {desc} to {path}")
    except Exception as e:
        print(f"Failed to download {desc}: {e}")
        raise

if __name__ == "__main__":
    # 1. Kokoro Model
    download_file(
        'https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/kokoro-v1_0.pth',
        '/app/kokoro-v1_0.pth',
        'Kokoro Model'
    )
    
    # 2. Kokoro Voice Profile
    download_file(
        'https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/voices/af_heart.pt',
        '/app/af_heart.pt',
        'Kokoro Voice Profile (af_heart)'
    )
    
    # 3. Spacy Model Wheel
    spacy_whl = '/app/en_core_web_sm-3.8.0-py3-none-any.whl'
    download_file(
        'https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl',
        spacy_whl,
        'Spacy en_core_web_sm Model'
    )
    
    print("Installing Spacy model...")
    subprocess.check_call(['pip', 'install', spacy_whl])
    print("All models downloaded and installed successfully!")
