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
    
    if (!process.env.key) {
      return res.status(500).json({ error: 'GROQ_KEY missing. Add env var named "key" in Vercel Settings' })
    }

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' })
    }

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
            content: 'You are Forge. Describe the app you would build for this prompt in 2-3 sentences. Be concise. No code, no markdown.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 300
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
