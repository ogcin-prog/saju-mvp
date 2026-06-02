// ─────────────────────────────────────────────────────────────
//  사주 엔진 래퍼
//  - 8글자: @fullstackfamily/manseryeok (KASI 데이터, 진태양시 보정) 로 정확 계산
//  - 오행 분포 / 십신: 확정 매핑으로 코드 도출 (계산 오류 없음)
// ─────────────────────────────────────────────────────────────
import { calculateSaju } from '@fullstackfamily/manseryeok';

// 천간 → { 오행, 음양(true=양) }
const STEM = {
  '甲':{el:'목',yang:true},  '乙':{el:'목',yang:false},
  '丙':{el:'화',yang:true},  '丁':{el:'화',yang:false},
  '戊':{el:'토',yang:true},  '己':{el:'토',yang:false},
  '庚':{el:'금',yang:true},  '辛':{el:'금',yang:false},
  '壬':{el:'수',yang:true},  '癸':{el:'수',yang:false},
};
// 지지 → { 오행, 정기(본기 천간) }  (십신은 정기 천간 기준)
const BRANCH = {
  '子':{el:'수',main:'癸'}, '丑':{el:'토',main:'己'},
  '寅':{el:'목',main:'甲'}, '卯':{el:'목',main:'乙'},
  '辰':{el:'토',main:'戊'}, '巳':{el:'화',main:'丙'},
  '午':{el:'화',main:'丁'}, '未':{el:'토',main:'己'},
  '申':{el:'금',main:'庚'}, '酉':{el:'금',main:'辛'},
  '戌':{el:'토',main:'戊'}, '亥':{el:'수',main:'壬'},
};
// 한글 지지 라벨
const BRANCH_KR = {'子':'자','丑':'축','寅':'인','卯':'묘','辰':'진','巳':'사','午':'오','未':'미','申':'신','酉':'유','戌':'술','亥':'해'};
const STEM_KR   = {'甲':'갑','乙':'을','丙':'병','丁':'정','戊':'무','己':'기','庚':'경','辛':'신','壬':'임','癸':'계'};

const GEN  = {목:'화',화:'토',토:'금',금:'수',수:'목'};   // 생(生)
const CTRL = {목:'토',화:'금',토:'수',금:'목',수:'화'};   // 극(剋)

// 일간 기준으로 대상 천간의 십신 계산
function tenGod(dmStem, targetStem){
  const dm = STEM[dmStem], t = STEM[targetStem];
  const same = dm.yang === t.yang;
  if (t.el === dm.el)         return same ? '비견' : '겁재';
  if (GEN[dm.el] === t.el)    return same ? '식신' : '상관';   // 내가 생함 → 식상
  if (CTRL[dm.el] === t.el)   return same ? '편재' : '정재';   // 내가 극함 → 재성
  if (CTRL[t.el] === dm.el)   return same ? '편관' : '정관';   // 나를 극함 → 관성
  if (GEN[t.el] === dm.el)    return same ? '편인' : '정인';   // 나를 생함 → 인성
  return '?';
}

export function buildSaju({ year, month, day, hour = 12, minute = 0, hourUnknown = false }) {
  const r = calculateSaju(Number(year), Number(month), Number(day), Number(hour), Number(minute));

  // 한자 8글자
  const yH = r.yearPillarHanja,  mH = r.monthPillarHanja,
        dH = r.dayPillarHanja,   hH = r.hourPillarHanja;
  const stems   = [yH[0], mH[0], dH[0], hourUnknown ? null : hH[0]];
  const branches= [yH[1], mH[1], dH[1], hourUnknown ? null : hH[1]];

  const dayStem = dH[0];               // 일간 (나)
  const dayBranch = dH[1];             // 일지

  // 오행 분포 (시주 제외 여부 반영)
  const dist = {목:0,화:0,토:0,금:0,수:0};
  stems.forEach(s => { if(s) dist[STEM[s].el]++; });
  branches.forEach(b => { if(b) dist[BRANCH[b].el]++; });

  // 십신 (일간 제외) — 천간 3~4개 + 지지 정기 4개
  const labels = ['년','월','일','시'];
  const stemGods = stems.map((s,i)=> (!s||i===2) ? null : { 위치:labels[i], 글자:STEM_KR[s], 십신:tenGod(dayStem,s) }).filter(Boolean);
  const branchGods = branches.map((b,i)=> !b ? null : { 위치:labels[i], 글자:BRANCH_KR[b], 십신:tenGod(dayStem,BRANCH[b].main) }).filter(Boolean);

  return {
    pillars: {
      년주:{hanja:yH, hangul:r.yearPillar},
      월주:{hanja:mH, hangul:r.monthPillar},
      일주:{hanja:dH, hangul:r.dayPillar},
      시주: hourUnknown ? null : {hanja:hH, hangul:r.hourPillar},
    },
    일간:{hanja:dayStem, hangul:STEM_KR[dayStem], 오행:STEM[dayStem].el, 음양:STEM[dayStem].yang?'양':'음'},
    일지:{hanja:dayBranch, hangul:BRANCH_KR[dayBranch], 오행:BRANCH[dayBranch].el},
    오행분포: dist,
    십신_천간: stemGods,
    십신_지지: branchGods,
    시간보정: r.isTimeCorrected ? r.correctedTime : null,
    시간모름: hourUnknown,
  };
}
