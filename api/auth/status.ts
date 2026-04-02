import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Refresh Token이 환경변수에 있으면 항상 인증된 상태
  const isAuthenticated = !!process.env.GOOGLE_REFRESH_TOKEN;
  res.json({ isAuthenticated });
}
