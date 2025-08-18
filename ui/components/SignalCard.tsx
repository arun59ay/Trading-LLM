import React from 'react';
type Props = { s: any };
export default function SignalCard({ s }: Props) {
  return (
    <div style={{border:'1px solid #e5e7eb', borderRadius:12, padding:12, marginBottom:12}}>
      <div style={{display:'flex', justifyContent:'space-between'}}>
        <strong>{s.direction} {s.asset}</strong>
        <span>{s.market}</span>
      </div>
      <div>Entry {s.entry} | TP {s.tp} | SL {s.sl} | Size {s.size}</div>
      <div>Conf {s.confidence} | Horizon {s.horizon_min}m</div>
      <div style={{marginTop:8}} dangerouslySetInnerHTML={{__html: (s.explain_md||'').replace(/\n/g,'<br/>')}} />
    </div>
  );
}
