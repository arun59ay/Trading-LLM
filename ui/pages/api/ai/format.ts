import type { NextApiRequest, NextApiResponse } from 'next';

const BASE = process.env.GATEWAY_INTERNAL || 'http://localhost:8080';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { text, system } = req.body;
    const r = await fetch(`${BASE}/ai/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: system || "Clean up and format this text:",
        context: text || ""
      }),
    });
    
    if (!r.ok) {
      const errorText = await r.text();
      return res.status(r.status).send(errorText);
    }
    
    const data = await r.json();
    res.status(200).json({ text: data.answer });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'proxy failed' });
  }
}