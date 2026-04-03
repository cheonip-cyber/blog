import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const isProduction = process.env.VERCEL_ENV === 'production';
  const token = process.env.GOOGLE_REFRESH_TOKEN;
  const isAuthenticated = isProduction && !!(token && token.length > 0);

  res.json({
    isAuthenticated,
    isProduction,
    // Preview에서는 명확한 메시지 제공
    message: !isProduction ? 'OAuth 기능은 Production 전용입니다.' : undefined
  });
}
