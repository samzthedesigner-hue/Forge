import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

const TIERS = {
  FREE: { credits: 400, graceCredits: 50, graceDays: 15, costPerBuild: 10 },
  PRO: { credits: 5000, graceCredits: 500, graceDays: 15, costPerBuild: 8 },
  PROMAX: { credits: 999999, graceCredits: 0, graceDays: 0, costPerBuild: 5 },
};

export default async function handler(req, res) {
  const { email, action, buildCost } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const userEmail = email.toLowerCase();
  const tier = await redis.get(`tier_email:${userEmail}`) || 'FREE';
  const tierData = TIERS;
  
  let credits = await redis.get(`credits_email:${userEmail}`);
  let inGrace = await redis.get(`grace_email:${userEmail}`);
  
  if (credits === null) {
    credits = tierData.credits;
    await redis.set(`credits_email:${userEmail}`, credits);
    await redis.set(`tier_email:${userEmail}`, 'FREE');
  }
  
  credits = parseInt(credits);
  
  if (credits <= 0 &&!inGrace) {
    if (tierData.graceCredits > 0) {
      await redis.set(`grace_email:${userEmail}`, 'true', { ex: tierData.graceDays * 86400 });
      await redis.set(`credits_email:${userEmail}`, tierData.graceCredits);
      credits = tierData.graceCredits;
      inGrace = 'true';
    }
  }
  
  if (action === 'check') {
    return res.json({ 
      tier, 
      credits, 
      inGrace:!!inGrace,
      canBuild: credits >= (buildCost || tierData.costPerBuild),
      costPerBuild: tierData.costPerBuild
    });
  }
  
  if (action === 'deduct') {
    const cost = buildCost || tierData.costPerBuild;
    if (credits < cost) {
      return res.status(402).json({ 
        error: 'Insufficient credits',
        tier,
        credits,
        inGrace:!!inGrace,
        upgrade: true
      });
    }
    
    const newCredits = credits - cost;
    await redis.set(`credits_email:${userEmail}`, newCredits);
    return res.json({ success: true, credits: newCredits, tier });
  }
  
  res.status(400).json({ error: 'Invalid action' });
}
