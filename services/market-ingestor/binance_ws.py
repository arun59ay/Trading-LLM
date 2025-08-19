# binance_ws.py
import asyncio, json, websockets
from kafka_pub import publish

async def stream(symbol="btcusdt", interval="1m", topic="market.ohlc"):
    url = f"wss://stream.binance.com:9443/ws/{symbol}@kline_{interval}"
    async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
        async for raw in ws:
            m = json.loads(raw)
            k = m.get("k")
            if not k or not k.get("x"):  # only on candle close
                continue
            msg = {
                "provider": "binance",
                "symbol": symbol.upper().replace("USDT","USD"),
                "interval": interval,
                "ts": int(k["T"]),                 # close time ms
                "o": float(k["o"]), "h": float(k["h"]),
                "l": float(k["l"]), "c": float(k["c"]),
                "v": float(k["v"]),
            }
            publish(topic, msg)

def run(symbol="BTCUSDT", interval="1m", topic="market.ohlc"):
    asyncio.run(stream(symbol.lower(), interval, topic))
