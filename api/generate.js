import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.url,
  token: process.env.upatash,
})

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method!== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { prompt } = req.body
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt required' })
    }

    // Rate limit: 25 free
    const ip = req.headers['x-forwarded-for'] || 'unknown'
    const key = `forge:${ip}`
    const count = await redis.get(key) || 0

    if (count >= 25) {
      return res.status(429).json({ error: 'Free limit reached. Upgrade for unlimited.' })
    }

    // Call Groq
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are Forge, an AI that writes complete code projects. Respond with a brief explanation of what you built. Do not use markdown formatting.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
    })

    if (!groqRes.ok) {
      const err = await groqRes.text()
      console.error('Groq error:', err)
      return res.status(500).json({ error: 'AI service error' })
    }

    const data = await groqRes.json()
    const result = data.choices[0].message.content

    // Increment credits
    await redis.incr(key)
    await redis.expire(key, 86400) // Reset daily

    return res.status(200).json({ result })

  } catch (error) {
    console.error('API error:', error)
    return res.status(500).json({ error: 'Server error. Check logs.' })
  }
}
