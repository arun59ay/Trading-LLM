FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# System deps (optional but nice for ssl/timezones)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# default envs (compose can override)
ENV KAFKA_BROKER=redpanda:9092 \
    DATA_TOPIC=market.ohlc \
    PRED_TOPIC=signals.raw \
    MODEL_PATH=/data/model.joblib \
    LOG_LEVEL=info \
    GATEWAY_PORT=8080 \
    HEALTH_CHECK_INTERVAL=30000

# Run the web health endpoint + background trainer loop
CMD ["python", "-u", "main.py"]
