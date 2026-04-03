// ✅ AI 생성은 브라우저에서 Gemini API 직접 호출
// - 504 Timeout 구조적 해결 (Vercel Function 시간 제한 없음)
// - API 키는 HTTP Referrer 제한으로 보호 (Google Cloud Console 설정)
// - Google Docs 저장 등 서버 작업은 여전히 /api/* 경유

// ─── 이미지 프롬프트 풀 ──────────────────────────────────────────────────
// gemini-2.5-flash-image 모델 기준으로 매번 다양한 스타일이 생성되도록
// 배경 컬러 풀 + 패턴 풀을 랜덤 조합 → 6장 모두 다른 스타일 보장

// 배경 컬러 풀 (다크 6 + 라이트 4)
const BG_POOL = [
  'deep dark purple (#1a0033)',
  'dark navy blue (#0a0f2e)',
  'pure jet black (#0d0d0d)',
  'deep dark teal (#002d2d)',
  'midnight dark indigo (#080c1a)',
  'dark charcoal gray (#1c1c1e)',
  'pure white',
  'vibrant warm orange (#f96820)',
  'bold coral red (#ff4040)',
  'soft warm cream white (#faf5f0)',
];

// 그래픽 패턴 풀
const PATTERN_POOL = [
  'glowing neon circuit board geometric patterns with floating isometric 3D cubes and hexagons, particle light effects',
  'flowing neon wave lines with 3D wireframe hexagons and diamond shapes scattered, cinematic glow',
  'abstract fluid organic blob shapes decorating all four edges with bold accent lines, clean center space',
  'abstract geometric diamond and angular crystalline shapes with golden accent lines, luxury style',
  'glowing data visualization network nodes connected by bright light lines, futuristic tech style',
  'radiant particle orbs and circular glow rings with light streaks, ethereal energy style',
  'layered abstract triangular geometric structures with gradient depth, modern architecture style',
  'concentric circle rings with gradient glow and radiating energy lines from center',
  'hexagonal honeycomb grid pattern with glowing neon edges and depth layers',
  'abstract cosmic nebula color splash with vibrant gradients and star particle effects',
];

// 네온 컬러 악센트 풀 (다크 배경용)
const ACCENT_POOL = [
  'cyan and blue neon',
  'purple and magenta neon',
  'teal and green neon',
  'golden yellow and amber',
  'pink and violet neon',
  'electric blue and white neon',
];

// 랜덤 셔플 (Fisher-Yates)
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 이미지 6장 프롬프트 동적 생성
// - 썸네일1(0): 다크 계열 고정 (샘플 기준)
// - 썸네일2(1): 라이트 계열 고정 (샘플 기준)
// - 본문 4장(2~5): 풀에서 랜덤 선택
export function generateImagePrompts(): string[] {
  const shuffledBg = shuffle(BG_POOL);
  const shuffledPattern = shuffle(PATTERN_POOL);
  const shuffledAccent = shuffle(ACCENT_POOL);

  const darkBgs = BG_POOL.slice(0, 6);   // 다크 계열
  const lightBgs = BG_POOL.slice(6);      // 라이트 계열
  const randomDark = shuffle(darkBgs);
  const randomLight = shuffle(lightBgs);

  const base = 'Professional corporate graphic design style, pure digital illustration, NO photography, NO realistic photos, NO real people, NO text, NO letters';

  return [
    // [0] 썸네일A: 다크 배경 + 네온 패턴
    `${randomDark[0]} background, ${shuffledAccent[0]} ${shuffledPattern[0]}, ${base}`,
    // [1] 썸네일B: 라이트 배경 + 장식 패턴
    `${randomLight[0]} background, ${shuffledPattern[1]}, ${base}`,
    // [2~5] 본문 이미지: 완전 랜덤 조합
    `${shuffledBg[0]} background, ${shuffledAccent[1]} ${shuffledPattern[2]}, ${base}`,
    `${shuffledBg[1]} background, ${shuffledPattern[3]}, ${base}`,
    `${shuffledBg[2]} background, ${shuffledAccent[2]} ${shuffledPattern[4]}, ${base}`,
    `${shuffledBg[3]} background, ${shuffledPattern[5]}, ${base}`,
  ];
}

