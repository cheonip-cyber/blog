import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/google/callback`
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('Missing code parameter');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    const refreshToken = tokens.refresh_token || '';

    console.log('=== REFRESH TOKEN ===');
    console.log(refreshToken);
    console.log('====================');

    // 화면에 직접 토큰 표시 (복사하기 쉽게)
    res.send(`
      <html>
        <head>
          <meta charset="utf-8">
          <title>인증 성공</title>
          <style>
            body { font-family: sans-serif; text-align: center; padding: 40px; background: #f8f9fa; }
            .box { background: white; border-radius: 12px; padding: 32px; max-width: 600px; margin: 0 auto; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
            h2 { color: #22c55e; }
            .token-area { background: #1e293b; color: #86efac; padding: 16px; border-radius: 8px; font-family: monospace; word-break: break-all; text-align: left; margin: 16px 0; font-size: 13px; }
            .label { font-weight: bold; color: #475569; margin-bottom: 8px; }
            button { background: #3b82f6; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 15px; margin-top: 8px; }
            button:hover { background: #2563eb; }
            .step { background: #fef3c7; border-radius: 8px; padding: 16px; text-align: left; margin-top: 16px; font-size: 14px; line-height: 1.8; }
          </style>
        </head>
        <body>
          <div class="box">
            <h2>✅ Google 인증 성공!</h2>
            <div class="label">🔑 GOOGLE_REFRESH_TOKEN (아래 값을 복사하세요)</div>
            <div class="token-area" id="token">${refreshToken || '⚠️ Refresh Token 없음 - 이미 발급된 적 있으면 아래 방법 참고'}</div>
            <button onclick="navigator.clipboard.writeText('${refreshToken}').then(()=>alert('복사됨!'))">
              📋 토큰 복사하기
            </button>
            <div class="step">
              <strong>📌 다음 단계:</strong><br>
              1. 위 토큰 값을 복사<br>
              2. Vercel → 프로젝트 → Settings → Environment Variables<br>
              3. <code>GOOGLE_REFRESH_TOKEN</code> 항목에 붙여넣기 → Save<br>
              4. Vercel → Deployments → Redeploy
            </div>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
            }
          </script>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error('OAuth Callback Error:', error);
    res.status(500).send(`
      <html><body style="font-family:sans-serif;padding:40px;text-align:center;">
        <h2>❌ 인증 실패</h2>
        <p>${error.message}</p>
        <a href="/">← 돌아가기</a>
      </body></html>
    `);
  }
}
