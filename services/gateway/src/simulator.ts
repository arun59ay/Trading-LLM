// services/gateway/src/simulator.ts
export function startSimulator(io: any) {
  console.log("🚀 Starting data simulation...");

  const generateQuote = (symbol: string) => ({
    ts: Date.now(),
    symbol,
    ltp: Math.random() * 1000 + 100,
    bid: Math.random() * 1000 + 99,
    ask: Math.random() * 1000 + 101,
    volume: Math.floor(Math.random() * 100000),
  });

  setInterval(() => {
    const connectedClients = io.engine.clientsCount;
    if (connectedClients > 0) {
      const symbol = "NIFTY";
      io.emit("quotes_nse", generateQuote(symbol));
    }
  }, 2000);
}
