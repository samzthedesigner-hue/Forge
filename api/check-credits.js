import { Redis } from '@upstash/redis';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method!== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const redis = Redis.fromEnv();
    const { email, action, buildCost } = await req.json();
    
    if (!email) return Response.json({ error: 'Email required' }, { status: 400 });

    const userEmail = email.toLowerCase().trim();
    const TIERS = {
      FREE: { credits: 400, graceCredits: 50, graceDays: 15, costPerBuild: 10 },
      PRO: { credits: 5000, graceCredits: 500, graceDays: 15, costPerBuild: 8 },
      PROMAX: { credits: 999999, graceCredits: 0, graceDays: 0, costPerBuild: 5 },
    };
    
    // Pipeline all Redis calls = 1 round trip
    const [tier, credits, inGrace] = await redis.mget([
      `tier_email:${userEmail}`,
      `credits_email:${userEmail}`,
      `grace_email:${userEmail}`
    ]);
    
    const currentTier = tier || 'FREE';
    const tierData = TIERS;
    let currentCredits = credits === null? tierData.credits : parseInt(credits);
    
    if (credits === null) {
      await redis.mset({
        [`credits_email:${userEmail}`]: tierData.credits,
        [`tier_email:${userEmail}`]: 'FREE'
      });
    }
    
    if (currentCredits <= 0 &&!inGrace && tierData.graceCredits > 0) {
      await redis.mset({
        [`grace_email:${userEmail}`]: 'true',
        [`credits_email:${userEmail}`]: tierData.graceCredits
      });
      await redis.expire(`grace_email:${userEmail}`, tierData.graceDays * 86400);
      currentCredits = tierData.graceCredits;
    }
    
    if (action === 'check') {
      return Response.json({ 
        tier: currentTier, 
        credits: currentCredits, 
        inGrace:!!inGrace,
        canBuild: currentCredits >= (buildCost || tierData.costPerBuild),
        costPerBuild: tierData.costPerBuild,
        success: true
      });
    }
    
    if (action === 'deduct') {
      const cost = buildCost || tierData.costPerBuild;
      if (currentCredits < cost) {
        return Response.json({ 
          error: 'Insufficient credits',
          tier: currentTier, credits: currentCredits, inGrace:!!inGrace, upgrade: true, success: false
        }, { status: 402 });
      }
      
      const newCredits = currentCredits - cost;
      await redis.set(`credits_email:${userEmail}`, newCredits);
      return Response.json({ success: true, credits: newCredits, tier: currentTier });
    }
    
    return Response.json({ error: 'Invalid action' }, { status: 400 });
    
  } catch (err) {
    console.error('Redis error:', err);
    return Response.json({ 
      tier: 'FREE', credits: 400, inGrace: false, canBuild: true, 
      costPerBuild: 10, success: true, error: 'Redis offline'
    });
  }
}
