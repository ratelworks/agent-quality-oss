// ─────────────────────────────────────────────────────────────────────────────
// evaluate-pour-conditions.ts — 타설 전 예보·계획 값으로 타설 조건을 판정한다.
//
// evaluate_observation 이 측정값을 사후에 판정한다면, 이 도구는 타설 전에
//   ① 어느 기준(일반·서중·한중)이 걸리는지
//   ② 운반시간·이어치기 간격·타설 온도의 한도가 얼마인지
//   ③ 계획 값이 그 한도를 넘는지
// 를 판정한다. 조건 목록과 근거 원문은 .specs/plans/2026-11-22-evaluate-pour-conditions.md.
//
// 모르는 입력은 그 입력이 가질 수 있는 경우를 모두 계산하고, 모든 경우의 결론이 같을 때만
// 결론을 낸다. 다르면 undetermined 와 경우별 결과·빠진 입력을 준다.
// ─────────────────────────────────────────────────────────────────────────────

import { buildResponse, entityBasisWithStatus } from "../lib/response.js";
import type { ToolSpec } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

// ───── 상수 (조항 수치 — 바꾸려면 기준 노드 인용부터 고친다) ─────
const TOOL_NAME = "evaluate_pour_conditions";
/** KCS 14 20 41 §1.1(2) — 서중: 일평균기온 25 ℃ 초과 */
const HOT_DAILY_MEAN_OVER = 25;
/** KCS 14 20 41 §1.1(2) — 서중: 타설 완료 후 24시간 이내 일최고기온 30 ℃ 초과 */
const HOT_MAX_OVER = 30;
/** KCS 14 20 40 §1.1(2) — 한중: 일평균기온 4 ℃ 이하 */
const COLD_DAILY_MEAN_AT_MOST = 4;
/** KCS 14 20 40 §1.1(2) — 한중: 타설 완료 후 24시간 동안 일최저기온 0 ℃ 이하 */
const COLD_MIN_AT_MOST = 0;
/** KCS 14 20 10 §3.2(3) — 외기온도 25 ℃ 이상 1.5시간, 미만 2시간 */
const TRANSPORT_AMBIENT_AT_LEAST = 25;
const TRANSPORT_WARM_MIN = 90;
const TRANSPORT_COOL_MIN = 120;
/** KCS 14 20 41 §3.3(2) — 서중: 외기온도와 무관하게 1.5시간 */
const TRANSPORT_HOT_MIN = 90;
/** KCS 14 20 10 §3.3.2(8) 표 3.3-1 — 외기온도 25 ℃ 초과 2.0시간, 이하 2.5시간 */
const LIFT_AMBIENT_OVER = 25;
const LIFT_WARM_MIN = 120;
const LIFT_COOL_MIN = 150;
/** KCS 14 20 41 §3.3(3) — 서중 타설 온도 35 ℃ 이하 */
const HOT_CONCRETE_MAX = 35;
/** KCS 14 20 40 §3.3(1) — 한중 타설 온도 5~20 ℃, 가혹 기상 또는 단면 300 mm 이하면 최저 10 ℃ */
const COLD_CONCRETE_MIN = 5;
const COLD_CONCRETE_MIN_STRICT = 10;
const COLD_CONCRETE_MAX = 20;
const COLD_THIN_SECTION_MM = 300;
const CONFLICT_HOLD = "서중·한중 적용 조건이 함께 성립할 수 있다 — 한도를 정하지 않고 사람이 확인한다";

const NODE = {
  transport: "standard.kcs_14_20.10.3_2",
  preparation: "standard.kcs_14_20.10.3_3",
  placing: "standard.kcs_14_20.10.3_3_2",
  cold: "standard.kcs_14_20.40",
  generalTemp: "criteria.concrete_temperature_general",
  hot: "standard.kcs_14_20.41",
} as const;

