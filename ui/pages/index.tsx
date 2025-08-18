'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getSocket } from '../lib/socket';

type Quote = { 
  ts: number; 
  symbol: string; 
  ltp: number; 
  bid: number; 
  ask: number; 
  volume: number 
};

type Signal = {
  id?: string;
  symbol?: string;
  action?: string;
  price?: number;
  timestamp?: number;
  [key: string]: any;
  receivedAt?: number;
};

type QuoteWithDeltas = Quote & { 
  delta?: number; 
  spread: number; 
  spreadBps: number;
  isNew?: boolean;
};

type Theme = 'light' | 'dark';

interface TopicConfig { key: string; label: string; }
interface Stats { totalQuotes: number; uniqueSymbols: number; quotesPerSecond: number; lastUpdate: number; }

const ALL_TOPICS: TopicConfig[] = [
  { key: 'quotes_nse',     label: 'Quotes: NSE' },
  { key: 'quotes_crypto',  label: 'Quotes: Crypto' },
  { key: 'signals',        label: 'Signals' },
  { key: 'options_nse',    label: 'Options NSE' },
  { key: 'news',           label: 'News' },
  { key: 'social',         label: 'Social' },
  { key: 'defi_pairs',     label: 'DeFi Pairs' },
];

// ---------- localStorage helpers ----------
const getStorageItem = (key: string, defaultValue: any): any => {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
};
const setStorageItem = (key: string, value: any): void => {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};
const getStorageString = (key: string, defaultValue = ''): string => {
  if (typeof window === 'undefined') return defaultValue;
  return localStorage.getItem(key) || defaultValue;
};
const getStorageNumber = (key: string, defaultValue: number): number => {
  if (typeof window === 'undefined') return defaultValue;
  const v = localStorage.getItem(key);
  return v ? Number(v) || defaultValue : defaultValue;
};

// ---------- formatters ----------
const number = (n: number): string => new Intl.NumberFormat().format(n);
const time = (ms: number): string => new Date(ms).toLocaleTimeString();
const currency = (n: number, decimals = 2): string => n.toFixed(decimals);

// ===================================================================================

