# finnhub.py
import os, requests, time
from kafka_pub import publish

KEY = os.getenv("FINNHUB_API_KEY", "")

def _fx_symbol(sym: str) -> str:
    # Finnhub FX symbol for USD/INR
    return "OANDA:USD_INR"

def fetch_last_bar(sym: str, interval="1m", topic="market.ohlc"):
    if not KEY:
        return
    s = sym.upper()
    if s in ("USDINR","USD/INR","INRUSD"):
        url = f"https://finnhub.io/api/v1/forex/candle?symbol={_fx_symbol(s)}&resolution=1&count=1&token={KEY}"
    else:
        # Works for RELIANCE.NS, HDFCBANK.NS, ^NSEI, ^NSEBANK
        url = f"https://finnhub.io/api/v1/stock/candle?symbol={sym}&resolution=1&count=1&token={KEY}"

    r = requests.get(url, timeout=6)
    if r.status_code != 200:
        return
    j = r.json()
    if j.get("s") != "ok" or not j.get("t"):
        return

    ts = int(j["t"][-1]) * 1000
    i = -1
    msg = {
        "provider": "finnhub",
        "symbol": sym,
        "interval": interval,
        "ts": ts,
        "o": float(j["o"][i]), "h": float(j["h"][i]),
        "l": float(j["l"][i]), "c": float(j["c"][i]),
        "v": float(j.get("v",[0])[i]),
    }
    publish(topic, msg)
