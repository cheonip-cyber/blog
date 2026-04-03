import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─── 모델 레지스트리 ──────────────────────────────────────────────────────
const MODEL_REGISTRY: Record<string, string[]> = {
  fast: [
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
  ],
  balanced: [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
  ],
  high: [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-1.5-pro",
    "gemini-2.0-flash",
  ]
};

// 이미지 생성 모델 목록 (우선순위 순)
const IMAGE_MODEL_REGISTRY = [
  "gemini-2.0-flash-preview-image-generation",
  "gemini-2.0-flash-exp",
  "imagen-3.0-generate-002",
];

// ─── 모델 목록 캐싱 ───────────────────────────────────────────────────────
let modelCache: { list: string[]; updatedAt: number } = {
  list: [],
  updatedAt: 0
};
const TTL = 10 * 60 * 1000; // 10분

async function getAvailableModels(apiKey: string): Promise<string[]> {
  const now = Date.now();
  if (now - modelCache.updatedAt < TTL && modelCache.list.length > 0) {
    return modelCache.list;
  }

  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models',
      { headers: { 'x-goog-api-key': apiKey } }
    );
    const data = await res.json();
    const models = (data.models || []).map((m: any) =>
      m.name.replace('models/', '')
    );
    modelCache = { list: models, updatedAt: now };
    console.log('✅ 사용 가능한 모델 수:', models.length);
    return models;
  } catch (e) {
    console.warn('모델 목록 조회 실패, 캐시 또는 기본값 사용');
    return modelCache.list.length > 0 ? modelCache.list : MODEL_REGISTRY.balanced;
  }
}

async function resolveModels(quality: string, apiKey: string): Promise<string[]> {
  const available = await getAvailableModels(apiKey);
  const candidates = MODEL_REGISTRY[quality] || MODEL_REGISTRY.balanced;

  // 사용 가능한 모델만 필터링, 없으면 candidates 전체 반환
  const filtered = candidates.filter(m => available.includes(m));
  return filtered.length > 0 ? filtered : candidates;
}

// ─── Fallback 텍스트 생성 ─────────────────────────────────────────────────
async function generateWithFallback(
  models: string[],
  payload: any,
  apiKey: string
): Promise<any> {
  const errors: string[] = [];

  for (const model of models) {
    try {
      console.log(`🔄 시도 중: ${model}`);
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
        console.warn(`❌ ${model} 실패 (${res.status}): ${errText.slice(0, 100)}`);
        if (res.status === 404 || res.status === 400 || res.status === 429) {
          errors.push(`${model}: ${res.status}`);
          continue;
        }
        throw new Error(errText);
      }

      const data = await res.json();
      console.log(`✅ 성공: ${model}`);
      return { ...data, _usedModel: model };

    } catch (e: any) {
      errors.push(`${model}: ${e.message}`);
      continue;
    }
  }

  throw new Error(`모든 모델 실패: ${errors.join(', ')}`);
}

// ─── Fallback 이미지 생성 ─────────────────────────────────────────────────
async function generateImageWithFallback(
  prompt: string,
  apiKey: string
): Promise<string> {
  const available = await getAvailableModels(apiKey);
  const models = IMAGE_MODEL_REGISTRY.filter(m => available.includes(m));
  const tryModels = models.length > 0 ? models : IMAGE_MODEL_REGISTRY;

  for (const model of tryModels) {
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
              responseModalities: ["IMAGE", "TEXT"],
              imageConfig: { aspectRatio: "1:1" }
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
          return `data:${mimeType};base64,${part.inlineData.data}`;
        }
      }
      continue;

    } catch (e) {
      continue;
    }
  }

  throw new Error('이미지 생성 실패: 사용 가능한 모델 없음');
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
    // 이미지 생성 태스크
    if (task === 'image') {
      const imageData = await generateImageWithFallback(input, apiKey);
      return res.json({ success: true, imageData });
    }

    // 텍스트 생성 태스크 (blog, summary, qa 등)
    const quality = options?.quality || 'balanced';
    const models = await resolveModels(quality, apiKey);

    const payload = {
      contents: [{ parts: [{ text: input }] }],
      generationConfig: {
        responseMimeType: options?.jsonMode ? 'application/json' : 'text/plain',
        ...(options?.schema && { responseSchema: options.schema })
      }
    };

    const data = await generateWithFallback(models, payload, apiKey);

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return res.json({ success: true, text, usedModel: data._usedModel });

  } catch (error: any) {
    console.error('AI Gateway 오류:', error);
    return res.status(500).json({ error: error.message });
  }
}
