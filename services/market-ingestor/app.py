from fastapi import FastAPI
from pydantic import BaseModel
from datetime import datetime, timedelta
from dateutil import tz
import pandas as pd
import yfinance as yf
from kafka import KafkaProducer
import json
import os
import threading
import time

KAFKA_BROKER = os.getenv("KAFKA_BROKER", "redpanda:9092")
TOPIC = os.getenv("TOPIC", "market.ohlc")
SYMBOLS = os.getenv("SYMBOLS", "AAPL,MSFT,SPY,BTC-USD,ETH-USD").split(",")

producer = KafkaProducer(
    bootstrap_servers=KAFKA_BROKER,
    value_serializer=lambda v: json.dumps(v).encode("utf-8"),
)

app = FastAPI(title="market-ingestor")

class PollRequest(BaseModel):
    symbols: list[str]
    interval: str = "1m"  # valid: 1m, 5m, 15m, 1h, 1d
    lookback_minutes: int = 60

def fetch_and_publish(symbols, interval, lookback_minutes=60):
    end = datetime.utcnow()
    start = end - timedelta(minutes=lookback_minutes)
    for sym in symbols:
        try:
            df = yf.download(sym, start=start, end=end, interval=interval, progress=False)
            if df.empty:
                continue
            df = df.reset_index()
            for _, row in df.iterrows():
                msg = {
                    "symbol": sym,
                    "ts": pd.Timestamp(row["Datetime"] if "Datetime" in row else row["Date"]).isoformat(),
                    "open": float(row["Open"]),
                    "high": float(row["High"]),
                    "low": float(row["Low"]),
                    "close": float(row["Close"]),
                    "volume": float(row["Volume"]),
                    "interval": interval,
                }
                producer.send(TOPIC, msg)
        except Exception as e:
            print("Ingest error", sym, e)

def loop():
    interval = os.getenv("INTERVAL", "1m")
    lookback = int(os.getenv("LOOKBACK_MINUTES", "30"))
    sleep_s = int(os.getenv("SLEEP_SECONDS", "60"))
    while True:
        fetch_and_publish(SYMBOLS, interval, lookback)
        producer.flush()
        time.sleep(sleep_s)

@app.on_event("startup")
def _startup():
    threading.Thread(target=loop, daemon=True).start()

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/poll-once")
def poll_once(req: PollRequest):
    fetch_and_publish(req.symbols, req.interval, req.lookback_minutes)
    producer.flush()
    return {"ok": True}
