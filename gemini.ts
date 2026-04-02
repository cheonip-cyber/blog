import { GoogleGenAI, Type } from "@google/genai";

const apiKey = import.meta.env.VITE_GEMINI_API_KEY || (typeof process !== 'undefined' && process.env.GEMINI_API_KEY) || '';
const ai = new GoogleGenAI({ apiKey });

export interface BlogContent {
  title: string;
  content: string;
  imagePrompts: string[];
}

// ─── 블로그 콘텐츠 생성 ────────────────────────────────────────────────────
export async function generateBlogContent(
  proposalText: string,
  authorName: string,
  thumbnailTitle: string
): Promise<BlogContent> {

  // ✅ googleSearch 툴과 responseMimeType: "application/json"은 동시 사용 불가
  // → 2단계로 분리: 1단계(검색 포함 텍스트 생성) → 2단계(JSON 파싱)
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-05-20",
    contents: `
      당신은 '샘소타 ${authorName}'입니다.
      다음 교육 제안서 텍스트를 분석하여 네이버 블로그 포스팅을 작성하세요.

      [제안서 내용]
      ${proposalText}

      [작성 지침]
      1. 말투: 친근하고 편안한 문체 (~해요, ~했답니다).
      2. 작성자 소개: 자신을 소개할 때 반드시 "샘소타 ${authorName}예요"라고만 소개하세요.
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
         - 교육이론 전문 통찰 (커크패트릭, 70:20:10 등 관련 이론 직접 작성)
         - 마무리 및 교육자료요청
      8. 교육자료요청 (마지막 포함):
         📋 교육자료요청
         🌐 홈페이지: https://www.samsotta.com/AI
         📞 전화: 02-6949-3501
         📧 이메일: hrd@samsotta.com
         🏢 주식회사 SAM.SOTTA (샘소타)
      9. 키워드 태그: 해시태그 최소 10개. 마지막에 #샘소타 #SAMSOTTA #HRD #기업교육 포함.
      10. 이미지 프롬프트 6개 (영어, 텍스트 없는 이미지):
         - 이미지1 (썸네일A): Dark purple background, modern tech abstract design, no text, neon purple accents, Korean corporate style
         - 이미지2 (썸네일B): Clean white background, soft orange geometric shapes, no text, minimalist professional style
         - 이미지3: Korean corporate training scene, office workers aged 35-50, documentary style, muted tones
         - 이미지4: Small group workshop, Korean professionals, natural lighting, collaborative atmosphere
         - 이미지5: Flat minimal process diagram illustration, white background, no text, soft colors
         - 이미지6: Korean professional reviewing notes, clean desk, soft daylight
      11. 보안: 예산/개인이름/연락처 → "강사님" 등으로 대체.
      12. 썸네일 타이틀 "${thumbnailTitle}"은 이미지에 넣지 말 것 (UI 오버레이로 처리됨).

      [출력 형식 - 매우 중요]
      반드시 아래 JSON 형식으로만 출력하세요.
      마크다운 코드 블록(\`\`\`json)이나 추가 설명 없이 순수 JSON만 반환하세요:
      {
        "title": "블로그 제목",
        "content": "마크다운 형식의 블로그 본문",
        "imagePrompts": ["prompt1", "prompt2", "prompt3", "prompt4", "prompt5", "prompt6"]
      }
    `,
    config: {
      // ✅ googleSearch 제거 → JSON 응답과 충돌 없음
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          content: { type: Type.STRING },
          imagePrompts: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["title", "content", "imagePrompts"]
      }
    }
  });

  const rawText = response.text?.trim() || '';

  try {
    const cleaned = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
    return JSON.parse(cleaned) as BlogContent;
  } catch (e) {
    console.error('JSON 파싱 실패:', rawText.slice(0, 300));
    throw new Error('블로그 콘텐츠 파싱 실패. 다시 시도해 주세요.');
  }
}

// ─── 이미지 생성 ──────────────────────────────────────────────────────────
export async function generateImage(prompt: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash-preview-image-generation",
    contents: { parts: [{ text: prompt }] },
    config: {
      responseModalities: ["IMAGE", "TEXT"],
      imageConfig: { aspectRatio: "1:1" }
    }
  });

  const candidate = response.candidates?.[0];
  if (!candidate) throw new Error("이미지 생성 응답 없음");

  for (const part of candidate.content?.parts || []) {
    if (part.inlineData?.data) {
      const mimeType = part.inlineData.mimeType || 'image/png';
      return `data:${mimeType};base64,${part.inlineData.data}`;
    }
  }

  const finishReason = candidate.finishReason;
  if (finishReason && finishReason !== 'STOP') {
    throw new Error(`이미지 생성 차단: ${finishReason}`);
  }
  throw new Error("이미지 데이터 없음");
}
