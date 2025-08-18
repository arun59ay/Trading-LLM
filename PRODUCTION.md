# TradeBrain – Production Hardening Guide

This repo ships a working scaffold. To promote to **production**, complete the steps below.

## Security & Access
- Put **gateway** and **ui** behind a reverse proxy (Nginx/Traefik/Caddy) with **HTTPS** and HSTS.
- Restrict CORS: set `ALLOW_ORIGIN=https://your-domain`.
- Add **auth** (JWT or session) in gateway; implement RBAC for admin vs viewer.
- Configure **Kafka ACLs**, user/password, and TLS for brokers.
- Store secrets in a vault (Doppler/Vault); never commit `.env`.

## Observability
- Enable Fastify logger (pino) at `info`. Ship logs to ELK/Datadog.
- Prometheus exporters for services; Grafana dashboards (latency, consumer lag, signal throughput).
- Alerts: consumer lag, topic stalls, ClickHouse insert failures, UI WS disconnect rate.

## Data
- ClickHouse retention policies; partitioning by day. Backups to S3/MinIO.
- Postgres migrations (Prisma/Flyway). Daily snapshot & PITR where possible.
- Qdrant persistence on SSD; periodic compaction.

## Performance
- Increase Kafka partitions for hot topics (e.g., `quotes.nse`, `signals`).
- Consumer groups for scale-out; idempotent writes.
- Uvicorn workers = CPU cores; set `WORKERS` in prod Dockerfiles.

## AI/ML
- Replace simulator with real ingestors (Zerodha/Upstox/WazirX/Dex/News/Social).
- FinBERT or similar for sentiment; calibrate ensemble; run backtests; freeze model versions in registry.
- Add drift detection; schedule weekly re-training.

## Compliance
- Respect exchange/vendor ToS; avoid scraping gated sources; document data lineage.
- Keep **paper mode** for burn-in; gate live execution with an explicit flag and limits.

See `docker-compose.prod.yml` for a production build profile.
