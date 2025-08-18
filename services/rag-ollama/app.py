import os, re, json, requests
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL", "http://ollama:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.1:8b")

app = FastAPI()
@app.get("/health")
def health():
    return {"ok": True, "model": "llama3.1:8b"}

class TradeIdea(BaseModel):
    symbol: str
    side: str
    entry: float
    stop: float
    target: float
    size_usd: Optional[float] = None
    confidence: Optional[float] = None
    rationale: Optional[str] = ""
    news_bullets: List[str] = []
    risk_flags: List[str] = []

@app.get("/health")
def health():
    return {"ok": True, "model": OLLAMA_MODEL}

@app.post("/critique")
def critique(idea: TradeIdea):
    prompt = f"""
You are a risk officer. Given this trade idea, critique it and return ONLY JSON.

Trade:
symbol: {idea.symbol}
side: {idea.side}
entry: {idea.entry}
stop: {idea.stop}
target: {idea.target}
size_usd: {idea.size_usd}
confidence: {idea.confidence}
rationale: {idea.rationale}
news_bullets: {idea.news_bullets}
risk_flags: {idea.risk_flags}

Return JSON ONLY in this shape:
{{
  "suggestion": "BUY|SELL|HOLD|SKIP",
  "risk_score": 0.0,
  "notes": ["bullet1","bullet2"]
}}
"""
    try:
        r = requests.post(f"{OLLAMA_BASE}/api/generate",
                          json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
                          timeout=120)
        r.raise_for_status()
        txt = r.json().get("response", "")
        m = re.search(r"\{[\s\S]*\}", txt)
        if m:
            try:
                data = json.loads(m.group(0))
                return {
                    "suggestion": data.get("suggestion", "HOLD"),
                    "risk_score": float(data.get("risk_score", 0.5)),
                    "notes": data.get("notes", []),
                }
            except Exception:
                pass
        return {"suggestion": "HOLD", "risk_score": 0.5, "notes": [txt.strip()[:300]]}
    except requests.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Ollama error: {e.response.text}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
