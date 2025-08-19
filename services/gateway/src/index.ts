// services/gateway/src/index.ts - Fixed Socket.IO Integration
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { Server as SocketIOServer } from 'socket.io';
import { startKafkaConsumer } from "./kafka-consumer.js";
import { startSimulator } from "./simulator.js";

const simulate = (process.env.SIMULATE || "false").toLowerCase() === "true";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

const OLLAMA_URL = process.env.RAG_OLLAMA_URL || 'http://rag-ollama:8006';
const OPENAI_FMT = process.env.OPENAI_FORMATTER_URL || 'http://openai-formatter:8005';

app.get('/health', async (_req, reply) => reply.send({ ok: true, service: 'gateway' }));

/** ---------- Q&A: ALWAYS via formatter ---------- */
app.post('/ai/ask', async (
  req: FastifyRequest<{ Body: { question?: string; context?: string } }>,
  reply: FastifyReply
) => {
  const { question = '', context = '' } = req.body || {};
  const prompt = `Use ONLY this context to answer.\n\nContext:\n${context}\n\nQuestion: ${question}\nAnswer:`;
  try {
    const r = await fetch(`${OPENAI_FMT}/format`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: prompt, system: 'Answer clearly and concisely.' }),
    });
    if (!r.ok) throw new Error(`formatter proxy ${r.status}`);
    const j = await r.json();
    return reply.send({ provider: 'openai', answer: j.text });
  } catch (e: any) {
    req.log.error(e, 'Q&A proxy failed');
    return reply.status(500).send({ error: 'Q&A proxy failed', detail: String(e) });
  }
});

/** ---------- Critique: forward TradeIdea to rag-ollama ---------- */
type TradeIdea = {
  symbol: string;
  side: string;   // BUY | SELL
  entry: number;
  stop: number;
  target: number;
  size_usd?: number | null;
  confidence?: number | null;
  rationale?: string | null;
  news_bullets?: string[];
  risk_flags?: string[];
};

app.post('/ai/critique', async (
  req: FastifyRequest<{ Body: TradeIdea }>,
  reply: FastifyReply
) => {
  const idea = req.body;
  for (const k of ['symbol','side','entry','stop','target'] as const) {
    const v = (idea as any)[k];
    if (v === undefined || v === null || v === '') {
      return reply.status(400).send({ error: `Missing required field: ${k}` });
    }
  }
  
  try {
    const r = await fetch(`${OLLAMA_URL}/critique`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(idea),
    });
    const raw = await r.text();
    if (!r.ok) {
      req.log.error({ status: r.status, raw }, 'rag-ollama /critique failed');
      return reply.status(502).send({ error: `rag-ollama ${r.status}`, body: raw });
    }
    let out: any = raw; try { out = JSON.parse(raw); } catch {}
    return reply.send({ provider: 'ollama', result: out });
  } catch (e: any) {
    req.log.error(e, 'critique proxy error');
    return reply.status(500).send({ error: 'critique proxy error', detail: String(e) });
  }
});

const port = Number(process.env.GATEWAY_PORT || 8080);

// Start Fastify server first
await app.listen({ port, host: '0.0.0.0' });
console.log(`✅ Gateway HTTP server started on port ${port}`);

// Create Socket.IO server attached to Fastify's underlying HTTP server
const io = new SocketIOServer(app.server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  allowEIO3: true
});

console.log('🔄 Setting up Socket.IO server...');

