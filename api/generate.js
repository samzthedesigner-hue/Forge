export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST method' })
  }

  try {
    const { prompt } = req.body
    
    if (!process.env.GROQ_KEY) {
      return res.status(500).json({ error: 'GROQ_KEY missing in Vercel Environment Variables' })
    }

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' })
    }

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are Forge, an AI that instantly describes apps. For the user prompt, respond in 2-3 punchy sentences explaining what the app would do, key features, and tech stack. Be exciting and specific. No code blocks.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 400
      })
    })

    if (!groqRes.ok) {
      const errorText = await groqRes.text()
      return res.status(500).json({ error: `Groq API ${groqRes.status}: ${errorText}` })
    }

    const data = await groqRes.json()
    const result = data.choices[0].message.content

    return res.status(200).json({ result })

  } catch (error) {
    return res.status(500).json({ error: `Server crashed: ${error.message}` })
  }
}
