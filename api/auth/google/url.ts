import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/google/callback`
);

export default function handler(req: VercelRequest, res: VercelResponse) {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/documents'],
    prompt: 'consent'
  });
  res.json({ url });
}