export default function Home() {
  // mount gate to avoid SSR/hydration mismatch
  const [isMounted, setIsMounted] = useState(false);

  // UI state
  const [enabled, setEnabled]         = useState<Record<string, boolean>>(() => Object.fromEntries(ALL_TOPICS.map(t => [t.key, true])));
  const [symbolFilter, setSymbolFilter] = useState<string>('');
  const [maxRows, setMaxRows]         = useState<number>(200);
  const [paused, setPaused]           = useState<boolean>(false);
  const [autoScroll, setAutoScroll]   = useState<boolean>(true);
  const [theme, setTheme]             = useState<Theme>('light');

  // runtime
  const [connected, setConnected] = useState<boolean>(false);
  const [rtt, setRtt]             = useState<number | null>(null);
  const [connectionAttempts, setConnectionAttempts] = useState<number>(0);

  const [quotes, setQuotes]   = useState<Quote[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);

  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);
  const lastBySymbol  = useRef<Map<string, Quote>>(new Map());
  const newQuoteSyms  = useRef<Set<string>>(new Set());

  const [stats, setStats] = useState<Stats>({ totalQuotes: 0, uniqueSymbols: 0, quotesPerSecond: 0, lastUpdate: 0 });

  // one-time mount: load prefs + init socket (client-only)
  useEffect(() => {
    setIsMounted(true);

        setEnabled(getStorageItem('ui.enabled.topics', Object.fromEntries(ALL_TOPICS.map(t => [t.key, true]))));
        setSymbolFilter(getStorageString('ui.symbolFilter'));
    setMaxRows(getStorageNumber('ui.maxRows', 200));
    setTheme(getStorageString('ui.theme', 'light') as Theme);
    setAutoScroll(getStorageItem('ui.autoScroll', true));

    try {
      socketRef.current = getSocket();
      setConnected(!!socketRef.current?.connected);
    } catch (err) {
      console.error('getSocket failed', err);
    }
  }, []);

  // persist prefs
  useEffect(() => { if (isMounted) setStorageItem('ui.enabled.topics', enabled); },      [enabled, isMounted]);
  useEffect(() => { if (isMounted) setStorageItem('ui.symbolFilter', symbolFilter); },   [symbolFilter, isMounted]);
  useEffect(() => { if (isMounted) setStorageItem('ui.maxRows', maxRows); },             [maxRows, isMounted]);
  useEffect(() => { if (isMounted) setStorageItem('ui.theme', theme); },                 [theme, isMounted]);
  useEffect(() => { if (isMounted) setStorageItem('ui.autoScroll', autoScroll); },       [autoScroll, isMounted]);

  // socket lifecycle
  useEffect(() => {
    if (!isMounted || !socketRef.current) return;
    const socket = socketRef.current;

    const onConnect = () => { setConnected(true); setConnectionAttempts(0); };
    const onDisconnect = (reason: string) => {
      setConnected(false);
      if (reason === 'io server disconnect') {
        setTimeout(() => {
          setConnectionAttempts(prev => prev + 1);
          socket.connect();
        }, 1000 * Math.min(connectionAttempts + 1, 10));
      }
    };
    const onConnectError = (e: Error) => { console.error('connect_error', e); setConnectionAttempts(p => p + 1); };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    let pingTimer: NodeJS.Timeout | undefined;
    const doPing = () => {
      if (!socket.connected) return;
      const t0 = performance.now();
      socket.timeout(4000).emit('ping', { clientTime: Date.now() }, (reply: any) => {
        const r = Math.round(performance.now() - t0);
        setRtt(r);
        if (reply?.serverTime) {
          const drift = Date.now() - reply.serverTime - r / 2;
          console.debug('clock drift', drift);
        }
      });
    };

    pingTimer = setInterval(doPing, 5000);
    doPing();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      if (pingTimer) clearInterval(pingTimer);
    };
  }, [isMounted, connectionAttempts]);

  // stream handlers
  useEffect(() => {
    if (!isMounted || !socketRef.current) return;
    const socket = socketRef.current;

    const parseSymbols = (input: string): Set<string> => {
      const parts = input.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      return new Set(parts);
    };

    const onQuote = (q: Quote) => {
      if (paused) return;
      if (!q?.symbol || typeof q.ltp !== 'number' || q.ltp <= 0) return;

      if (symbolFilter.trim()) {
        const allowed = parseSymbols(symbolFilter);
        if (!allowed.has(q.symbol.toUpperCase())) return;
      }

      newQuoteSyms.current.add(q.symbol);
      setTimeout(() => newQuoteSyms.current.delete(q.symbol), 2000);

      // keep only latest occurrence per symbol in map, but keep list for UI
      const prev = lastBySymbol.current.get(q.symbol);
      if (!prev || prev.ts <= q.ts) lastBySymbol.current.set(q.symbol, q);

      setQuotes(prevList => {
        const next = [q, ...prevList];
        if (next.length > maxRows) next.length = maxRows;
        return next;
      });
    };

    const onSignal = (s: Signal) => {
      if (paused || !s || typeof s !== 'object') return;
      setSignals(prev => [{ ...s, receivedAt: Date.now() }, ...prev].slice(0, 100));
    };

    const onError = (err: any) => console.error('socket error', err);

    if (enabled.quotes_nse)     socket.on('quotes_nse', onQuote);
    if (enabled.quotes_crypto)  socket.on('quotes_crypto', onQuote);
    if (enabled.signals)        socket.on('signals', onSignal);
    if (enabled.news)           socket.on('news',   (m: any) => console.debug('news', m));
    if (enabled.social)         socket.on('social', (m: any) => console.debug('social', m));
    if (enabled.options_nse)    socket.on('options_nse', (m: any) => console.debug('options', m));
    if (enabled.defi_pairs)     socket.on('defi_pairs',  (m: any) => console.debug('defi', m));
    socket.on('error', onError);

    return () => {
      socket.off('quotes_nse', onQuote);
      socket.off('quotes_crypto', onQuote);
      socket.off('signals', onSignal);
      socket.off('news');
      socket.off('social');
      socket.off('options_nse');
      socket.off('defi_pairs');
      socket.off('error', onError);
    };
  }, [isMounted, enabled, paused, symbolFilter, maxRows]);

  // stats
  useEffect(() => {
    if (!isMounted) return;
    const h = setInterval(() => {
      const now = Date.now();
      const unique = new Set(quotes.slice(0, 100).map(q => q.symbol)).size;
      const qps   = quotes.filter(q => now - q.ts < 1000).length;
      setStats({ totalQuotes: quotes.length, uniqueSymbols: unique, quotesPerSecond: qps, lastUpdate: now });
    }, 1000);
    return () => clearInterval(h);
  }, [isMounted, quotes]);

  // derived rows
  const rows = useMemo<QuoteWithDeltas[]>(() => {
    if (!isMounted) return [];
    const parseSymbols = (input: string): Set<string> => {
      const parts = input.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      return new Set(parts);
    };
    const syFilter = parseSymbols(symbolFilter);
    return quotes
      .filter(q => !syFilter.size || syFilter.has(q.symbol.toUpperCase()))
      .map(q => {
        const prev = lastBySymbol.current.get(q.symbol);
        const prevLtp = prev && prev.ts < q.ts ? prev.ltp : undefined;
        const delta   = prevLtp !== undefined ? q.ltp - prevLtp : undefined;
        const spread  = q.ask && q.bid ? (q.ask - q.bid) : 0;
        const spreadBps = q.ltp ? (spread / q.ltp) * 10_000 : 0;
        const isNew = newQuoteSyms.current.has(q.symbol);
        return { ...q, delta, spread, spreadBps, isNew };
      });
  }, [quotes, symbolFilter, isMounted]);

  // actions
  const clearQuotes = () => { setQuotes([]); lastBySymbol.current.clear(); newQuoteSyms.current.clear(); };
  const clearSignals = () => setSignals([]);
  const exportCSV = () => {
    const header = ['time', 'symbol', 'ltp', 'bid', 'ask', 'volume', 'delta', 'spread', 'spread_bps'];
    const lines = rows.map(r => [
      new Date(r.ts).toISOString(), r.symbol, r.ltp, r.bid ?? '', r.ask ?? '', r.volume,
      r.delta ?? '', r.spread, r.spreadBps.toFixed(2)
    ].join(','));
    const blob = new Blob([[header.join(',')].concat(lines).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `quotes_${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };
  const toggleTheme = () => setTheme(p => p === 'light' ? 'dark' : 'light');

  if (!isMounted) {
    return (
      <div style={{ maxWidth: 1200, margin: '24px auto', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', padding: '0 16px' }}>
        <h1>TradeBrain Dashboard</h1>
        <p style={{ color: '#666' }}>Loading...</p>
      </div>
    );
  }

  const containerStyle: React.CSSProperties = {
    maxWidth: 1200, margin: '24px auto', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    backgroundColor: theme === 'dark' ? '#1a1a1a' : '#ffffff',
    color: theme === 'dark' ? '#ffffff' : '#000000',
    minHeight: '100vh', padding: '0 16px'
  };

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h1 style={{ margin: 0 }}>TradeBrain Dashboard</h1>
        <button onClick={toggleTheme} style={{ ...btnStyle, background: theme === 'dark' ? '#333' : '#f5f5f5' }}>
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
      </div>

      <p style={{ color: theme === 'dark' ? '#ccc' : '#666', marginTop: 0, marginBottom: 20 }}>
        Live simulator pushing quotes &amp; signals via Kafka → Gateway → Socket.IO
      </p>

      <StatusBar
        connected={connected}
        rtt={rtt}
        paused={paused}
        onPause={() => setPaused(p => !p)}
        stats={stats}
        connectionAttempts={connectionAttempts}
        theme={theme}
        socketReady={!!socketRef.current}
      />

      <Controls
        enabled={enabled}
        setEnabled={setEnabled}
        symbolFilter={symbolFilter}
        setSymbolFilter={setSymbolFilter}
        maxRows={maxRows}
        setMaxRows={setMaxRows}
        autoScroll={autoScroll}
        setAutoScroll={setAutoScroll}
        clearQuotes={clearQuotes}
        clearSignals={clearSignals}
        exportCSV={exportCSV}
        theme={theme}
      />

      <AIPanel rows={rows} signals={signals} theme={theme} />

      <h2 style={{ marginTop: 24, marginBottom: 12 }}>
        Signals ({signals.length})
        {signals.length > 0 && (
          <button onClick={clearSignals} style={{ ...btnStyle, marginLeft: 12, fontSize: 12 }}>Clear</button>
        )}
      </h2>
      {signals.length === 0 && <EmptyCard text="No signals yet" theme={theme} />}
      {signals.slice(0, 10).map((s, i) => <SignalDisplay key={i} signal={s} theme={theme} />)}

      <h2 style={{ marginTop: 24, marginBottom: 12 }}>
        Recent Quotes ({rows.length})
        <span style={{ fontWeight: 'normal', fontSize: 14, marginLeft: 8, color: theme === 'dark' ? '#ccc' : '#666' }}>
          {stats.uniqueSymbols} symbols • {stats.quotesPerSecond}/s
        </span>
      </h2>
      <QuotesTable rows={rows} autoScroll={autoScroll} theme={theme} />
    </div>
  );
}

// ===================================================================================
// components below

const btnStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', background: '#fff',
  cursor: 'pointer', fontSize: 14, fontWeight: 500, transition: 'all 0.2s ease'
};

interface StatusBarProps {
  connected: boolean; rtt: number | null; paused: boolean; onPause: () => void;
  stats: Stats; connectionAttempts: number; theme: Theme; socketReady: boolean;
}
function StatusBar({ connected, rtt, paused, onPause, stats, connectionAttempts, theme, socketReady }: StatusBarProps) {
  const bg = theme === 'dark' ? '#2a2a2a' : '#f8f9fa';
  const br = theme === 'dark' ? '#444'   : '#e9ecef';
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', margin: '8px 0 16px',
      padding: 12, backgroundColor: bg, border: `1px solid ${br}`, borderRadius: 8, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Dot ok={connected && socketReady} />
        <span>Socket: {!socketReady ? 'initializing' : connected ? 'connected' : 'disconnected'}</span>
        {connectionAttempts > 0 && !connected && (<span style={{ color: '#ef4444', fontSize: 12 }}>(attempt {connectionAttempts})</span>)}
      </div>
      <span style={{ color: theme === 'dark' ? '#666' : '#888' }}>•</span>
      <span>Latency: {rtt != null ? `${rtt} ms` : '—'}</span>
      <span style={{ color: theme === 'dark' ? '#666' : '#888' }}>•</span>
      <span>{stats.quotesPerSecond} quotes/s</span>
      <button onClick={onPause} style={{
        marginLeft: 'auto', padding: '6px 12px', borderRadius: 6, border: `1px solid ${br}`,
        background: paused ? '#fff6e5' : (theme === 'dark' ? '#1e3a8a' : '#3b82f6'),
        color: paused ? '#92400e' : '#ffffff', cursor: 'pointer', fontWeight: 500
      }}>
        {paused ? '▶️ Resume' : '⏸️ Pause'}
      </button>
    </div>
  );
}

interface ControlsProps {
  enabled: Record<string, boolean>;
  setEnabled: (u: Record<string, boolean>) => void;
  symbolFilter: string; setSymbolFilter: (s: string) => void;
  maxRows: number; setMaxRows: (n: number) => void;
  autoScroll: boolean; setAutoScroll: (b: boolean) => void;
  clearQuotes: () => void; clearSignals: () => void; exportCSV: () => void;
  theme: Theme;
}
function Controls(props: ControlsProps) {
  const { enabled, setEnabled, symbolFilter, setSymbolFilter, maxRows, setMaxRows,
    autoScroll, setAutoScroll, clearQuotes, clearSignals, exportCSV, theme } = props;

  const card: React.CSSProperties = {
    padding: 16, border: `1px solid ${theme === 'dark' ? '#444' : '#eee'}`,
    borderRadius: 10, backgroundColor: theme === 'dark' ? '#2a2a2a' : '#ffffff'
  };
  const input: React.CSSProperties = {
    width: '100%', padding: '8px 12px', border: `1px solid ${theme === 'dark' ? '#555' : '#ddd'}`,
    borderRadius: 6, marginTop: 6, backgroundColor: theme === 'dark' ? '#1a1a1a' : '#ffffff',
    color: theme === 'dark' ? '#ffffff' : '#000000'
  };

  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', margin: '10px 0 18px' }}>
      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Topics</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          {ALL_TOPICS.map(t => (
            <label key={t.key} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!enabled[t.key]} onChange={e => setEnabled({ ...enabled, [t.key]: e.target.checked })} />
              <span style={{ fontSize: 14 }}>{t.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 600 }}>Symbol Filter</div>
            <input
              placeholder="e.g. NIFTY, BANKNIFTY, RELIANCE"
              value={symbolFilter}
              onChange={e => setSymbolFilter(e.target.value)}
              style={input}
            />
            <div style={{ color: theme === 'dark' ? '#888' : '#666', fontSize: 12, marginTop: 4 }}>
              Comma or space separated. Empty = all symbols.
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>Max rows:</div>
              <div style={{ fontSize: 14, color: theme === 'dark' ? '#ccc' : '#666' }}>{number(maxRows)}</div>
            </div>
            <input type="range" min={50} max={1000} step={25} value={maxRows} onChange={e => setMaxRows(Number(e.target.value))} style={{ width: '100%' }} />
          </div>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
            <span style={{ fontSize: 14 }}>Auto-scroll to new quotes</span>
          </label>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={clearQuotes}  style={{ ...btnStyle, flex: 1 }}>🗑️ Clear Quotes</button>
            <button onClick={exportCSV}    style={{ ...btnStyle, flex: 1 }}>📊 Export CSV</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: ok ? '#22c55e' : '#ef4444' }} />;
}

function EmptyCard({ text, theme }: { text: string; theme: Theme }) {
  return (
    <div style={{
      padding: 20, border: `2px dashed ${theme === 'dark' ? '#444' : '#ddd'}`, borderRadius: 10,
      color: theme === 'dark' ? '#888' : '#666', textAlign: 'center', fontSize: 14
    }}>
      {text}
    </div>
  );
}

// ---------- AI Panel ----------
function AIPanel({ rows, signals, theme }: { rows: QuoteWithDeltas[]; signals: Signal[]; theme: Theme }) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'signals' | 'quotes' | 'custom'>('signals');
  const [customText, setCustomText] = useState('');
  const [bullets, setBullets] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const runAI = async () => {
    setBusy(true); setError(null); setBullets([]);
    try {
      if (mode === 'custom') {
        const res = await fetch('/api/ai/format', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: customText }) });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setBullets([data.text]);
      } else if (mode === 'signals') {
        const items = signals.slice(0, 30).map(s => JSON.stringify(s));
        const res = await fetch('/api/ai/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setBullets(data.bullets || []);
      } else {
        const items = rows.slice(0, 50).map(r => `${new Date(r.ts).toLocaleTimeString()} ${r.symbol} ltp=${r.ltp} bid=${r.bid ?? ''} ask=${r.ask ?? ''} vol=${r.volume}`);
        const res = await fetch('/api/ai/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setBullets(data.bullets || []);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const card: React.CSSProperties = {
    padding: 16, border: `1px solid ${theme === 'dark' ? '#444' : '#eee'}`,
    borderRadius: 10, backgroundColor: theme === 'dark' ? '#2a2a2a' : '#ffffff', marginBottom: 16
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <strong>AI Assistant</strong>
        <select value={mode} onChange={e => setMode(e.target.value as any)} style={{ padding: 6, borderRadius: 6 }}>
          <option value="signals">Summarize Signals</option>
          <option value="quotes">Summarize Recent Quotes</option>
          <option value="custom">Format Custom Text</option>
        </select>
        <button onClick={runAI} disabled={busy} style={{ ...btnStyle }}>
          {busy ? 'Working…' : 'Run'}
        </button>
      </div>

      {mode === 'custom' && (
        <textarea
          value={customText}
          onChange={e => setCustomText(e.target.value)}
          placeholder="Paste text to clean up…"
          rows={4}
          style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ccc', background: theme === 'dark' ? '#1a1a1a' : '#fff', color: theme === 'dark' ? '#fff' : '#000' }}
        />
      )}

      {error && <div style={{ color: '#dc2626', marginTop: 8 }}>{error}</div>}
      {bullets.length > 0 && (
        <ul style={{ marginTop: 12 }}>
          {bullets.map((b, i) => <li key={i} style={{ marginBottom: 6 }}>{b}</li>)}
        </ul>
      )}
    </div>
  );
}

// ---------- Signals ----------
function SignalDisplay({ signal, theme }: { signal: Signal; theme: Theme; }) {
  const card: React.CSSProperties = {
    padding: 16, margin: '8px 0', border: `1px solid ${theme === 'dark' ? '#444' : '#e5e7eb'}`,
    borderRadius: 8, backgroundColor: theme === 'dark' ? '#1f2937' : '#ffffff'
  };
  const getColor = (action?: string) => {
    const a = action?.toUpperCase() || '';
    if (a.includes('BUY')) return '#16a34a';
    if (a.includes('SELL')) return '#dc2626';
    return theme === 'dark' ? '#6b7280' : '#374151';
  };

  const action = signal.action || signal.side || 'UNKNOWN';
  const symbol = signal.symbol || signal.instrument || 'N/A';
  const entry  = signal.entry || signal.price || signal.entryPrice;
  const tp     = signal.tp || signal.takeProfit || signal.target;
  const sl     = signal.sl || signal.stopLoss || signal.stoploss;
  const size   = signal.size || signal.quantity || signal.qty;
  const conf   = signal.confidence || signal.conf;
  const horiz  = signal.horizon || signal.timeframe;
  const exch   = signal.exchange || signal.market;
  const idea   = signal.idea || signal.description || signal.reason;

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ backgroundColor: getColor(action), color: 'white', padding: '4px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>{action}</span>
          <span style={{ fontSize: 18, fontWeight: 600, fontFamily: 'monospace' }}>{symbol}</span>
        </div>
        {exch && (<span style={{ fontSize: 12, color: theme === 'dark' ? '#9ca3af' : '#6b7280', backgroundColor: theme === 'dark' ? '#374151' : '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>{exch}</span>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 8 }}>
        {entry && <InfoItem label="Entry" value={entry} />}
        {tp    && <InfoItem label="TP"    value={tp}    color="#16a34a" />}
        {sl    && <InfoItem label="SL"    value={sl}    color="#dc2626" />}
        {size  && <InfoItem label="Size"  value={size} />}
      </div>
      {(conf || horiz) && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
          {conf  && <span><Label theme={theme}>Confidence:</Label> <strong>{conf}</strong></span>}
          {horiz && <span><Label theme={theme}>Horizon:</Label> <strong>{horiz}</strong></span>}
        </div>
      )}
      {idea && (
        <div style={{ fontSize: 14, color: theme === 'dark' ? '#d1d5db' : '#374151', fontStyle: 'italic', marginTop: 8,
          paddingTop: 8, borderTop: `1px solid ${theme === 'dark' ? '#374151' : '#e5e7eb'}` }}>
          {idea}
        </div>
      )}
      {signal.receivedAt && (
        <div style={{ fontSize: 11, color: theme === 'dark' ? '#6b7280' : '#9ca3af', marginTop: 8, textAlign: 'right' }}>
          {new Date(signal.receivedAt).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

function InfoItem({ label, value, color }: { label: string; value: any; color?: string }) {
  return (
    <div>
      <span style={{ fontSize: 12, color: color || '#6b7280' }}>{label}</span>
      <div style={{ fontFamily: 'monospace', fontWeight: 600, color }}>{value}</div>
    </div>
  );
}
function Label({ children, theme }: { children: React.ReactNode; theme: Theme }) {
  return <span style={{ fontSize: 12, color: theme === 'dark' ? '#9ca3af' : '#6b7280' }}>{children}</span>;
}

// ---------- Quotes ----------
function QuotesTable({ rows, autoScroll, theme }: { rows: QuoteWithDeltas[]; autoScroll: boolean; theme: Theme }) {
  const tableRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (autoScroll && tableRef.current && rows.length > 0) tableRef.current.scrollTop = 0; }, [rows, autoScroll]);

  const border = theme === 'dark' ? '#444' : '#eee';
  const headBg = theme === 'dark' ? '#2a2a2a' : '#fafafa';
  const rowBrd = theme === 'dark' ? '#333' : '#f0f0f0';

  if (rows.length === 0) return <EmptyCard text="No quotes yet" theme={theme} />;

  const Th = ({ children, align = 'left' as const }: { children: React.ReactNode; align?: 'left'|'right'|'center' }) => (
    <th style={{ textAlign: align, padding: '12px', fontWeight: 700, fontSize: 12, color: theme === 'dark' ? '#ccc' : '#666', letterSpacing: 0.5, textTransform: 'uppercase' }}>
      {children}
    </th>
  );
  const Td = ({ children, align = 'left' as const, style = {} }: { children: React.ReactNode; align?: 'left'|'right'|'center'; style?: React.CSSProperties }) => (
    <td style={{ textAlign: align, padding: '10px 12px', color: theme === 'dark' ? '#ffffff' : '#000000', ...style }}>{children}</td>
  );

  return (
    <div ref={tableRef} style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: 'auto', maxHeight: 600,
      backgroundColor: theme === 'dark' ? '#1a1a1a' : '#ffffff' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead style={{ background: headBg, position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            <Th>Time</Th><Th>Symbol</Th><Th align="right">LTP</Th><Th align="right">Δ</Th>
            <Th align="right">Bid</Th><Th align="right">Ask</Th><Th align="right">Spread</Th><Th align="right">Spread (bps)</Th><Th align="right">Volume</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.symbol}-${r.ts}-${i}`} style={{
              borderTop: `1px solid ${rowBrd}`,
              backgroundColor: r.isNew ? (theme === 'dark' ? '#1e3a1e' : '#f0fff0') : 'transparent',
              transition: 'background-color 0.3s ease'
            }}>
              <Td>{time(r.ts)}</Td>
              <Td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{r.symbol}</Td>
              <Td align="right" style={{ fontFamily: 'monospace' }}>{currency(r.ltp)}</Td>
              <Td align="right" style={{
                color: r.delta === undefined ? (theme === 'dark' ? '#666' : '#999') :
                       r.delta > 0 ? '#16a34a' : r.delta < 0 ? '#dc2626' : (theme === 'dark' ? '#ccc' : '#444'),
                fontFamily: 'monospace', fontWeight: r.delta !== undefined ? 600 : 'normal'
              }}>
                {r.delta === undefined ? '—' : `${r.delta > 0 ? '+' : ''}${currency(r.delta)}`}
              </Td>
              <Td align="right" style={{ fontFamily: 'monospace' }}>{r.bid ? currency(r.bid) : '—'}</Td>
              <Td align="right" style={{ fontFamily: 'monospace' }}>{r.ask ? currency(r.ask) : '—'}</Td>
              <Td align="right" style={{ fontFamily: 'monospace' }}>{currency(r.spread)}</Td>
              <Td align="right" style={{ fontFamily: 'monospace' }}>{r.spreadBps.toFixed(1)}</Td>
              <Td align="right" style={{ fontFamily: 'monospace' }}>{number(r.volume)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
