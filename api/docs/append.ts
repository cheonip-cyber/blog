import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';

const DOCUMENT_ID = process.env.GOOGLE_DOC_ID || '19d5e01j5IYakOKftv-7Y28T8oo0SStGKRwGej1QK6Wk';

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+(.+)$/gm, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/^>\s+/gm, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/---+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { title, content } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: '제목과 내용이 필요합니다.' });
  }

  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    return res.status(401).json({
      error: '인증 정보가 없습니다.',
      needsAuth: true
    });
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.APP_URL}/auth/google/callback`
    );
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });

    const docs = google.docs({ version: 'v1', auth: oauth2Client });

    // 현재 문서 마지막 인덱스 조회
    const doc = await docs.documents.get({ documentId: DOCUMENT_ID });
    const bodyContent = doc.data.body?.content || [];
    const lastElement = bodyContent[bodyContent.length - 1];
    const insertionIndex = Math.max(1, (lastElement?.endIndex || 2) - 1);

    const plainContent = markdownToPlainText(content);
    const timestamp = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const textToInsert = `\n\n📅 작성일: ${timestamp}\n\n${title}\n\n${plainContent}\n`;

    await docs.documents.batchUpdate({
      documentId: DOCUMENT_ID,
      requestBody: {
        requests: [
          { insertPageBreak: { location: { index: insertionIndex } } },
          { insertText: { location: { index: insertionIndex + 1 }, text: textToInsert } }
        ]
      }
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Google Docs Error:', error?.response?.data || error);

    if (error?.response?.status === 401) {
      return res.status(401).json({ error: '인증이 만료되었습니다.', needsAuth: true });
    }

    const message = error?.response?.data?.error?.message || error.message || '저장 실패';
    res.status(500).json({ error: message });
  }
}
