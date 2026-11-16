/**
 * 현장 관측값 문자열 파서.
 * "슬럼프 210mm", "기준 150±25mm", "염화물 ≤ 0.30 kg/㎥" 등. 날짜·시각·레미콘 규격(25-24-150)은 측정값으로 읽지 않는다.
 *
 * 여러 번의 시험값과, 판정에 필요한 조건(강도의 종류·공시체의 종류·시공 조건)도 함께 읽는다.
 *   "연속 3회 평균 25 최저 21" → series { mean, min, n }
 *   "압축강도 1회 시험값 21MPa, 호칭강도 24MPa" → scalar 21 + context.fcn=24
 *   "코어 4개 평균 22MPa 최저 17MPa, 품질기준강도 24MPa" → series + context.fcq=24 + strengthCase=core
 */

export type ObservationKind = 'tolerance' | 'range' | 'compare' | 'scalar' | 'series' | 'qualitative';

export interface ObservationToken {
  kind: ObservationKind;
  value?: number;
  min?: number;
  max?: number;
  plusMinus?: number;
  operator?: string;
  unit: string | null;
  original: string;
  /** series 모드 — n회 평균/최저/최고/values */
  n?: number;
  mean?: number;
  values?: number[];
  /** 쉼표로 이어 적은 값들이 공시체 여러 개(1회 시험)인지 여러 회의 시험값인지 문장에 없을 때 */
  listUnclear?: boolean;
}

/**
 * 판정에 쓰는 조건. 관측값 문장에서 읽는다.
 * 강도의 이름은 KCS 14 20 10 의 뜻을 따른다(2.2.2).
 */
export interface ObservationContext {
  /** 호칭강도 — 레디믹스트 콘크리트를 주문할 때의 강도 (품질기준강도 + 기온보정강도) */
  fcn?: number;
  /** 품질기준강도 — 설계기준압축강도와 내구성기준압축강도 중 큰 값 */
  fcq?: number;
  /** 설계기준압축강도 */
  fck?: number;
  /** 내구성기준압축강도 */
  durabilityFc?: number;
  /** 기온보정강도 */
  tempCorrection?: number;
  /** 어떤 공시체·생산 방식인지 (말하지 않으면 레디믹스트 콘크리트의 표준양생 공시체로 본다) */
  strengthCase?: 'site_batch' | 'field_cured' | 'core';
  /** "공시체 3개 평균"처럼 공시체 여러 개의 평균(= 1회 시험값)을 말했는지 */
  specimenAverage?: boolean;
  /** 단층구조·다층구조 — 슬래브·보 밑면 거푸집 해체 강도가 달라진다 */
  storyType?: 'single' | 'multi';
  /** 필러 동바리 구조 */
  fillerShoring?: boolean;
  /** 한중·서중 콘크리트 — 타설할 때의 콘크리트 온도 기준이 달라진다 */
  weather?: 'cold' | 'hot';
  /** 외기온도 (℃) — 운반시간/한중 분기 */
  ambientTemperature?: number;
  /** 부재 종류 키워드 (slab/beam/column/wall/footing) — R5 거푸집 라우팅 */
  memberKeyword?: string;
}

/** 단위 정규화 (lowercase 기준) */
const UNIT_ALIAS: Readonly<Record<string, string>> = {
  'kg/m3': 'kg/㎥',
  'kg/m³': 'kg/㎥',
  'mpa': 'MPa',
  'degc': '℃',
  '°c': '℃',
};

const UNIT_INLINE =
  '(?:kg\\/㎥|kg\\/m3|kg\\/m³|mpa|MPa|mm|cm|degC|degc|°C|°c|℃|%|m)';