type Tri = boolean | undefined;
/** conflict = 서중·한중 적용 조건이 함께 성립 — 한도를 정하지 않고 사람 확인으로 돌린다 */
type Regime = "standard" | "hot_weather" | "cold_weather" | "conflict";
type Outcome = "pass" | "exceeds_standard" | "fail" | "undetermined" | "needs_judgment";

export const spec: ToolSpec = {
  name: "evaluate_pour_conditions",
  description:
    "타설 전에 예보·계획 값으로 콘크리트 타설 조건을 판정한다 — 일반·서중·한중 중 어느 기준이 걸리는지, 비비기부터 타설 완료까지의 운반시간 한도, 이어치기 허용 간격, 타설 온도 범위, 계획 값이 한도를 넘는지. " +
    "근거는 KCS 14 20 10·14 20 40·14 20 41 현행판 조항. 일평균기온은 하루 8회(03·06·09·12·15·18·21·24시) 기온의 평균으로 넘긴다. " +
    "모르는 값은 비워 두면 경우를 나눠 계산하고, 결론이 갈리면 판정하지 않고 필요한 값을 알려 준다. " +
    "운반시간·이어치기 간격 초과는 불합격이 아니라 '표준 초과'로 낸다(특별 조치와 책임기술자 승인으로 변경 가능). 강우·강설은 수치 기준이 없어 책임기술자 판단 항목으로 낸다. " +
    "[근거 제공용 · 최종 판정은 품질관리자·감리원·책임기술자]",
  inputSchema: {
    type: "object",
    properties: {
      dailyMeanTemp: { type: "number", description: "타설일 일평균기온(℃) — 8회 관측(예보)값의 평균" },
      maxTempNext24h: { type: "number", description: "타설 완료 후 24시간 이내 일최고기온 예보(℃)" },
      minTempNext24h: { type: "number", description: "타설 완료 후 24시간 동안 일최저기온 예보(℃)" },
      earlyFrostRiskLater: { type: "boolean", description: "24시간 이후에도 초기동해 위험이 있는가" },
      ambientTemp: { type: "number", description: "타설 시간대 외기온도(℃)" },
      ambientTemps: {
        type: "array",
        items: { type: "number" },
        description: "타설 시간대 시각별 외기온도(℃) — 가장 높은 값을 쓴다(ambientTemp 와 함께 주면 모두 합쳐 가장 높은 값)",
      },
      mixToPlacementEndMinutes: { type: "number", description: "비비기 시작부터 타설 완료까지 예상 시간(분) — 출하 전 대기·운행·타설 포함" },
      liftIntervalMinutes: { type: "number", description: "하층 비비기 시작부터 상층 타설까지 예상 시간(분)" },
      concreteTemp: { type: "number", description: "타설 시 콘크리트 온도(계획값, ℃)" },
      sectionThicknessMm: { type: "number", description: "구조물 단면 두께(mm)" },
      harshWeather: { type: "boolean", description: "기상 조건이 가혹한가(한중 최저 온도 판정용)" },
      massConcrete: { type: "boolean", description: "매스 콘크리트인가" },
      highStrengthConcrete: { type: "boolean", description: "고강도 콘크리트인가" },
      precipitationExpected: { type: "boolean", description: "운반·타설·초기 양생 중 강우·강설이 예보되는가" },
    },
  },
};

export interface PourConditionArgs {
  dailyMeanTemp?: number;
  maxTempNext24h?: number;
  minTempNext24h?: number;
  earlyFrostRiskLater?: boolean;
  ambientTemp?: number;
  ambientTemps?: number[];
  mixToPlacementEndMinutes?: number;
  liftIntervalMinutes?: number;
  concreteTemp?: number;
  sectionThicknessMm?: number;
  harshWeather?: boolean;
  massConcrete?: boolean;
  highStrengthConcrete?: boolean;
  precipitationExpected?: boolean;
}

interface Check {
  item: "transport_time" | "lift_interval" | "concrete_temperature" | "precipitation";
  outcome: Outcome;
  value?: number | boolean;
  limit?: string;
  clause: string;
  note?: string;
  /** 결론이 갈렸을 때 경우별 결과 */
  cases?: Array<{ when: string; outcome: Outcome; limit?: string }>;
}

