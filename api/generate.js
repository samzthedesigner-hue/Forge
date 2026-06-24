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
      const creditsKey = `credits_user:${safeUserKey}`;
      const tierKey = `tier_user:${safeUserKey}`;
      const graceKey = `grace_user:${safeUserKey}`;

      let [tier, credits, graceUsed] = await Promise.all([
        redis.get(tierKey),
        redis.get(creditsKey), 
        redis.get(graceKey)
      ]);

      if (tier === null) { tier = 'FREE'; await redis.set(tierKey, 'FREE'); }
      if (credits === null) { credits = 400; await redis.set(creditsKey, 400); }
      if (graceUsed === null) { graceUsed = 0; await redis.set(graceKey, 0); }

      credits = parseInt(credits, 10);
      graceUsed = parseInt(graceUsed, 10);
      const graceLimit = 50;
      const graceRemaining = Math.max(0, graceLimit - graceUsed);
      const totalAvailable = credits + graceRemaining;

      if (totalAvailable < operationCost) {
        return Response.json({
          success: false,
          error: `Need ${operationCost} credits but only ${totalAvailable} available.`,
          upgrade: true
        }, { status: 402 });
      }

      let newCredits = credits;
      let newGraceUsed = graceUsed;
      let remainingCost = operationCost;

      if (remainingCost <= newCredits) {
        newCredits -= remainingCost;
      } else {
        remainingCost -= newCredits;
        newCredits = 0;
        newGraceUsed += remainingCost;
      }

      await Promise.all([
        redis.set(creditsKey, newCredits),
        redis.set(graceKey, newGraceUsed)
      ]);
    }

    const groqKey = hasValidByok? apiKey : process.env.GROQ_API_KEY;
    
    if (!groqKey) {
      return Response.json({ error: 'No Groq API key configured' }, { status: 500 });
    }

    const systemPrompt = `You are Forge, an expert frontend engineer. Generate a complete single-file HTML app. 
You can use: HTML, CSS, vanilla JS, React 18 via CDN, Vue 3 via CDN, Svelte via CDN, Tailwind CSS via CDN, Three.js, D3.js, or any client-side library via CDN.
Rules:
1. Return ONLY the full HTML file with all CSS/JS inlined or via CDN links
2. No markdown, no explanations, no code fences
3. Must work in a browser iframe with no build step
4. Use modern, clean UI patterns
User request: ${prompt}`;

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
        temperature: 0.2,
        max_tokens: 8000
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
          
          const projectId = crypto.randomUUID().slice(0, 8);
          const projectKey = `project:${projectId}`;
          await redis.set(projectKey, JSON.stringify({
            id: projectId,
            userId: safeUserKey,
            html: fullCode,
            prompt: prompt,
            created: Date.now()
          }));
          await redis.expire(projectKey, 60 * 60 * 24 * 30);
          
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ done: true, code: fullCode, projectId })}\n\n`));
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
