import { Redis } from '@upstash/redis';

export const config = { runtime: 'edge' };

const redis = Redis.fromEnv();

export default async function handler(req) {
  if (req.method!== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { userId, prompt, apiKey } = await req.json();

    if (!userId ||!prompt) {
      return Response.json({ error: 'Missing userId or prompt' }, { status: 400 });
    }

    const safeUserKey = String(userId).trim().replace(/[^a-zA-Z0-9_\-+:]/g, '');
    const hasValidByok = apiKey && String(apiKey).trim().startsWith('gsk_');
    const operationCost = 20;

    if (!hasValidByok) {
      const checkRes = await fetch(new URL('/api/check-credits', req.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: safeUserKey, action: 'deduct', buildCost: operationCost })
      });

      if (!checkRes.ok) {
        const errData = await checkRes.json();
        return Response.json({
          success: false,
          error: errData.message || 'Insufficient credits',
          upgrade: errData.upgrade
        }, { status: 402 });
      }
    }

    const groqKey = hasValidByok? apiKey : process.env.GROQ_API_KEY;

    if (!groqKey) {
      return Response.json({ error: 'No Groq API key configured' }, { status: 500 });
    }

    const systemPrompt = `You are Forge, an expert web dev. Generate a complete single-file HTML app using Tailwind CSS via CDN and Font Awesome icons. Return ONLY the full HTML code, no markdown, no explanations. User prompt: ${prompt}`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-70b-versatile',
        messages: [{ role: 'user', content: systemPrompt }],
        stream: true,
        temperature: 0.2
      })
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      throw new Error(`Groq error: ${err}`);
    }

    const stream = new ReadableStream({
      async start(controller) {
        const reader = groqRes.body.getReader();
        const decoder = new TextDecoder();
        let fullCode = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.trim().startsWith('data: '));

            for (const line of lines) {
              const data = line.replace('data: ', '').trim();
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const token = parsed.choices[0]?.delta?.content || '';
                if (token) {
                  fullCode += token;
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ token })}\n\n`));
                }
              } catch {}
            }
          }

          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ done: true, code: fullCode })}\n\n`));
          controller.close();
        } catch (e) {
          controller.error(e);
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
    console.error('Generate error:', error);
    return Response.json({ error: 'Generation failed: ' + error.message }, { status: 500 });
  }
}
