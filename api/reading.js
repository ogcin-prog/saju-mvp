// ─────────────────────────────────────────────────────────────
//  /api/reading  — 서버리스 함수 (v2)
//  body: { year, month, day, hour, minute, hourUnknown, gender, name, relation, section, partner }
//  section: 'profile' | '이번달운세' | '총운' | '연애운' | '결혼운' | '금전운' | '직업운' | '건강운' | '궁합'
//  partner(궁합 전용): { year, month, day, hour, minute, hourUnknown }
// ─────────────────────────────────────────────────────────────
import { buildSaju, pairAnalysis } from './_saju.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
let CACHED_MODEL = null;

// ── 사용량 카운터 (Vercel KV / Upstash REST 사용, 미연결 시 자동 skip) ──
function kvCreds() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    tok: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}
async function redisPipe(cmds) {
  const { url, tok } = kvCreds();
  if (!url || !tok) return null;
  try {
    const r = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
    });
    return await r.json();
  } catch { return null; }
}
async function countHit(section) {
  // profile = '사주 조회 시작', 그 외 = 항목별 클릭 + 총 풀이수
  if (section === 'profile') return redisPipe([['HINCRBY', 'saju:counts', 'starts', 1]]);
  return redisPipe([
    ['HINCRBY', 'saju:counts', section, 1],
    ['HINCRBY', 'saju:counts', 'readings', 1],
  ]);
}

async function pickModel(key) {
  if (CACHED_MODEL) return CACHED_MODEL;
  try {
    const res = await fetch(`${GEMINI_BASE}/models?key=${key}&pageSize=200`);
    const data = await res.json();
    const names = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name);
    const score = (n) => {
      const s = n.toLowerCase();
      if (!s.includes('flash')) return -1;
      if (s.includes('image') || s.includes('tts') || s.includes('audio') || s.includes('live')) return -1;
      let pts = 10;
      const mv = s.match(/gemini-(\d+(?:\.\d+)?)/);
      if (mv) pts += parseFloat(mv[1]) * 5;
      if (s.includes('lite')) pts += 3;
      if (s.includes('latest')) pts += 2;
      if (s.includes('preview') || s.includes('exp')) pts -= 1;
      return pts;
    };
    CACHED_MODEL = names.filter((n) => score(n) > 0).sort((a, b) => score(b) - score(a))[0] || 'models/gemini-2.5-flash';
  } catch {
    CACHED_MODEL = 'models/gemini-2.5-flash';
  }
  return CACHED_MODEL;
}

// 한 사람의 사주를 텍스트로
function sajuContext(s, who = '') {
  const p = s.pillars;
  const line = (k, v) => (v ? `${k} ${v.hangul}(${v.hanja})` : `${k}(시간모름)`);
  const dist = Object.entries(s.오행분포).map(([k, v]) => `${k}${v}`).join(' ');
  const sg = s.십신_천간.map((g) => `${g.위치}간 ${g.글자}=${g.십신}`).join(', ');
  const bg = s.십신_지지.map((g) => `${g.위치}지 ${g.글자}=${g.십신}`).join(', ');
  return [
    who ? `■ ${who}` : '',
    `사주: ${line('년', p.년주)} / ${line('월', p.월주)} / ${line('일', p.일주)} / ${line('시', p.시주)}`,
    `일간(나): ${s.일간.hangul}${s.일간.hanja}(${s.일간.오행}·${s.일간.음양}) / 일지: ${s.일지.hangul}${s.일지.hanja}`,
    `오행 분포(클수록 강함): ${dist}`,
    `십신 천간: ${sg || '-'} / 십신 지지: ${bg || '-'}`,
    s.시간모름 ? `※ 태어난 시간 모름 → 시 기반 해석 생략` : '',
  ].filter(Boolean).join('\n');
}

// ── 행사 제공 음료 11종 (오행/분위기 태그) ──
const DRINKS = `[행사 제공 음료 11종 — 이 풀이 '내용'에 가장 어울리는 딱 하나를 골라 마무리에 추천]
· 핑크블러셔 (좋은데이+암바사+홍초) — 핑크빛 새콤달콤 디저트 술. 설렘·연애·따뜻한 감정, 화(火) 기운 보충.
· 사랑과 재채기 (좋은데이+후추) — 알싸하게 정신 번쩍. 답답함을 깨거나 과감한 결단·변화·자극이 필요할 때.
· 탕비실 녹차 (좋은데이+녹차티백) — 은은하고 차분한 녹차향. 마음 가라앉히고 정리·휴식·번아웃 회복이 필요할 때.
· 나야 참기름 (좋은데이+참기름+소금) — 고소하고 든든. 실속·재물·안정, 현실감각이 키워드일 때.
· 전남친 한입소맥 (좋은데이+블루문) — 부드럽게 섞이는 한입 소맥. 사람·인연·관계가 주제일 때(특히 둘이서).
· 윤정아 (좋은데이+암바사+뿌요소다) — 톡톡 튀는 추억의 소다맛. 즐겁게 놀고 텐션 올릴 때, 친구·추억.
· 요즘 애들 레시피 (톡소다 사과+코코팜 포도) — 가볍고 달달한 청량 탄산. 부담 없이 가볍게, 젊고 산뜻한 기운.
· 블루문 왁뿌 (블루문 3단계 코스) — 한 캔으로 세 가지 맛. 새 도전·변화·기회·커리어, 단계적으로 성장할 때.
· 좋은데이(플레인) — 72시간 산소숙성, 깔끔 담백. 기본에 충실·정직·군더더기 없이 갈 때.
· 블루문(플레인) — 시트러스 향 청량한 맥주. 답답함을 시원하게 풀고 리프레시가 필요할 때.
· 톡소다 사과(플레인) — 달콤한 사과향에 톡 쏘는 탄산. 기분 전환·가벼운 활력이 필요할 때.`;

