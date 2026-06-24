import { Redis } from '@upstash/redis';
export const config = { runtime: 'edge' };
const redis = Redis.fromEnv();

export default async function handler(req) {
  const url = new URL(req.url);
  const id = url.pathname.split('/').pop();
  const project = await redis.get(`project:${id}`);
  
  if (!project) {
    return new Response('Project not found or expired', { status: 404 });
  }
  
  const data = JSON.parse(project);
  return new Response(data.html, {
    headers: { 'Content-Type': 'text/html' }
  });
}