const TOLERANCE_RE = new RegExp(
  `(-?\\d+(?:\\.\\d+)?)\\s*[±±]\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_INLINE})?`,
  'iu',
);
const RANGE_RE = new RegExp(
  `(-?\\d+(?:\\.\\d+)?)\\s*[~\\-]\\s*(-?\\d+(?:\\.\\d+)?)\\s*(${UNIT_INLINE})?`,
  'iu',
);
const COMPARE_RE = new RegExp(
  `(≤|≥|<=|>=|<|>|이상|이하|초과|미만)\\s*(-?\\d+(?:\\.\\d+)?)\\s*(${UNIT_INLINE})?`,
  'iu',
);
const SCALAR_WITH_UNIT_RE = new RegExp(
  `(-?\\d+(?:\\.\\d+)?)\\s*(${UNIT_INLINE})?`,
  'iu',
);
const SCALAR_GLOBAL_RE = new RegExp(SCALAR_WITH_UNIT_RE.source, 'giu');
/** 수 하나와 그 뒤의 단위 */
const VALUE_TOKEN_RE = new RegExp(`(?<![\\d.A-Za-z])(-?\\d+(?:\\.\\d+)?)(?:\\s*(${UNIT_INLINE})(?![A-Za-z]))?`, 'giu');
/** 값과 값 사이에 올 수 있는 것 — 공백, 구분 기호 하나, 잇는 말 하나 ("190, 150" · "190·150" · "190 및 150" · "190이고 150") */
const LIST_JOIN_RE = /^\s*(?:(?:이고|이며|이랑|랑|와|과|하고|및|그리고)\s*|[,，、·ㆍ/]\s*)?$/u;
/**
 * 순번·횟수·기간·위치처럼 세는 말이 붙은 수 — 측정값이 아니다 ("3호차" · "2회차" · "28일" · "90분" · "2구역").
 * 여기에 없는 말이 붙은 수는 값으로 남긴다 — 값을 놓쳐 하나만 판정하는 것보다 되묻는 쪽이 안전하다.
 */
export const COUNTER_RE =
  /\d+(?:\.\d+)?\s*(?:호차|회차|차수|차례|번째|번|차|층|대|회|개월|개소|개|일|동|호기|호|분|시간|초|톤|명|주|년|배|구간|구역|공구|블록|단계|열|단|급|종)(?![가-힣a-z])/giu;
/** 기준·조문·표 번호 — 측정값이 아니다 ("KS F 2402" · "KCS 14 20 10" · "제41조" · "별표 2" · "표 1.7-2") */
const REFERENCE_RE =
  /K(?:CS|DS)\s*\d{2}\s*\d{2}(?:\s*\d{2})?(?!\d)|KS\s*[A-Z](?:\s*ISO)?\s*\d+(?:-\d+)?|제\s*\d+\s*조(?:의\s*\d+)?(?:\s*제?\s*\d+\s*항)?|별표\s*\d+|(?<![가-힣])표\s*\d+(?:\.\d+)*-\d+/giu;
/** 날짜·시각 — 측정값으로 읽지 않는다 */
export const DATE_TIME_RE =
  /\d{4}\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}\s*일?|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\s*:\s*\d{2}(?::\d{2})?|\d{1,2}\s*시\s*(?:\d{1,2}\s*분)?/gu;
/** 레디믹스트 콘크리트 규격 "굵은골재 최대치수-호칭강도-슬럼프" (예: 25-24-150) */
export const MIX_CODE_RE = /(\d{2})\s*-\s*(\d{2,3})\s*-\s*(\d{2,3})(?!\s*-?\d)/u;

/** 이어 적은 값의 묶음 */
export interface ValueRun {
  values: number[];
  /** 묶음 안 어느 값에든 붙어 있던 단위 — 하나도 없으면 null */
  unit: string | null;
}

/** 측정값이 아닌 수(날짜·시각·레미콘 규격·기준 번호·세는 말이 붙은 수)를 걷어 낸다 */
function stripNonValues(text: string): string {
  return text.replace(DATE_TIME_RE, ' ').replace(MIX_CODE_RE, ' ').replace(REFERENCE_RE, ' ').replace(COUNTER_RE, ' ');
}

/**
 * 글에 적힌 수를 이어 적은 묶음으로 나눈다.
 * 값 사이에 공백·구분 기호·잇는 말만 있으면 한 묶음이다. 단위는 묶음의 어느 값에 붙어 있어도 묶음 전체의 단위로 본다
 * ("160, 175, 190mm" 는 mm 값 셋). 서로 다른 단위가 붙은 수는 한 묶음으로 잇지 않는다("185mm, 25℃").
 */
