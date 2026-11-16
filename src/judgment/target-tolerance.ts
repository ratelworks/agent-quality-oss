// ─────────────────────────────────────────────────────────────────────────────
// target-tolerance.ts — 지정값(호칭값)에 따라 허용오차가 달라지는 항목의 판정.
//
// 슬럼프가 그렇다. 허용오차는 호칭 슬럼프에 따라 다르고(KCS 14 20 10 표 1.7-2),
// 호칭 슬럼프는 배합마다 다르다. 호칭값을 모르면 허용범위를 정할 수 없으므로 판정하지 않는다.
//
//   "슬럼프 200mm, 호칭 슬럼프 180mm"      → 180 ± 25 = 155~205 → 충족
//   "슬럼프 185mm (기준 150±25mm)"         → 150 ± 25 = 125~175 → 초과
//   "슬럼프 210mm, 규격 25-24-180"         → 규격의 셋째 수 180 이 호칭 슬럼프
//   "슬럼프 185mm"                          → 호칭 슬럼프를 몰라 판정하지 않음
//
// 허용오차 표와 지정값을 가리키는 말은 판정기준 노드가 갖는다(코드에 수치를 두지 않는다).
// ─────────────────────────────────────────────────────────────────────────────

import {
  COUNTER_AFTER_RE,
  DATE_TIME_RE,
  MIX_CODE_RE,
  hasEvidence,
  hasForeignUnitList,
  isSupported,
  isCandidateRun,
  labelledByOtherMeasure,
  normalizeUnit,
  readValueRuns,
  stripNonMeasurements,
} from "./parse-observation.js";

// ───── 상수 ─────
const NUMBER = "-?\\d+(?:\\.\\d+)?";
/** "150±25" */
const PLUS_MINUS_RE = new RegExp(`(${NUMBER})\\s*(?:mm)?\\s*[±]\\s*(${NUMBER})`, "u");

/** 허용오차 표의 한 줄 — 지정값이 targets 중 하나이거나 min 이상이면 plusMinus 를 쓴다 */
export interface ToleranceRow {
  targets?: number[];
  min?: number;
  plusMinus: number;
}

export interface TargetReading {
  /** 지정값(호칭값) */
  target?: number;
  /** 지정값을 어디서 읽었는지 */
  targetSource?: "label" | "plus_minus" | "mix_code";
  /** 문장에 함께 적힌 허용오차 (예: 150±25 의 25) */
  statedPlusMinus?: number;
  /** 측정값 — 지정값 표현을 걷어 낸 나머지에서 읽은 수 */
  measured: number[];
  /** 측정값 어디에도 단위가 붙어 있지 않다 */
  unitless: boolean;
  /** 측정값 어디에도 단위·항목 이름·재서 나온 값이라는 말이 붙어 있지 않다 — 측정값이라는 근거가 없는 수다 */
  unsupported: boolean;
  /** 바로 앞에 다른 양의 이름이 붙은 후보가 있다("굵은골재 최대치수 … 40mm") — 판정하지 않는다 */
  otherMeasureLabelled?: boolean;
  /** 이 항목의 값일 수 있는 수 목록이 다른 단위로 끝나 후보에서 빠졌다 — 판정하지 않는다 */
  foreignUnitList?: boolean;
  /** 지정값이 서로 다르게 두 군데 적혀 있다 (예: 규격의 슬럼프 180 과 "호칭 슬럼프 150") — 어느 쪽인지 정하지 않는다 */
  conflict?: [number, number];
}

/** 읽어 낸 자리를 비울 때 넣는 표시 — 앞뒤 말이 이어져 다른 수와 엮이지 않게 한다 */
const HOLE = " § ";

/**
 * 문장에서 지정값과 측정값을 가려 읽는다.
 * @param keywords 지정값을 가리키는 말 (예: 호칭·지정·배합)
 * @param quantity 항목 이름 (예: 슬럼프)
 * @param unit 단위 (예: mm)
 */
