from fastapi import FastAPI
from pydantic import BaseModel
from kafka import KafkaProducer
import feedparser, requests, hashlib, os, json, time, sqlite3, datetime

KAFKA_BROKER = os.getenv("KAFKA_BROKER", "redpanda:9092")
TOPIC = os.getenv("TOPIC", "news.raw")
OLLAMA = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
DB_PATH = os.getenv("DB_PATH", "/data/news.db")
EMBED_MODEL = os.getenv("EMBED_MODEL","nomic-embed-text")

RSS = [
  "https://www.investing.com/rss/news.rss",
  "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
  "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
  "https://www.coindesk.com/arc/outboundfeeds/rss/"
]

app = FastAPI()
producer = KafkaProducer(bootstrap_servers=KAFKA_BROKER, value_serializer=lambda v: bytes(v, 'utf-8'))


def db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    return sqlite3.connect(DB_PATH)

def embed(text: str):
    # Ollama embeddings
    r = requests.post(f"{OLLAMA}/api/embeddings", json={"model":"nomic-embed-text","prompt":text}, timeout=60)
    r.raise_for_status()
    return r.json()["embedding"]

@app.get("/health")
def health(): return {"ok": True}

@app.post("/ingest")
def ingest(feed_url: str):
  d = feedparser.parse(feed_url)
  for e in d.entries[:20]:
    title = e.get("title","")
    vec = embed(title)
    payload = {"ts": int(time.time()*1000), "source":"rss", "title":title, "embedding":vec}
    producer.send("news", value=str(payload))
  return {"ok": True, "count": len(d.entries[:20])}

def upsert_article(conn, a):
    cur = conn.cursor()
    cur.execute("""CREATE TABLE IF NOT EXISTS articles(
        id TEXT PRIMARY KEY, title TEXT, link TEXT, published TEXT, summary TEXT, embedding BLOB
    )""")
    cur.execute("INSERT OR IGNORE INTO articles(id,title,link,published,summary,embedding) VALUES(?,?,?,?,?,?)",
        (a["id"], a["title"], a["link"], a["published"], a["summary"], json.dumps(a["embedding"]))
    )
    conn.commit()

def pull_rss():
    items = []
    for url in RSS:
        try:
            feed = feedparser.parse(url)
            for e in feed.entries:
                uid = hashlib.sha1((e.get("title","")+e.get("link","")).encode()).hexdigest()
                items.append({
                    "id": uid,
                    "title": e.get("title"),
                    "link": e.get("link"),
                    "published": e.get("published",""),
                    "summary": e.get("summary",""),
                })
        except Exception as e:
            print("RSS error", url, e)
    return items

def ingest():
    conn = db()
    for item in pull_rss():
        try:
            emb = embed((item["title"] or "") + "\n" + (item["summary"] or ""))
            payload = {**item, "embedding": emb}
            upsert_article(conn, payload)
            producer.send(TOPIC, {k:v for k,v in item.items() if k!="embedding"})
        except Exception as e:
            print("ingest err", e)
    producer.flush()
    conn.close()

@app.on_event("startup")
def _startup():
    # simple scheduler: every 10 min
    import threading
    def loop():
        while True:
            ingest()
            time.sleep(600)
    threading.Thread(target=loop, daemon=True).start()

@app.get("/health")
def health():
    return {"ok":True}
