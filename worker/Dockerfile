FROM python:3.10-slim
WORKDIR /app
COPY requirements.txt .

RUN apt-get update && apt-get install -y imagemagick fonts-liberation && \
    rm -rf /var/lib/apt/lists/* && \
    sed -i 's/<policy domain="path" rights="none" pattern="@\*"\/>/<!-- <policy domain="path" rights="none" pattern="@\*"\/> -->/g' /etc/ImageMagick-6/policy.xml || true && \
    sed -i 's/<policy domain="path" rights="none" pattern="@\*"\/>/<!-- <policy domain="path" rights="none" pattern="@\*"\/> -->/g' /etc/ImageMagick-7/policy.xml || true

RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "-u", "main.py"]
