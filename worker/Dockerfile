FROM python:3.10-slim
WORKDIR /app
COPY requirements.txt .

RUN apt-get update && apt-get install -y imagemagick fonts-liberation espeak-ng && \
    rm -rf /var/lib/apt/lists/* && \
    sed -i 's/<policy domain="path" rights="none" pattern="@\*"\/>/<!-- <policy domain="path" rights="none" pattern="@\*"\/> -->/g' /etc/ImageMagick-6/policy.xml || true && \
    sed -i 's/<policy domain="path" rights="none" pattern="@\*"\/>/<!-- <policy domain="path" rights="none" pattern="@\*"\/> -->/g' /etc/ImageMagick-7/policy.xml || true

RUN pip install --no-cache-dir -r requirements.txt

# Pre-download models to bake them into the Docker image
COPY download_models.py .
RUN python download_models.py

COPY . .
CMD ["python", "-u", "main.py"]
