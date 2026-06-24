import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).send('Missing project ID');
  
  try {
    const html = await redis.get(`project:${id}`);
    if (!html) return res.status(404).send('Project not found or expired');
    
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).send(html);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
}
