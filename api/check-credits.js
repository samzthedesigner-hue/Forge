import { Redis } from '@upstash/redis';

export const config = { runtime: 'edge' };

const redis = Redis.fromEnv();

export default async function handler(req) {
  if (req.method!== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { userId, action = 'check', buildCost = 0 } = await req.json();

    if (!userId) {
      return Response.json({ error: 'User ID required' }, { status: 400 });
    }

    const safeUserKey = String(userId).trim().replace(/[^a-zA-Z0-9_\-+:]/g, '');
    const creditsKey = `credits_user:${safeUserKey}`;
    const tierKey = `tier_user:${safeUserKey}`;
    const graceKey = `grace_user:${safeUserKey}`;

    let [tier, credits, graceUsed] = await Promise.all([
      redis.get(tierKey),
      redis.get(creditsKey),
      redis.get(graceKey)
    ]);

    if (tier === null) {
      tier = 'FREE';
      await redis.set(tierKey, 'FREE');
    }
    if (credits === null) {
      credits = 400;
      await redis.set(creditsKey, 400);
    }
    if (graceUsed === null) {
      graceUsed = 0;
      await redis.set(graceKey, 0);
    }

    credits = parseInt(credits, 10);
    graceUsed = parseInt(graceUsed, 10);
    const graceLimit = 50;
    const graceRemaining = Math.max(0, graceLimit - graceUsed);

    if (action === 'check') {
      return Response.json({
        success: true,
        userId: safeUserKey,
        tier,
        credits,
        graceCredits: graceRemaining,
        totalAvailable: credits + graceRemaining
      });
    }

    if (action === 'deduct') {
      const totalAvailable = credits + graceRemaining;

      if (totalAvailable < buildCost) {
        return Response.json({
          success: false,
          error: 'INSUFFICIENT_CREDITS',
          message: `Need ${buildCost} credits but only ${totalAvailable} available.`,
          tier,
          credits,
          graceCredits: graceRemaining,
          upgrade: true
        }, { status: 402 });
      }

      let newCredits = credits;
      let newGraceUsed = graceUsed;
      let remainingCost = buildCost;

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

      return Response.json({
        success: true,
        deducted: buildCost,
        tier,
        credits: newCredits,
        graceCredits: Math.max(0, graceLimit - newGraceUsed),
        totalAvailable: newCredits + Math.max(0, graceLimit - newGraceUsed)
      });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });

  } catch (err) {
    console.error('Credit check error:', err);
    return Response.json({ error: 'Credit system error: ' + err.message }, { status: 500 });
  }
      }
