import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const FREE_LIMIT = 25;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';

  if (req.method === 'OPTIONS') {
    const hasBYOK = req.headers['x-groq-key'] || req.headers['x-openai-key'] || req.headers['x-openrouter-key'];
    const proEmail = req.headers['x-user-email'];
    const isPro = proEmail && await redis.get(`pro_email:${proEmail}`);

    if (hasBYOK || isPro) return res.status(200).end();

    const used = await redis.get(`free:${ip}`) || 0;
    const remaining = FREE_LIMIT - used;
    res.setHeader('X-Free-Remaining', Math.max(0, remaining).toString());
    return res.status(200).end();
  }

  if (req.method!== 'POST') return res.status(405).json({ error: 'POST only' });

  const { prompt, lang, ask, taskType } = req.body;

  const GROQ_KEY = req.headers['x-groq-key'] || process.env.GROQ_KEY;
  const OPENAI_KEY = req.headers['x-openai-key'] || process.env.OPENAI_KEY;
  const OPENROUTER_KEY = req.headers['x-openrouter-key'] || process.env.OPENROUTER_KEY;

  const proEmail = req.headers['x-user-email'];
  const isPro = proEmail && await redis.get(`pro_email:${proEmail}`);
  const isBYOK =!!(req.headers['x-groq-key'] || req.headers['x-openai-key'] || req.headers['x-openrouter-key']);

  if (ask) {
    const { url, key, model, provider } = selectModel('reasoning', { OPENAI_KEY, OPENROUTER_KEY, GROQ_KEY });
    if (!key) return res.status(500).json({ error: 'No API key configured for reasoning' });

    const askRes = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are Forge, an AI dev assistant. Answer questions about the project you are building. Be concise, technical, and helpful.' },
          { role: 'user', content: ask }
        ]
      })
    });
    const askData = await askRes.json();
    if (!askRes.ok) return res.status(500).json({ error: askData.error?.message || 'LLM error' });
    return res.status(200).json({ answer: askData.choices[0].message.content, provider });
  }

  if (!isBYOK &&!isPro) {
    const userId = `free:${ip}`;
    const used = await redis.get(userId) || 0;
    if (used >= FREE_LIMIT) return res.status(429).json({ error: 'Free limit reached', limit: FREE_LIMIT, upsell: true });
    await redis.set(userId, used + 1, { ex: 2592000 });
  }

  const { url, key, model, provider } = selectModel(taskType || 'code', { OPENAI_KEY, OPENROUTER_KEY, GROQ_KEY });
  if (!key) return res.status(500).json({ error: 'No API key configured. Add GROQ_KEY, OPENAI_KEY, or OPENROUTER_KEY to Vercel env vars.' });

  const system = `You are Forge. You MUST generate ALL files needed for the project to run. Never skip config files, package.json, index.html, vite.config.js, requirements.txt, or entry points. Output ONLY valid JSON: {"plan":"step by step explanation of architecture and files","files":[{"path":"...","content":"..."}]}. For React use Vite. For Flask include requirements.txt + app.py. No markdown, no explanations outside JSON.`;

  const llmRes = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: `Language: ${lang}\nTask: ${prompt}` }],
      response_format: { type: 'json_object' },
      temperature: 0.1
    })
  });

  if (!llmRes.ok) {
    const err = await llmRes.text();
    return res.status(500).json({ error: `LLM error from ${provider}: ${err}` });
  }

  const data = await llmRes.json();
  const result = JSON.parse(data.choices[0].message.content);
  return res.status(200).json({...result, provider});
}

function selectModel(taskType, keys) {
  const { OPENAI_KEY, OPENROUTER_KEY, GROQ_KEY } = keys;

  if (taskType === 'reasoning' || taskType === 'plan') {
    if (OPENAI_KEY) return { url: 'https://api.openai.com/v1/chat/completions', key: OPENAI_KEY, model: 'gpt-5', provider: 'OpenAI' };
    if (OPENROUTER_KEY) return { url: 'https://openrouter.ai/api/v1/chat/completions', key: OPENROUTER_KEY, model: 'openai/gpt-5', provider: 'OpenRouter' };
    if (GROQ_KEY) return { url: 'https://api.groq.com/openai/v1/chat/completions', key: GROQ_KEY, model: 'llama-3.3-70b-versatile', provider: 'Groq' };
  }

  if (GROQ_KEY) return { url: 'https://api.groq.com/openai/v1/chat/completions', key: GROQ_KEY, model: 'llama-3.3-70b-versatile', provider: 'Groq' };
  if (OPENROUTER_KEY) return { url: 'https://openrouter.ai/api/v1/chat/completions', key: OPENROUTER_KEY, model: 'meta-llama/llama-3.3-70b-instruct', provider: 'OpenRouter' };
  if (OPENAI_KEY) return { url: 'https://api.openai.com/v1/chat/completions', key: OPENAI_KEY, model: 'gpt-5-mini', provider: 'OpenAI' };

  return { url: '', key: '', model: '', provider: 'None' };
}
