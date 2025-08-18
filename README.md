# TradeBrain – Multi‑Asset Trading AI (Memecoins • Indian Stocks • NSE/BSE Options)

> Starter monorepo implementing the **Final Blueprint** you approved: real-time ingest → features (TA/Greeks/NLP) →
> ensemble scoring → risk sizing → JSON `SignalV1` → OpenAI formatter → WebSocket UI.
> Uses **Ollama** locally for RAG/embeddings and **OpenAI** (optional) for the final narrative.
>
> This repo is production‑grade *scaffold* with live-ready wiring. By default it runs with a **simulator** publishing
> fresh data every second so you can verify the full pipeline immediately.

## Quickstart (Docker)
1. Copy `.env.example` to `.env` and adjust ports/keys as needed.
2. `docker compose up --build`
3. Open the UI at http://localhost:3000 — you should see live **Signals** within ~10 seconds (from the simulator).

## Services
- **gateway** (Fastify + Socket.IO + KafkaJS): REST + WS; bridges Kafka → WebSocket; validates Signal schema.
- **ingestor-sim** (Node): publishes quotes/options/news/social to Kafka every second.
- **feature-ta** (FastAPI): RSI/MACD/ATR/VWAP features.
- **feature-options** (FastAPI): Black‑Scholes Greeks + implied vol; simple IV surface fit placeholder.
- **model-ensemble** (FastAPI): blends features/rules into a direction score and reasons.
- **risk-sizer** (FastAPI): capped‑Kelly position sizing + ATR stop and time-stop.
- **openai-formatter** (FastAPI): formats `SignalV1` into human explanation using OpenAI when key present.
- **rag-ollama** (FastAPI): embeddings via Ollama + Qdrant vector store (skeleton endpoints).
- **ui** (Next.js): real-time dashboard via Socket.IO.

All contracts are aligned to **SignalV1** (see `shared/signal.schema.json`).

## Env
See `.env.example`. Most services run fine with defaults; external APIs are optional at first.

## Local (without Docker)
- Start **Redpanda** (or Kafka), **Redis**, **Postgres**, **ClickHouse**, **Qdrant** yourself.
- `cd services/ingestor-sim && npm i && npm run dev`
- `cd services/gateway && npm i && npm run dev`
- `cd ui && npm i && npm run dev`
- Start each Python service: `uvicorn app:app --reload --port 8xxx`

## Topics
- quotes.nse • options.nse • quotes.crypto • defi.pairs • news • social • signals

## Signal JSON (canonical)
```json
{
  "asset":"string","market":"NSE-OPT|NSE-CASH|CRYPTO|DEFI","direction":"BUY|SELL|NEUTRAL",
  "entry":0.0,"sl":0.0,"tp":0.0,"size":0,"horizon_min":0,"confidence":0.0,
  "reasons":["..."],"risks":["..."],"action_hint":"PAPER_BUY|PAPER_SELL|WATCHLIST|AVOID",
  "explain_md":"string","telemetry":{"missing":[],"latency_ms":0}
}
```

## Notes
- Real broker/market APIs are **not** hardcoded. Replace simulator with `ingestor-*` for Zerodha/Upstox/WazirX when you add keys.
- `feature-nlp` can be expanded to FinBERT; here we provide a lightweight sentiment heuristic to keep images small.
- Keep paper mode on until backtests pass your thresholds.
