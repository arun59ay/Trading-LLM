from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Dict
import math

app = FastAPI(title="feature-ta")

def rsi(series: List[float], period: int = 14) -> float:
    if len(series) < period + 1: return 50.0
    gains = [max(0, series[i] - series[i-1]) for i in range(1, period+1)]
    losses = [max(0, series[i-1] - series[i]) for i in range(1, period+1)]
    avg_g = sum(gains) / period
    avg_l = sum(losses) / period
    if avg_l == 0: return 100.0
    rs = avg_g / avg_l
    return 100 - (100 / (1 + rs))

def ema(values: List[float], span: int) -> float:
    if not values: return 0.0
    k = 2 / (span + 1)
    ema_val = values[0]
    for v in values[1:]:
        ema_val = v * k + ema_val * (1 - k)
    return ema_val

def macd(series: List[float]) -> Dict[str, float]:
    if len(series) < 26: return {"macd": 0.0, "signal": 0.0, "hist": 0.0}
    ema12 = ema(series[-26:], 12)
    ema26 = ema(series[-26:], 26)
    m = ema12 - ema26
    sig = ema([m]*9, 9)  # simplified placeholder
    return {"macd": m, "signal": sig, "hist": m - sig}

class TARequest(BaseModel):
    close: List[float]

@app.get("/health")
def health(): return {"ok": True}

@app.post("/ta")
def ta(req: TARequest):
    series = req.close
    return {
        "rsi": rsi(series),
        "macd": macd(series),
        "atr": 0.0,  # simplified
        "vwap": sum(series[-20:]) / max(1, min(20, len(series)))
    }
