// ─────────────────────────────────────────────────────────────────────────────
// veto.ts — 문장이 판정하면 안 되는 상태를 말하고 있는지 먼저 본다.
//
// 값을 고르는 규칙(parse-observation.ts)은 "남은 수가 측정값 하나인가"를 본다. 그런데 남은 수가
// 하나여도 문장이 그 수로 판정하면 안 된다고 말하는 경우가 있다.
//   어림한 수     "공기량이 4점 몇이라고 들었는데 정확한 숫자가 기억나지 않습니다"
//   다른 단위계   "압축강도(kgf/㎠) 245 252 239" — 기준은 MPa 다
//   판정 재령 밖  "7일 강도는 19.6MPa" — 압축강도 판정은 지정 재령(보통 28일)의 시험값으로 한다
//   기준 밖 대상  "보조기층 다짐도는 96.5%" — 이 기준은 노상·노체만 다룬다
//   번호로 먹힌 값 "오후 차량 0.27 kg/㎥" — 단위가 붙은 측정값을 차량 번호 칸으로 읽어 지움
//   견준 말·가정  "지난 차보다 20mm 높게" · "10mm만 덜 나왔어도" — 수가 차이·가정일 수 있음
//   조건 충돌     "주문서엔 25-24-150, 납품서엔 25-24-180" — 어느 조건으로 볼지 정할 수 없음
//   이번 값 아님  "옆 공구 96% 나왔다는데 우리 쪽은 아직" · "지난번엔 6.4%였는데"
// 이런 신호가 있으면 판정하지 않고 되묻는다. 신호를 못 알아보면 원래 규칙대로 가므로, 이 단계는
// 틀린 판정을 되묻기로 바꿀 뿐 판정을 새로 만들지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

import { stripNonMeasurements, swallowedMeasuredValues } from './parse-observation.js';

// ───── 상수 ─────
/** 어림한 수·기억나지 않는 수 — 측정값이 아니다 */
const VAGUE_VALUE_RES: readonly RegExp[] = [
  /\d+\s*점\s*몇/u, // "4점 몇"
  /\d+\s*점\s*대(?![가-힣])/u, // "4점대"
  /\d+\s*(?:점\s*)?대\s*(?:초반|중반|후반)/u, // "150대 초반"
  /(?:대략|얼추|대충|어림잡아|어림해서)\s*-?\d/u,
  /(?:정확한|정확히)\s*(?:숫자|수치|값|측정값|결과)?[가-힣\s]{0,8}(?:기억|모르|모름|못\s*들|확인\s*(?:못|안)|안\s*나)/u,
  /(?:숫자|수치|값|측정값)(?:가|는|이|은)?\s*(?:기억(?:이)?\s*(?:안|나지)|생각(?:이)?\s*(?:안|나지))/u,
  /\d+(?:\.\d+)?\s*(?:mm|%|MPa|kg\/㎥|℃)?\s*(?:언저리|안팎|남짓|내외|어림)/u, // "6 언저리" · "150 안팎"
  /(?:였|이었|인|일|됐|나왔|찍혔)(?:던)?\s*(?:것|거)\s*같/u, // "6 언저리였던 것 같은데" — 값을 짐작으로 말함
];

/**
 * 다른 무엇과 견준 말 — "지난 차보다 20mm 높게" · "어제 대비 0.05 상승" · "1호차에 비해".
 * 이런 문장의 수는 차이이거나 견준 대상의 값일 수 있다.
 * 기준과 견준 말("기준 150±25mm 대비" · "호칭강도 24MPa 대비" · "최적함수비 대비")은 뺀다 — 견주는 표지 앞 구절에 기준 쪽 말이 있으면 기준과의 비교다.
 */
