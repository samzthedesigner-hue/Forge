import { Redis } from '@upstash/redis';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method!== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { userId, prompt, apiKey } = await req.json();
    if (!userId ||!prompt) {
      return new Response(JSON.stringify({ error: 'Missing userId or prompt' }), { status: 400 });
    }

    // Check credits
    let credits = await redis.get(`credits:${userId}`);
    if (credits === null) credits = 400;
    if (credits < 1 &&!apiKey) {
      return new Response(JSON.stringify({ error: 'Out of credits. Add BYOK key or upgrade.' }), { status: 402 });
    }

    // Deduct credit if no BYOK
    if (!apiKey) await redis.decr(`credits:${userId}`);

    const systemPrompt = `You are Forge, an expert web developer. Generate a complete, single-file HTML app with Tailwind CSS via CDN. No external JS files. Use inline <script>. Make it production-ready and beautiful. Output ONLY HTML code, no explanations.`;

    const groqKey = apiKey || process.env.GROQ_API_KEY;
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        stream: true
      })
    });

    if (!groqRes.ok) {
      return new Response(JSON.stringify({ error: 'Groq API failed' }), { status: 500 });
    }

    const projectId = nanoid();
    let fullCode = '';

    const stream = new ReadableStream({
      async start(controller) {
        const reader = groqRes.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                await redis.set(`project:${projectId}`, fullCode, { ex: 2592000 }); // 30 days
                controller.enqueue(`data: ${JSON.stringify({ done: true, code: fullCode, projectId })}\n\n`);
                controller.close();
                return;
              }
              try {
                const parsed = JSON.parse(data);
                const token = parsed.choices[0]?.delta?.content || '';
                if (token) {
                  fullCode += token;
                  controller.enqueue(`data: ${JSON.stringify({ token })}\n\n`);
                }
              } catch (e) {}
            }
          }
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
}
