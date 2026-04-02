import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const token = process.env.GOOGLE_REFRESH_TOKEN;
  const isAuthenticated = !!(token && token.length > 0);
  res.json({ isAuthenticated });
}