const COMPARISON_MARK_RE = /(?:보다|대비|에\s*비해|에\s*비하여|와\s*비교해|과\s*비교해)/gu;
/** 견주는 표지 앞에서 보는 범위(글자) — 구절이 끊기면(마침표·쉼표·줄바꿈) 거기까지 */
const COMPARISON_LOOKBACK = 30;
const CRITERION_SIDE_RE = /기준|허용|하한|상한|규정|시방|호칭|지정|설계|목표|규격|범위|한계|최소|최대|관리|최적|배합|요구|규준/u;

/**
 * 이번 측정값이 아직 없거나, 다른 현장·지난번의 값을 말하는 문장 — "우리 현장은 아직 시험 전" · "결과 대기 중" ·
 * "옆 공구 96% 나왔다는데" · "지난번엔 6.4%였는데". 문장의 수는 이번 측정값이 아닐 수 있다.
 */
const NOT_THIS_MEASUREMENT_RES: readonly RegExp[] = [
  // 측정이 아직이라는 말 — 측정·결과를 가리키는 말과 붙은 것만("타설 대기 중" · "28㎥ 예정" · "89%밖에 안 나왔네요" 는 아니다)
  /(?:시험|측정|채취|결과|결과지|성적서)\s*(?:은|는|이|가|도)?\s*(?:아직|대기\s*중|예정|내일|모레|다음\s*(?:주|날)|전(?:입니다|이에요|이고|이라|이라서)?(?![가-힣]))/u,
  /아직\s*(?:시험|측정|채취|결과|안\s*(?:쟀|재|했|나왔|떴)|못\s*(?:쟀|했|떴)|전)/u,
  /(?:우리|이번|저희|여기)\s*(?:현장|쪽|공구|차|구간|동)?\s*(?:은|는|도)?\s*아직/u,
  /(?:안|못)\s*(?:쟀|재었|떴)(?:어요|습니다|다|는데|고|어)/u,
  // 요청·주문한 값 — "슬럼프 170mm로 맞춰서 보내 달라고 요청" · "4.5%로 조정해 주세요".
  // 지정값을 주문했다는 말("호칭 슬럼프 25mm로 주문했고 측정 30mm")은 뺀다 — 앞에 호칭·지정·설계 같은 이름이 붙은 수
  /(?<!(?:호칭|지정|설계|배합|목표|규격|소요)\s*(?:슬럼프|강도|공기량|다짐도)?\s*(?:은|는|을|를|이|가|:)?\s*)(?<![\d.])\d+(?:\.\d+)?\s*(?:mm|%|MPa|kg\/㎥)?\s*(?:으로|로)\s*(?:맞춰|맞추|조정|요청|주문|보내|올려|낮춰|내려|해\s*(?:달라|주세요|줘|주라))/u,
  /(?:다른|옆|타|인근|이웃|저쪽)\s*(?:현장|공구|동|구간|블록|공장|업체|팀)|(?<![A-Za-z])[A-Z]\s*현장|지난번|저번|지난\s*(?:주|달|회|차|번)/u,
];

/** 가정한 일 — "10mm만 덜 나왔어도" · "2만 더 높았으면" · "넘는다면". 이런 문장의 수는 실제 측정값이 아닐 수 있다 */
const HYPOTHETICAL_RE = /(?:었|았|였|했|됐|왔)(?:어도|더라도|더라면|으면|다면)|(?:는다면|ㄴ다면|이라면)(?![가-힣])/u;

