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
            content: `You are Forge, an AI code generator. You MUST respond with ONLY a single, complete, working HTML file. No explanations, no markdown, no code blocks. The HTML file must include all CSS in <style> tags and all JS in <script> tags. The app must be fully functional and run immediately when opened. Use modern, clean design. Mobile-first.`
          },
          {
            role: 'user',
            content: `Build this app: ${prompt}`
          }
        ],
        temperature: 0.2,
        max_tokens: 8000
      })
    })

    if (!groqRes.ok) {
      const errorText = await groqRes.text()
      return res.status(500).json({ error: `Groq API ${groqRes.status}: ${errorText}` })
    }

    const data = await groqRes.json()
    let result = data.choices[0].message.content.trim()

    // Strip markdown if Groq adds it anyway
    if (result.startsWith('```html')) {
      result = result.replace(/```html\n?/, '').replace(/```$/, '');
    } else if (result.startsWith('```')) {
      result = result.replace(/```\n?/, '').replace(/```$/, '');
    }

    return res.status(200).json({ result })

  } catch (error) {
    return res.status(500).json({ error: `Server crashed: ${error.message}` })
  }
}
