# --- app.py ---
from fastapi import FastAPI
from pydantic import BaseModel
import pandas as pd
import yfinance as yf
from kafka import KafkaProducer
import json, os, threading, time

KAFKA_BROKER = os.getenv("KAFKA_BROKER", "redpanda:9092")
TOPIC = os.getenv("TOPIC", "market.ohlc")
SYMBOLS = [s.strip() for s in os.getenv("SYMBOLS","AAPL,MSFT,SPY,BTC-USD,ETH-USD").split(",") if s.strip()]
INTERVAL = os.getenv("INTERVAL", "1m")
LOOKBACK_MIN = int(os.getenv("LOOKBACK_MINUTES", "240"))
SLEEP_SECONDS = int(os.getenv("SLEEP_SECONDS", "5"))

producer = KafkaProducer(
    bootstrap_servers=KAFKA_BROKER,
    value_serializer=lambda v: json.dumps(v).encode("utf-8"),
    linger_ms=50, acks="1"
)

app = FastAPI(title="market-ingestor")

class PollRequest(BaseModel):
    symbols: list[str]
    interval: str = "1m"
    lookback_minutes: int = 60

_last_ts: dict[str, int] = {}  # symbol -> last published ts (ms)

def _publish_rows(sym: str, df: pd.DataFrame, interval: str):
    """Publish only rows newer than the last seen ts for this symbol."""
    if df is None or df.empty:
        return

    # yfinance sometimes returns MultiIndex columns: ('Open','AAPL'), etc.
    # Provide a safe accessor that works for both simple and multiindex cols.
    def get_float(row, col):
        try:
            return float(row[col])
        except Exception:
            if isinstance(df.columns, pd.MultiIndex):
                for c in df.columns:
                    if isinstance(c, tuple) and c and c[0] == col:
                        try:
                            return float(row[c])
                        except Exception:
                            pass
            # If still failing, coerce via pandas
            return float(pd.to_numeric(row.get(col, 0), errors="coerce") or 0.0)

    # Ensure we have UTC timestamps in milliseconds
    if not isinstance(df.index, pd.DatetimeIndex):
        # After reset_index(), the time column may be 'Datetime' or 'Date'
        ts_col = "Datetime" if "Datetime" in df.columns else ("Date" if "Date" in df.columns else None)
        if ts_col is None:
            print("No datetime column for", sym, "columns:", list(df.columns))
            return
        df = df.set_index(pd.to_datetime(df[ts_col], utc=True))

    idx = df.index.tz_convert("UTC") if df.index.tz is not None else df.index.tz_localize("UTC")

    last_ms = _last_ts.get(sym, 0)
    for i, ts in enumerate(idx):
        ts_ms = int(ts.timestamp() * 1000)
        if ts_ms <= last_ms:
            continue

        row = df.iloc[i]
        msg = {
            "provider": "yfinance",
            "symbol": sym,
            "ts": ts_ms,
            "o": get_float(row, "Open"),
            "h": get_float(row, "High"),
            "l": get_float(row, "Low"),
            "c": get_float(row, "Close"),
            "v": float(row.get("Volume", 0) or 0),
            "interval": interval,
        }
        producer.send(TOPIC, msg)
        last_ms = ts_ms

    _last_ts[sym] = last_ms

def fetch_and_publish(symbols, interval, lookback_minutes=60):
    # Use 'period' for intraday: yfinance rejects small "240m" values for period
    period_map = {
        "1m": f"{max(lookback_minutes, 30)}m",
        "5m": f"{max(lookback_minutes, 60)}m",
        "15m": "1d",
        "1h": "5d",
        "1d": "1mo",
    }
    period = period_map.get(interval, f"{max(lookback_minutes, 60)}m")

    for sym in symbols:
        try:
            if sym.startswith("^") and interval in ("1m", "5m"):
                print("Skipping index for intraday:", sym)
                continue

            df = yf.download(
                tickers=sym,
                period=period,
                interval=interval,
                auto_adjust=False,
                prepost=True,
                progress=False,
                threads=False,
            )

            if df is None or df.empty:
                print("Empty DF:", sym, period, interval)
                continue

            # Normalize: keep index as datetime, columns as OHLCV
            if "Open" not in df.columns:
                # If yfinance returned multiindex columns, select the first level
                try:
                    df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
                except Exception:
                    pass

            _publish_rows(sym, df, interval)

        except Exception as e:
            import traceback; traceback.print_exc()
            print("Ingest error", sym, e)

def loop():
    while True:
        fetch_and_publish(SYMBOLS, INTERVAL, LOOKBACK_MIN)
        producer.flush()
        time.sleep(SLEEP_SECONDS)

@app.on_event("startup")
def _startup():
    threading.Thread(target=loop, daemon=True).start()

@app.get("/health")
def health():
    return {"ok": True, "symbols": SYMBOLS, "interval": INTERVAL, "last_ts": _last_ts}

@app.post("/poll-once")
def poll_once(req: PollRequest):
    fetch_and_publish(req.symbols, req.interval, req.lookback_minutes)
    producer.flush()
    return {"ok": True}
