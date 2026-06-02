// ─────────────────────────────────────────────────────────────
//  /api/reading  — 서버리스 함수
//  요청 body: { year, month, day, hour, minute, hourUnknown, gender, name, section }
//  section: 'profile' | '총운' | '연애운' | '결혼운' | '금전운' | '직업운' | '건강운'
//  - 8글자/오행/십신은 코드로 계산(_saju.js)
//  - Gemini는 "해석"만 수행. 모델은 가용 Flash 모델을 자동 탐지.
//  ※ 실제 API 키는 코드에 없음 → Vercel 환경변수 GEMINI_API_KEY 로 주입
// ─────────────────────────────────────────────────────────────
import { buildSaju } from './_saju.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
let CACHED_MODEL = null; // 웜 인스턴스에서 1회만 탐지

// 사용 가능한 Flash 계열 모델 자동 선택 (시기에 따라 모델명이 달라지는 문제 회피)
async function pickModel(key) {
  if (CACHED_MODEL) return CACHED_MODEL;
  try {
    const res = await fetch(`${GEMINI_BASE}/models?key=${key}&pageSize=200`);
    const data = await res.json();
    const models = (data.models || []).filter(
      (m) => (m.supportedGenerationMethods || []).includes('generateContent')
    );
    const names = models.map((m) => m.name); // 예: "models/gemini-2.5-flash"
    const score = (n) => {
      const s = n.toLowerCase();
      if (!s.includes('flash')) return -1;       // Flash 계열만
      if (s.includes('image') || s.includes('tts') || s.includes('audio') || s.includes('live')) return -1;
      let pts = 10;
      const mv = s.match(/gemini-(\d+(?:\.\d+)?)/); // 버전 높을수록 우대
      if (mv) pts += parseFloat(mv[1]) * 5;
      if (s.includes('lite')) pts += 3;           // lite(저렴/빠름) 약간 우대
      if (s.includes('latest')) pts += 2;
      if (s.includes('preview') || s.includes('exp')) pts -= 1;
      return pts;
    };
    const best = names.filter((n) => score(n) > 0).sort((a, b) => score(b) - score(a))[0];
    CACHED_MODEL = best || 'models/gemini-2.5-flash';
  } catch {
    CACHED_MODEL = 'models/gemini-2.5-flash';
  }
  return CACHED_MODEL;
}

// ── 사주 데이터를 모델이 읽을 텍스트로 ──
function sajuContext(s) {
  const p = s.pillars;
  const line = (k, v) => (v ? `${k} ${v.hangul}(${v.hanja})` : `${k} (시간 모름)`);
  const dist = Object.entries(s.오행분포).map(([k, v]) => `${k}${v}`).join(' · ');
  const stemGods = s.십신_천간.map((g) => `${g.위치}간 ${g.글자}=${g.십신}`).join(', ');
  const branchGods = s.십신_지지.map((g) => `${g.위치}지 ${g.글자}=${g.십신}`).join(', ');
  return [
    `사주팔자: ${line('년주', p.년주)} / ${line('월주', p.월주)} / ${line('일주', p.일주)} / ${line('시주', p.시주)}`,
    `일간(나): ${s.일간.hangul}${s.일간.hanja} — ${s.일간.오행}(${s.일간.음양})`,
    `일지: ${s.일지.hangul}${s.일지.hanja}(${s.일지.오행})`,
    `오행 분포(많을수록 강함): ${dist}`,
    `십신(천간): ${stemGods || '없음'}`,
    `십신(지지 정기): ${branchGods || '없음'}`,
    s.시간모름 ? `※ 태어난 시간 모름 → 시주/시간 기반 해석은 생략.` : ``,
  ].filter(Boolean).join('\n');
}

