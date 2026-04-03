import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─── 타입 정의 ────────────────────────────────────────────────────────────
interface GeminiModel {
  name: string;
  displayName: string;
  supportedGenerationMethods: string[];
}

// ─── TTL 캐시 (Serverless 인스턴스 생존 동안 유효) ──────────────────────
let modelCache: {
  models: GeminiModel[];
  updatedAt: number;
} = {
  models: [],
  updatedAt: 0
};

const TTL = 10 * 60 * 1000; // 10분

// ─── 모델 목록 조회 (TTL 캐싱 + stale cache fallback) ───────────────────
async function getModels(apiKey: string): Promise<GeminiModel[]> {
  const now = Date.now();

  // 캐시 유효 → 즉시 반환
  if (now - modelCache.updatedAt < TTL && modelCache.models.length > 0) {
    console.log(`📦 캐시 사용 (${modelCache.models.length}개 모델)`);
    return modelCache.models;
  }

  try {
    console.log('🔍 /v1beta/models 조회 중...');
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );

    if (!res.ok) {
      throw new Error(`모델 목록 조회 실패: ${res.status}`);
    }

    const data = await res.json();
    const models: GeminiModel[] = (data.models || []).map((m: any) => ({
      name: m.name.replace('models/', ''),
      displayName: m.displayName || '',
      supportedGenerationMethods: m.supportedGenerationMethods || []
    }));

    // 캐시 갱신
    modelCache = { models, updatedAt: now };
    console.log(`✅ 모델 목록 갱신: ${models.length}개`);
    return models;

  } catch (err: any) {
    // ✅ API 실패 시 stale cache 사용 (graceful degradation)
    if (modelCache.models.length > 0) {
      console.warn(`⚠️ 모델 목록 조회 실패 → stale cache 사용: ${err.message}`);
      return modelCache.models;
    }
    throw new Error(`모델 목록 조회 실패 (캐시도 없음): ${err.message}`);
  }
}

// ─── 점수 기반 모델 정렬 ──────────────────────────────────────────────────
function scoreTextModel(name: string): number {
  // 최신 버전 우선 (숫자가 클수록 높은 점수)
  const versionMatch = name.match(/(\d+\.\d+)/);
  const version = versionMatch ? parseFloat(versionMatch[1]) : 0;

  // 모델 계열 점수
  let tierScore = 0;
  if (name.includes('pro'))   tierScore = 30;
  if (name.includes('flash')) tierScore = 20;
  if (name.includes('lite'))  tierScore = 10;

  // preview/exp는 감점 (안정성 낮음)
  const stabilityPenalty = (name.includes('preview') || name.includes('exp')) ? -5 : 0;

  return version * 10 + tierScore + stabilityPenalty;
}

// ─── 텍스트 모델 필터링 + 정렬 ───────────────────────────────────────────
function filterTextModels(models: GeminiModel[]): string[] {
  const filtered = models
    .filter(m =>
      // ① capability 기반: generateContent 지원
      m.supportedGenerationMethods.includes('generateContent') &&
      // ② Gemini 모델만
      m.name.includes('gemini') &&
      // ③ 이미지 생성 전용 모델 제외
      !m.name.includes('image-generation') &&
      // ④ 임베딩/기타 제외
      !m.name.includes('embedding') &&
      !m.name.includes('aqa')
    )
    .sort((a, b) => scoreTextModel(b.name) - scoreTextModel(a.name))
    .map(m => m.name);

  // ✅ 빈 목록 방어
  if (filtered.length === 0) {
    throw new Error('호환 가능한 텍스트 모델 없음 (필터 결과 0개)');
  }

  console.log(`📋 텍스트 모델 후보: ${filtered.slice(0, 5).join(', ')}`);
  return filtered;
}

// ─── 이미지 모델 필터링 ───────────────────────────────────────────────────
function filterImageModels(models: GeminiModel[]): string[] {
  // Google API는 이미지 생성 capability를 별도 필드로 제공하지 않음
  // supportedGenerationMethods만으로 텍스트/이미지 모델 구분 불가
  // 현재 기준에서 "image-generation" 문자열이 유일한 식별 방법
  const filtered = models
    .filter(m =>
      m.supportedGenerationMethods.includes('generateContent') &&
      m.name.includes('image-generation')
    )
    .map(m => m.name);

  if (filtered.length === 0) {
    console.warn('⚠️ 이미지 생성 모델 없음');
  } else {
    console.log(`🎨 이미지 모델 후보: ${filtered.join(', ')}`);
  }

  return filtered;
}

// ─── 텍스트 생성 (fallback 포함) ─────────────────────────────────────────
async function generateText(
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
        const reason = `${res.status}: ${errText.slice(0, 100)}`;
        // ✅ fallback 로그
        console.warn(`❌ [fallback] ${model} 실패 → ${reason}`);
        errors.push(`${model}(${res.status})`);

        if ([400, 404, 429, 503].includes(res.status)) continue;
        throw new Error(errText);
      }

      console.log(`✅ 텍스트 성공: ${model}`);
      const data = await res.json();
      return { ...data, _usedModel: model };

    } catch (e: any) {
      console.warn(`❌ [fallback] ${model} 예외 → ${e.message?.slice(0, 80)}`);
      errors.push(`${model}(exception)`);
      continue;
    }
  }

  throw new Error(`텍스트 생성 실패 - 시도한 모델: ${errors.join(', ')}`);
}

// ─── 이미지 생성 (fallback 포함) ─────────────────────────────────────────
async function generateImage(
  models: string[],
  prompt: string,
  apiKey: string
): Promise<{ imageData: string; isPlaceholder: boolean }> {

  for (const model of models) {
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
        console.warn(`❌ [fallback] 이미지 ${model} 실패 (${res.status})`);
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

      console.warn(`⚠️ [fallback] 이미지 ${model}: 응답에 이미지 없음`);

    } catch (e: any) {
      console.warn(`❌ [fallback] 이미지 ${model} 예외 → ${e.message?.slice(0, 80)}`);
      continue;
    }
  }

  // 모든 이미지 모델 실패 → placeholder (서비스 중단 없음)
  console.warn('⚠️ 모든 이미지 모델 실패 → placeholder 반환');
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
    // 모델 목록 동적 조회 (TTL 캐싱 + stale fallback)
    const allModels = await getModels(apiKey);

    // ── 이미지 생성 ──
    if (task === 'image') {
      const imageModels = filterImageModels(allModels);
      const result = await generateImage(imageModels, input, apiKey);
      return res.json({
        success: true,
        imageData: result.imageData,
        isPlaceholder: result.isPlaceholder,
        message: result.isPlaceholder
          ? '이미지 생성 서비스가 일시적으로 불가합니다.' : undefined
      });
    }

    // ── 텍스트 생성 ──
    const textModels = filterTextModels(allModels);
    const payload = {
      contents: [{ parts: [{ text: input }] }],
      generationConfig: {
        responseMimeType: options?.jsonMode ? 'application/json' : 'text/plain',
      }
    };

    const data = await generateText(textModels, payload, apiKey);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return res.json({ success: true, text, usedModel: data._usedModel });

  } catch (error: any) {
    console.error('🚨 AI Gateway 오류:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
