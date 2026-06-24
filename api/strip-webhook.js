import { Redis } from '@upstash/redis';
import Stripe from 'stripe';

const redis = Redis.fromEnv();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Set your Stripe Price IDs here
const PRICE_IDS = {
  PRO_MONTHLY_USD: 'price_xxx', // $5/mo USD
  PRO_MONTHLY_NGN: 'price_yyy', // ₦7,500/mo NGN 
  PROMAX_MONTHLY_USD: 'price_zzz', // $15/mo USD
  PROMAX_MONTHLY_NGN: 'price_aaa', // ₦22,500/mo NGN
};

const CREDITS = {
  PRO: 250,
  PROMAX: 999999 // unlimited
};

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
    console.log(`Webhook signature failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // New subscription or renewal payment
  if (event.type === 'checkout.session.completed' || event.type === 'invoice.payment_succeeded') {
    const session = event.data.object;
    const customerEmail = session.customer_details?.email || session.customer_email;
    const customerId = session.customer;
    
    // Get price ID from subscription
    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    const priceId = subscription.items.data[0].price.id;
    
    let tier = 'PRO';
    let credits = CREDITS.PRO;
    
    if (priceId === PRICE_IDS.PROMAX_MONTHLY_USD || priceId === PRICE_IDS.PROMAX_MONTHLY_NGN) {
      tier = 'PROMAX';
      credits = CREDITS.PROMAX;
    }
    
    // Store tier + refill credits
    await redis.set(`tier:${customerId}`, tier, { ex: 2678400 }); // 31 days
    await redis.set(`tier_email:${customerEmail}`, tier, { ex: 2678400 });
    await redis.set(`credits:${customerId}`, credits, { ex: 2678400 });
    await redis.set(`credits_email:${customerEmail}`, credits, { ex: 2678400 });

    console.log(`${tier} activated for ${customerEmail} with ${credits} credits`);
  }

  // Subscription cancelled
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const customerId = subscription.customer;
    const customer = await stripe.customers.retrieve(customerId);
    const email = customer.email;
    
    await redis.del(`tier:${customerId}`);
    await redis.del(`tier_email:${email}`);
    await redis.del(`credits:${customerId}`);
    await redis.del(`credits_email:${email}`);
    
    console.log(`Subscription cancelled for ${email}`);
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
