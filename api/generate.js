import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  const { prompt, email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  
  // Estimate cost: 1 credit per 50 chars, min 8, max 25
  const estimatedCost = Math.max(8, Math.min(25, Math.ceil(prompt.length / 50)));
  
  // Check credits first
  const creditCheck = await fetch(`${process.env.VERCEL_URL}/api/check-credits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, action: 'check', buildCost: estimatedCost })
  }).then(r => r.json());
  
  if (!creditCheck.canBuild) {
    return res.status(402).json({
      error: 'INSUFFICIENT_CREDITS',
      message: `This build needs ~${estimatedCost} credits. You have ${creditCheck.credits}.`,
      tier: creditCheck.tier,
      credits: creditCheck.credits,
      inGrace: creditCheck.inGrace,
      upgrade: true
    });
  }
  
  // Deduct credits BEFORE generation
  await fetch(`${process.env.VERCEL_URL}/api/check-credits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, action: 'deduct', buildCost: estimatedCost })
  });
  
  // Your existing AI generation code here - replace this with your actual function
  try {
    // const result = await yourAIGenerateFunction(prompt);
    const result = { code: "// AI generated code here" }; // placeholder
    res.json({ success: true, code: result.code, creditsUsed: estimatedCost });
  } catch (err) {
    // Refund on failure
    const currentCredits = await redis.get(`credits_email:${email.toLowerCase()}`);
    await redis.set(`credits_email:${email.toLowerCase()}`, parseInt(currentCredits) + estimatedCost);
    res.status(500).json({ error: 'Generation failed, credits refunded' });
  }
}
