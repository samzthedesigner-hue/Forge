export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method!== 'POST') {
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
            content: `You are Forge, an AI code generator. Respond with ONLY valid JSON. No markdown, no explanations. Format: {"files": [{"path": "index.html", "content": "<!DOCTYPE..."}, {"path": "style.css", "content": "body {...}"}, {"path": "app.js", "content": "const..."}]}. Create all files needed for a working app. Use modern code.`
          },
          {
            role: 'user',
            content: `Build this app with separate HTML, CSS, and JS files: ${prompt}`
          }
        ],
        temperature: 0.2,
        max_tokens: 8000,
        response_format: { type: "json_object" }
      })
    })

    if (!groqRes.ok) {
      const errorText = await groqRes.text()
      return res.status(500).json({ error: `Groq API ${groqRes.status}: ${errorText}` })
    }

    const data = await groqRes.json()
    const result = JSON.parse(data.choices[0].message.content)

    return res.status(200).json(result)

  } catch (error) {
    return res.status(500).json({ error: `Server crashed: ${error.message}` })
  }
}
