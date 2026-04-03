// ✅ 클라이언트는 Gemini를 직접 호출하지 않음
// 모든 AI 호출은 /api/ai/generate (서버 Gateway)를 통해 처리

export interface BlogContent {
  title: string;
  content: string;
  imagePrompts: string[];
}

// ─── Gateway 호출 헬퍼 ─────────────────────────────────────────────────────
async function callGateway(body: {
  task: string;
  input: string;
  options?: { quality?: 'fast' | 'balanced' | 'high'; jsonMode?: boolean; };
}) {
  const res = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '알 수 없는 오류' }));
    throw new Error(err.error || `Gateway 오류: ${res.status}`);
  }

  return res.json();
}

// ─── 블로그 콘텐츠 생성 ────────────────────────────────────────────────────
export async function generateBlogContent(
  proposalText: string,
  authorName: string,
  thumbnailTitle: string
): Promise<BlogContent> {

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
10. 이미지 프롬프트 6개 (영어, 텍스트 없는 이미지):
   - 이미지1: Dark purple background, modern tech abstract, no text, neon purple accents
   - 이미지2: Clean white background, soft orange geometric shapes, no text, minimalist
   - 이미지3: Korean corporate training scene, office workers 35-50, documentary style
   - 이미지4: Small group workshop, Korean professionals, natural lighting, collaborative
   - 이미지5: Flat minimal process diagram, white background, no text, soft colors
   - 이미지6: Korean professional reviewing notes, clean desk, soft daylight
11. 보안: 예산/개인이름/연락처 → 강사님 등으로 대체.
12. 썸네일 타이틀 "${thumbnailTitle}"은 이미지에 넣지 말 것.

[출력 형식]
반드시 순수 JSON만 반환 (마크다운 블록 없이):
{"title":"블로그 제목","content":"마크다운 형식의 블로그 본문","imagePrompts":["prompt1","prompt2","prompt3","prompt4","prompt5","prompt6"]}`;

  const result = await callGateway({
    task: 'blog',
    input: prompt,
    options: { quality: 'high', jsonMode: true }
  });

  const rawText = (result.text || '').trim();
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
  const result = await callGateway({ task: 'image', input: prompt });
  if (!result.imageData) throw new Error('이미지 데이터가 없습니다.');
  return result.imageData;
}
