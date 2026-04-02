import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// ─── Google Docs API (API Key 방식) ────────────────────────────────────────
// Google Docs에 직접 쓰기 위해 Service Account 또는 OAuth2 토큰이 필요합니다.
// 여기서는 서버에 저장된 OAuth2 Refresh Token을 사용하는 방식으로 단순화합니다.
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL || 'http://localhost:3000'}/auth/google/callback`
);

// Refresh Token이 환경변수에 있으면 자동으로 인증 처리
if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });
}

const DOCUMENT_ID = process.env.GOOGLE_DOC_ID || '19d5e01j5IYakOKftv-7Y28T8oo0SStGKRwGej1QK6Wk';

// ─── Google OAuth Routes (초기 토큰 발급용) ───────────────────────────────
app.get("/api/auth/google/url", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/documents'],
    prompt: 'consent'
  });
  res.json({ url });
});

app.get(["/auth/google/callback", "/auth/google/callback/"], async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    oauth2Client.setCredentials(tokens);

    // 개발자에게 refresh_token을 콘솔에 출력 (최초 1회만 필요)
    if (tokens.refresh_token) {
      console.log('\n✅ GOOGLE_REFRESH_TOKEN (환경변수에 저장하세요):');
      console.log(tokens.refresh_token);
      console.log('\n');
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
            }
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Google OAuth Error:', error);
    res.status(500).send('Authentication failed');
  }
});

app.get("/api/auth/status", (req, res) => {
  const hasCredentials = !!process.env.GOOGLE_REFRESH_TOKEN || !!oauth2Client.credentials?.access_token;
  res.json({ isAuthenticated: hasCredentials });
});

// ─── Google Docs 저장 API ──────────────────────────────────────────────────
app.post("/api/docs/append", async (req, res) => {
  const { title, content } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: '제목과 내용이 필요합니다.' });
  }

  try {
    const docs = google.docs({ version: 'v1', auth: oauth2Client });

    // 1. 현재 문서의 마지막 인덱스 조회
    const doc = await docs.documents.get({ documentId: DOCUMENT_ID });
    const bodyContent = doc.data.body?.content || [];
    const lastElement = bodyContent[bodyContent.length - 1];
    const insertionIndex = Math.max(1, (lastElement?.endIndex || 2) - 1);

    // 2. 마크다운을 일반 텍스트로 변환 (Google Docs API는 마크다운 미지원)
    const plainContent = markdownToPlainText(content);
    const timestamp = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

    // 3. 삽입할 텍스트 구성
    const textToInsert = `\n\n📅 작성일: ${timestamp}\n\n${title}\n\n${plainContent}\n`;

    // 4. batchUpdate 요청
    const requests: any[] = [
      {
        insertPageBreak: {
          location: { index: insertionIndex }
        }
      },
      {
        insertText: {
          location: { index: insertionIndex + 1 },
          text: textToInsert
        }
      }
    ];

    await docs.documents.batchUpdate({
      documentId: DOCUMENT_ID,
      requestBody: { requests }
    });

    res.json({ success: true, message: 'Google Docs에 저장되었습니다.' });

  } catch (error: any) {
    console.error('Google Docs API Error:', error?.response?.data || error);

    // 인증 오류 시 재인증 안내
    if (error?.response?.status === 401) {
      return res.status(401).json({
        error: '인증이 만료되었습니다.',
        needsAuth: true
      });
    }

    const message = error?.response?.data?.error?.message || error.message || '저장에 실패했습니다.';
    res.status(500).json({ error: message });
  }
});

// ─── 마크다운 → 일반 텍스트 변환 헬퍼 ────────────────────────────────────
function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+(.+)$/gm, '$1')          // 헤더 제거
    .replace(/\*\*(.+?)\*\*/g, '$1')              // 볼드 제거
    .replace(/\*(.+?)\*/g, '$1')                  // 이탤릭 제거
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')           // 링크 → 텍스트만
    .replace(/^[-*+]\s+/gm, '• ')                 // 불렛 포인트 변환
    .replace(/^>\s+/gm, '')                        // 블록쿼트 제거
    .replace(/`{1,3}[^`]*`{1,3}/g, '')            // 코드 블록 제거
    .replace(/---+/g, '')                          // 구분선 제거
    .replace(/\n{3,}/g, '\n\n')                   // 과도한 줄바꿈 정리
    .trim();
}

// ─── Vite Dev / Production Static ─────────────────────────────────────────
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    if (!process.env.GOOGLE_REFRESH_TOKEN) {
      console.log('⚠️  GOOGLE_REFRESH_TOKEN이 없습니다. /api/auth/google/url 로 최초 인증 후 .env에 추가하세요.');
    }
  });
}

startServer();
