import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  // 환경변수 디버깅용 (배포 후 삭제 예정)
  const token = process.env.GOOGLE_REFRESH_TOKEN;
  const hasToken = !!(token && token.length > 0);
  
  res.json({ 
    isAuthenticated: hasToken,
    debug: {
      tokenLength: token?.length || 0,
      hasClientId: !!process.env.GOOGLE_CLIENT_ID,
      hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
      appUrl: process.env.APP_URL || 'not set'
    }
  });
}