// ───── 입력 정리 ─────

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function bool(v: unknown): Tri {
  return typeof v === "boolean" ? v : undefined;
}

/** D1 — 외기온도를 여러 개 주면 한도가 짧아지는 쪽(가장 높은 값)을 쓴다 */
function pickAmbient(v: unknown): number | undefined {
  if (Array.isArray(v)) {
    const xs = v.map(num).filter((x): x is number => x !== undefined);
    return xs.length ? Math.max(...xs) : undefined;
  }
  return num(v);
}

/** 조건 여러 개 중 하나라도 참이면 참, 모두 거짓이면 거짓, 그 밖은 모름 */
function anyOf(flags: Tri[]): Tri {
  if (flags.some((f) => f === true)) return true;
  if (flags.every((f) => f === false)) return false;
  return undefined;
}

function cmp(v: number | undefined, test: (x: number) => boolean): Tri {
  return v === undefined ? undefined : test(v);
}

// ───── 기준 판정 ─────

function decideRegime(a: PourConditionArgs) {
  const hotByMean = cmp(a.dailyMeanTemp, (x) => x > HOT_DAILY_MEAN_OVER);
  const hotByMax = cmp(a.maxTempNext24h, (x) => x > HOT_MAX_OVER);
  const coldByMean = cmp(a.dailyMeanTemp, (x) => x <= COLD_DAILY_MEAN_AT_MOST);
  const coldByMin = cmp(a.minTempNext24h, (x) => x <= COLD_MIN_AT_MOST);
  const coldByFrost = a.earlyFrostRiskLater;

  const hot = anyOf([hotByMean, hotByMax]);
  const cold = anyOf([coldByMean, coldByMin, coldByFrost]);

  const reasons: string[] = [];
  if (hotByMean) reasons.push(`일평균기온 ${a.dailyMeanTemp} ℃ > ${HOT_DAILY_MEAN_OVER} ℃ (KCS 14 20 41 §1.1(2))`);
  if (hotByMax) reasons.push(`24시간 이내 일최고기온 ${a.maxTempNext24h} ℃ > ${HOT_MAX_OVER} ℃ (KCS 14 20 41 §1.1(2))`);
  if (coldByMean) reasons.push(`일평균기온 ${a.dailyMeanTemp} ℃ ≤ ${COLD_DAILY_MEAN_AT_MOST} ℃ (KCS 14 20 40 §1.1(2))`);
  if (coldByMin) reasons.push(`24시간 동안 일최저기온 ${a.minTempNext24h} ℃ ≤ ${COLD_MIN_AT_MOST} ℃ (KCS 14 20 40 §1.1(2))`);
  if (coldByFrost) reasons.push("24시간 이후에도 초기동해 위험 (KCS 14 20 40 §1.1(2))");

  // 서중·한중 해당 여부가 가질 수 있는 조합을 모두 후보로 둔다 — 한쪽이 확정돼도 다른 쪽이 미상이면 동시 해당 후보가 남는다
  const possible = (t: Tri) => (t === undefined ? [true, false] : [t]);
  const candidates: Regime[] = [];
  for (const h of possible(hot)) {
    for (const c of possible(cold)) {
      const r: Regime = h && c ? "conflict" : h ? "hot_weather" : c ? "cold_weather" : "standard";
      if (!candidates.includes(r)) candidates.push(r);
    }
  }
  const missing: string[] = [];
  if (candidates.length > 1) {
    if (a.dailyMeanTemp === undefined) missing.push("dailyMeanTemp");
    if (hot === undefined && a.maxTempNext24h === undefined) missing.push("maxTempNext24h");
    if (cold === undefined && a.minTempNext24h === undefined) missing.push("minTempNext24h");
    if (cold === undefined && a.earlyFrostRiskLater === undefined) missing.push("earlyFrostRiskLater");
  }
  const regime = candidates.length === 1 ? candidates[0] : ("undetermined" as const);
  return { regime, candidates, reasons, missing };
}

