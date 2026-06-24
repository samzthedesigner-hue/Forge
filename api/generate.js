import { Redis } from '@upstash/redis';
import OpenAI from 'openai';

export const config = { runtime: 'edge' };

const redis = Redis.fromEnv();

export default async function handler(req) {
  if (req.method!== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { prompt, userId, action, filePath, fileDescription, existingFiles, byok } = await req.json();
    if (!userId) return Response.json({ error: 'User ID required' }, { status: 400 });
    
    let aiClient;
    let model = 'gpt-4o-mini';
    
    if (byok?.key && byok?.provider) {
      if (byok.provider === 'groq') {
        aiClient = new OpenAI({ apiKey: byok.key, baseURL: 'https://api.groq.com/openai/v1' });
        model = 'llama-3.1-70b-versatile'; // 750 tokens/s
      } else if (byok.provider === 'openai') {
        aiClient = new OpenAI({ apiKey: byok.key });
        model = 'gpt-4o-mini';
      } else if (byok.provider === 'openrouter') {
        aiClient = new OpenAI({ apiKey: byok.key, baseURL: 'https://openrouter.ai/api/v1' });
        model = 'openai/gpt-4o-mini';
      }
    } else {
      // Default to Groq for speed - 10x faster than OpenAI
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
        return Response.json({ error: 'No AI API key found' }, { status: 500 });
      }
    }
    
    if (!byok?.key && action === 'plan') {
      const estimatedCost = Math.max(20, Math.min(60, Math.ceil(prompt.length / 20)));
      const host = req.headers.get('host');
      const proto = req.headers.get('x-forwarded-proto') || 'https';
      
      const creditRes = await fetch(`${proto}://${host}/api/check-credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action: 'deduct', buildCost: estimatedCost })
      });
      const creditCheck = await creditRes.json();
      
      if (!creditCheck.success) {
        return Response.json({
          error: 'INSUFFICIENT_CREDITS',
          message: `This project needs ~${estimatedCost} credits. You have ${creditCheck.credits}.`,
          tier: creditCheck.tier, credits: creditCheck.credits, upgrade: true
        }, { status: 402 });
      }
    }
    
    if (action === 'plan') {
      const completion = await aiClient.chat.completions.create({
        model: model,
        messages: [{
          role: 'system',
          content: 'Return ONLY JSON: {projectName: string, files: [{path: string, description: string}]}. Max 5 files. For web: index.html, style.css, script.js. For React: index.html, App.jsx, index.css.'
        }, {
          role: 'user',
          content: `App: ${prompt}`
        }],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 500
      });
      
      const plan = JSON.parse(completion.choices[0].message.content);
      return Response.json({ success: true,...plan });
    }
    
    if (action === 'file') {
      // Stream the response for instant UI updates
      const stream = await aiClient.chat.completions.create({
        model: model,
        stream: true,
        messages: [{
          role: 'system',
          content: `Write ONLY code for ${filePath}. No markdown, no explanations. Description: ${fileDescription}. Existing: ${existingFiles?.join(', ') || 'none'}. Production-ready. Use Tailwind CDN if needed.`
        }, {
          role: 'user',
          content: `Project: ${prompt}\nFile: ${filePath}`
        }],
        temperature: 0.1,
        max_tokens: 3000
      });

      // Convert OpenAI stream to web stream
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of stream) {
              const text = chunk.choices[0]?.delta?.content || '';
              controller.enqueue(encoder.encode(text));
            }
            controller.close();
          } catch (e) {
            controller.error(e);
          }
        }
      });

      return new Response(readable, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
    
    return Response.json({ error: 'Invalid action' }, { status: 400 });
    
  } catch (err) {
    console.error('AI Error:', err);
    return Response.json({ error: 'Generation failed: ' + err.message }, { status: 500 });
  }
}
