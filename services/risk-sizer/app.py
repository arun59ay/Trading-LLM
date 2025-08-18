from fastapi import FastAPI
from pydantic import BaseModel
from math import isfinite

app = FastAPI(title="risk-sizer")

class Req(BaseModel):
    equity: float = 100000.0
    entry: float
    sl: float
    tp: float
    conviction: float = 0.6  # 0..1

@app.get("/health")
def health(): return {"ok": True}

@app.post("/size")
def size(req: Req):
    # Simple expectancy
    R = abs((req.tp - req.entry) / (req.entry - req.sl)) if req.entry!=req.sl else 1.0
    p = max(0.01, min(0.99, req.conviction))
    kelly = p - (1-p)/max(0.01, R)
    kelly = max(0.0, min(0.05, kelly))  # cap at 5%
    size_value = req.equity * kelly
    return {"kelly_fraction": kelly, "size_value": size_value}
