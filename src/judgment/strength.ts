// ─────────────────────────────────────────────────────────────────────────────
// strength.ts — 콘크리트 압축강도 판정 (KCS 14 20 10 · KCS 14 20 12).
//
// 기준 강도가 경우마다 다르다.
//   레디믹스트 콘크리트(표 3.5-3 "호칭강도로부터 배합을 정한 경우") → 호칭강도
//     호칭강도 = 품질기준강도 + 기온보정강도 (식 2.2-2)
//     품질기준강도 = 설계기준압축강도와 내구성기준압축강도 중 큰 값 (식 2.2-1)
//   현장 배치플랜트(표 3.5-3 "그 밖의 경우")        → 품질기준강도 (평균값만)
//   현장양생공시체(표 3.5-7)                       → 품질기준강도
//   코어(3.5.5.7 (4))                              → 품질기준강도의 85 %·75 % 초과
//
// 설계기준압축강도만 알면 기준 강도는 "그 값 이상"이라는 것만 안다. 그 값으로도
// 못 미치면 불합격이 확실하지만, 그 값을 넘는다고 합격이라고 할 수는 없다.
// 그래서 기준 강도를 [하한, 상한] 구간으로 다루고, 확실한 것만 합격·불합격으로 낸다.
// ─────────────────────────────────────────────────────────────────────────────

import type { ObservationContext, ObservationToken } from "./parse-observation.js";

// ───── 상수 (모두 원문의 수치) ─────
/** 1회 시험값 기준이 바뀌는 경계 — 표 3.5-3·표 3.5-7 의 "≤ 35 MPa / ＞ 35 MPa" */
const RANGE_SPLIT_MPA = 35;
/** 35 MPa 이하: 1회 시험값 ≥ 기준 강도 − 3.5 MPa */
const SINGLE_MARGIN_MPA = 3.5;
/** 35 MPa 초과: 1회 시험값 ≥ 기준 강도의 90 % */
const SINGLE_RATIO_OVER_SPLIT = 0.9;
/** 평균은 "연속 3회 시험값"으로 본다 */
const CONSECUTIVE_TESTS = 3;
/** 코어: 평균 > 품질기준강도의 85 %, 각각 > 75 % (3.5.5.7 (4)) */
const CORE_MEAN_RATIO = 0.85;
const CORE_EACH_RATIO = 0.75;
/** 슬래브·보 밑면 거푸집 해체: 단층구조는 설계기준압축강도의 2/3배 이상 또한 최소 14 MPa (KCS 14 20 12 표 3.3-1) */
const SLAB_SINGLE_STORY_RATIO = 2 / 3;
const SLAB_MIN_MPA = 14;

export type StrengthCase = "ready_mixed" | "site_batch" | "field_cured" | "core";
export type Tri = true | false | null;
export type StrengthVerdict = "PASS" | "FAIL" | "UNDETERMINED";

export interface StrengthBounds {
  label: "호칭강도" | "품질기준강도";
  /** 기준 강도의 하한 (0 이면 모름) */
  lo: number;
  /** 기준 강도의 상한 (Infinity 면 모름) */
  hi: number;
  /** 기준 강도를 어떻게 정했는지 */
  basis: string;
  /** 기준 강도를 정확히 정하려면 필요한 입력 */
  missing: string[];
}

export interface StrengthJudgment {
  verdict: StrengthVerdict;
  reasoning: string;
  /** 판정에 쓴 규칙의 출처 */
  rule: string;
  bounds: StrengthBounds | null;
  meanCheck: Tri;
  singleCheck: Tri;
  observedMean?: number;
  observedMin?: number;
  n?: number;
  /** 합격·불합격을 확정하려면 필요한 입력 */
  neededInputs: string[];
  /** 기준 강도를 하한값으로 가정했을 때의 결과 (확정 아님) */
  provisional?: { assumption: string; verdict: "PASS" };
}

const RULE: Record<StrengthCase, string> = {
  ready_mixed: "KCS 14 20 10 표 3.5-3 (호칭강도로부터 배합을 정한 경우)",
  site_batch: "KCS 14 20 10 표 3.5-3 (그 밖의 경우 — 현장 배치플랜트)",
  field_cured: "KCS 14 20 10 표 3.5-7 (현장양생공시체)",
  core: "KCS 14 20 10 3.5.5.7 (4) (코어)",
};

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
const isExact = (b: StrengthBounds): boolean => b.lo === b.hi;