export function readTargetAndMeasured(text: string, keywords: string[], quantity: string, unit: string): TargetReading {
  let rest = text.replace(DATE_TIME_RE, " ");
  const reading: TargetReading = { measured: [], unitless: false, unsupported: false };

  const said: number[] = [];
  const mix = rest.match(MIX_CODE_RE);
  if (mix) {
    reading.target = Number(mix[3]);
    reading.targetSource = "mix_code";
    said.push(reading.target);
    rest = rest.replace(mix[0], HOLE);
  }
  const pm = rest.match(PLUS_MINUS_RE);
  if (pm) {
    // 규격보다 문장에 직접 적은 기준을 따른다
    reading.target = Number(pm[1]);
    reading.targetSource = "plus_minus";
    reading.statedPlusMinus = Number(pm[2]);
    said.push(reading.target);
    rest = rest.replace(new RegExp(`${escapeRegExp(pm[0])}\\s*(?:${escapeRegExp(unit)})?`, "u"), HOLE);
  }
  // "호칭 슬럼프 180mm" · "배합 슬럼프는 180" · "지정 180mm"
  const labelRe = new RegExp(
    `(?:${keywords.map(escapeRegExp).join("|")})\\s*(?:${escapeRegExp(quantity)})?\\s*(?:값|치)?\\s*(?:은|는|이|가|의|을|를|:|=)?\\s*(${NUMBER})\\s*(?:${escapeRegExp(unit)})?`,
    "u",
  );
  const label = rest.match(labelRe);
  // 가리키는 말 뒤의 수가 세는 수이거나("규격 … 8번차") 다른 번호의 앞부분이면("규격 25-…") 지정값이 아니다
  const labelTail = label ? rest.slice((label.index ?? 0) + label[0].length) : "";
  if (label && !COUNTER_AFTER_RE.test(labelTail) && !/^\s*-\s*\d/u.test(labelTail)) {
    if (reading.target === undefined || reading.targetSource === "mix_code") {
      reading.target = Number(label[1]);
      reading.targetSource = "label";
    }
    said.push(Number(label[1]));
    rest = rest.replace(label[0], HOLE);
  }
  // "180짜리" · "210 배합" — 수 뒤에 붙여 적은 지정값
  const suffix = rest.match(new RegExp(`(?<![\\d.])(${NUMBER})\\s*(?:${escapeRegExp(unit)})?\\s*(?:짜리|배합)`, "u"));
  if (suffix) {
    if (reading.target === undefined) {
      reading.target = Number(suffix[1]);
      reading.targetSource = "label";
    }
    said.push(Number(suffix[1]));
    rest = rest.replace(suffix[0], HOLE);
  }
  const different = said.find((v) => v !== said[0]);
  if (said[0] !== undefined && different !== undefined) reading.conflict = [said[0], different];

  // 이어 적은 값은 한 묶음이다 — 단위를 마지막 값에만 붙여도("160, 175, 190mm") 셋 모두 측정값이다.
  // 이 항목의 단위가 붙은 수와 단위 없이 적은 수가 모두 측정값 후보다("160mm, 재시험 190" 의 190).
  // 다른 단위의 수와 다른 항목의 이름이 앞에 적힌 수("공기량 4.8")는 뺀다.
  // 지정값을 읽고 난 뒤에 남은 기준 표현("허용 125~175mm" · "175mm 이하")은 측정값이 아니다
  const runs = readValueRuns(stripNonMeasurements(rest));
  const wanted = normalizeUnit(unit);
  let candidates = runs.filter((r) => isCandidateRun(r, wanted, [quantity]));
  // 지정값을 한 번 더 적은 수("120으로 받는 건데 … 150 나왔어요" 의 120)는 측정값이 아니다.
  // 지정값과 같은 값은 언제나 허용범위 안이므로, 다른 후보가 있을 때 이 수를 빼도 벗어난 값을 놓치지 않는다.
  const restated = (r: (typeof runs)[number]): boolean =>
    reading.target !== undefined && r.values.length === 1 && r.values[0] === reading.target && !hasEvidence(r, [quantity]) && !r.cue;
  if (candidates.some((r) => !restated(r))) candidates = candidates.filter((r) => !restated(r));
  reading.measured = [...new Set(candidates.flatMap((r) => r.values))];
  reading.unitless = candidates.length > 0 && candidates.every((r) => r.unit === null);
  reading.unsupported = candidates.length > 0 && !candidates.some((r) => isSupported(r, [quantity]));
  reading.otherMeasureLabelled = candidates.some((r) => labelledByOtherMeasure(r.nearWord ?? null));
  reading.foreignUnitList = hasForeignUnitList(runs, wanted, [quantity]);
  return reading;
}

/** 지정값에 맞는 허용오차 — 표에 없으면 null */
export function toleranceFor(target: number, table: ToleranceRow[]): number | null {
  for (const row of table) {
    if (row.targets?.includes(target)) return row.plusMinus;
  }
  for (const row of table) {
    if (row.min !== undefined && target >= row.min) return row.plusMinus;
  }
  return null;
}

/** 허용오차 표를 한 줄로 */
export function describeTable(table: ToleranceRow[], unit: string): string {
  return table
    .map((row) => `${row.targets ? `${row.targets.join("·")} ${unit}` : `${row.min} ${unit} 이상`} ±${row.plusMinus}`)
    .join(", ");
}

export function isToleranceTable(value: unknown): value is ToleranceRow[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((row) => {
      if (typeof row !== "object" || row === null) return false;
      const r = row as Record<string, unknown>;
      const hasTargets = Array.isArray(r["targets"]) && r["targets"].every((t) => typeof t === "number");
      return typeof r["plusMinus"] === "number" && (hasTargets || typeof r["min"] === "number");
    })
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