const SYSTEM = `너는 한국 명리학(사주팔자)에 빠삭한 사주 상담가야. 술자리/행사에서 사람들한테 재미로 봐주는 콘텐츠를 쓴다.

[말투]
- 친근한 해요체. 옆에서 말 걸듯 자연스럽고 살짝 위트 있게. 가벼운 감탄이나 농담 섞어도 좋아.
- 단, 오글거리거나 전형적인 'AI 말투'는 절대 금지. ("~하는 당신은 특별한 사람이에요", "결론적으로", "~인 셈이죠", "무엇보다", 과한 미사여구·상투구 쓰지 마.)
- 명리 용어(정관·편재·식신 등)는 그대로 써서 전문성은 살리되, 처음 나올 때만 괄호로 짧게 풀어줘.
- 운명론·불안 조장 금지. 단점도 솔직하게, 대신 밉지 않게 농담처럼 짚어줘.

[형식 — 중요]
- 반드시 2~3개의 짧은 문단으로 나눠 쓰고, 문단 사이는 빈 줄(엔터 두 번)로 띄워. 절대 한 덩어리로 주르륵 쓰지 마.
- 모바일에서 서서 읽어. 문단당 2~3문장으로 짧게.

[마무리 — 무학 음료 추천]
- 맨 마지막 문단은 위 음료 11종 중 '딱 하나'를 골라 추천하는 한두 문장으로 끝내.
- 고르는 기준(가장 중요): 방금 네가 쓴 이 풀이의 '상황·분위기·예측 내용'에 가장 잘 어울리는 술로 골라. (예: 도전·기회·커리어 얘기 → 블루문 왁뿌, 돈·실속 → 나야 참기름, 사람·관계 → 전남친 한입소맥, 휴식·정리·스트레스 → 탕비실 녹차, 즐겁게 놀기 → 윤정아.)
- 부족한 오행을 채우는 건 여러 근거 중 '하나'일 뿐이야. 매번 같은 술(특히 핑크블러셔)로만 귀결되지 않게, 풀이의 종류와 내용에 맞춰 다양하게 골라.
- 음료의 '실제 이름'을 쓰고 키치하고 재밌게. 술을 강요하지 말고 '오늘 이 자리에 어울리는 한 잔' 느낌으로.
- ★중요 형식: 이 '음료를 추천하는 문장'은 반드시 양쪽을 별표 두 개로 감싸서 **이렇게** 굵게 표시해. (추천 문장 전체를 **로 감싼다. 다른 일반 문장에는 별표를 쓰지 마.)`;

const SECTION_PROMPT = {
  profile: `이 사람의 '기본 성향'을 풀어줘. 일간이 어떤 캐릭터인지 → 오행 균형으로 본 강점과 은근한 약점 → 사람들이 느끼는 첫인상·매력 순서로. 마지막 문단은 음료 추천.`,
  총운: `이 사람의 '총운(전체적인 큰 흐름)'을 풀어줘. 지금 두드러지는 기운, 살리면 좋은 강점, 조심할 점, 짧은 행동 팁. 마지막 문단은 음료 추천.`,
  연애운: `이 사람의 '연애운'을 풀어줘. 연애 스타일, 잘 맞는 상대 유형, 요즘 인연의 흐름. 마지막 문단은 음료 추천.`,
  결혼운: `이 사람의 '결혼운'을 현실적으로 풀어줘. 결혼에 어울리는 태도와 시기 경향, 배우자 상, 결혼 생활이 안정되는 포인트. 마지막 문단은 음료 추천.`,
  금전운: `이 사람의 '금전운'을 풀어줘. 돈 버는 방식(월급형/사업형/전문직형 등 중 무엇에 가까운지), 재물의 흐름, 조심할 소비·투자 1가지. 마지막 문단은 음료 추천.`,
  직업운: `이 사람의 '직업운'을 풀어줘. 타고난 직업 적성, 잘 맞는 일하는 방식, 강해지는 분야. 마지막 문단은 음료 추천.`,
  건강운: `이 사람의 '건강운'을 풀어줘. 체질적으로 신경 쓰면 좋은 부위나 컨디션 경향, 생활습관 팁. ※의학적 진단·병명 단정은 절대 하지 말고 '경향'으로만. 마지막 문단은 음료 추천.`,
};

