import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method!== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, action } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    
    let credits = await redis.get(`credits:${userId}`);
    if (credits === null) {
      credits = 400;
      await redis.set(`credits:${userId}`, 400);
    }
    
    if (action === 'deduct') {
      const { amount = 1 } = req.body;
      if (credits < amount) {
        return res.status(402).json({ error: 'Insufficient credits' });
      }
      credits = await redis.decrby(`credits:${userId}`, amount);
    }
    
    res.status(200).json({ 
      credits: parseInt(credits), 
      tier: credits > 400? 'PRO' : 'FREE' 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Redis error' });
  }
}