/** 레미콘 규격 (굵은골재 최대치수-호칭강도-슬럼프) — 서로 다른 규격이 둘 이상 적혔는지 본다 */
const MIX_CODE_GLOBAL_RE = /(?<![\d.-])(10|13|15|19|20|25|40)\s*-\s*(1[5-9]|[2-9]\d|1\d{2})\s*-\s*(\d{2,3})(?!\d|\s*-\s*\d)/gu;
/** 조건 값의 이름 — 서로 다른 값이 둘 이상이면 어느 조건으로 볼지 정할 수 없다 */
const CONDITION_LABEL_RES: Readonly<Record<string, RegExp>> = {
  statistical_threshold: /(?:호칭\s*강도|fcn|Fcn|f_cn)\s*(?:은|는|이|가|:|=)?\s*(\d+(?:\.\d+)?)/gu,
  tolerance_by_target: /(?:호칭|지정|배합|목표|주문|소요)\s*슬럼프\s*(?:은|는|이|가|을|를|:|=)?\s*(\d+(?:\.\d+)?)/gu,
};
/** 조건 값 뒤에 이어 적은 다른 조건 값 — 앞 값의 단위·괄호 설명 뒤 "/ 27MPa" · "· 180mm" (바로 이어진 것만) */
const ALTERNATE_CONDITION_RE = /^\s*(?:MPa|mm)?\s*(?:[(（][^)）]{0,12}[)）])?\s*[\/·ㆍ]\s*(\d+(?:\.\d+)?)(?=\s*(?:MPa|mm|[(（,]|$))/u;
/** 규격의 몇째 수가 그 조건인가 (2 = 호칭강도, 3 = 슬럼프) */
const MIX_CODE_PART: Readonly<Record<string, number>> = { statistical_threshold: 2, tolerance_by_target: 3 };

/**
 * 기준의 단위와 같은 양을 다른 단위계로 적은 표기 — 환산하지 않는다.
 * (N/mm² 는 MPa 와 같아 표기 고르기에서 MPa 로 바꾼다. cm 는 값을 읽는 단계에서 이미 되묻는다)
 */
const FOREIGN_UNIT_SYSTEMS: Readonly<Record<string, RegExp>> = {
  MPa: /kgf\s*\/\s*(?:㎠|cm\s*2|cm²|cm\^2)|kg\s*\/\s*(?:㎠|cm\s*2|cm²|cm\^2)|kgf\s*\/\s*㎝²|(?<![A-Za-z])psi(?![A-Za-z])|(?<![A-Za-z])ksi(?![A-Za-z])/iu,
  '℃': /℉|°\s*F(?![A-Za-z])|화씨/u,
};

/**
 * 값과 떨어져 남은 칸 이름의 단위 — "측정공기량(%)," · "공기량(%)\t" · 줄 끝의 "슬럼프(mm)".
 * 표를 펴는 단계(linearizeTables)가 이어 붙이지 못한 머리글이다. 이때 값의 칸 위치를 알 수 없다.
 * 이름은 두 글자 이상이고 수에 붙지 않은 것만 — "공시체 3개(MPa)" 는 단위를 밝힌 말이지 칸 이름이 아니다.
 */
const UNLINKED_TABLE_HEADER_RE =
  /(?<![\d가-힣A-Za-z])[가-힣A-Za-z]{2,}\s*[(（]\s*(?:mm|cm|%|MPa|kg\/㎥|kg\/m3|kg\/m³|℃|°C)\s*[)）]\s*(?=[,，|\t]|\r?\n|$)/u;

/** 압축강도 판정의 기본 재령(일) — 설계도서가 다른 재령을 지정하면 그 재령 */
const STANDARD_AGE_DAYS = 28;
/** 재령을 적은 표현 — "재령 7일" · "7일 강도" · "7일차 공시체". "11월 13일 시험" 같은 날짜는 빼려고 앞에 '월'이 오면 재령으로 읽지 않는다 */
const AGE_RES: readonly RegExp[] = [
  /재령\s*[:=]?\s*(\d+)\s*일/gu,
  /(?<!월\s*)(?<![\d.])(\d+)\s*일\s*(?:차\s*)?(?:압축\s*)?(?:강도|공시체|양생\s*강도|파괴|시험값|강도\s*시험)/gu,
];
/** 그 재령이 설계도서가 정한 판정 재령이라고 밝힌 표현 — "지정 재령 56일" · "관리 재령 91일" */
const DESIGNATED_AGE_RE = /(?:지정|관리|설계|기준|판정|품질\s*관리)\s*재령\s*[:=]?\s*(\d+)\s*일/u;

export interface VetoContext {
  /** 기준의 연산자 — 재령 검사는 압축강도(statistical_threshold)에만 한다 */
  operator?: string;
  /** 기준의 단위 */
  unit?: string | null;
  /** 이 기준이 다루지 않는 대상의 이름(기준 노드의 meta.outOfScopeKeywords) */
  outOfScopeKeywords?: readonly string[];
  /** 이 기준이 다루는 대상의 이름(meta.inScopeKeywords) — 값에 더 가까이 붙어 있으면 기준 밖 대상의 값이 아니다 */
  inScopeKeywords?: readonly string[];
}

export interface Veto {
  reason: string;
  neededInput: string;
}

function agesIn(text: string): number[] {
  const ages: number[] = [];
  for (const re of AGE_RES) {
    for (const m of text.matchAll(re)) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0 && n <= 365) ages.push(n);
    }
  }
  return ages;
}

