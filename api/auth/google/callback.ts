import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/google/callback`
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code } = req.query;

  try {
    const { tokens } = await oauth2Client.getToken(code as string);

    if (tokens.refresh_token) {
      console.log('New refresh_token issued:', tokens.refresh_token);
    }

    res.send(`
      <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family:sans-serif;text-align:center;padding-top:60px;">
          <h2>✅ 인증 성공!</h2>
          <p>이 창을 닫고 앱으로 돌아가세요.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              setTimeout(() => window.close(), 1500);
            } else {
              window.location.href = '/';
            }
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('OAuth Error:', error);
    res.status(500).send('Authentication failed');
  }
}
