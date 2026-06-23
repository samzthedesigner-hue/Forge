import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const FREE_LIMIT = 25;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    const userKey = req.headers['x-user-key'];
    if (userKey) return res.status(200).end();
    const used = await redis.get(`free:${ip}`);
    const remaining = FREE_LIMIT - (used || 0);
    res.setHeader('X-Free-Remaining', Math.max(0, remaining).toString());
    return res.status(200).end();
  }

  if (req.method!== 'POST') return res.status(405).json({ error: 'POST only' });

  const { prompt, lang, ask } = req.body;
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  const userKey = req.headers['x-user-key'];
  const proKey = req.headers['x-pro-key'];
  const GROQ_KEY = userKey || process.env.GROQ_KEY;
  const isBYOK =!!userKey;
  const isPro = proKey && await redis.get(`pro:${proKey}`);

  // Handle "Ask Forge" questions mid-build
  if (ask) {
    const askRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-70b-versatile',
        messages: [
          { role: 'system', content: 'You are Forge, an AI dev assistant. Answer questions about the project you are building. Be concise.' },
          { role: 'user', content: ask }
        ]
      })
    });
    const askData = await askRes.json();
    return res.status(200).json({ answer: askData.choices[0].message.content });
  }

  // Rate limit
  if (!isBYOK &&!isPro) {
    const userId = `free:${ip}`;
    const used = await redis.get(userId) || 0;
    if (used >= FREE_LIMIT) return res.status(429).json({ error: 'Free limit reached', limit: FREE_LIMIT, upsell: true });
    await redis.set(userId, used + 1, { ex: 2592000 });
  }

  // Main build prompt - enforce complete file generation
  const system = `You are Forge. You MUST generate ALL files needed for the project to run. Never skip config files, package.json, index.html, or entry points. Output ONLY valid JSON: {"plan":"step by step explanation","files":[{"path":"...","content":"..."}]}. For React use Vite with vite.config.js + index.html. For Flask include requirements.txt + app.py. No markdown.`;

  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.1-70b-versatile',
      messages: [{ role: 'system', content: system }, { role: 'user', content: `Language: ${lang}\nTask: ${prompt}` }],
      response_format: { type: 'json_object' },
      temperature: 0.1
    })
  });

  if (!groqRes.ok) return res.status(500).json({ error: 'LLM error' });
  const data = await groqRes.json();
  const result = JSON.parse(data.choices[0].message.content);
  return res.status(200).json(result);
}
