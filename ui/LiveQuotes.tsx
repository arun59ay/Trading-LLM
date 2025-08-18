'use client';
import { useEffect, useState } from 'react';
import { getSocket } from './lib/socket'; // <-- changed

type Quote = { ts:number; symbol:string; ltp:number; bid:number; ask:number; volume:number };

export default function LiveQuotes() {
  const [quotes, setQuotes] = useState<Quote[]>([]);

  useEffect(() => {
    const socket = getSocket();               // <-- use the getter
    const handler = (q: Quote) => setQuotes(p => [q, ...p].slice(0, 30));

    socket.on('quotes_nse', handler);
    socket.on('quotes_crypto', handler);

    return () => {
      socket.off('quotes_nse', handler);
      socket.off('quotes_crypto', handler);
      // DO NOT disconnect here if other components use the same socket
    };
  }, []);

  return (
    <pre>
      {quotes.map((q,i)=>JSON.stringify(q)).join('\n')}
    </pre>
  );
}