io.on('connection', (socket) => {
  console.log('🎉 Client connected:', socket.id);
  
  // Handle ping for latency testing
  socket.on('ping', (data, callback) => {
    console.log('📡 Ping received from client:', socket.id);
    if (callback) {
      callback({
        serverTime: Date.now(),
        clientTime: data?.clientTime || Date.now()
      });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('👋 Client disconnected:', socket.id);
  });
});



if (simulate) {
  console.log('🚀 Starting data simulation...');

  // keep your existing generator functions here
  const generateQuote = (symbol: string) => ({
    ts: Date.now(),
    symbol,
    ltp: Math.random() * 1000 + 100,
    bid: Math.random() * 1000 + 99,
    ask: Math.random() * 1000 + 101,
    volume: Math.floor(Math.random() * 100000)
  });

  const generateSignal = () => ({
    id: Math.random().toString(36).substr(2, 9),
    symbol: ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'NIFTY', 'BANKNIFTY'][Math.floor(Math.random() * 6)],
    action: ['BUY', 'SELL'][Math.floor(Math.random() * 2)],
    entry: Math.random() * 200 + 100,
    target: Math.random() * 250 + 150,
    stop: Math.random() * 150 + 50,
    confidence: 0.6 + Math.random() * 0.4,
    horizon: ['1H', '4H', '1D'][Math.floor(Math.random() * 3)],
    exchange: 'NSE',
    idea: 'Technical breakout pattern detected'
  });

  // NSE quotes every 2s
  setInterval(() => {
    const n = io.engine.clientsCount;
    if (n > 0) {
      const symbols = ['NIFTY', 'BANKNIFTY', 'RELIANCE', 'TCS', 'INFY', 'HDFC'];
      const symbol = symbols[Math.floor(Math.random() * symbols.length)];
      const quote = generateQuote(symbol);
      io.emit('quotes_nse', quote);
      console.log(`📈 Sent NSE quote to ${n} clients: ${symbol} @ ${quote.ltp.toFixed(2)}`);
    }
  }, 2000);

  // crypto quotes every 3s
  setInterval(() => {
    const n = io.engine.clientsCount;
    if (n > 0) {
      const cryptos = ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'DOTUSDT'];
      const symbol = cryptos[Math.floor(Math.random() * cryptos.length)];
      const quote = generateQuote(symbol);
      io.emit('quotes_crypto', quote);
      console.log(`🪙 Sent crypto quote to ${n} clients: ${symbol} @ ${quote.ltp.toFixed(2)}`);
    }
  }, 3000);

  // signals every 10s
  setInterval(() => {
    const n = io.engine.clientsCount;
    if (n > 0) {
      const signal = generateSignal();
      io.emit('signals', signal);
      console.log(`📡 Sent signal to ${n} clients: ${signal.action} ${signal.symbol} @ ${signal.entry.toFixed(2)}`);
    }
  }, 10000);

  console.log('🎯 Gateway with Socket.IO ready!');
} else {
  console.log('🔌 Starting Kafka consumer...');
  // lazy import to avoid bundling kafkajs in sim-only runs if you want
  const { Kafka } = await import('kafkajs');
  const broker = process.env.KAFKA_BROKER || 'redpanda:9092';
  const topics = (process.env.WS_TOPICS || 'signals.raw').split(',');

  const kafka = new Kafka({ brokers: [broker] });
  const consumer = kafka.consumer({ groupId: 'gateway-consumer' });

  await consumer.connect();
  for (const t of topics) await consumer.subscribe({ topic: t, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        const payload = JSON.parse(message.value?.toString() || '{}');
        io.emit(topic, payload);               // emits with event name = topic
        // If your UI expects 'signals' instead of 'signals.raw', map here:
        // if (topic === 'signals.raw') io.emit('signals', payload);
      } catch (e) {
        console.error('Kafka parse error', e);
      }
    }
  });

  console.log(`✅ Kafka consumer running on ${broker}, topics: ${topics.join(', ')}`);
}



// Generate sample data for testing
const generateQuote = (symbol: string) => ({
  ts: Date.now(),
  symbol,
  ltp: Math.random() * 1000 + 100,
  bid: Math.random() * 1000 + 99,
  ask: Math.random() * 1000 + 101,
  volume: Math.floor(Math.random() * 100000)
});

const generateSignal = () => ({
  id: Math.random().toString(36).substr(2, 9),
  symbol: ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'NIFTY', 'BANKNIFTY'][Math.floor(Math.random() * 6)],
  action: ['BUY', 'SELL'][Math.floor(Math.random() * 2)],
  entry: Math.random() * 200 + 100,
  target: Math.random() * 250 + 150,
  stop: Math.random() * 150 + 50,
  confidence: 0.6 + Math.random() * 0.4,
  horizon: ['1H', '4H', '1D'][Math.floor(Math.random() * 3)],
  exchange: 'NSE',
  idea: 'Technical breakout pattern detected'
});

// Start data simulation
console.log('🚀 Starting data simulation...');

// Generate NSE quotes every 2 seconds
setInterval(() => {
  const connectedClients = io.engine.clientsCount;
  
  if (connectedClients > 0) {
    const symbols = ['NIFTY', 'BANKNIFTY', 'RELIANCE', 'TCS', 'INFY', 'HDFC'];
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    const quote = generateQuote(symbol);
    io.emit('quotes_nse', quote);
    console.log(`📈 Sent NSE quote to ${connectedClients} clients: ${symbol} @ ${quote.ltp.toFixed(2)}`);
  }
}, 2000);

// Generate crypto quotes every 3 seconds  
setInterval(() => {
  const connectedClients = io.engine.clientsCount;
  
  if (connectedClients > 0) {
    const cryptos = ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'DOTUSDT'];
    const symbol = cryptos[Math.floor(Math.random() * cryptos.length)];
    const quote = generateQuote(symbol);
    io.emit('quotes_crypto', quote);
    console.log(`🪙 Sent crypto quote to ${connectedClients} clients: ${symbol} @ ${quote.ltp.toFixed(2)}`);
  }
}, 3000);

// Generate signals every 10 seconds
setInterval(() => {
  const connectedClients = io.engine.clientsCount;
  
  if (connectedClients > 0) {
    const signal = generateSignal();
    io.emit('signals', signal);
    console.log(`📡 Sent signal to ${connectedClients} clients: ${signal.action} ${signal.symbol} @ ${signal.entry.toFixed(2)}`);
  }
}, 10000);

console.log('🎯 Gateway with Socket.IO ready!');


if (simulate) {
  startSimulator(io);
} else {
  startKafkaConsumer(io).catch((err: any) => {
    console.error("❌ Kafka consumer failed", err);
    process.exit(1);
  });
}