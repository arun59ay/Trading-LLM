import os
import json
import threading
import time
from collections import deque, defaultdict
from typing import Dict, Deque, Tuple

from fastapi import FastAPI
import uvicorn
from kafka import KafkaConsumer, KafkaProducer

BROKER = os.getenv("KAFKA_BROKER", "redpanda:9092")
DATA_TOPIC = os.getenv("DATA_TOPIC", "market.ohlc")
PRED_TOPIC = os.getenv("PRED_TOPIC", "signals.raw")

FAST_N = int(os.getenv("FAST_N", "5"))
SLOW_N = int(os.getenv("SLOW_N", "20"))

# Simple per-symbol state for rolling SMAs
class SmaState:
    def __init__(self, n_fast: int, n_slow: int):
        self.fast_n = n_fast
        self.slow_n = n_slow
        self.fast_q: Deque[float] = deque(maxlen=n_fast)
        self.slow_q: Deque[float] = deque(maxlen=n_slow)
        self.fast_sum = 0.0
        self.slow_sum = 0.0
        self.prev_fast: float | None = None
        self.prev_slow: float | None = None

    def update(self, price: float) -> Tuple[float | None, float | None, str | None]:
        # update fast
        if len(self.fast_q) == self.fast_q.maxlen:
            self.fast_sum -= self.fast_q[0]
        self.fast_q.append(price)
        self.fast_sum += price
        fast = self.fast_sum / len(self.fast_q) if self.fast_q else None

        # update slow
        if len(self.slow_q) == self.slow_q.maxlen:
            self.slow_sum -= self.slow_q[0]
        self.slow_q.append(price)
        self.slow_sum += price
        slow = self.slow_sum / len(self.slow_q) if self.slow_q else None

        signal = None
        if fast is not None and slow is not None and self.prev_fast is not None and self.prev_slow is not None:
            # crossover detection
            crossed_up = self.prev_fast <= self.prev_slow and fast > slow
            crossed_dn = self.prev_fast >= self.prev_slow and fast < slow
            if crossed_up:
                signal = "BUY"
            elif crossed_dn:
                signal = "SELL"

        self.prev_fast = fast
        self.prev_slow = slow
        return fast, slow, signal

app = FastAPI()

@app.get("/health")
def health():
    return {"ok": True, "service": "trainer", "topics": {"consume": DATA_TOPIC, "produce": PRED_TOPIC}}

def trainer_loop():
    # Robust consumer/producer with retries
    while True:
        try:
            consumer = KafkaConsumer(
                DATA_TOPIC,
                bootstrap_servers=[BROKER],
                value_deserializer=lambda m: json.loads(m.decode("utf-8")),
                enable_auto_commit=True,
                auto_offset_reset="latest",
                client_id="trainer",
                group_id="trainer-group",
                consumer_timeout_ms=0,
            )
            producer = KafkaProducer(
                bootstrap_servers=[BROKER],
                value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            )
            print(f"✅ Trainer connected to {BROKER}, consuming '{DATA_TOPIC}', producing '{PRED_TOPIC}'")

            state: Dict[str, SmaState] = defaultdict(lambda: SmaState(FAST_N, SLOW_N))

            for msg in consumer:
                try:
                    payload = msg.value or {}
                    # Expected: { ts, symbol, o,h,l,c,v } — be permissive
                    symbol = payload.get("symbol") or payload.get("sym") or payload.get("ticker")
                    close = payload.get("c") or payload.get("close") or payload.get("ltp")
                    ts = payload.get("ts") or payload.get("time") or int(time.time() * 1000)

                    if not symbol or close is None:
                        continue

                    st = state[symbol]
                    fast, slow, sig = st.update(float(close))

                    if sig:
                        # emit a simple signal the gateway understands
                        out = {
                            "id": f"{symbol}-{ts}",
                            "symbol": symbol,
                            "action": sig,                # BUY / SELL
                            "entry": float(close),
                            "target": round(float(close) * (1.01 if sig == "BUY" else 0.99), 2),
                            "stop": round(float(close) * (0.99 if sig == "BUY" else 1.01), 2),
                            "confidence": 0.65,
                            "horizon": "1H",
                            "exchange": "SIM",
                            "idea": f"{FAST_N}/{SLOW_N} SMA crossover",
                            "indicators": {"sma_fast": fast, "sma_slow": slow},
                            "ts": ts,
                        }
                        producer.send(PRED_TOPIC, out)
                        producer.flush()
                        print(f"📡 Emitted signal -> {PRED_TOPIC}: {out['action']} {out['symbol']} @ {out['entry']}")
                except Exception as e:
                    print("⚠️ trainer message error:", e)
        except Exception as e:
            print("❌ trainer connection error:", e)
            time.sleep(3)  # backoff then retry

if __name__ == "__main__":
    # background thread for kafka loop
    t = threading.Thread(target=trainer_loop, daemon=True)
    t.start()

    # health server on 0.0.0.0:8013 (matches your compose)
    uvicorn.run(app, host="0.0.0.0", port=8013)
