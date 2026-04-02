import { GoogleGenAI, Type } from "@google/genai";

const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY!;
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

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",   // ✅ 안정 버전 모델
    contents: `
      당신은 '샘소타 ${authorName}'입니다.
      다음 교육 제안서 텍스트를 분석하여 네이버 블로그 포스팅을 작성하세요.

      [제안서 내용]
      ${proposalText}

      [작성 지침]
      1. 말투: 친근하고 편안한 문체 (~해요, ~했답니다).
      2. 작성자 소개: 자신을 소개할 때 "교육 컨설턴트"나 "마케팅 전문가" 같은 수식어를 절대 사용하지 마세요. 반드시 "샘소타 ${authorName}예요"라고만 소개하세요.
      3. 분량 및 품질 (매우 중요):
         - 공백 제외 최소 1,500자 이상의 풍성한 분량으로 작성하세요.
         - 단순히 글자 수를 채우기 위한 의미 없는 반복적인 글 또는 전문성이 부족한 글은 작성하지 마세요.
         - 독자가 끝까지 읽을 수 있도록 정보 전달이 명확하고 체류 시간이 긴 알찬 내용을 작성하여 네이버 블로그 최적화(SEO)를 달성하세요.
      4. 가독성 규칙: 본문 내용의 모든 마침표(.) 뒤에는 반드시 줄바꿈(Line Break)을 추가하여 가독성을 극대화하세요.
      5. 소제목 스타일: "[교육개요]", "[핵심특징]" 같은 딱딱한 표현과 대괄호([])를 절대 사용하지 마세요. 대신 블로그 분위기에 어울리는 감성적이고 매력적인 문장으로 소제목을 작성하고, 이모지를 활용하여 눈에 띄게 표현하세요.
      6. 강사 호칭: 제안서 내의 강사 이름이나 대표님 등의 호칭은 모두 "강사님"으로 통일하여 작성하세요.
      7. 구조 (이 순서를 반드시 지킬 것):
         - 전반부: 독자의 호기심과 문제해결에 도움이 될 수 있는 핵심 메세지를 가장 먼저 1~2줄 작성.
         - 교육 성과: 이 교육을 통해 고객사가 얻을 수 있는 구체적인 효과와 변화.
         - 교육 개요: 교육 대상과 핵심 주제를 불렛 포인트로 요약.
         - 핵심 특징: 이 교육만의 차별점과 강점을 실무 적용 관점에서 상세히 기술.
         - 커리큘럼: 핵심 아젠다 흐름만 반영.
         - 교육이론: 관련 교육학 이론을 검색·분석하여 전문적인 통찰 제공.
         - 마무리: 따뜻한 인사 및 아래의 교육자료요청 정보 포함.
      8. 교육자료요청 (마지막에 반드시 포함, 각 항목 줄바꿈):
         📋 교육자료요청
         🌐 홈페이지: https://www.samsotta.com/AI
         📞 전화: 02-6949-3501
         📧 이메일: hrd@samsotta.com
         🏢 주식회사 SAM.SOTTA (샘소타)
      9. 키워드 태그 (마지막에 반드시 포함):
         - 교육 주제와 관련된 주요 키워드를 해시태그(#) 형태로 최소 10개 이상 제시하세요.
         - "#샘소타, #SAMSOTTA, #HRD, #기업교육"은 키워드 리스트의 마지막에 반드시 포함되어야 합니다.
      10. 이미지 기획: 블로그에 삽입할 이미지 총 6장에 대한 상세 프롬프트를 영어로 작성하여 JSON에 포함하세요.
         - 이미지 1 (썸네일 A): Dark purple background, modern tech abstract design. No text. Clean professional corporate atmosphere with neon purple accents. Korean minimalist aesthetic.
         - 이미지 2 (썸네일 B): Clean white background with soft orange abstract geometric shapes. No text. Minimalist professional illustrative corporate style.
         - 이미지 3: Korean corporate training scene. Office workers aged 35-50 in modern conference room. Documentary style, muted professional tones.
         - 이미지 4: Small group workshop discussion in bright modern office. Korean professionals, natural lighting, collaborative atmosphere.
         - 이미지 5: Flat minimal process diagram illustration, white background, no text, soft corporate colors, clean vector style.
         - 이미지 6: Korean professional reviewing printed notes at clean desk, soft daylight, calm focused composition.
      11. 보안: 예산, 개인 이름, 연락처 등 민감 정보는 비식별 처리하거나 "강사님" 등으로 대체하세요.
      12. 썸네일 타이틀 "${thumbnailTitle}"은 UI 오버레이로 처리되므로 이미지 프롬프트에 텍스트를 포함하지 마세요.

      [출력 형식]
      반드시 아래 JSON 형식으로만 출력하세요:
      {
        "title": "블로그 제목",
        "content": "마크다운 형식의 블로그 본문",
        "imagePrompts": ["prompt1", "prompt2", "prompt3", "prompt4", "prompt5", "prompt6"]
      }
    `,
    config: {
      tools: [{ googleSearch: {} }],
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
    console.error('JSON 파싱 실패:', rawText.slice(0, 500));
    throw new Error('블로그 콘텐츠 파싱에 실패했습니다. 다시 시도해 주세요.');
  }
}

// ─── 이미지 생성 ──────────────────────────────────────────────────────────
export async function generateImage(prompt: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",  // ✅ 이미지 생성 모델
    contents: { parts: [{ text: prompt }] },
    config: {
      responseModalities: ["IMAGE", "TEXT"],
      imageConfig: { aspectRatio: "1:1" }
    }
  });

  const candidate = response.candidates?.[0];
  if (!candidate) throw new Error("이미지 생성 응답이 없습니다.");

  for (const part of candidate.content?.parts || []) {
    if (part.inlineData?.data) {
      const mimeType = part.inlineData.mimeType || 'image/png';
      return `data:${mimeType};base64,${part.inlineData.data}`;
    }
  }

  const finishReason = candidate.finishReason;
  if (finishReason && finishReason !== 'STOP') {
    throw new Error(`이미지 생성 차단됨: ${finishReason}`);
  }
  throw new Error("이미지 데이터를 찾을 수 없습니다.");
}
