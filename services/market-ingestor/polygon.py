# polygon.py
import os, requests
from kafka_pub import publish

API = "https://api.polygon.io"
KEY = os.getenv("POLYGON_API_KEY", "")

def _p(sym: str) -> str:
    # polygon crypto tickers need X: prefix
    s = sym.upper()
    if s.endswith(("USD","USDT")):
        return f"X:{s}"
    return s

def fetch_last_bar(sym: str, interval="1m", topic="market.ohlc"):
    if not KEY:
        return
    tkr = _p(sym)
    # Use previous-aggregate endpoint (fast + stable)
    url = f"{API}/v2/aggs/ticker/{tkr}/prev?adjusted=true&apiKey={KEY}"
    r = requests.get(url, timeout=6)
    if r.status_code != 200:
        return
    res = r.json().get("results") or []
    if not res:
        return
    k = res[-1]
    msg = {
        "provider": "polygon",
        "symbol": sym,
        "interval": interval,
        "ts": int(k["t"]),      # ms
        "o": float(k["o"]),
        "h": float(k["h"]),
        "l": float(k["l"]),
        "c": float(k["c"]),
        "v": float(k.get("v", 0.0)),
    }
    publish(topic, msg)
