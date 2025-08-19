# main.py
import os, time, sys, logging

import polygon as pg
import finnhub as fh
import twelvedata as td
import yf_poll as yf

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)

SYMS = [s.strip() for s in os.getenv("SYMBOLS","AAPL,MSFT").split(",") if s.strip()]
SLEEP = float(os.getenv("SLEEP_SECONDS","2"))
INTERVAL = "1m"
TOPIC = os.getenv("OUT_TOPIC","market.ohlc")

USE_PG = os.getenv("ENABLE_POLYGON","false").lower() == "true"
USE_FH = os.getenv("ENABLE_FINNHUB","false").lower() == "true"
USE_TD = os.getenv("ENABLE_TWELVEDATA","false").lower() == "true"
USE_YF = os.getenv("ENABLE_YFINANCE","false").lower() == "true"

def route(sym: str) -> str:
    s = sym.upper()
    if s in ("USDINR","USD/INR","INRUSD"):
        return "finnhub" if USE_FH else ("twelvedata" if USE_TD else "none")
    if s.endswith(".NS") or s in ("^NSEI","^NSEBANK"):
        return "finnhub" if USE_FH else ("yfinance" if USE_YF else "none")
    if s.endswith(("USD","USDT")):  # crypto pairs like BTCUSD
        return "polygon" if USE_PG else "none"
    # default US equity/ETF
    return "polygon" if USE_PG else ("yfinance" if USE_YF else "none")

def tick_once(sym: str):
    r = route(sym)
    try:
        if r == "polygon":   pg.fetch_last_bar(sym, INTERVAL, TOPIC)
        elif r == "finnhub": fh.fetch_last_bar(sym, INTERVAL, TOPIC)
        elif r == "twelvedata": td.fetch_last_bar(sym, INTERVAL, TOPIC)
        elif r == "yfinance": yf.fetch_last_bar(sym, INTERVAL, TOPIC)
        else:
            logging.debug("No provider enabled for %s", sym)
    except Exception as e:
        logging.warning("ingestor error for %s: %s", sym, e)

def run():
    logging.info("market-ingestor up | symbols=%s", SYMS)
    while True:
        for s in SYMS:
            tick_once(s)
        time.sleep(SLEEP)

if __name__ == "__main__":
    run()
