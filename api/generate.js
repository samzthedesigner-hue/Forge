import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const FREE_LIMIT = 25;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  const proEmail = req.headers['x-user-email'];

  if (req.method === 'OPTIONS') {
    const hasBYOK = req.headers['x-groq-key'] || req.headers['x-openai-key'] || req.headers['x-openrouter-key'];
    const tier = proEmail && await redis.get(`tier_email:${proEmail}`);
    
    if (hasBYOK || tier === 'PROMAX') return res.status(200).end();
    
    if (tier === 'PRO') {
      const credits = await redis.get(`credits_email:${proEmail}`) || 0;
      res.setHeader('X-Credits-Remaining', credits.toString());
      return res.status(200).end();
    }

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

  const isBYOK =!!(req.headers['x-groq-key'] || req.headers['x-openai-key'] || req.headers['x-openrouter-key']);
  const tier = proEmail && await redis.get(`tier_email:${proEmail}`);

  // Ask Forge logic - no credit cost
  if (ask) {
    const { url, key, model, provider } = selectModel('reasoning', { OPENAI_KEY, OPENROUTER_KEY, GROQ_KEY });
    if (!key) return res.status(500).json({ error: 'No API key configured' });

    const askRes = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are Forge, an AI dev assistant. Be concise and technical.' },
          { role: 'user', content: ask }
        ]
      })
    });
    const askData = await askRes.json();
    if (!askRes.ok) return res.status(500).json({ error: askData.error?.message || 'LLM error' });
    return res.status(200).json({ answer: askData.choices[0].message.content, provider });
  }

  // Credit check logic
  if (!isBYOK) {
    if (tier === 'PROMAX') {
      // Unlimited - do nothing
    } else if (tier === 'PRO') {
      const credits = await redis.get(`credits_email:${proEmail}`) || 0;
      if (credits <= 0) {
        return res.status(429).json({ 
          error: 'Out of credits', 
          credits: 0, 
          upsell: 'promax',
          message: 'Upgrade to Pro Max for unlimited or wait for monthly refill'
        });
      }
      await redis.decr(`credits_email:${proEmail}`);
    } else {
      // Free user
      const userId = `free:${ip}`;
      const used = await redis.get(userId) || 0;
      if (used >= FREE_LIMIT) {
        return res.status(429).json({ 
          error: 'Free limit reached', 
          limit: FREE_LIMIT, 
          upsell: 'pro',
          message: 'Upgrade to Pro for 250 credits/mo'
        });
      }
      await redis.set(userId, used + 1, { ex: 2592000 });
    }
  }

  const { url, key, model, provider } = selectModel(taskType || 'code', { OPENAI_KEY, OPENROUTER_KEY, GROQ_KEY });
  if (!key) return res.status(500).json({ error: 'No API key configured' });

  const system = `You are Forge. Generate ALL files needed. Output ONLY valid JSON: {"plan":"...","files":[{"path":"...","content":"..."}]}. For React use Vite. For Flask include requirements.txt. No markdown.`;

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
  
  // Send remaining credits back
  let creditsLeft = null;
  if (tier === 'PRO') creditsLeft = await redis.get(`credits_email:${proEmail}`);
  
  return res.status(200).json({...result, provider, creditsLeft, tier});
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
