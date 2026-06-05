// ─────────────────────────────────────────────────────────────
//  /api/stats — 사용량 대시보드 (관리자용)
//  접속: https://<배포주소>/api/stats?key=<STATS_KEY>
//  - STATS_KEY 환경변수가 있으면 ?key= 가 일치해야 열람 가능(없으면 공개)
//  - 집계는 reading.js가 Vercel KV(Upstash)에 쌓은 saju:counts 해시를 읽음
// ─────────────────────────────────────────────────────────────
function kvCreds() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    tok: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

const SECTIONS = ['이번달운세', '총운', '연애운', '결혼운', '금전운', '직업운', '건강운', '궁합'];
const LABEL = { 이번달운세: '이번 달 운세' };

export default async function handler(req, res) {
  // 간단 접근 제어
  const need = process.env.STATS_KEY;
  const got = (req.query && (req.query.key || req.query.k)) || '';
  if (need && got !== need) {
    res.status(401).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send('<meta charset="utf-8"><body style="font-family:sans-serif;padding:40px">접근 권한이 없어요. 주소 끝에 <b>?key=설정한값</b> 을 붙여주세요.</body>');
    return;
  }

  const { url, tok } = kvCreds();
  let obj = {}, connected = false, errMsg = '';
  if (url && tok) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['HGETALL', 'saju:counts']),
      });
      const j = await r.json();
      const arr = j.result;
      if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) obj[arr[i]] = Number(arr[i + 1]) || 0;
      connected = true;
    } catch (e) { errMsg = String(e?.message || e); }
  }

  const starts = obj.starts || 0;
  const readings = obj.readings || 0;
  const rows = SECTIONS.map((s) => ({ key: s, label: LABEL[s] || s, n: obj[s] || 0 }))
    .sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...rows.map((r) => r.n));
  const totalClicks = rows.reduce((a, r) => a + r.n, 0);

  const bar = (r, i) => `
    <div class="row">
      <div class="rank">${i + 1}</div>
      <div class="lab">${r.label}</div>
      <div class="track"><div class="fill" style="width:${(r.n / max) * 100}%"></div></div>
      <div class="num">${r.n.toLocaleString()}<span class="pct">${totalClicks ? Math.round((r.n / totalClicks) * 100) : 0}%</span></div>
    </div>`;

  const notConnected = `<div class="warn">아직 집계 저장소(Vercel KV)가 연결되지 않았어요.<br>Vercel 프로젝트 → <b>Storage → Create Database → KV</b> 를 만들어 이 프로젝트에 연결하면 이 화면에 숫자가 쌓입니다.</div>`;

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>사주풀이 집계</title><style>
  :root{--navy:#003087;--blue:#004ea8;--bg:#eef1f7;--card:#fff;--ink:#1c1c1a;--sub:#5f6b7a;--line:#dce2ec;}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard",sans-serif;padding:26px 16px 60px;}
  .wrap{max-width:560px;margin:0 auto}
  h1{font-size:21px;color:var(--navy);margin:0 0 2px} .sub{color:var(--sub);font-size:12.5px;margin-bottom:18px}
  .kpis{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px}
  .kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
  .kpi .k{font-size:12px;color:var(--sub);font-weight:700} .kpi .v{font-size:30px;font-weight:800;color:var(--navy);margin-top:4px}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
  .panel h2{font-size:14px;margin:0 0 14px;color:var(--ink)}
  .row{display:flex;align-items:center;gap:10px;margin:9px 0}
  .rank{width:18px;color:var(--sub);font-size:12px;font-weight:700;text-align:center}
  .lab{width:88px;font-size:13.5px;font-weight:700}
  .track{flex:1;background:#eef1f7;border-radius:7px;height:14px;overflow:hidden}
  .fill{height:100%;background:linear-gradient(90deg,var(--navy),var(--blue));border-radius:7px}
  .num{width:74px;text-align:right;font-size:13.5px;font-weight:800;color:var(--navy)}
  .num .pct{color:var(--sub);font-weight:600;font-size:11px;margin-left:5px}
  .warn{background:#fff7ed;border:1px solid #f3d9b5;color:#8a5a1a;border-radius:12px;padding:16px;font-size:13.5px;line-height:1.6}
  .foot{color:var(--sub);font-size:11.5px;margin-top:16px;text-align:center}
  .btn{display:inline-block;margin-top:14px;background:var(--navy);color:#fff;border:none;border-radius:10px;
    padding:10px 16px;font-size:13px;font-weight:700;cursor:pointer;text-decoration:none}
</style></head><body><div class="wrap">
  <h1>🍶 야장하기 좋은데이 사주풀이 — 집계</h1>
  <div class="sub">실시간 사용량 · ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 기준</div>

  <div class="kpis">
    <div class="kpi"><div class="k">사주 조회 시작</div><div class="v">${starts.toLocaleString()}<span style="font-size:14px;color:var(--sub);font-weight:600">명</span></div></div>
    <div class="kpi"><div class="k">총 운세 풀이</div><div class="v">${readings.toLocaleString()}<span style="font-size:14px;color:var(--sub);font-weight:600">회</span></div></div>
  </div>

  <div class="panel">
    <h2>인기 항목 순위</h2>
    ${connected ? rows.map(bar).join('') : notConnected}
    ${connected && errMsg ? `<div class="warn">오류: ${errMsg}</div>` : ''}
  </div>

  <div style="text-align:center"><a class="btn" href="javascript:location.reload()">새로고침</a></div>
  <div class="foot">한 명이 시작(시작=${starts})하면 평균 ${starts ? (totalClicks / starts).toFixed(1) : 0}개 항목을 눌러봤어요.</div>
</div></body></html>`;

  res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}