// 하위 호환: 기존 FIXED_IMAGE_PROMPTS 사용처를 위해 유지
// App.tsx에서 generateImagePrompts() 호출로 교체 필요
export const FIXED_IMAGE_PROMPTS: string[] = generateImagePrompts();

export interface BlogContent {
  title: string;
  content: string;
}

export interface ImageResult {
  imageData: string;
  isPlaceholder: boolean;
  message?: string;
}

// ─── Gemini 모델 타입 ─────────────────────────────────────────────────────
interface GeminiModel {
  name: string;
  supportedGenerationMethods: string[];
}

// ─── 브라우저용 TTL 캐시 ──────────────────────────────────────────────────
let modelCache: { models: GeminiModel[]; updatedAt: number } = {
  models: [],
  updatedAt: 0
};
const TTL = 10 * 60 * 1000;

// ─── API 키 ───────────────────────────────────────────────────────────────
function getApiKey(): string {
  const key = import.meta.env.VITE_GEMINI_API_KEY;
  if (!key) throw new Error('VITE_GEMINI_API_KEY가 설정되지 않았습니다.');
  return key;
}

// ─── 모델 목록 동적 조회 ─────────────────────────────────────────────────
async function getModels(): Promise<GeminiModel[]> {
  const now = Date.now();
  if (now - modelCache.updatedAt < TTL && modelCache.models.length > 0) {
    return modelCache.models;
  }
  try {
    const apiKey = getApiKey();
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (!res.ok) throw new Error(`모델 목록 조회 실패: ${res.status}`);
    const data = await res.json();
    const models: GeminiModel[] = (data.models || []).map((m: any) => ({
      name: m.name.replace('models/', ''),
      supportedGenerationMethods: m.supportedGenerationMethods || []
    }));
    modelCache = { models, updatedAt: now };
    return models;
  } catch (err: any) {
    if (modelCache.models.length > 0) return modelCache.models;
    throw new Error(`모델 목록 조회 실패: ${err.message}`);
  }
}

function scoreTextModel(name: string): number {
  const versionMatch = name.match(/(\d+\.\d+)/);
  const version = versionMatch ? parseFloat(versionMatch[1]) : 0;
  let tier = 0;
  if (name.includes('pro'))   tier = 30;
  if (name.includes('flash')) tier = 20;
  if (name.includes('lite'))  tier = 10;
  const penalty = (name.includes('preview') || name.includes('exp')) ? -5 : 0;
  return version * 10 + tier + penalty;
}

async function getTextModels(): Promise<string[]> {
  const all = await getModels();
  const filtered = all
    .filter(m =>
      m.supportedGenerationMethods.includes('generateContent') &&
      m.name.includes('gemini') &&
      !m.name.includes('image-generation') &&
      !m.name.includes('embedding') &&
      !m.name.includes('aqa')
    )
    .sort((a, b) => scoreTextModel(b.name) - scoreTextModel(a.name))
    .map(m => m.name);
  if (filtered.length === 0) throw new Error('사용 가능한 텍스트 모델 없음');
  return filtered;
}

async function getImageModels(): Promise<string[]> {
  const all = await getModels();

  const filtered = all
    .filter(m =>
      m.supportedGenerationMethods.includes('generateContent') &&
      // gemini-2.5-flash-image, gemini-2.0-flash-preview-image-generation 등 모두 포함
      (m.name.includes('image-generation') || /\-image(\-|$)/.test(m.name))
    )
    .map(m => m.name);

  // 품질 우선순위: 2.5-flash-image > 2.0-flash-image > image-generation 계열
  const priority = (name: string): number => {
    if (name.includes('2.5') && name.endsWith('-image')) return 0;
    if (name.includes('2.5') && name.includes('image')) return 1;
    if (name.includes('2.0') && name.endsWith('-image')) return 2;
    return 3;
  };

  return filtered.sort((a, b) => priority(a) - priority(b));
}