// ───── 한도 계산 (경우별) ─────

interface Limits {
  /** 동시 해당(conflict)이면 비운다 — 숫자 한도를 확정하지 않는다 */
  transportMaxMinutes?: number;
  transportClause?: string;
  liftMaxMinutes?: number;
  concreteTemp: { min?: number; max?: number; clause: string; hold?: string; judgment?: string };
  /** 서중·한중 동시 해당 — 어떤 한도도 확정하지 않는다 */
  conflict?: true;
}

/** 한 경우(기준·외기온도·단면·기상이 정해진 경우)의 한도 */
function limitsFor(regime: Regime, ambient: number, strictCold: boolean, mass: Tri): Limits {
  const transport =
    regime === "hot_weather"
      ? { m: TRANSPORT_HOT_MIN, c: "KCS 14 20 41 §3.3(2)" }
      : { m: ambient >= TRANSPORT_AMBIENT_AT_LEAST ? TRANSPORT_WARM_MIN : TRANSPORT_COOL_MIN, c: "KCS 14 20 10 §3.2(3)" };
  const lift = ambient > LIFT_AMBIENT_OVER ? LIFT_WARM_MIN : LIFT_COOL_MIN;
  let concreteTemp: Limits["concreteTemp"];
  if (regime === "conflict") {
    concreteTemp = { clause: "KCS 14 20 40 · KCS 14 20 41", hold: CONFLICT_HOLD };
  } else if (regime === "hot_weather") {
    concreteTemp =
      mass === true
        ? { clause: "KCS 14 20 41 표 3.5-1", hold: "매스 콘크리트는 KCS 14 20 42 §3.3 에 따른다 — 이 도구에 수록되지 않아 판정하지 않는다" }
        : { max: HOT_CONCRETE_MAX, clause: "KCS 14 20 41 §3.3(3)" };
  } else if (regime === "cold_weather") {
    concreteTemp = {
      min: strictCold ? COLD_CONCRETE_MIN_STRICT : COLD_CONCRETE_MIN,
      max: COLD_CONCRETE_MAX,
      clause: "KCS 14 20 40 §3.3(1)",
    };
  } else {
    // 일반 콘크리트 — 표 3.5-2 판정기준은 '정해진 조건에 적합할 것'(수치 없음): 공사시방서·배합 조건으로 판정한다
    concreteTemp = {
      clause: "KCS 14 20 10 §3.5.3.1 표 3.5-2",
      judgment: "공사시방서·배합에서 정한 온도 조건에 적합한지 확인(KCS 수치 기준 없음)",
    };
  }
  if (regime === "conflict") return { concreteTemp, conflict: true };
  return { transportMaxMinutes: transport.m, transportClause: transport.c, liftMaxMinutes: lift, concreteTemp };
}

interface Case {
  when: string[];
  regime: Regime;
  limits: Limits;
}

