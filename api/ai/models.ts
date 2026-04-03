import type { VercelRequest, VercelResponse } from '@vercel/node';

// 실제 API 키로 사용 가능한 모델 목록을 실시간 조회
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API 키 없음' });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    const data = await response.json();

    // generateContent 지원 모델만 필터링
    const textModels = (data.models || [])
      .filter((m: any) =>
        m.supportedGenerationMethods?.includes('generateContent')
      )
      .map((m: any) => ({
        name: m.name.replace('models/', ''),
        displayName: m.displayName,
        description: m.description?.slice(0, 80),
      }));

    res.json({
      total: textModels.length,
      models: textModels
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
