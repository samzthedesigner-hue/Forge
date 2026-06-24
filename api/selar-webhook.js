import { Redis } from '@upstash/redis';
import crypto from 'crypto';

const redis = Redis.fromEnv();

const SELAR_PRODUCTS = {
  'w4r1231121': { tier: 'PRO', credits: 5000 },
  'es97887gu9': { tier: 'PROMAX', credits: 999999 },
};

export default async function handler(req, res) {
  if (req.method!== 'POST') return res.status(405).end();

  const signature = req.headers['selar-signature'];
  const secret = process.env.SELAR_WEBHOOK_SECRET;
  const hash = crypto.createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex');
  
  if (hash!== signature) return res.status(400).send('Invalid signature');

  const event = req.body;

  if (event.event === 'subscription.payment.successful') {
    const email = event.data.customer.email.toLowerCase();
    const slug = event.data.product.slug;
    const plan = SELAR_PRODUCTS;
    
    if (!plan) return res.status(200).send('Unknown product');
    
    await redis.set(`tier_email:${email}`, plan.tier, { ex: 2678400 });
    await redis.set(`credits_email:${email}`, plan.credits, { ex: 2678400 });
    await redis.del(`grace_email:${email}`);
    await redis.set(`gateway:${email}`, 'selar', { ex: 2678400 });
  }

  if (event.event === 'subscription.cancelled') {
    const email = event.data.customer.email.toLowerCase();
    await redis.set(`tier_email:${email}`, 'FREE', { ex: 2678400 });
    await redis.set(`credits_email:${email}`, 400, { ex: 2678400 });
  }

  res.status(200).send('OK');
}
