import { Redis } from '@upstash/redis';
import Stripe from 'stripe';

const redis = Redis.fromEnv();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  if (req.method!== 'POST') return res.status(405).end();

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, endpointSecret);
  } catch (err) {
    console.log(`Webhook signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_details.email;
    const customerId = session.customer;
    await redis.set(`pro:${customerId}`, customerEmail, { ex: 2678400 });
    await redis.set(`pro_email:${customerEmail}`, customerId, { ex: 2678400 });
    console.log(`Pro activated for ${customerEmail}`);
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const customerId = subscription.customer;
    const email = await redis.get(`pro:${customerId}`);
    await redis.del(`pro:${customerId}`);
    await redis.del(`pro_email:${email}`);
    console.log(`Pro cancelled for ${customerId}`);
  }

  res.status(200).json({ received: true });
}

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string'? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}