export function readValueRuns(text: string): ValueRun[] {
  const clean = stripNonValues(text);
  const runs: ValueRun[] = [];
  let current: ValueRun | null = null;
  let lastEnd = 0;
  for (const m of clean.matchAll(VALUE_TOKEN_RE)) {
    const value = Number(m[1]);
    const unit = normalizeUnit(m[2]);
    const start = m.index ?? 0;
    const joined =
      current !== null && LIST_JOIN_RE.test(clean.slice(lastEnd, start)) && (current.unit === null || unit === null || current.unit === unit);
    if (joined && current) {
      current.values.push(value);
      current.unit ??= unit;
    } else {
      current = { values: [value], unit };
      runs.push(current);
    }
    lastEnd = start + m[0].length;
  }
  return runs;
}

/** 기준을 적은 표현 — 측정값이 아니다 ("150±25" · "3~6%" · "95% 이상" · "≥ 95%" · "기준 95%") */
const CRITERION_STATEMENT_RES: readonly RegExp[] = [
  new RegExp(TOLERANCE_RE.source, 'giu'),
  new RegExp(RANGE_RE.source, 'giu'),
  new RegExp(`-?\\d+(?:\\.\\d+)?\\s*(?:${UNIT_INLINE})?\\s*(?:이상|이하|초과|미만)`, 'giu'),
  new RegExp(`(?:≤|≥|<=|>=|<|>)\\s*-?\\d+(?:\\.\\d+)?\\s*(?:${UNIT_INLINE})?`, 'giu'),
  new RegExp(
    `(?:관리\\s*)?(?:기준|허용|상한|하한|규정|시방)(?:값|치|범위|기준)?\\s*(?:은|는|이|가|:|=)?\\s*-?\\d+(?:\\.\\d+)?\\s*(?:${UNIT_INLINE})?`,
    'giu',
  ),
];

/** 기준을 적은 표현을 걷어 낸다 — 남는 수만 측정값 후보다 */
export function stripCriterionStatements(text: string): string {
  let clean = text;
  for (const re of CRITERION_STATEMENT_RES) clean = clean.replace(re, ' ');
  return clean;
}

/** 조건으로 읽은 수(기준 강도·기온 등) — 측정값 후보에서 뺀다 */
function contextValues(context: ObservationContext): Set<number> {
  const values = new Set<number>();
  for (const v of [context.fcn, context.fcq, context.fck, context.durabilityFc, context.tempCorrection, context.ambientTemperature]) {
    if (v !== undefined) values.add(v);
  }
  return values;
}

export interface MeasuredCandidates {
  /** 서로 다른 후보 값 — 적힌 순서 */
  values: number[];
  /** 후보를 고른 단위. 단위가 붙은 수가 없어 단위 없는 수를 후보로 삼았으면 null */
  unit: string | null;
}

/**
 * 판정할 항목의 측정값 후보를 모두 모은다. 판정은 후보가 정확히 하나일 때만 한다 —
 * 문장 어디에 어떤 모양으로 적었든(이어 적든, "1호차 4.5%, 2호차 6.5%" 처럼 떨어져 있든) 후보가 둘 이상이면 고르지 않는다.
 *
 *   1. 측정값이 아닌 수를 걷어 낸다: 날짜·시각·레미콘 규격·기준 번호·세는 말이 붙은 수·기준을 적은 표현·조건으로 읽은 수
 *   2. 판정기준의 단위가 붙은 수가 있으면 그것이 후보다. 하나도 없으면 단위 없이 적은 수가 후보다.
 *      다른 단위가 붙은 수("슬럼프 160mm" 를 공기량 판정에서)는 후보가 아니다.
 */
export function readMeasuredCandidates(text: string, context: ObservationContext, unit: string | null | undefined): MeasuredCandidates {
  const clean = stripCriterionStatements(stripNonValues(text));
  const exclude = contextValues(context);
  const wanted = normalizeUnit(unit ?? undefined);
  const found = readValueRuns(clean)
    .flatMap((run) => run.values.map((value) => ({ value, unit: run.unit })))
    .filter((t) => !exclude.has(t.value));
  const withUnit = wanted === null ? found : found.filter((t) => t.unit === wanted);
  const pool = withUnit.length > 0 ? withUnit : found.filter((t) => t.unit === null);
  return { values: [...new Set(pool.map((t) => t.value))], unit: withUnit.length > 0 ? wanted : null };
}