/** 모르는 입력을 경우로 펼친다 — 외기온도는 각 경계의 양쪽 대표값, 단면·기상은 참/거짓 */
function enumerateCases(a: PourConditionArgs, candidates: Regime[], ambient: number | undefined): Case[] {
  const ambients: Array<{ v: number; label?: string }> =
    ambient !== undefined
      ? [{ v: ambient }]
      : [
          { v: 26, label: "외기온도 25 ℃ 초과" },
          { v: 25, label: "외기온도 25 ℃" },
          { v: 24, label: "외기온도 25 ℃ 미만" },
        ];
  const thinKnown = a.sectionThicknessMm !== undefined ? a.sectionThicknessMm <= COLD_THIN_SECTION_MM : undefined;
  const strictKnown = anyOf([a.harshWeather, thinKnown]);
  const cases: Case[] = [];
  for (const regime of candidates) {
    const stricts: Array<{ v: boolean; label?: string }> =
      regime !== "cold_weather" || strictKnown !== undefined
        ? [{ v: strictKnown === true }]
        : [
            { v: true, label: "기상 가혹 또는 단면 300 mm 이하" },
            { v: false, label: "기상 가혹 아님·단면 300 mm 초과" },
          ];
    // 서중 타설 온도는 매스 콘크리트면 다른 기준(KCS 14 20 42)을 따른다 — 매스 여부를 모르면 두 경우로 나눈다
    const masses: Array<{ v: Tri; label?: string }> =
      regime !== "hot_weather" || a.massConcrete !== undefined
        ? [{ v: a.massConcrete }]
        : [
            { v: true, label: "매스 콘크리트" },
            { v: false, label: "매스 콘크리트 아님" },
          ];
    for (const amb of ambients) {
      for (const st of stricts) {
        for (const ms of masses) {
          const when = [candidates.length > 1 ? REGIME_LABEL[regime] : undefined, amb.label, st.label, ms.label].filter(
            (x): x is string => !!x,
          );
          cases.push({ when, regime, limits: limitsFor(regime, amb.v, st.v, ms.v) });
        }
      }
    }
  }
  return cases;
}

const REGIME_LABEL: Record<Regime, string> = {
  conflict: "서중·한중 동시 해당",
  standard: "일반 콘크리트",
  hot_weather: "서중 콘크리트",
  cold_weather: "한중 콘크리트",
};

/** 경우별 결과를 하나로 접는다 — 모두 같으면 그 결과, 다르면 undetermined */
function fold(
  item: Check["item"],
  value: number,
  per: Array<{ when: string[]; outcome: Outcome; limit: string; clause: string }>,
  note?: string,
): Check {
  const outcomes = new Set(per.map((p) => p.outcome));
  const limits = new Set(per.map((p) => p.limit));
  const clauses = [...new Set(per.map((p) => p.clause))].join(" · ");
  if (outcomes.size === 1) {
    return {
      item,
      outcome: per[0]!.outcome,
      value,
      limit: limits.size === 1 ? per[0]!.limit : [...limits].join(" / "),
      clause: clauses,
      note,
    };
  }
  return {
    item,
    outcome: "undetermined",
    value,
    clause: clauses,
    note,
    cases: per.map((p) => ({ when: p.when.join(", ") || "기본", outcome: p.outcome, limit: p.limit })),
  };
}

// ───── 실행 ─────

