import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';

// ✅ 요청 Host로 자동 감지 → URL 하드코딩 완전 제거
function getAppUrl(req: VercelRequest): string {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  const appUrl = getAppUrl(req);

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${appUrl}/auth/google/callback`
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/documents'],
    prompt: 'consent'
  });

  res.json({ url });
}
