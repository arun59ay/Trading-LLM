import { Kafka, logLevel } from 'kafkajs';
import axios from 'axios';

const broker = process.env.KAFKA_BROKER || 'redpanda:9092';
const kafka = new Kafka({ clientId: 'ingestor-sim', brokers: [broker], logLevel: logLevel.NOTHING });
const producer = kafka.producer();

const symbols = (process.env.SIM_SYMBOLS || 'NIFTY,BANKNIFTY,RELIANCE,BTCINR,MEME1').split(',');
const interval = Number(process.env.SIM_INTERVAL_MS || '1000');
const useOllama = (process.env.USE_OLLAMA || 'false').toLowerCase() === 'true';
const critiqueUrl = process.env.OLLAMA_CRITIQUE_URL || 'http://rag-ollama:8006/critique';

type Topic = 'quotes.nse'|'options.nse'|'quotes.crypto'|'news'|'social'|'signals';

const state: Record<string, number> = {};
symbols.forEach((s: string) => (state[s] = 100 + Math.random() * 50));
const randn = () => (Math.random() - 0.5) * 2;

function mkQuote(sym: string) {
  const drift = randn() * 0.2;
  state[sym] = Math.max(1, state[sym] + drift);
  return { ts: Date.now(), symbol: sym, ltp: +state[sym].toFixed(2), bid: +(state[sym]-0.1).toFixed(2), ask: +(state[sym]+0.1).toFixed(2), volume: Math.floor(100+Math.random()*1000) };
}

function mkNews() {
  const list = ['policy change', 'earnings beat', 'downgrade', 'new listing', 'market rally', 'regulatory update'];
  const idx = Math.floor(Math.random()*list.length);
  return { ts: Date.now(), source: 'sim', url: 'https://example.com', headline: `Simulated ${list[idx]}`, tickers: [symbols[Math.floor(Math.random()*symbols.length)]], sentiment: Math.round(randn()*100)/100 };
}

function mkSignal() {
  const asset = symbols[Math.floor(Math.random()*symbols.length)];
  const entry = state[asset] || 100;
  const direction = Math.random()>0.5?'BUY':'SELL';
  const tp = direction==='BUY' ? entry*1.01 : entry*0.99;
  const sl = direction==='BUY' ? entry*0.985 : entry*1.015;
  return {
    asset, market: asset.endsWith('INR')?'CRYPTO':'NSE-CASH', direction,
    entry: +entry.toFixed(2), sl: +sl.toFixed(2), tp: +tp.toFixed(2),
    size: 1, horizon_min: 15, confidence: +(0.5+Math.random()*0.4).toFixed(2),
    reasons: ['momentum','volume spike'], risks: ['volatility'],
    action_hint: 'WATCHLIST'
  };
}

async function maybeCritique(sig: ReturnType<typeof mkSignal>) {
  if (!useOllama) return;
  const body = {
    symbol: sig.asset,
    side: sig.direction,
    entry: sig.entry,
    stop: sig.sl,
    target: sig.tp,
    size_usd: 2500,
    rationale: 'Sim signal',
    news_bullets: ['sim'],
    risk_flags: ['vol']
  };
  try {
    const { data } = await axios.post(critiqueUrl, body, { timeout: 20000 });
    console.log('Critique:', data?.suggestion, data?.risk_score);
  } catch (e: any) {
    console.error('Ollama critique failed:', e?.message || e);
  }
}

async function loop() {
  const batches: { topic: Topic, messages: any[] }[] = [];
  for (const s of symbols) {
    batches.push({ topic: s.endsWith('INR')?'quotes.crypto':'quotes.nse', messages: [{ value: JSON.stringify(mkQuote(s)) }] });
  }
  batches.push({ topic: 'news', messages: [{ value: JSON.stringify(mkNews()) }] });
  if (Math.random() > 0.6) {
    const sig = mkSignal();
    await maybeCritique(sig);
    batches.push({ topic: 'signals', messages: [{ value: JSON.stringify(sig) }] });
  }
  for (const b of batches) await producer.send(b as any);
}

(async () => {
  await producer.connect();
  console.log('Ingestor simulator running every', interval, 'ms');
  setInterval(loop, interval);
})();
