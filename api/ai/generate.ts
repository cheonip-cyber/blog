import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─── 텍스트 모델 레지스트리 (검증된 모델만 하드코딩) ──────────────────────
// Serverless 환경에서 동적 모델 조회는 매 요청마다 초기화되므로 하드코딩이 안정적
const TEXT_MODEL_REGISTRY: Record<string, string[]> = {
  fast: [
    'gemini-2.0-flash',
    'gemini-1.5-flash',
  ],
  balanced: [
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ],
  high: [
    'gemini-2.5-pro-preview-05-06',
    'gemini-2.5-flash-preview-05-20',
    'gemini-1.5-pro',
    'gemini-2.0-flash',
  ]
};

// ─── 이미지 모델 레지스트리 (generateContent + IMAGE 방식만 허용) ──────────
// ❌ 제거된 모델:
//   - gemini-2.0-flash-exp: 텍스트 전용, 이미지 생성 불가
//   - imagen-3.0-generate-002: predict API 방식으로 구조 불일치
const IMAGE_MODELS = [
  'gemini-2.0-flash-preview-image-generation',
];

// ─── 텍스트 생성 (Fallback 포함) ─────────────────────────────────────────
async function generateTextWithFallback(
  models: string[],
  payload: any,
  apiKey: string
): Promise<any> {
  const errors: string[] = [];

  for (const model of models) {
    try {
      console.log(`🔄 텍스트 시도: ${model}`);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(payload)
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`❌ ${model} 실패 (${res.status}): ${errText.slice(0, 150)}`);
        // 404(없는 모델), 400(잘못된 요청), 429(할당량) → 다음 모델 시도
        if ([400, 404, 429, 503].includes(res.status)) {
          errors.push(`${model}: ${res.status}`);
          continue;
        }
        throw new Error(errText);
      }

      const data = await res.json();
      console.log(`✅ 텍스트 성공: ${model}`);
      return { ...data, _usedModel: model };

    } catch (e: any) {
      errors.push(`${model}: ${e.message?.slice(0, 80)}`);
      continue;
    }
  }

  throw new Error(`텍스트 생성 실패 - 모든 모델 시도: ${errors.join(' | ')}`);
}

// ─── 이미지 생성 ──────────────────────────────────────────────────────────
// 이미지 전용 모델만 시도. 실패 시 placeholder 반환 (잘못된 모델 fallback 금지)
async function generateImage(
  prompt: string,
  apiKey: string
): Promise<{ imageData: string; isPlaceholder: boolean }> {

  for (const model of IMAGE_MODELS) {
    try {
      console.log(`🎨 이미지 시도: ${model}`);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ['IMAGE', 'TEXT'],
              imageConfig: { aspectRatio: '1:1' }
            }
          })
        }
      );

      if (!res.ok) {
        console.warn(`❌ 이미지 ${model} 실패 (${res.status})`);
        continue;
      }

      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts || [];

      for (const part of parts) {
        if (part.inlineData?.data) {
          const mimeType = part.inlineData.mimeType || 'image/png';
          console.log(`✅ 이미지 성공: ${model}`);
          return {
            imageData: `data:${mimeType};base64,${part.inlineData.data}`,
            isPlaceholder: false
          };
        }
      }

      console.warn(`⚠️ ${model}: 응답에 이미지 데이터 없음`);

    } catch (e: any) {
      console.warn(`❌ 이미지 ${model} 예외: ${e.message?.slice(0, 80)}`);
      continue;
    }
  }

  // ✅ 이미지 모델 전부 실패 → placeholder 반환 (텍스트 모델로 fallback 금지)
  console.warn('⚠️ 이미지 생성 실패 → placeholder 반환');
  const seed = Math.floor(Math.random() * 1000);
  return {
    imageData: `https://picsum.photos/seed/samsotta-${seed}/1024/1024?blur=2`,
    isPlaceholder: true
  };
}

// ─── API Handler ──────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' });
  }

  const { task, input, options } = req.body;
  if (!task || !input) {
    return res.status(400).json({ error: 'task와 input이 필요합니다.' });
  }

  try {
    // ── 이미지 생성 ──
    if (task === 'image') {
      const result = await generateImage(input, apiKey);
      return res.json({
        success: true,
        imageData: result.imageData,
        isPlaceholder: result.isPlaceholder,
        // placeholder인 경우 프론트에서 토스트 알림 표시용
        message: result.isPlaceholder ? '이미지 생성 서비스가 일시적으로 불가합니다.' : undefined
      });
    }

    // ── 텍스트 생성 ──
    const quality = options?.quality || 'balanced';
    const models = TEXT_MODEL_REGISTRY[quality] || TEXT_MODEL_REGISTRY.balanced;

    const payload = {
      contents: [{ parts: [{ text: input }] }],
      generationConfig: {
        responseMimeType: options?.jsonMode ? 'application/json' : 'text/plain',
      }
    };

    const data = await generateTextWithFallback(models, payload, apiKey);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return res.json({ success: true, text, usedModel: data._usedModel });

  } catch (error: any) {
    console.error('AI Gateway 오류:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
