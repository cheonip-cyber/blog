import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─── 텍스트 모델 레지스트리 (2025년 현재 검증된 모델명) ───────────────────
const TEXT_MODEL_REGISTRY: Record<string, string[]> = {
  fast: [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
  ],
  balanced: [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
  ],
  high: [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
  ]
};

// ─── 이미지 모델 레지스트리 (generateContent + IMAGE 방식) ────────────────
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

  throw new Error(`텍스트 생성 실패: ${errors.join(' | ')}`);
}

// ─── 이미지 생성 ──────────────────────────────────────────────────────────
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

    } catch (e: any) {
      console.warn(`❌ 이미지 ${model} 예외: ${e.message?.slice(0, 80)}`);
    }
  }

  // 실패 시 placeholder 반환
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
    if (task === 'image') {
      const result = await generateImage(input, apiKey);
      return res.json({
        success: true,
        imageData: result.imageData,
        isPlaceholder: result.isPlaceholder,
        message: result.isPlaceholder ? '이미지 생성 서비스가 일시적으로 불가합니다.' : undefined
      });
    }

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
