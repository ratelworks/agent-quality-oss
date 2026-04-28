/**
 * 현장 관측값 문자열 파서.
 * "슬럼프 210mm", "기준 150±25mm", "염화물 ≤ 0.30 kg/㎥" 등.
 *
 * R1 (2026-04-28): series + fcn/fck 컨텍스트 추출 추가.
 *   "연속 3회 평균 25 최저 21" → series { mean, min, n }
 *   "압축강도 1회 시험값 21MPa, 호칭강도 24MPa" → scalar 21 + context.fcn=24
 *   "코어 4개 평균 22MPa 최저 17MPa, fck 24MPa" → series + context.fck=24
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
}

/**
 * R1: 통계 판정 + 거푸집 분기 등에 사용되는 컨텍스트 수치.
 * observation 문자열에서 fcn/fck/내구성기준강도 등을 추출.
 */
export interface ObservationContext {
  /** 호칭강도품질기준강도 fcn (= max(fck, durability)) */
  fcn?: number;
  /** 설계기준강도 fck */
  fck?: number;
  /** 내구성기준강도 */
  durabilityFc?: number;
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

  // fcn / 호칭강도품질기준강도 / 호칭강도
  const fcnRe = /(?:fcn|호칭강도품질기준강도|호칭강도|호칭)\s*[:=]?\s*(-?\d+(?:\.\d+)?)/iu;
  const fcnM = text.match(fcnRe);
  if (fcnM) ctx.fcn = Number(fcnM[1]);

  // fck / 설계기준강도 / 설계기준압축강도
  const fckRe = /(?:fck|설계기준강도|설계기준압축강도)\s*[:=]?\s*(-?\d+(?:\.\d+)?)/iu;
  const fckM = text.match(fckRe);
  if (fckM) ctx.fck = Number(fckM[1]);

  // 내구성기준강도
  const durRe = /내구성기준강도\s*[:=]?\s*(-?\d+(?:\.\d+)?)/u;
  const durM = text.match(durRe);
  if (durM) ctx.durabilityFc = Number(durM[1]);

  // 외기온도 / 외기 N℃ / 기온 N℃
  const tempRe = /(?:외기(?:온도)?|기온|대기온도)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(?:℃|°C|degC|degc)?/iu;
  const tempM = text.match(tempRe);
  if (tempM) ctx.ambientTemperature = Number(tempM[1]);

  // 부재 키워드 — R5 거푸집 라우팅 준비
  const memberRe = /(슬래브|보\s|기둥|벽체?|기초|푸팅|footing|slab|beam|column|wall)/iu;
  const memberM = text.match(memberRe);
  if (memberM) ctx.memberKeyword = (memberM[1] ?? '').trim();

  // R1: fcn 미지정 + fck만 있으면 fcn = fck (간이 추론, 내구성기준강도 미지정 시)
  if (ctx.fcn === undefined && ctx.fck !== undefined && ctx.durabilityFc === undefined) {
    ctx.fcn = ctx.fck;
  }
  // 둘 다 있으면 fcn = max
  if (ctx.fcn === undefined && ctx.fck !== undefined && ctx.durabilityFc !== undefined) {
    ctx.fcn = Math.max(ctx.fck, ctx.durabilityFc);
  }

  return ctx;
}

/**
 * R1: 시리즈 (n회 평균/최저/최고/values) 인식.
 * "연속 3회 평균 25 최저 21" / "3회 시험값 23 24 22" / "코어 4개 평균 22 최저 17"
 */
function detectSeries(text: string): ObservationToken | null {
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

  // series로 분류할 신호: 평균·최저·최고 중 하나라도 있거나 명시 values 배열이 있을 때.
  if (!meanM && !minM && !maxM && !valuesM) return null;

  const token: ObservationToken = {
    kind: 'series',
    unit: normalizeUnit(meanM?.[2] ?? minM?.[2] ?? maxM?.[2] ?? undefined),
    original: text,
  };
  if (meanM) token.mean = Number(meanM[1]);
  if (minM) token.min = Number(minM[1]);
  if (maxM) token.max = Number(maxM[1]);
  if (nM) token.n = Number(nM[1]);
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

export function parseObservation(text: string): { tokens: ObservationToken[]; context: ObservationContext } {
  if (typeof text !== 'string' || !text.trim()) return { tokens: [], context: {} };
  const norm = text.trim();
  const tokens: ObservationToken[] = [];
  const context = parseContext(text);

  // R1: series 우선 검사 (평균·최저 등 키워드 존재 시)
  const series = detectSeries(norm);
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
    return { tokens, context };
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
    return { tokens, context };
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

  // 자연어에 여러 숫자가 등장할 수 있다 ("28일 압축강도 26MPa").
  // R1: fcn/fck/외기온도 컨텍스트 수치는 parseContext가 별도 추출했으므로
  // 여기서는 그 수치들을 scalar 후보에서 제외 → 진짜 관측값만 매칭.
  const exclude = new Set<number>();
  if (context.fcn !== undefined) exclude.add(context.fcn);
  if (context.fck !== undefined) exclude.add(context.fck);
  if (context.durabilityFc !== undefined) exclude.add(context.durabilityFc);
  if (context.ambientTemperature !== undefined) exclude.add(context.ambientTemperature);

  const all = Array.from(norm.matchAll(SCALAR_GLOBAL_RE));
  // 단위가 명시된 수-단위 페어 + 컨텍스트 수치 아닌 것을 우선
  const candidates = all.filter((m) => !exclude.has(Number(m[1])));
  if (candidates.length > 0) {
    const withUnit = candidates.find((m) => m[2]);
    const chosen = withUnit ?? candidates[0];
    if (chosen) {
      tokens.push({
        kind: 'scalar',
        value: Number(chosen[1]),
        unit: normalizeUnit(chosen[2]),
        original: text,
      });
      return { tokens, context };
    }
  }
  // fallback — exclude 무시
  if (all.length > 0) {
    const withUnit = all.find((m) => m[2]);
    const chosen = withUnit ?? all[0];
    if (chosen) {
      tokens.push({
        kind: 'scalar',
        value: Number(chosen[1]),
        unit: normalizeUnit(chosen[2]),
        original: text,
      });
      return { tokens, context };
    }
  }

  tokens.push({ kind: 'qualitative', unit: null, original: text });
  return { tokens, context };
}

function normalizeUnit(u: string | undefined): string | null {
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
