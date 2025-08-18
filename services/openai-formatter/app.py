# services/openai-formatter/app.py
import os, json, time
from typing import Any, Dict, List, Optional
from flask import Flask, request, jsonify, abort
import requests

app = Flask(__name__)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")  # <-- from env ONLY
OPENAI_MODEL   = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")

if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is not set")

def _post_openai(path: str, payload: Dict[str, Any], timeout: int = 60, retries: int = 2) -> Dict[str, Any]:
    """POST with small retry/backoff for rate limits / transient errors."""
    url = f"{OPENAI_BASE_URL}/{path.lstrip('/')}"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    last_err = None
    for attempt in range(retries + 1):
        try:
            resp = requests.post(url, headers=headers, data=json.dumps(payload), timeout=timeout)
            if resp.status_code in (429, 500, 502, 503, 504) and attempt < retries:
                # exponential-ish backoff
                time.sleep(1.5 * (attempt + 1))
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            last_err = e
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
            else:
                raise
    # if we somehow fell through
    raise last_err or RuntimeError("Unknown error calling OpenAI")

def openai_chat(messages: List[Dict[str, str]], response_format: Optional[Dict[str, str]] = None, temperature: float = 0.2) -> str:
    payload: Dict[str, Any] = {
        "model": OPENAI_MODEL,
        "messages": messages,
        "temperature": temperature,
    }
    if response_format:
        payload["response_format"] = response_format
    data = _post_openai("chat/completions", payload)
    return data["choices"][0]["message"]["content"]

@app.route("/health")
def health():
    # Do NOT return the API key
    return jsonify({"ok": True, "model": OPENAI_MODEL, "base_url": OPENAI_BASE_URL})

@app.route("/format", methods=["POST"])
def format_text():
    body = request.get_json(force=True) or {}
    raw = body.get("text")
    if not raw:
        abort(400, "Missing 'text'")
    sys = body.get("system", "You are a helpful formatter. Clean up the text, keep facts.")
    content = openai_chat(
        [{"role": "system", "content": sys}, {"role": "user", "content": raw}],
        temperature=0.2,
    )
    return jsonify({"text": content})

@app.route("/summarize", methods=["POST"])
def summarize():
    body = request.get_json(force=True) or {}
    items = body.get("items")
    if not items or not isinstance(items, list):
        abort(400, "Missing 'items' (list of strings)")
    sys = "Summarize the items into concise bullet points with tickers if present. Return valid JSON: { bullets: string[] }."
    content = openai_chat(
        [{"role": "system", "content": sys}, {"role": "user", "content": "\n\n".join(items)}],
        response_format={"type": "json_object"},
        temperature=0.3,
    )
    # If model didn't return valid JSON, fall back gracefully
    try:
        return jsonify(json.loads(content))
    except Exception:
        return jsonify({"bullets": [content]})
