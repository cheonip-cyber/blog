import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';

// ✅ OAuth는 반드시 Production URL(APP_URL) 고정 사용
// Preview 환경에서는 OAuth 기능 비활성화
const isProduction = process.env.VERCEL_ENV === 'production';
const APP_URL = process.env.APP_URL!;

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!isProduction) {
    return res.status(403).json({
      error: 'OAuth 기능은 Production 환경에서만 사용 가능합니다.',
      env: process.env.VERCEL_ENV
    });
  }

  if (!APP_URL) {
    return res.status(500).json({ error: 'APP_URL 환경변수가 설정되지 않았습니다.' });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${APP_URL}/auth/google/callback`
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/documents'],
    prompt: 'consent'
  });

  res.json({ url });
}
