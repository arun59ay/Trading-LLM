# yf_poll.py
import time, yfinance as yf
from kafka_pub import publish

def fetch_last_bar(sym: str, interval="1m", topic="market.ohlc"):
    df = yf.download(sym, period="2d", interval=interval, progress=False)
    if df.empty:
        return
    ts = int(df.index[-1].timestamp() * 1000)
    row = df.iloc[-1]
    msg = {
        "provider": "yfinance",
        "symbol": sym,
        "interval": interval,
        "ts": ts,
        "o": float(row["Open"]), "h": float(row["High"]),
        "l": float(row["Low"]),  "c": float(row["Close"]),
        "v": float(row.get("Volume", 0.0)),
    }
    publish(topic, msg)
