# twelvedata.py
import os, requests, time
from kafka_pub import publish

KEY = os.getenv("TWELVEDATA_API_KEY","")

def fetch_last_bar(sym: str, interval="1m", topic="market.ohlc"):
    if not KEY:
        return
    if sym.upper() not in ("USDINR","USD/INR"):
        return
    url = f"https://api.twelvedata.com/time_series?symbol=USD/INR&interval=1min&outputsize=1&apikey={KEY}"
    r = requests.get(url, timeout=6)
    if r.status_code != 200:
        return
    j = r.json()
    vals = j.get("values",[])
    if not vals:
        return
    d = vals[0]
    msg = {
        "provider": "twelvedata",
        "symbol": "USDINR",
        "interval": interval,
        "ts": int(time.time()*1000),
        "o": float(d["open"]), "h": float(d["high"]),
        "l": float(d["low"]),  "c": float(d["close"]),
        "v": 0.0,
    }
    publish(topic, msg)