/** 기준이 아닌 무엇(지난 차·어제·다른 회차)과 견준 말이 있는가 */
function comparesWithNonCriterion(text: string): boolean {
  for (const m of text.matchAll(COMPARISON_MARK_RE)) {
    const at = m.index ?? 0;
    const before = text.slice(Math.max(0, at - COMPARISON_LOOKBACK), at);
    const clause = before.split(/[.。!?\n,，;；]/u).pop() ?? '';
    if (!CRITERION_SIDE_RE.test(clause)) return true;
  }
  return false;
}

/** 판정 조건(호칭강도·호칭 슬럼프)이 서로 다르게 둘 이상 적혔으면 그 값들을 돌려준다 */
function conflictingConditions(text: string, operator: string | undefined): { label: string; values: string[] } | null {
  if (!operator) return null;
  const part = MIX_CODE_PART[operator];
  const labelRe = CONDITION_LABEL_RES[operator];
  if (part === undefined || !labelRe) return null;
  const values = new Set<number>();
  for (const m of text.matchAll(MIX_CODE_GLOBAL_RE)) values.add(Number(m[part]));
  for (const m of text.matchAll(labelRe)) {
    values.add(Number(m[1]));
    // 이름 하나 뒤에 빗금·가운뎃점으로 이어 적은 값도 조건 값이다 — "호칭강도 24MPa(지하층) / 27MPa(지상층)"
    let tail = text.slice((m.index ?? 0) + m[0].length);
    for (let alt = tail.match(ALTERNATE_CONDITION_RE); alt; alt = tail.match(ALTERNATE_CONDITION_RE)) {
      values.add(Number(alt[1]));
      tail = tail.slice(alt[0].length);
    }
  }
  if (values.size < 2) return null;
  return {
    label: operator === 'statistical_threshold' ? '호칭강도' : '호칭 슬럼프',
    values: [...values].map(String),
  };
}