const OP_MAP: Readonly<Record<string, string>> = {
  '≤': 'le',
  '<=': 'le',
  '이하': 'le',
  '미만': 'lt',
  '<': 'lt',
  '≥': 'ge',
  '>=': 'ge',
  '이상': 'ge',
  '초과': 'gt',
  '>': 'gt',
};

/**
 * R1: 컨텍스트 수치(fcn/fck/외기온도/부재) 자동 추출.
 * observation 문자열을 별도 정규식 세트로 스캔.
 */
export function parseContext(text: string): ObservationContext {
  if (typeof text !== 'string' || !text.trim()) return {};
  const ctx: ObservationContext = {};

  // 강도의 이름 뒤에 조사·기호가 올 수 있다 ("호칭강도는 27", "fck=24")
  const NUM = '\\s*(?:은|는|이|가)?\\s*[:=]?\\s*(-?\\d+(?:\\.\\d+)?)';

  // 호칭강도
  const fcnM = text.match(new RegExp(`(?:fcn|호칭\\s*강도|호칭)${NUM}`, 'iu'));
  if (fcnM) ctx.fcn = Number(fcnM[1]);

  // 품질기준강도
  const fcqM = text.match(new RegExp(`(?:fcq|품질\\s*기준\\s*강도)${NUM}`, 'iu'));
  if (fcqM) ctx.fcq = Number(fcqM[1]);

  // 설계기준압축강도
  const fckM = text.match(new RegExp(`(?:fck|설계\\s*기준\\s*(?:압축)?\\s*강도|설계\\s*강도)${NUM}`, 'iu'));
  if (fckM) ctx.fck = Number(fckM[1]);

  // 내구성기준압축강도
  const durM = text.match(new RegExp(`(?:fcd|내구성\\s*기준\\s*(?:압축)?\\s*강도)${NUM}`, 'iu'));
  if (durM) ctx.durabilityFc = Number(durM[1]);

  // 기온보정강도
  const tnM = text.match(new RegExp(`(?:Tn|기온\\s*보정\\s*(?:강도|값)?)${NUM}`, 'u'));
  if (tnM) ctx.tempCorrection = Number(tnM[1]);

  // 공시체·생산 방식
  if (/코어/u.test(text)) ctx.strengthCase = 'core';
  else if (/현장\s*양생/u.test(text)) ctx.strengthCase = 'field_cured';
  else if (/배치\s*플랜트|현장\s*배합/u.test(text)) ctx.strengthCase = 'site_batch';

  // "공시체 3개 평균"은 1회의 시험값이다. "3회"를 함께 말했으면 여러 번의 시험으로 본다.
  if (/공시체\s*\d+\s*개/u.test(text) && !/\d+\s*회/u.test(text)) ctx.specimenAverage = true;

  // 구조·시공 조건
  if (/단층/u.test(text)) ctx.storyType = 'single';
  else if (/다층|고층/u.test(text)) ctx.storyType = 'multi';
  if (/필러/u.test(text)) ctx.fillerShoring = true;
  if (/한중|동절기|겨울철/u.test(text)) ctx.weather = 'cold';
  else if (/서중|하절기|여름철|혹서기/u.test(text)) ctx.weather = 'hot';

  // 외기온도 / 외기 N℃ / 기온 N℃
  const tempRe = /(?:외기(?:온도)?|기온|대기온도)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(?:℃|°C|degC|degc)?/iu;
  const tempM = text.match(tempRe);
  if (tempM) ctx.ambientTemperature = Number(tempM[1]);

  // 부재 키워드 — R5 거푸집 라우팅 준비
  const memberRe = /(슬래브|보\s|기둥|벽체?|기초|푸팅|footing|slab|beam|column|wall)/iu;
  const memberM = text.match(memberRe);
  if (memberM) ctx.memberKeyword = (memberM[1] ?? '').trim();

  // 설계기준압축강도를 호칭강도로 바꿔 쓰지 않는다 — 호칭강도는 품질기준강도에 기온보정강도를 더한
  // 값이라 더 클 수 있다. 어느 강도를 기준으로 삼을지는 판정 단계(strength.ts)가 정한다.
  return ctx;
}

/** 기준 강도를 적은 부분 — 시험값 목록에서 뺀다 */
const STRENGTH_LABEL_RE =
  /(?:호칭강도|설계기준\s*압축?강도|품질기준강도|내구성기준\s*압축?강도|배합강도|f\s*c[knqr])\s*[:=은는이가]?\s*-?\d+(?:\.\d+)?\s*(?:MPa)?/giu;