/** 1회 시험값의 하한 — 기준 강도에 따라 달라진다. 35 MPa 에서 두 식의 값이 같아 끊기지 않는다. */
function singleBound(reference: number): number {
  return reference <= RANGE_SPLIT_MPA ? reference - SINGLE_MARGIN_MPA : reference * SINGLE_RATIO_OVER_SPLIT;
}

/**
 * 입력에서 기준 강도를 정한다. 정확히 정하지 못하면 구간으로 돌려준다.
 * 아무 강도도 알려 주지 않았으면 null.
 */
export function resolveStrengthBounds(kind: StrengthCase, ctx: ObservationContext): StrengthBounds | null {
  const qualityExact =
    ctx.fcq ?? (ctx.fck !== undefined && ctx.durabilityFc !== undefined ? Math.max(ctx.fck, ctx.durabilityFc) : undefined);
  // 품질기준강도는 둘 중 큰 값이라, 하나만 알아도 그 값보다 작지 않다
  const qualityLower = qualityExact ?? ctx.fck ?? ctx.durabilityFc;

  if (kind === "ready_mixed") {
    if (ctx.fcn !== undefined) {
      return { label: "호칭강도", lo: ctx.fcn, hi: ctx.fcn, basis: `입력한 호칭강도 ${fmt(ctx.fcn)} MPa`, missing: [] };
    }
    if (qualityExact !== undefined && ctx.tempCorrection !== undefined) {
      const nominal = qualityExact + ctx.tempCorrection;
      return {
        label: "호칭강도",
        lo: nominal,
        hi: nominal,
        basis: `품질기준강도 ${fmt(qualityExact)} + 기온보정강도 ${fmt(ctx.tempCorrection)} = ${fmt(nominal)} MPa (식 2.2-2)`,
        missing: [],
      };
    }
    if (qualityLower === undefined) return null;
    const lo = qualityLower + (ctx.tempCorrection ?? 0);
    return {
      label: "호칭강도",
      lo,
      hi: Number.POSITIVE_INFINITY,
      basis:
        qualityExact !== undefined
          ? `품질기준강도 ${fmt(qualityExact)} MPa 만 알려 줌 — 호칭강도는 여기에 기온보정강도를 더한 값이라 ${fmt(lo)} MPa 이상`
          : `설계기준압축강도 ${fmt(qualityLower)} MPa 만 알려 줌 — 호칭강도는 품질기준강도(설계기준압축강도와 내구성기준압축강도 중 큰 값)에 기온보정강도를 더한 값이라 ${fmt(lo)} MPa 이상`,
      missing: ["호칭강도 (납품서에 적힌 호칭강도. 품질기준강도 + 기온보정강도)"],
    };
  }

  if (qualityExact !== undefined) {
    return {
      label: "품질기준강도",
      lo: qualityExact,
      hi: qualityExact,
      basis:
        ctx.fcq !== undefined
          ? `입력한 품질기준강도 ${fmt(qualityExact)} MPa`
          : `설계기준압축강도 ${fmt(ctx.fck ?? 0)} 와 내구성기준압축강도 ${fmt(ctx.durabilityFc ?? 0)} 중 큰 값 ${fmt(qualityExact)} MPa (식 2.2-1)`,
      missing: [],
    };
  }
  if (ctx.fcn !== undefined && ctx.tempCorrection !== undefined) {
    const quality = ctx.fcn - ctx.tempCorrection;
    return {
      label: "품질기준강도",
      lo: quality,
      hi: quality,
      basis: `호칭강도 ${fmt(ctx.fcn)} − 기온보정강도 ${fmt(ctx.tempCorrection)} = ${fmt(quality)} MPa (식 2.2-2)`,
      missing: [],
    };
  }
  const lo = qualityLower ?? 0;
  // 품질기준강도는 호칭강도보다 클 수 없다(호칭강도 = 품질기준강도 + 기온보정강도)
  const hi = ctx.fcn ?? Number.POSITIVE_INFINITY;
  if (lo === 0 && hi === Number.POSITIVE_INFINITY) return null;
  const known: string[] = [];
  if (qualityLower !== undefined) known.push(`설계기준압축강도 ${fmt(qualityLower)} MPa 이상`);
  if (ctx.fcn !== undefined) known.push(`호칭강도 ${fmt(ctx.fcn)} MPa 이하`);
  return {
    label: "품질기준강도",
    lo,
    hi,
    basis: `품질기준강도를 알려 주지 않음 — ${known.join(", ")}라는 것만 앎`,
    missing: ["품질기준강도 (설계기준압축강도와 내구성기준압축강도 중 큰 값)"],
  };
}