/** 판정하면 안 되는 상태면 그 까닭을, 아니면 null 을 돌려준다 */
export function findVeto(text: string, ctx: VetoContext): Veto | null {
  if (typeof text !== 'string' || text.length === 0) return null;

  if (VAGUE_VALUE_RES.some((re) => re.test(text))) {
    return {
      reason: '문장의 수가 어림한 값이거나 정확한 값이 아니라고 적혀 있어 판정하지 않습니다 — 기록지·성적서의 측정값을 그대로 적어 주세요.',
      neededInput: '기록지·성적서에 적힌 측정값',
    };
  }

  if (NOT_THIS_MEASUREMENT_RES.some((re) => re.test(text))) {
    return {
      reason: '문장이 이번 측정값이 아직 없다고 하거나(시험 전·결과 대기), 다른 현장·지난번의 값을 말하고 있어 판정하지 않습니다 — 문장의 수가 이번 측정값이 아닐 수 있습니다. 이번에 잰 값을 적어 주세요.',
      neededInput: '이번에 잰 측정값',
    };
  }

  if (comparesWithNonCriterion(text)) {
    return {
      reason: '문장이 측정값을 다른 값(지난 차·어제·다른 회차 등)과 견주어 말하고 있어 판정하지 않습니다 — 문장의 수가 차이이거나 견준 대상의 값일 수 있습니다. 이번 측정값 하나를 그대로 적어 주세요.',
      neededInput: '이번 측정값 (차이가 아닌 값)',
    };
  }

  if (HYPOTHETICAL_RE.test(text)) {
    return {
      reason: '문장이 가정(만약 ~였으면/~였어도)을 말하고 있어 판정하지 않습니다 — 문장의 수가 실제 측정값이 아닐 수 있습니다. 실제로 나온 측정값을 적어 주세요.',
      neededInput: '실제로 나온 측정값',
    };
  }

  const conflict = conflictingConditions(text, ctx.operator);
  if (conflict) {
    return {
      reason: `문장에 판정 조건(${conflict.label})이 서로 다르게 적혀 있어(${conflict.values.join(' · ')}) 판정하지 않습니다 — 어느 조건으로 보느냐에 따라 결과가 달라질 수 있습니다. 이 측정값에 해당하는 조건 하나를 적어 주세요.`,
      neededInput: `이 측정값의 ${conflict.label} 하나`,
    };
  }

  if (UNLINKED_TABLE_HEADER_RE.test(text)) {
    return {
      reason: '표의 칸 이름(단위가 붙은 이름)과 값을 이어 읽지 못해 판정하지 않습니다 — 머리글 줄과 값 줄의 칸 수가 다르거나 머리글에 다른 글이 섞여 있습니다. "칸 이름 값" 모양으로(예: "측정 공기량 5.3%") 측정값 하나를 적어 주세요.',
      neededInput: '칸 이름을 붙인 측정값 하나',
    };
  }

  const swallowed = swallowedMeasuredValues(text, ctx.unit);
  if (swallowed.length > 0) {
    return {
      reason: `단위(${ctx.unit})가 붙은 수를 번호나 기록의 다른 칸으로 읽은 곳이 있어(${swallowed.join(' · ')}) 판정하지 않습니다 — 그 수가 측정값이면 값 하나를 놓친 채 판정하게 됩니다. 측정값을 하나씩 적어 주세요.`,
      neededInput: '측정값 하나 (번호·다른 칸 값과 떼어 적은 것)',
    };
  }

  const foreign = ctx.unit ? FOREIGN_UNIT_SYSTEMS[ctx.unit] : undefined;
  if (foreign && foreign.test(text)) {
    return {
      reason: `문장의 값이 이 기준의 단위(${ctx.unit})가 아닌 단위계로 적혀 있어 판정하지 않습니다 — 단위를 바꿔 견주지 않습니다. ${ctx.unit} 로 적힌 값을 주세요.`,
      neededInput: `${ctx.unit} 단위의 측정값`,
    };
  }

  if (ctx.operator === 'statistical_threshold') {
    const ages = agesIn(text);
    const designated = text.match(DESIGNATED_AGE_RE);
    const allowed = designated ? Number(designated[1]) : STANDARD_AGE_DAYS;
    const other = ages.filter((a) => a !== allowed);
    if (other.length > 0) {
      return {
        reason: `문장에 판정 재령(${allowed}일${designated ? ', 지정 재령' : ' — 설계도서가 다른 재령을 정했으면 그 재령'})이 아닌 재령(${[...new Set(other)].join('·')}일)의 강도가 있어 판정하지 않습니다 — 압축강도의 합격 판정은 판정 재령의 시험값으로 합니다. 판정 재령의 시험값만 적어 주세요(지정 재령이 다르면 "지정 재령 N일"이라고 함께 적어 주세요).`,
        neededInput: '판정 재령의 압축강도 시험값',
      };
    }
  }

  const outOfScope = valuesLabelledOutOfScope(text, ctx.outOfScopeKeywords ?? [], ctx.inScopeKeywords ?? []);
  if (outOfScope.length > 0) {
    return {
      reason: `측정값이 이 기준이 다루지 않는 대상(${outOfScope.join('·')})의 값으로 적혀 있어 판정하지 않습니다 — 그 대상의 값을 이 기준으로 견주면 틀린 결론이 납니다. 이 기준이 다루는 대상의 값만 적어 주세요.`,
      neededInput: '이 기준이 다루는 대상의 측정값',
    };
  }

  return null;
}