/**
 * R1: 시리즈 (n회 평균/최저/최고/values) 인식.
 * "연속 3회 평균 25 최저 21" / "3회 시험값 23 24 22" / "코어 4개 평균 22 최저 17"
 */
function detectSeries(text: string, context: ObservationContext): ObservationToken | null {
  const meanRe = /평균\s*(-?\d+(?:\.\d+)?)\s*(MPa|mpa|mm|kg\/㎥|kg\/m3|kg\/m³|%|℃)?/iu;
  const minRe = /최저\s*(-?\d+(?:\.\d+)?)\s*(MPa|mpa|mm|kg\/㎥|kg\/m3|kg\/m³|%|℃)?/iu;
  const maxRe = /최고\s*(-?\d+(?:\.\d+)?)\s*(MPa|mpa|mm|kg\/㎥|kg\/m3|kg\/m³|%|℃)?/iu;
  const nRe = /(?:연속\s*)?(\d+)\s*(?:회|개|차)\s*(?:시험값|평균|공시체)?/u;
  const valuesRe = /(?:시험값|values?)\s*[:：]?\s*((?:-?\d+(?:\.\d+)?\s+){2,}-?\d+(?:\.\d+)?)/iu;

  const meanM = text.match(meanRe);
  const minM = text.match(minRe);
  const maxM = text.match(maxRe);
  const nM = text.match(nRe);
  const valuesM = text.match(valuesRe);

  // 이어 적은 강도 값 — "25.1, 26.4, 27.8 MPa" · "25.1MPa 26.4MPa 27.8MPa"
  // 기준 강도(호칭강도 27MPa 등)는 시험값이 아니므로 먼저 걷어 낸다. MPa 가 붙은 묶음만 받는다.
  const listRun =
    meanM || minM || maxM || valuesM
      ? undefined
      : readValueRuns(text.replace(STRENGTH_LABEL_RE, ' ')).find((r) => r.unit === 'MPa' && r.values.length >= 2);
  // 이어 적지 않고 떨어져 적은 강도 값("1호차 26MPa, 2호차 20MPa")도 하나만 고르지 않는다 — 모두 모아 무엇인지 되묻게 한다
  const scattered =
    listRun || meanM || minM || maxM || valuesM ? null : readMeasuredCandidates(text.replace(STRENGTH_LABEL_RE, ' '), context, 'MPa');
  const listValues = listRun ? listRun.values : scattered && scattered.unit === 'MPa' && scattered.values.length >= 2 ? scattered.values : null;

  // series로 분류할 신호: 평균·최저·최고 중 하나라도 있거나 명시 values 배열이 있을 때.
  if (!meanM && !minM && !maxM && !valuesM && !listValues) return null;

  const token: ObservationToken = {
    kind: 'series',
    unit: normalizeUnit(meanM?.[2] ?? minM?.[2] ?? maxM?.[2] ?? undefined),
    original: text,
  };
  if (meanM) token.mean = Number(meanM[1]);
  if (minM) token.min = Number(minM[1]);
  if (maxM) token.max = Number(maxM[1]);
  if (nM) token.n = Number(nM[1]);
  if (listValues) {
    token.unit = 'MPa';
    token.values = listValues;
    token.mean = listValues.reduce((a, b) => a + b, 0) / listValues.length;
    token.min = Math.min(...listValues);
    token.max = Math.max(...listValues);
    // "3회"·"공시체 3개" 같은 말이 없으면 값들이 무엇인지 알 수 없다 — 판정 단계가 되묻는다
    if (token.n === undefined || !/\d+\s*(?:회|개|차)/u.test(text)) token.listUnclear = true;
    token.n = listValues.length;
  }
  if (valuesM && valuesM[1]) {
    const vals = valuesM[1].trim().split(/\s+/).map((s) => Number(s));
    token.values = vals;
    if (token.mean === undefined) token.mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (token.min === undefined) token.min = Math.min(...vals);
    if (token.max === undefined) token.max = Math.max(...vals);
    if (token.n === undefined) token.n = vals.length;
  }
  return token;
}

