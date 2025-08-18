import type { NextApiRequest, NextApiResponse } from 'next';

const BASE = process.env.GATEWAY_INTERNAL || 'http://localhost:8080';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { items } = req.body;
    const context = Array.isArray(items) ? items.join('\n\n') : String(items || '');
    
    const r = await fetch(`${BASE}/ai/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: "Summarize these items into concise bullet points. Focus on key trading signals and market insights:",
        context: context
      }),
    });
    
    if (!r.ok) {
      const errorText = await r.text();
      return res.status(r.status).send(errorText);
    }
    
    const data = await r.json();
    
    // Convert the answer into bullet points format
    const answer = data.answer || '';
    const bullets = answer.split('\n')
      .filter(line => line.trim())
      .map(line => line.replace(/^[-•*]\s*/, '').trim())
      .filter(line => line.length > 0);
    
    res.status(200).json({ bullets: bullets.length > 0 ? bullets : [answer] });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'proxy failed' });
  }
}