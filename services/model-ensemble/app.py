from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Dict

app = FastAPI(title="model-ensemble")

class Features(BaseModel):
    rsi: float = 50.0
    macd: dict = {}
    iv_edge: float = 0.0
    oi_momentum: float = 0.0
    news_sentiment: float = 0.0
    social_velocity: float = 0.0

class ScoreReq(BaseModel):
    asset: str
    market: str
    features: Features

@app.get("/health")
def health(): return {"ok": True}

@app.post("/score")
def score(req: ScoreReq):
    # Simple interpretable blend
    macd_hist = float(req.features.macd.get('hist', 0))
    s = (0.30*(req.features.rsi-50)/50 +
         0.25*macd_hist +
         0.20*req.features.iv_edge +
         0.15*req.features.oi_momentum +
         0.10*req.features.news_sentiment +
         0.10*req.features.social_velocity)
    # squash to [-1,1]
    score = max(-1.0, min(1.0, s))
    conf = min(1.0, 0.5 + abs(score)/2)
    direction = 'BUY' if score>0.05 else 'SELL' if score<-0.05 else 'NEUTRAL'
    reasons = []
    if req.features.rsi>60: reasons.append("RSI>60 momentum")
    if macd_hist>0: reasons.append("MACD positive")
    if req.features.iv_edge>0.1: reasons.append("IV below model (value)")
    if req.features.news_sentiment>0.3: reasons.append("News tailwind")
    return {"score": score, "confidence": conf, "direction": direction, "reasons": reasons}
