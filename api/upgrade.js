import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const PLAN_LIMITS = {
  FREE: 400,
  PRO: 10000,
  MAX: 100000
};

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method!== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { userId, tier } = await req.json();
    if (!userId ||!tier) {
      return new Response(JSON.stringify({ error: 'Missing userId or tier' }), { status: 400 });
    }

    const upperTier = tier.toUpperCase();
    if (!PLAN_LIMITS[upperTier]) {
      return new Response(JSON.stringify({ error: 'Invalid tier' }), { status: 400 });
    }

    await redis.set(`tier:${userId}`, upperTier);
    await redis.set(`credits:${userId}`, PLAN_LIMITS[upperTier]);

    return new Response(JSON.stringify({ 
      success: true, 
      tier: upperTier,
      credits: PLAN_LIMITS[upperTier]
    }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
}
