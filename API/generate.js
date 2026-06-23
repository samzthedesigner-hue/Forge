import { Redis } from '@upstash/redis'
import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.key })

const redis = new Redis({
  url: process.env.url,
  token: process.env.upatash,
})

export default async function handler(req, res) {
  if (req.method!== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress
  const key = `ratelimit_${ip}`

  const current = await redis.incr(key)
  if (current === 1) {
    await redis.expire(key, 60) // 1 min window
  }
  if (current > 5) { // 5 requests per minute
    return res.status(429).json({ error: 'Too many requests. Try again in a minute.' })
  }

  const { prompt } = req.body
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' })
  }

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.1-70b-versatile',
    })
    res.status(200).json({ result: chatCompletion.choices[0].message.content })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
