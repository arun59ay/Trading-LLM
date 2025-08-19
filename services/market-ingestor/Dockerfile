# services/market-ingestor/Dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# add system tzdata if you need local time; usually safe to skip
# RUN apt-get update && apt-get install -y tzdata && rm -rf /var/lib/apt/lists/*

COPY . .

ENV PYTHONUNBUFFERED=1
EXPOSE 8011

# Your app.py is a FastAPI app that starts a background polling thread.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8011"]
