export type Market = 'NSE-OPT'|'NSE-CASH'|'CRYPTO'|'DEFI';
export type Direction = 'BUY'|'SELL'|'NEUTRAL';
export type ActionHint = 'PAPER_BUY'|'PAPER_SELL'|'WATCHLIST'|'AVOID';

export interface SignalV1 {
  asset: string;
  market: Market;
  direction: Direction;
  entry: number;
  sl: number;
  tp: number;
  size: number;
  horizon_min: number;
  confidence: number; // 0..1
  reasons: string[];
  risks: string[];
  action_hint: ActionHint;
  explain_md: string;
  telemetry: { missing: string[]; latency_ms: number; };
}
