'use client';
import { useEffect, useState } from 'react';
import { getSocket } from './lib/socket'; // Import the function, not default

export default function LiveWire() {
  const [lines, setLines] = useState<string[]>([]);
  
  useEffect(() => {
    const socket = getSocket(); // Call the function to get the socket instance
    
    const onMsg = (msg: any) => {
      setLines((xs) => [JSON.stringify(msg), ...xs].slice(0, 20));
    };
    
    ['signals','news','social','options_nse','defi_pairs'].forEach(ev => socket.on(ev, onMsg));
    
    return () => ['signals','news','social','options_nse','defi_pairs'].forEach(ev => socket.off(ev, onMsg));
  }, []);
  
  return (
    <div>
      <h3>Signals</h3>
      <pre style={{maxHeight:240,overflow:'auto',background:'#fafafa',padding:8,borderRadius:8}}>
        {lines.join('\n')}
      </pre>
    </div>
  );
}