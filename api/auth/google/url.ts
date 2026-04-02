import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';

// APP_URL 환경변수 → 없으면 고정 Production URL 사용
const APP_URL = process.env.APP_URL || 'https://blog-six-bice-71.vercel.app';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${APP_URL}/auth/google/callback`
);

export default function handler(req: VercelRequest, res: VercelResponse) {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/documents'],
    prompt: 'consent'
  });
  res.json({ url });
}