/**
 * 측정값으로 남는 수마다 가장 가까이 붙은 대상 이름을 찾아, 기준 밖 대상의 값이면 그 이름을 돌려준다.
 * 같은 구절(쉼표·마침표·줄바꿈으로 나눈 조각) 안에서 앞쪽의 가장 가까운 이름을 먼저 보고, 앞에 없으면 뒤쪽을 본다.
 *   "보조기층 다짐도는 96.5% 나왔고, 노상은 내일"    → 96.5 는 보조기층의 값 → 기준 밖
 *   "노상 다짐도 98 나왔으니 오후부터 보조기층 깔아도" → 98 은 노상의 값 → 판정
 *   "되메우기 상부 노상 구간 다짐도 90.7"             → 90.7 에 가장 가까운 이름은 노상 → 판정
 */
function valuesLabelledOutOfScope(text: string, outKeys: readonly string[], inKeys: readonly string[]): string[] {
  const outs = outKeys.filter(Boolean);
  if (outs.length === 0 || !outs.some((k) => text.includes(k))) return [];
  const keys = [...outs.map((k) => ({ k, out: true })), ...inKeys.filter(Boolean).map((k) => ({ k, out: false }))]
    // 긴 이름을 먼저 — "보조기층" 안의 "기층"을 따로 세지 않는다
    .sort((a, b) => b.k.length - a.k.length);
  // 기준이 다루는 대상의 이름이 따로(기준 밖 이름의 일부가 아니게) 한 번도 없으면, 문장 전체가 기준 밖 대상의 이야기다
  //   "고유동 콘크리트 슬럼프 플로 시험: 목표 600mm, 측정 640mm" — "슬럼프"는 "슬럼프 플로"의 일부일 뿐이다
  if (inKeys.length > 0) {
    let masked = text;
    for (const k of [...outs].sort((a, b) => b.length - a.length)) masked = masked.split(k).join(' ');
    if (!inKeys.some((k) => k && masked.includes(k))) return outs.filter((k) => text.includes(k)).slice(0, 1);
  }
  const found = new Set<string>();
  for (const segment of stripNonMeasurements(text).split(/[.。!?\n,，;；]/u)) {
    // 이름이 놓인 자리 (겹치는 짧은 이름은 버린다)
    const marks: { at: number; end: number; k: string; out: boolean }[] = [];
    for (const { k, out } of keys) {
      let from = 0;
      for (let at = segment.indexOf(k, from); at >= 0; at = segment.indexOf(k, from)) {
        const end = at + k.length;
        if (!marks.some((m) => at < m.end && end > m.at)) marks.push({ at, end, k, out });
        from = end;
      }
    }
    if (marks.length === 0) continue;
    for (const num of segment.matchAll(/(?<![\d.])\d+(?:\.\d+)?/gu)) {
      const pos = num.index ?? 0;
      const before = marks.filter((m) => m.end <= pos).sort((a, b) => b.end - a.end)[0];
      const after = marks.filter((m) => m.at >= pos).sort((a, b) => a.at - b.at)[0];
      const label = before ?? after;
      if (label?.out) found.add(label.k);
    }
  }
  return [...found];
}