const SYSTEM = `너는 한국 명리학(사주팔자)에 정통한 상담가다. 아래 '재미로 보는' 콘텐츠를 작성한다.
규칙:
- 주어진 사주 데이터(8글자·일간·오행·십신)는 이미 정확히 계산된 것이다. 다시 계산하지 말고 그대로 해석만 하라.
- 일간과 십신, 오행 강약을 근거로 "어, 이거 진짜 나네" 싶은 구체적 묘사를 하라. 두루뭉술 금지.
- 명리 용어(정관·편재·식신 등)는 쓰되, 처음 나올 때 괄호로 아주 짧게 뜻을 곁들여라.
- 말투는 친근한 반존대(~해요체). 운명론·단정·불안 조장 금지. 긍정적이되 솔직하게.
- 분량은 짧게. 모바일에서 서서 읽는 상황이다.
- 마크다운 제목/불릿 쓰지 말고 자연스러운 문단으로.`;

const SECTION_PROMPT = {
  profile: `[이 사람의 기본 성향]을 4~6문장으로. 일간이 상징하는 기질 → 오행 균형으로 본 강점과 약점 → 전체적인 첫인상/매력 순서. 마지막은 한 문장으로 가볍게 마무리.`,
  총운: `[요즘~앞으로의 큰 흐름(총운)]을 4~5문장으로. 지금 두드러지는 기운 1가지, 살리면 좋은 강점 1가지, 조심할 점 1가지, 짧은 조언 1줄.`,
  연애운: `[연애운]을 4~5문장으로. 이 사람의 연애 스타일, 끌리거나 잘 맞는 상대 유형, 요즘 인연의 흐름.`,
  결혼운: `[결혼운]을 4~5문장으로. 결혼에 어울리는 태도와 시기 경향, 배우자 상, 결혼 생활이 안정되는 포인트. 현실적으로.`,
  금전운: `[금전운]을 4~5문장으로. 돈을 버는 방식(월급형/사업형/전문직형 등 중 무엇에 가까운지), 재물의 흐름, 조심할 소비·투자 패턴 1가지.`,
  직업운: `[직업운]을 4~5문장으로. 타고난 직업 적성과 잘 맞는 일하는 방식, 강해지는 분야, 커리어가 풀리는 흐름.`,
  건강운: `[건강운]을 4~5문장으로. 체질적으로 신경 쓰면 좋은 부위나 컨디션 경향, 생활습관 팁. ※ 의학적 진단·병명 단정은 절대 하지 말고 '경향'으로만.`,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { year, month, day, hour, minute, hourUnknown, gender, name, section = 'profile' } = body;

    if (!year || !month || !day) {
      res.status(400).json({ error: '생년월일(year, month, day)은 필수입니다.' });
      return;
    }
    if (!SECTION_PROMPT[section]) {
      res.status(400).json({ error: `알 수 없는 항목: ${section}` });
      return;
    }

    const saju = buildSaju({ year, month, day, hour, minute, hourUnknown: !!hourUnknown });

    const who = [name ? `이름: ${name}` : '', gender ? `성별: ${gender}` : ''].filter(Boolean).join(' / ');
    const prompt = `${SYSTEM}

${who ? who + '\n' : ''}${sajuContext(saju)}

요청: ${SECTION_PROMPT[section]}`;

    const model = await pickModel(key);
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${key}`;
    const gRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 900, topP: 0.95 },
      }),
    });

    if (!gRes.ok) {
      const errText = await gRes.text();
      // 모델 문제일 수 있으니 캐시 비우고 1회 재시도
      CACHED_MODEL = null;
      res.status(502).json({ error: `Gemini 오류 (${gRes.status}). 모델: ${model}`, detail: errText.slice(0, 500) });
      return;
    }

    const data = await gRes.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('')
      .trim();

    // 관심도 측정용 간단 로그 (Vercel 런타임 로그에서 확인)
    console.log(`[reading] section=${section} model=${model} ok len=${text.length}`);

    res.status(200).json({
      section,
      text: text || '결과를 불러오지 못했어요. 다시 시도해 주세요.',
      saju: {
        pillars: saju.pillars,
        일간: saju.일간,
        오행분포: saju.오행분포,
        시간보정: saju.시간보정,
        시간모름: saju.시간모름,
      },
    });
  } catch (e) {
    console.error('[reading] error', e);
    res.status(500).json({ error: '서버 오류', detail: String(e?.message || e) });
  }
}