// ─── 텍스트 생성 ─────────────────────────────────────────────────────────
async function generateTextWithFallback(models: string[], payload: object): Promise<string> {
  const apiKey = getApiKey();
  const errors: string[] = [];
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );
      if (!res.ok) {
        const errText = await res.text();
        errors.push(`${model}(${res.status})`);
        if ([400, 404, 429, 503].includes(res.status)) continue;
        throw new Error(errText);
      }
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (e: any) {
      errors.push(`${model}(err)`);
      continue;
    }
  }
  throw new Error(`텍스트 생성 실패: ${errors.join(', ')}`);
}

// ─── 블로그 콘텐츠 생성 (imagePrompts 제거됨) ────────────────────────────
export async function generateBlogContent(
  proposalText: string,
  authorName: string,
  thumbnailTitle: string
): Promise<BlogContent> {

  const models = await getTextModels();

  // imagePrompts를 요청하지 않음 → 고정 프롬프트(FIXED_IMAGE_PROMPTS) 사용
  const prompt = `당신은 '샘소타 ${authorName}'입니다.
다음 교육 제안서 텍스트를 분석하여 네이버 블로그 포스팅을 작성하세요.

[제안서 내용]
${proposalText}

[작성 지침]
1. 말투: 친근하고 편안한 문체 (~해요, ~했답니다).
2. 작성자 소개: 반드시 "샘소타 ${authorName}예요"라고만 소개하세요.
3. 분량: 공백 제외 최소 1,500자 이상. 의미 없는 반복 금지.
4. 가독성: 모든 마침표(.) 뒤에 줄바꿈 추가.
5. 소제목: 대괄호([]) 사용 금지. 이모지 활용한 감성적 소제목.
6. 강사 호칭: 모두 "강사님"으로 통일.
7. 구조 (순서 준수):
   - 핵심 메세지 1~2줄
   - 교육 성과 및 기대 효과
   - 교육 개요 (불렛 포인트)
   - 핵심 특징 및 차별점
   - 커리큘럼 핵심 흐름
   - 교육이론 전문 통찰 (커크패트릭, 70:20:10 등)
   - 마무리 및 교육자료요청
8. 교육자료요청 (마지막 포함):
   📋 교육자료요청
   🌐 홈페이지: https://www.samsotta.com/AI
   📞 전화: 02-6949-3501
   📧 이메일: hrd@samsotta.com
   🏢 주식회사 SAM.SOTTA (샘소타)
9. 키워드 태그: 해시태그 최소 10개. 마지막에 #샘소타 #SAMSOTTA #HRD #기업교육 포함.
10. 보안: 예산/개인이름/연락처 → 강사님 등으로 대체.
11. 썸네일 타이틀 "${thumbnailTitle}"은 이미지에 절대 넣지 말 것.

[출력 형식]
반드시 순수 JSON만 반환 (마크다운 블록 없이):
{"title":"블로그 제목","content":"마크다운 형식의 블로그 본문"}`;

  const rawText = await generateTextWithFallback(models, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json' }
  });

  try {
    const cleaned = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
    return JSON.parse(cleaned) as BlogContent;
  } catch {
    throw new Error('블로그 콘텐츠 파싱 실패. 다시 시도해 주세요.');
  }
}

// ─── 이미지 생성 (고정 프롬프트 사용) ────────────────────────────────────
export async function generateImage(prompt: string): Promise<ImageResult> {
  const apiKey = getApiKey();
  const models = await getImageModels();

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ['IMAGE', 'TEXT'],
              imageConfig: { aspectRatio: '1:1' }
            }
          })
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          return {
            imageData: `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`,
            isPlaceholder: false
          };
        }
      }
    } catch {
      continue;
    }
  }

  const seed = Math.floor(Math.random() * 1000);
  return {
    imageData: `https://picsum.photos/seed/samsotta-${seed}/1024/1024?blur=2`,
    isPlaceholder: true,
    message: '이미지 생성 서비스가 일시적으로 불가합니다.'
  };
}