export function run(rawArgs: PourConditionArgs, graph: OntologyGraph) {
  const raw = (rawArgs ?? {}) as Record<string, unknown>;
  const a: PourConditionArgs = {
    dailyMeanTemp: num(raw.dailyMeanTemp),
    maxTempNext24h: num(raw.maxTempNext24h),
    minTempNext24h: num(raw.minTempNext24h),
    earlyFrostRiskLater: bool(raw.earlyFrostRiskLater),
    mixToPlacementEndMinutes: num(raw.mixToPlacementEndMinutes),
    liftIntervalMinutes: num(raw.liftIntervalMinutes),
    concreteTemp: num(raw.concreteTemp),
    sectionThicknessMm: num(raw.sectionThicknessMm),
    harshWeather: bool(raw.harshWeather),
    massConcrete: bool(raw.massConcrete),
    highStrengthConcrete: bool(raw.highStrengthConcrete),
    precipitationExpected: bool(raw.precipitationExpected),
  };
  const ambientList = [
    ...(Array.isArray(raw.ambientTemps) ? raw.ambientTemps : []),
    ...(raw.ambientTemp !== undefined ? [raw.ambientTemp] : []),
  ];
  const ambient = pickAmbient(ambientList);
  const ambientNote = ambientList.length > 1 && ambient !== undefined
    ? `외기온도 ${ambientList.join(", ")} ℃ 중 가장 높은 ${ambient} ℃ 를 썼다 — 원문이 측정 시점을 정하지 않아 한도가 짧아지는 쪽을 택했다`
    : undefined;

  const decided = decideRegime(a);
  const basisIds = new Set<string>([NODE.transport, NODE.placing, NODE.preparation]);
  const mayConflict = decided.candidates.includes("conflict");
  if (decided.candidates.includes("hot_weather") || mayConflict) basisIds.add(NODE.hot);
  if (decided.candidates.includes("cold_weather") || mayConflict) basisIds.add(NODE.cold);
  if (decided.candidates.includes("standard") && a.concreteTemp !== undefined) basisIds.add(NODE.generalTemp);
  const basis = entityBasisWithStatus(graph, [...basisIds], 1);

  // D3 — 서중·한중 동시 해당이 확정: 판정하지 않는다
  if (decided.regime === "conflict") {
    return buildResponse(
      TOOL_NAME,
      graph.version,
      {
        regime: "conflict",
        reasons: decided.reasons,
        message: "서중과 한중 조건이 함께 걸린다 — 예보 값을 다시 확인해야 한다",
      },
      basis,
      { required: true, reason: "기준 충돌: 서중(KCS 14 20 41)과 한중(KCS 14 20 40) 적용 조건이 함께 성립" },
      undefined,
      graph,
    );
  }

  const cases = enumerateCases(a, decided.candidates, ambient);
  const missing = new Set<string>(decided.missing ?? []);
  const checks: Check[] = [];

  // 운반시간 (C4~C7)
  if (a.mixToPlacementEndMinutes !== undefined) {
    const v = a.mixToPlacementEndMinutes;
    const c = fold(
      "transport_time",
      v,
      cases.map((k) => ({
        when: k.when,
        outcome: (k.limits.transportMaxMinutes === undefined ? "undetermined" : v <= k.limits.transportMaxMinutes ? "pass" : "exceeds_standard") as Outcome,
        limit: k.limits.transportMaxMinutes === undefined ? CONFLICT_HOLD : `${k.limits.transportMaxMinutes}분 이내`,
        clause: k.limits.transportClause ?? "KCS 14 20 40 · KCS 14 20 41",
      })),
      "초과해도 특별 조치(지연제 등, 서중은 슬럼프 유지·응결 지연 성능)를 하고 책임기술자의 승인을 받으면 변경할 수 있다",
    );
    checks.push(c);
    if (c.outcome === "undetermined" && ambient === undefined) missing.add("ambientTemp");
  } else {
    missing.add("mixToPlacementEndMinutes");
  }

  // 이어치기 간격 (C11)
  if (a.liftIntervalMinutes !== undefined) {
    const v = a.liftIntervalMinutes;
    const c = fold(
      "lift_interval",
      v,
      cases.map((k) => ({
        when: k.when,
        outcome: (k.limits.liftMaxMinutes === undefined ? "undetermined" : v <= k.limits.liftMaxMinutes ? "pass" : "exceeds_standard") as Outcome,
        limit: k.limits.liftMaxMinutes === undefined ? CONFLICT_HOLD : `${k.limits.liftMaxMinutes}분 이내`,
        clause: "KCS 14 20 10 §3.3.2(8) 표 3.3-1",
      })),
      "표 3.3-1 은 표준이다 — 하층 비비기 시작부터 상층 타설까지의 시간",
    );
    checks.push(c);
    if (c.outcome === "undetermined" && ambient === undefined) missing.add("ambientTemp");
  }

  // 타설 온도 (C8~C10)
  if (a.concreteTemp !== undefined) {
    const v = a.concreteTemp;
    const per = cases.map((k) => {
      const t = k.limits.concreteTemp;
      if (t.hold) return { when: k.when, outcome: "undetermined" as Outcome, limit: t.hold, clause: t.clause };
      if (t.judgment) return { when: k.when, outcome: "needs_judgment" as Outcome, limit: t.judgment, clause: t.clause };
      const ok = (t.min === undefined || v >= t.min) && (t.max === undefined || v <= t.max);
      const limit = t.min !== undefined ? `${t.min}~${t.max} ℃` : `${t.max} ℃ 이하`;
      return { when: k.when, outcome: (ok ? "pass" : "fail") as Outcome, limit, clause: t.clause };
    });
    if (per.length > 0) {
      const coldExempt =
        decided.candidates.includes("cold_weather") && (a.massConcrete === true || a.highStrengthConcrete === true)
          ? "매스·고강도 콘크리트는 책임기술자의 승인으로 한중 규정의 일부 또는 전부를 적용하지 않을 수 있다 (KCS 14 20 40 §1.4(3))"
          : undefined;
      const c = fold("concrete_temperature", v, per, coldExempt);
      checks.push(c);
      if (c.outcome === "undetermined" && decided.candidates.includes("cold_weather")) {
        if (a.sectionThicknessMm === undefined) missing.add("sectionThicknessMm");
        if (a.harshWeather === undefined) missing.add("harshWeather");
      }
      if (c.outcome === "undetermined" && decided.candidates.includes("hot_weather") && a.massConcrete === undefined) {
        missing.add("massConcrete");
      }
    }
  }

  // 강우·강설 (C12)
  if (a.precipitationExpected === true) {
    checks.push({
      item: "precipitation",
      outcome: "needs_judgment",
      value: true,
      clause: "KCS 14 20 10 §3.3.2(12)",
      note: "강우·강설로 품질에 유해한 영향이 예상되면 원칙적으로 타설 금지 — 수치 기준이 없어 해당 여부는 책임기술자가 판단한다. 수분 유입 방지 조치를 하거나 영향이 크지 않으면 승인을 받아 타설할 수 있다",
    });
  }

  // 한도 요약 — 경우가 하나면 그 값, 여럿이면 경우별
  const limitView = (k: Case) => ({
    when: k.when.join(", ") || undefined,
    regime: k.regime,
    transportMaxMinutes: k.limits.transportMaxMinutes,
    transportClause: k.limits.transportClause,
    liftIntervalMaxMinutes: k.limits.liftMaxMinutes,
    concreteTemperature: k.limits.concreteTemp,
    hold: k.limits.conflict ? CONFLICT_HOLD : undefined,
  });

  const checklist: Array<{ item: string; clause: string }> = [
    { item: "운반·타설·초기 양생 중 강우·강설 보호 대책과 관리방안을 수립해 책임기술자 승인", clause: "KCS 14 20 10 §3.3.1(2)" },
  ];
  if (decided.candidates.includes("hot_weather")) {
    checklist.push({ item: "서중 콘크리트 시공계획서(재료·배합·운반·양생) 작성·책임기술자 승인", clause: "KCS 14 20 41 §3.1(2)" });
  }
  if (decided.candidates.includes("cold_weather")) {
    checklist.push(
      { item: "철근·거푸집에 빙설이 붙어 있지 않은지 확인", clause: "KCS 14 20 40 §3.3(2)" },
      { item: "타설할 지반이 동결되지 않도록 덮어 두기(동결 시 녹인 뒤 타설)", clause: "KCS 14 20 40 §3.3(3)" },
      { item: "동결된 시공이음부는 녹인 뒤 이어 타설", clause: "KCS 14 20 40 §3.3(4)" },
    );
  }

  const hasFail = checks.some((c) => c.outcome === "fail");
  return buildResponse(
    TOOL_NAME,
    graph.version,
    {
      regime: decided.regime,
      regimeCandidates: decided.candidates.length > 1 ? decided.candidates : undefined,
      regimeReasons: decided.reasons,
      limits: cases.length === 1 ? limitView(cases[0]!) : cases.map(limitView),
      checks,
      missingInputs: [...missing],
      checklist,
      notes: ambientNote ? [ambientNote] : undefined,
    },
    basis,
    hasFail
      ? { required: true, reason: `부적합: ${checks.filter((c) => c.outcome === "fail").map((c) => c.item).join(", ")}` }
      : undefined,
    undefined,
    graph,
  );
}
