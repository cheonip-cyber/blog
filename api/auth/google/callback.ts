import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';

const isProduction = process.env.VERCEL_ENV === 'production';
const APP_URL = process.env.APP_URL!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isProduction) {
    return res.status(403).send('OAuth 콜백은 Production 환경에서만 동작합니다.');
  }

  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code');

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${APP_URL}/auth/google/callback`  // ✅ 항상 고정 APP_URL 사용
  );

  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    const refreshToken = tokens.refresh_token || '';

    if (refreshToken) {
      console.log('=== NEW REFRESH TOKEN ===');
      console.log(refreshToken);
      console.log('========================');
    }

    res.send(`
      <html>
        <head><meta charset="utf-8"><title>인증 성공</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:40px;background:#f8f9fa;">
          <div style="background:white;border-radius:12px;padding:32px;max-width:600px;margin:0 auto;box-shadow:0 2px 12px rgba(0,0,0,0.1);">
            <h2 style="color:#22c55e;">✅ Google 인증 성공!</h2>
            ${refreshToken
              ? `<div style="background:#1e293b;color:#86efac;padding:16px;border-radius:8px;font-family:monospace;word-break:break-all;text-align:left;margin:16px 0;font-size:13px;">${refreshToken}</div>
                 <button onclick="navigator.clipboard.writeText('${refreshToken}').then(()=>alert('복사됨!'))" style="background:#3b82f6;color:white;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;font-size:15px;">📋 토큰 복사</button>`
              : '<p>인증이 완료되었습니다.</p>'
            }
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              setTimeout(() => window.close(), 2000);
            }
          </script>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error('OAuth Error:', error);
    res.status(500).send('인증 실패: ' + error.message);
  }
}