/**
 * 글에서 측정값 하나를 고른다.
 * 자연어에는 여러 숫자가 나온다("28일 압축강도 26MPa"). 기준 강도·기온처럼 조건으로 읽은 수는 빼고,
 * 단위가 붙은 수를 먼저 고른다.
 * @param unitOnly 단위가 붙은 수만 받는다 (기준 표현 옆의 측정값을 찾을 때)
 */
function pickScalar(clean: string, original: string, context: ObservationContext, unitOnly: boolean): ObservationToken | null {
  const exclude = contextValues(context);

  const all = Array.from(clean.matchAll(SCALAR_GLOBAL_RE));
  const candidates = all.filter((m) => !exclude.has(Number(m[1])));
  // 조건으로 읽은 수가 아닌 것 가운데 단위가 붙은 것 → 아무 수 → (조건 수까지 포함해) 단위가 붙은 것 → 아무 수
  const chosen = unitOnly
    ? candidates.find((m) => m[2])
    : (candidates.find((m) => m[2]) ?? candidates[0] ?? all.find((m) => m[2]) ?? all[0]);
  if (!chosen) return null;
  return { kind: 'scalar', value: Number(chosen[1]), unit: normalizeUnit(chosen[2]), original };
}

export function parseObservation(text: string): { tokens: ObservationToken[]; context: ObservationContext } {
  if (typeof text !== 'string' || !text.trim()) return { tokens: [], context: {} };
  // 날짜·시각·레미콘 규격(25-24-150)·기준 번호(KS F 2421)는 측정값이 아니다 — 범위(a-b)나 수치로 잘못 읽지 않게 걷어 낸다.
  // 세는 말이 붙은 수("공시체 3개")는 남긴다 — 시험 횟수를 읽는 데 쓴다.
  const norm = text.trim().replace(DATE_TIME_RE, ' ').replace(MIX_CODE_RE, ' ').replace(REFERENCE_RE, ' ');
  const tokens: ObservationToken[] = [];
  const context = parseContext(text);
  /** 기준 표현(150±25 · 125~175)을 걷어 낸 나머지에 측정값이 있으면 함께 싣는다 */
  const withMeasured = (matched: string): { tokens: ObservationToken[]; context: ObservationContext } => {
    const measured = pickScalar(norm.replace(matched, ' '), text, context, true);
    if (measured) tokens.push(measured);
    return { tokens, context };
  };

  // R1: series 우선 검사 (평균·최저 등 키워드 존재 시)
  const series = detectSeries(norm, context);
  if (series) {
    tokens.push(series);
    return { tokens, context };
  }

  const tol = norm.match(TOLERANCE_RE);
  if (tol) {
    const target = Number(tol[1]);
    const pm = Number(tol[2]);
    tokens.push({
      kind: 'tolerance',
      value: target,
      plusMinus: pm,
      min: target - pm,
      max: target + pm,
      unit: normalizeUnit(tol[3]),
      original: text,
    });
    return withMeasured(tol[0]);
  }

  const rng = norm.match(RANGE_RE);
  if (rng) {
    const a = Number(rng[1]);
    const b = Number(rng[2]);
    tokens.push({
      kind: 'range',
      min: Math.min(a, b),
      max: Math.max(a, b),
      unit: normalizeUnit(rng[3]),
      original: text,
    });
    return withMeasured(rng[0]);
  }

  const cmp = norm.match(COMPARE_RE);
  if (cmp) {
    const raw = cmp[1] ?? '';
    tokens.push({
      kind: 'compare',
      operator: OP_MAP[raw] ?? 'eq',
      value: Number(cmp[2]),
      unit: normalizeUnit(cmp[3]),
      original: text,
    });
    return { tokens, context };
  }

  const scalar = pickScalar(norm, text, context, false);
  if (scalar) {
    tokens.push(scalar);
    return { tokens, context };
  }

  tokens.push({ kind: 'qualitative', unit: null, original: text });
  return { tokens, context };
}

export function normalizeUnit(u: string | undefined): string | null {
  if (!u) return null;
  const lower = u.toLowerCase();
  return UNIT_ALIAS[lower] ?? u;
}

export function unitsCompatible(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return true;
  const na = UNIT_ALIAS[a.toLowerCase()] ?? a;
  const nb = UNIT_ALIAS[b.toLowerCase()] ?? b;
  return na === nb;
}