/** 값 ≥ g(기준 강도) 인지 — 기준 강도가 구간이면 확실할 때만 참·거짓 */
function triAtLeast(value: number, g: (reference: number) => number, bounds: StrengthBounds, strict = false): Tri {
  const passes = (reference: number): boolean => (strict ? value > g(reference) : value >= g(reference));
  if (Number.isFinite(bounds.hi) && passes(bounds.hi)) return true;
  if (bounds.lo > 0 && !passes(bounds.lo)) return false;
  return null;
}

function combine(checks: Tri[]): Tri {
  if (checks.some((c) => c === false)) return false;
  if (checks.every((c) => c === true)) return true;
  return null;
}

interface ObservedStrength {
  /** 시험값을 차례로 알려 준 경우 */
  values?: number[];
  mean?: number;
  min?: number;
  n?: number;
  /** 값 하나만 알려 준 경우 */
  single?: number;
}

function readObservation(
  series: ObservationToken | null,
  scalar: ObservationToken | null,
  ctx: ObservationContext,
): ObservedStrength | null {
  if (series && series.kind === "series") {
    // "공시체 3개 평균"은 시험 3회가 아니라 1회의 시험값이다 (표 3.5-3 주 1)
    // 회마다 적은 기록(perTest)은 값마다가 이미 1회 시험값이다. 한 회의 공시체 값(specimens)은 평균이 1회 시험값이다.
    if (series.specimens && series.mean !== undefined) return { single: series.mean };
    if (ctx.specimenAverage && !series.perTest && series.mean !== undefined) return { single: series.mean };
    const min = series.min ?? (series.values ? Math.min(...series.values) : undefined);
    return {
      ...(series.values ? { values: series.values } : {}),
      ...(series.mean !== undefined ? { mean: series.mean } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(series.n !== undefined ? { n: series.n } : {}),
    };
  }
  if (scalar && scalar.kind === "scalar" && typeof scalar.value === "number") return { single: scalar.value };
  return null;
}

/** 압축강도 시험값을 경우에 맞는 규칙으로 판정한다. */
export function judgeStrength(
  kind: StrengthCase,
  series: ObservationToken | null,
  scalar: ObservationToken | null,
  ctx: ObservationContext,
): StrengthJudgment {
  const rule = RULE[kind];
  const bounds = resolveStrengthBounds(kind, ctx);
  const base = { rule, bounds, meanCheck: null as Tri, singleCheck: null as Tri };

  if (!bounds) {
    const needed =
      kind === "ready_mixed"
        ? ["호칭강도 (납품서에 적힌 호칭강도)"]
        : ["품질기준강도 (설계기준압축강도와 내구성기준압축강도 중 큰 값)"];
    return {
      ...base,
      verdict: "UNDETERMINED",
      reasoning: `기준 강도를 알려 주지 않아 판정하지 못합니다. ${needed[0]}를 함께 알려 주세요.`,
      neededInputs: needed,
    };
  }
  if (series?.listUnclear && !ctx.specimenAverage) {
    const count = series.values?.length ?? 0;
    return {
      ...base,
      verdict: "UNDETERMINED",
      reasoning: `값 ${count}개가 공시체 ${count}개의 값(1회 시험)인지 ${count}회의 시험값인지 문장에 없어 판정하지 않습니다 — 공시체 3개의 평균이 1회 시험값이고(표 3.5-3 주 1), 어느 쪽이냐에 따라 결과가 달라집니다. '공시체 ${count}개' 또는 '${count}회 시험값'이라고 함께 적어 주세요.`,
      neededInputs: [`값 ${count}개가 공시체 ${count}개(1회 시험)인지 ${count}회 시험값인지`],
    };
  }
  // 현장 배치플랜트·코어는 평균으로 판정하는 기준이라 되묻지 않는다
  if (series?.meanUnclear && kind !== "site_batch" && kind !== "core" && !ctx.specimenAverage && series.mean !== undefined) {
    return {
      ...base,
      verdict: "UNDETERMINED",
      reasoning: `평균 ${fmt(series.mean)} 이 공시체 평균(1회 시험값)인지 연속 3회 시험값의 평균인지 문장에 없어 판정하지 않습니다 — 어느 쪽이냐에 따라 견주는 기준이 다릅니다(표 3.5-3). '공시체 3개 평균' 또는 '연속 3회 평균'이라고 함께 적어 주세요.`,
      neededInputs: ["평균이 공시체 평균(1회 시험값)인지 연속 3회 시험값의 평균인지"],
    };
  }
  const observed = readObservation(series, scalar, ctx);
  if (!observed) {
    return {
      ...base,
      verdict: "UNDETERMINED",
      reasoning: "시험값을 읽지 못했습니다. 예: '연속 3회 평균 26 최저 22, 호칭강도 24'.",
      neededInputs: ["압축강도 시험값"],
    };
  }

  const refText = isExact(bounds) ? `${bounds.label} ${fmt(bounds.lo)}` : `${bounds.label}(${fmt(bounds.lo)} 이상)`;
  const notes: string[] = [];
  const needed: string[] = [...bounds.missing];
  const mark = (t: Tri): string => (t === true ? "충족" : t === false ? "미달" : "확인 못함");
  let meanCheck: Tri = null;
  let singleCheck: Tri = null;
  let observedMean = observed.mean;
  let observedMin = observed.min ?? observed.single;

  /** 주어진 구간으로 두 기준을 평가한다 — 하한값 가정 평가에도 다시 쓴다 */
  const evaluate = (b: StrengthBounds, record: boolean): Tri => {
    const say = (text: string): void => {
      if (record) notes.push(text);
    };
    let mean: Tri = null;
    let single: Tri = null;

    if (kind === "core") {
      const meanValue = observed.mean ?? (observed.values ? observed.values.reduce((a, c) => a + c, 0) / observed.values.length : undefined);
      const each = observed.values ? Math.min(...observed.values) : observed.min;
      if (meanValue !== undefined) {
        mean = triAtLeast(meanValue, (r) => r * CORE_MEAN_RATIO, b, true);
        say(`코어 평균 ${fmt(meanValue)} > ${refText}의 85 %(${fmt(b.lo * CORE_MEAN_RATIO)}${isExact(b) ? "" : " 이상"}) — ${mark(mean)}`);
        observedMean = meanValue;
      } else {
        say("코어 평균값이 없어 평균 기준을 확인 못함");
        if (record) needed.push("코어 강도의 평균값");
      }
      if (each !== undefined) {
        single = triAtLeast(each, (r) => r * CORE_EACH_RATIO, b, true);
        say(`코어 최저 ${fmt(each)} > ${refText}의 75 %(${fmt(b.lo * CORE_EACH_RATIO)}${isExact(b) ? "" : " 이상"}) — ${mark(single)}`);
        observedMin = each;
      } else if (observed.single !== undefined) {
        single = triAtLeast(observed.single, (r) => r * CORE_EACH_RATIO, b, true);
        say(`코어 1개 ${fmt(observed.single)} > ${refText}의 75 % — ${mark(single)}. 코어 평균과 각각의 값이 모두 있어야 판정함`);
        if (record) needed.push("코어 강도의 평균값과 각각의 값");
      } else {
        say("코어 각각의 값(최저값)이 없어 개별 기준을 확인 못함");
        if (record) needed.push("코어 강도 각각의 값(최저값)");
      }
      if (record) {
        meanCheck = mean;
        singleCheck = single;
      }
      return combine([mean, single]);
    }

    if (kind === "site_batch") {
      const meanValue = observed.mean ?? observed.single;
      if (meanValue !== undefined) {
        mean = triAtLeast(meanValue, (r) => r, b);
        say(
          `압축강도 평균 ${fmt(meanValue)} ≥ ${refText} — ${mark(mean)}` +
            (observed.mean === undefined ? " (입력한 값 하나를 평균값으로 봄)" : ""),
        );
        observedMean = meanValue;
      } else {
        say("평균값이 없어 확인 못함");
        if (record) needed.push("압축강도의 평균값");
      }
      if (record) meanCheck = mean;
      return combine([mean]);
    }

    // 레디믹스트 콘크리트·현장양생공시체 — ① 연속 3회 평균 ② 1회 시험값
    if (observed.values && observed.values.length >= CONSECUTIVE_TESTS) {
      const windows: number[] = [];
      for (let i = 0; i + CONSECUTIVE_TESTS <= observed.values.length; i += 1) {
        const w = observed.values.slice(i, i + CONSECUTIVE_TESTS);
        windows.push(w.reduce((a, c) => a + c, 0) / CONSECUTIVE_TESTS);
      }
      mean = combine(windows.map((w) => triAtLeast(w, (r) => r, b)));
      const lowest = Math.min(...windows);
      say(`① 연속 3회 평균(가장 낮은 값 ${fmt(lowest)}) ≥ ${refText} — ${mark(mean)}`);
      observedMean = lowest;
    } else if (observed.values) {
      say(`① 시험값이 ${observed.values.length}회라 연속 3회 평균을 확인 못함`);
      if (record) needed.push("연속 3회 시험값");
    } else if (observed.mean !== undefined && (observed.n === undefined || observed.n === CONSECUTIVE_TESTS)) {
      mean = triAtLeast(observed.mean, (r) => r, b);
      say(
        `① 연속 3회 평균 ${fmt(observed.mean)} ≥ ${refText} — ${mark(mean)}` +
          (observed.n === undefined ? " (입력한 평균을 연속 3회 시험값의 평균으로 봄)" : ""),
      );
    } else if (observed.mean !== undefined && observed.n !== undefined && observed.n < CONSECUTIVE_TESTS) {
      say(`① 시험값이 ${observed.n}회라 연속 3회 평균을 확인 못함`);
      if (record) needed.push("연속 3회 시험값");
    } else if (observed.mean !== undefined) {
      say(`① ${observed.n}회 전체의 평균만으로는 연속 3회 평균을 확인 못함`);
      if (record) needed.push("시험값을 차례대로 (연속 3회씩 평균을 봄)");
    } else {
      say("① 연속 3회 평균을 확인할 값이 없음 (1회 시험값만 있음)");
      // 1회 시험값이 기준 강도보다 낮다는 것만으로는 ①의 미달이 아니다 — 남은 두 회가 얼마면 되는지를 계산해 알린다
      if (observed.single !== undefined && isExact(b) && b.lo > 0) {
        const restMean = (CONSECUTIVE_TESTS * b.lo - observed.single) / (CONSECUTIVE_TESTS - 1);
        say(
          `①은 1회 시험값 하나가 아니라 연속 3회의 평균으로 봅니다 — 1회 시험값이 ${refText}보다 낮은 것만으로는 미달이 아닙니다. ` +
            `이 값(${fmt(observed.single)})을 포함한 연속 3회라면 나머지 두 회 시험값의 평균이 ${fmt(restMean)} MPa 이상일 때 ①을 충족합니다`,
        );
      }
      if (record) needed.push("연속 3회 시험값의 평균");
    }

    const lowestSingle = observed.values ? Math.min(...observed.values) : (observed.min ?? observed.single);
    if (lowestSingle !== undefined) {
      single = triAtLeast(lowestSingle, singleBound, b);
      const boundText =
        b.lo <= RANGE_SPLIT_MPA
          ? `${refText} − 3.5 = ${fmt(singleBound(b.lo))}${isExact(b) ? "" : " 이상"}`
          : `${refText}의 90 % = ${fmt(singleBound(b.lo))}${isExact(b) ? "" : " 이상"}`;
      say(`② 1회 시험값${observed.single === undefined ? " 최저" : ""} ${fmt(lowestSingle)} ≥ ${boundText} — ${mark(single)}`);
      observedMin = lowestSingle;
    } else {
      say("② 1회 시험값(최저값)이 없어 확인 못함");
      if (record) needed.push("시험값 가운데 가장 낮은 값");
    }
    if (record) {
      meanCheck = mean;
      singleCheck = single;
    }
    return combine([mean, single]);
  };

  const result = evaluate(bounds, true);
  const verdict: StrengthVerdict = result === true ? "PASS" : result === false ? "FAIL" : "UNDETERMINED";

  let provisional: StrengthJudgment["provisional"];
  if (verdict === "UNDETERMINED" && !isExact(bounds) && bounds.lo > 0) {
    const assumed: StrengthBounds = { ...bounds, hi: bounds.lo, missing: [] };
    if (evaluate(assumed, false) === true) {
      provisional = { assumption: `${bounds.label}가 ${fmt(bounds.lo)} MPa 라면`, verdict: "PASS" };
    }
  }

  const head = `[${rule}] 기준 강도: ${bounds.basis}.`;
  let tail: string;
  if (verdict === "PASS") tail = "→ 기준 충족";
  else if (verdict === "FAIL") tail = "→ 기준 미달";
  else if (provisional) {
    tail = `→ ${provisional.assumption} 기준을 충족하지만, ${bounds.label}가 더 크면 미달일 수 있어 합격으로 단정하지 않습니다. ${needed[0] ?? bounds.label}를 알려 주세요.`;
  } else {
    tail = `→ 확인하지 못한 기준이 있어 합격으로 단정하지 않습니다.${needed.length > 0 ? ` 필요한 입력: ${[...new Set(needed)].join(" / ")}` : ""}`;
  }

  return {
    verdict,
    reasoning: `${head} ${notes.join(" / ")} ${tail}`,
    rule,
    bounds,
    meanCheck,
    singleCheck,
    ...(observedMean !== undefined ? { observedMean } : {}),
    ...(observedMin !== undefined ? { observedMin } : {}),
    ...(observed.n !== undefined ? { n: observed.n } : observed.values ? { n: observed.values.length } : {}),
    neededInputs: [...new Set(needed)],
    ...(provisional ? { provisional } : {}),
  };
}

export interface SlabStrippingJudgment {
  verdict: StrengthVerdict;
  reasoning: string;
  rule: string;
  /** 판정에 쓴 해체 강도 (정하지 못했으면 없음) */
  threshold?: number;
  neededInputs: string[];
}

/**
 * 슬래브·보의 밑면, 아치 내면 거푸집 해체 강도 (KCS 14 20 12 표 3.3-1).
 *   단층구조: 설계기준압축강도의 2/3배 이상 또한 최소 14 MPa
 *   다층구조: 설계기준압축강도 이상 (필러 동바리 구조는 구조계산으로 단축할 수 있으나 최소 14 MPa)
 */
export function judgeSlabBottomStripping(value: number, ctx: ObservationContext): SlabStrippingJudgment {
  const rule = "KCS 14 20 12 표 3.3-1 (슬래브 및 보의 밑면, 아치 내면)";
  const cured = " 압축강도는 KCI-CT 118 에 따라 양생한 현장양생공시체로 확인합니다(3.3.1 (4)).";
  const fck = ctx.fck;
  if (fck === undefined) {
    // 단층구조는 최소 14 MPa, 다층구조는 설계기준압축강도 이상이고 필러 동바리 구조로 줄여도 최소 14 MPa 다.
    // 설계기준압축강도가 14 MPa 이상이라면 어느 경우에도 14 MPa 에 못 미치면 해체할 수 없다 — 그 전제를 밝히고 미달로 낸다.
    if (value < SLAB_MIN_MPA) {
      return {
        verdict: "FAIL",
        rule,
        threshold: SLAB_MIN_MPA,
        reasoning: `[${rule}] 시험값 ${fmt(value)} MPa 는 14 MPa 에 못 미칩니다. 단층구조는 최소강도 14 MPa, 다층구조는 설계기준압축강도 이상(필러 동바리 구조도 최소 14 MPa)이라 어느 경우에도 미달입니다(설계기준압축강도를 14 MPa 이상으로 봄).${cured}`,
        neededInputs: [],
      };
    }
    return {
      verdict: "UNDETERMINED",
      rule,
      reasoning: `[${rule}] 해체 강도는 설계기준압축강도로 정해집니다(단층구조는 2/3배 이상 또한 최소 14 MPa, 다층구조는 설계기준압축강도 이상). 설계기준압축강도를 알려 주세요.${cured}`,
      neededInputs: ["설계기준압축강도", ...(ctx.storyType ? [] : ["단층구조인지 다층구조인지"])],
    };
  }

  const single = Math.max(fck * SLAB_SINGLE_STORY_RATIO, SLAB_MIN_MPA);
  if (ctx.storyType === "single") {
    const ok = value >= single;
    return {
      verdict: ok ? "PASS" : "FAIL",
      rule,
      threshold: single,
      reasoning: `[${rule}] 단층구조: 설계기준압축강도 ${fmt(fck)} 의 2/3배(${fmt(fck * SLAB_SINGLE_STORY_RATIO)}) 이상 또한 최소 14 MPa → 해체 강도 ${fmt(single)} MPa. 시험값 ${fmt(value)} — ${ok ? "충족" : "미달"}.${cured}`,
      neededInputs: [],
    };
  }
  if (ctx.storyType === "multi") {
    if (value >= fck) {
      return {
        verdict: "PASS",
        rule,
        threshold: fck,
        reasoning: `[${rule}] 다층구조: 설계기준압축강도 ${fmt(fck)} MPa 이상. 시험값 ${fmt(value)} — 충족.${cured}`,
        neededInputs: [],
      };
    }
    if (ctx.fillerShoring && value >= SLAB_MIN_MPA) {
      return {
        verdict: "UNDETERMINED",
        rule,
        threshold: fck,
        reasoning: `[${rule}] 다층구조: 설계기준압축강도 ${fmt(fck)} MPa 이상이 원칙이고 시험값 ${fmt(value)} 는 못 미칩니다. 필러 동바리 구조는 구조계산으로 기간을 단축할 수 있고(최소 14 MPa) 시험값은 14 MPa 이상이므로, 구조계산서에서 정한 해체 강도를 확인해야 합니다.${cured}`,
        neededInputs: ["필러 동바리 구조계산서에서 정한 해체 강도"],
      };
    }
    return {
      verdict: "FAIL",
      rule,
      threshold: fck,
      reasoning: `[${rule}] 다층구조: 설계기준압축강도 ${fmt(fck)} MPa 이상. 시험값 ${fmt(value)} — 미달.${ctx.fillerShoring ? " 필러 동바리 구조라도 최소 14 MPa." : ""}${cured}`,
      neededInputs: [],
    };
  }
  // 단층·다층을 모를 때 — 어느 쪽이든 같은 결론인 경우만 낸다
  if (value >= Math.max(fck, SLAB_MIN_MPA)) {
    return {
      verdict: "PASS",
      rule,
      threshold: fck,
      reasoning: `[${rule}] 시험값 ${fmt(value)} 는 설계기준압축강도 ${fmt(fck)} MPa 이상이라 단층·다층구조 어느 쪽 기준도 충족.${cured}`,
      neededInputs: [],
    };
  }
  if (value < single) {
    return {
      verdict: "FAIL",
      rule,
      threshold: single,
      reasoning: `[${rule}] 시험값 ${fmt(value)} 는 단층구조 기준(설계기준압축강도 ${fmt(fck)} 의 2/3배 또한 최소 14 MPa = ${fmt(single)})에도 못 미쳐 어느 쪽이든 미달.${cured}`,
      neededInputs: [],
    };
  }
  return {
    verdict: "UNDETERMINED",
    rule,
    reasoning: `[${rule}] 시험값 ${fmt(value)} 는 단층구조 기준(${fmt(single)} MPa)은 충족하고 다층구조 기준(설계기준압축강도 ${fmt(fck)} MPa)에는 못 미칩니다. 단층구조인지 다층구조인지 알려 주세요.${cured}`,
    neededInputs: ["단층구조인지 다층구조인지"],
  };
}
