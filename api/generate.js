import { Redis } from '@upstash/redis';
import OpenAI from 'openai';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  const { prompt, email, action, filePath, fileDescription, existingFiles, byok } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  
  // Use BYOK or fallback to your Vercel keys - matches your naming
  let aiClient;
  let model = 'gpt-4o-mini';
  
  if (byok?.key) {
    if (byok.provider === 'openai') {
      aiClient = new OpenAI({ apiKey: byok.key });
      model = 'gpt-4o-mini';
    } else if (byok.provider === 'groq') {
      aiClient = new OpenAI({ apiKey: byok.key, baseURL: 'https://api.groq.com/openai/v1' });
      model = 'llama-3.1-70b-versatile'; // 10x faster
    } else if (byok.provider === 'openrouter') {
      aiClient = new OpenAI({ apiKey: byok.key, baseURL: 'https://openrouter.ai/api/v1' });
      model = 'openai/gpt-4o-mini';
    } else {
      return res.status(400).json({ error: 'Unsupported BYOK provider' });
    }
  } else {
    // Fallback to your Vercel env vars - using your exact names
    if (process.env.GROQ_KEY) {
      aiClient = new OpenAI({ apiKey: process.env.GROQ_KEY, baseURL: 'https://api.groq.com/openai/v1' });
      model = 'llama-3.1-70b-versatile';
    } else if (process.env.OPENROUTER_KEY) {
      aiClient = new OpenAI({ apiKey: process.env.OPENROUTER_KEY, baseURL: 'https://openrouter.ai/api/v1' });
      model = 'openai/gpt-4o-mini';
    } else if (process.env.OPENAI_KEY) {
      aiClient = new OpenAI({ apiKey: process.env.OPENAI_KEY });
      model = 'gpt-4o-mini';
    } else {
      return res.status(500).json({ error: 'No AI API key found in environment' });
    }
  }
  
  // Credit check only if not BYOK and planning
  if (!byok?.key && action === 'plan') {
    const estimatedCost = Math.max(20, Math.min(60, Math.ceil(prompt.length / 20)));
    const creditCheck = await fetch(`/api/check-credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, action: 'deduct', buildCost: estimatedCost })
    }).then(r => r.json());
    
    if (!creditCheck.success) {
      return res.status(402).json({
        error: 'INSUFFICIENT_CREDITS',
        message: `This project needs ~${estimatedCost} credits. You have ${creditCheck.credits}.`,
        tier: creditCheck.tier,
        credits: creditCheck.credits,
        upgrade: true
      });
    }
  }
  
  try {
    // STEP 1: PLAN - Return file structure in 1 AI call
    if (action === 'plan') {
      const completion = await aiClient.chat.completions.create({
        model: model,
        messages: [{
          role: 'system',
          content: 'You are a senior dev. Given a prompt, return ONLY JSON: {projectName: string, files: [{path: string, description: string}]}. Max 5 files. For web apps use: index.html, style.css, script.js. For React use: index.html, App.jsx, index.css. No explanations.'
        }, {
          role: 'user',
          content: `App to build: ${prompt}`
        }],
        response_format: { type: "json_object" },
        temperature: 0.2
      });
      
      const plan = JSON.parse(completion.choices[0].message.content);
      return res.json({ success: true,...plan });
    }
    
    // STEP 2: FILE - Generate individual file
    if (action === 'file') {
      const completion = await aiClient.chat.completions.create({
        model: model,
        messages: [{
          role: 'system',
          content: `You are an expert coder. Write ONLY the code for ${filePath}. No explanations, no markdown fences. Description: ${fileDescription}. Existing files: ${existingFiles?.join(', ') || 'none'}. Make it production-ready and functional. Use Tailwind CDN if styling needed.`
        }, {
          role: 'user',
          content: `Project prompt: ${prompt}\n\nWrite complete code for: ${filePath}`
        }],
        temperature: 0.1,
        max_tokens: 4000
      });
      
      let code = completion.choices[0].message.content;
      // Strip markdown fences if AI adds them
      code = code.replace(/```[\w]*\n/g, '').replace(/```$/g, '').trim();
      
      return res.json({ success: true, code });
    }
    
    res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    console.error('AI Error:', err);
    res.status(500).json({ error: 'Generation failed: ' + err.message });
  }
        }
