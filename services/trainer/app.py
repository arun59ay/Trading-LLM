from fastapi import FastAPI
from kafka import KafkaConsumer, KafkaProducer
from pydantic import BaseModel
import pandas as pd, numpy as np, os, json, time, joblib
from ta.momentum import RSIIndicator
from ta.trend import MACD, SMAIndicator

DATA_TOPIC = os.getenv("DATA_TOPIC","market.ohlc")
PRED_TOPIC = os.getenv("PRED_TOPIC","signals.raw")
BROKER = os.getenv("KAFKA_BROKER","redpanda:9092")
MODEL_PATH = os.getenv("MODEL_PATH","/data/model.joblib")

app = FastAPI(title="trainer")
producer = KafkaProducer(bootstrap_servers=BROKER, value_serializer=lambda v: json.dumps(v).encode())

def featurize(df: pd.DataFrame):
    df = df.sort_values("ts").copy()
    df["ret1"] = df["close"].pct_change()
    df["sma5"] = SMAIndicator(df["close"], window=5).sma_indicator()
    df["sma20"] = SMAIndicator(df["close"], window=20).sma_indicator()
    df["rsi14"] = RSIIndicator(df["close"], window=14).rsi()
    macd = MACD(df["close"])
    df["macd"] = macd.macd()
    df["macd_sig"] = macd.macd_signal()
    df = df.dropna()
    return df

def train_once(history: dict[str, pd.DataFrame]):
    # One model for all symbols (add symbol one-hot if needed)
    frames = []
    for sym, df in history.items():
        X = featurize(df)
        X["y"] = (X["close"].shift(-1) > X["close"]).astype(int)
        X["symbol"] = sym
        frames.append(X)
    data = pd.concat(frames)
    y = data["y"]
    X = data[["ret1","sma5","sma20","rsi14","macd","macd_sig"]].fillna(0)
    from sklearn.linear_model import LogisticRegression
    m = LogisticRegression(max_iter=200)
    m.fit(X, y)
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    joblib.dump(m, MODEL_PATH)

def predict_tick(m, row):
    import numpy as np
    X = np.array([[row.get(k,0) for k in ["ret1","sma5","sma20","rsi14","macd","macd_sig"]]])
    p = float(m.predict_proba(X)[0,1])
    return p

@app.on_event("startup")
def _startup():
    # 1) simple daily training loop (you can swap to APScheduler/Cron)
    import threading, datetime
    def daily_loop():
        while True:
            # TODO: pull last N days bars from your store; to keep MVP, accumulate in memory from consumer
            time.sleep(86400)
            # train_once(history)  # wire this to your stored history
    threading.Thread(target=daily_loop, daemon=True).start()

    # 2) live consumer that keeps rolling features per symbol and emits preds
    def live_predict():
        import collections
        m = None
        if os.path.exists(MODEL_PATH):
            import joblib
            m = joblib.load(MODEL_PATH)
        consumer = KafkaConsumer(DATA_TOPIC, bootstrap_servers=BROKER, value_deserializer=lambda m: json.loads(m.decode()))
        buffers = collections.defaultdict(lambda: pd.DataFrame(columns=["ts","open","high","low","close","volume"]))
        while True:
            for msg in consumer:
                d = msg.value
                sym = d["symbol"]
                buffers[sym] = pd.concat([buffers[sym], pd.DataFrame([d])], ignore_index=True)
                if len(buffers[sym]) < 30:
                    continue
                X = featurize(buffers[sym]).iloc[-1]
                if m is None or not os.path.exists(MODEL_PATH):
                    continue
                import joblib
                m = joblib.load(MODEL_PATH)
                row = X.to_dict()
                p = predict_tick(m, row)
                out = {"symbol": sym, "ts": d["ts"], "prob_up_next_bar": p}
                producer.send(PRED_TOPIC, out)
                producer.flush()
    threading.Thread(target=live_predict, daemon=True).start()

@app.get("/health")
def health():
    return {"ok":True}