function buildPrompt(section, saju, extra) {
  // 이번달운세
  if (section === '이번달운세') {
    const inst = `이 사람의 '${extra.monthLabel} 운세'를 풀어줘. 아래 '현재 운'이 타고난 원국과 어떻게 맞물리는지를 근거로: ①이번 달 전체 분위기 ②다가오는 기회나 잘 풀릴 일 ③조심할 것(돈·관계·건강·말실수 등 구체적으로) ④이번 달 한 줄 행동 팁. 마지막 문단은 음료 추천.`;
    return `${SYSTEM}

${sajuContext(saju)}

[현재 운] ${extra.luck}

${DRINKS}

요청: ${inst}`;
  }
  // 궁합
  if (section === '궁합') {
    const rel = extra.relation ? `두 사람 관계: ${extra.relation}` : '두 사람 관계: 미지정';
    const inst = `'본인'과 '상대'의 궁합을 재밌게 풀어줘. 아래 '궁합 힌트'(천간합·육합·충·오행 보완)를 근거로: ①첫인상으로 본 두 사람 케미 ②잘 맞는 점 ③부딪히기 쉬운 점(밉지 않게) ④이 관계를 좋게 만드는 팁. ${extra.relation === '친구' || extra.relation === '동료' ? '연애보다 우정/케미 관점으로.' : '관계 성격에 맞게.'} 마지막 문단은 '둘이 같이 마시기 좋은' 음료 한 잔 추천으로 끝내(혼자 말고 둘이서).`;
    return `${SYSTEM}

${rel}
${sajuContext(saju, '본인')}

${sajuContext(extra.partner, '상대')}

[궁합 힌트]
${extra.hint}

${DRINKS}

요청: ${inst}`;
  }
  // 일반
  return `${SYSTEM}

${extra.who ? extra.who + '\n' : ''}${sajuContext(saju)}

${DRINKS}

요청: ${SECTION_PROMPT[section]}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const key = process.env.GEMINI_API_KEY;
  if (!key) { res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { year, month, day, hour, minute, hourUnknown, gender, name, relation, section = 'profile', partner } = body;

    if (!year || !month || !day) { res.status(400).json({ error: '생년월일(year, month, day)은 필수입니다.' }); return; }
    const ALLOWED = ['profile','이번달운세','총운','연애운','결혼운','금전운','직업운','건강운','궁합'];
    if (!ALLOWED.includes(section)) { res.status(400).json({ error: `알 수 없는 항목: ${section}` }); return; }

    const saju = buildSaju({ year, month, day, hour, minute, hourUnknown: !!hourUnknown });
    const extra = { who: [name ? `이름: ${name}` : '', gender ? `성별: ${gender}` : ''].filter(Boolean).join(' / ') };

    let partnerSaju = null;
    if (section === '궁합') {
      if (!partner || !partner.year || !partner.month || !partner.day) {
        res.status(400).json({ error: '궁합을 보려면 상대방의 생년월일이 필요합니다.' }); return;
      }
      partnerSaju = buildSaju({ year: partner.year, month: partner.month, day: partner.day, hour: partner.hour, minute: partner.minute, hourUnknown: !!partner.hourUnknown });
      extra.partner = partnerSaju;
      extra.relation = relation || '';
      extra.hint = pairAnalysis(saju, partnerSaju);
    }
    if (section === '이번달운세') {
      const kst = new Date(Date.now() + 9 * 3600 * 1000);
      const Y = kst.getUTCFullYear(), M = kst.getUTCMonth() + 1, D = kst.getUTCDate();
      extra.monthLabel = `${M}월`;
      const cur = buildSaju({ year: Y, month: M, day: D });
      extra.luck = `${Y}년 세운 ${cur.pillars.년주.hangul}(${cur.pillars.년주.hanja}) · 이번 달 월운 ${cur.pillars.월주.hangul}(${cur.pillars.월주.hanja})`;
    }

    const prompt = buildPrompt(section, saju, extra);
    const model = await pickModel(key);
    const gRes = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.92, maxOutputTokens: 1100, topP: 0.95 },
      }),
    });
    if (!gRes.ok) {
      const errText = await gRes.text(); CACHED_MODEL = null;
      res.status(502).json({ error: `Gemini 오류 (${gRes.status}). 모델: ${model}`, detail: errText.slice(0, 500) }); return;
    }
    const data = await gRes.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    console.log(`[reading] section=${section} model=${model} len=${text.length}`);

    await countHit(section).catch(() => {}); // 집계 (실패해도 무시)

    const out = {
      section,
      text: text || '결과를 불러오지 못했어요. 다시 시도해 주세요.',
      saju: { pillars: saju.pillars, 일간: saju.일간, 오행분포: saju.오행분포, 시간보정: saju.시간보정, 시간모름: saju.시간모름 },
    };
    if (partnerSaju) out.partner = { 일간: partnerSaju.일간, pillars: partnerSaju.pillars, 시간모름: partnerSaju.시간모름 };
    res.status(200).json(out);
  } catch (e) {
    console.error('[reading] error', e);
    res.status(500).json({ error: '서버 오류', detail: String(e?.message || e) });
  }
}
