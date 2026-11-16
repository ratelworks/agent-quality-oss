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

import { DATE_TIME_RE, MIX_CODE_RE } from "./parse-observation.js";

// ───── 상수 ─────
const NUMBER = "-?\\d+(?:\\.\\d+)?";
/** "150±25" */
const PLUS_MINUS_RE = new RegExp(`(${NUMBER})\\s*(?:mm)?\\s*[±]\\s*(${NUMBER})`, "u");
/** 순번·위치를 세는 말이 붙은 수 — 측정값으로 읽지 않는다 */
const COUNTER_RE = /\d+\s*(?:호차|번째|번|차|층|대|회|개|일|동|호)(?![가-힣a-z])/giu;

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
}

/**
 * 문장에서 지정값과 측정값을 가려 읽는다.
 * @param keywords 지정값을 가리키는 말 (예: 호칭·지정·배합)
 * @param quantity 항목 이름 (예: 슬럼프)
 * @param unit 단위 (예: mm)
 */
export function readTargetAndMeasured(text: string, keywords: string[], quantity: string, unit: string): TargetReading {
  let rest = text.replace(DATE_TIME_RE, " ");
  const reading: TargetReading = { measured: [] };

  const mix = rest.match(MIX_CODE_RE);
  if (mix) {
    reading.target = Number(mix[3]);
    reading.targetSource = "mix_code";
    rest = rest.replace(mix[0], " ");
  }
  const pm = rest.match(PLUS_MINUS_RE);
  if (pm) {
    // 규격보다 문장에 직접 적은 기준을 따른다
    reading.target = Number(pm[1]);
    reading.targetSource = "plus_minus";
    reading.statedPlusMinus = Number(pm[2]);
    rest = rest.replace(new RegExp(`${escapeRegExp(pm[0])}\\s*(?:${escapeRegExp(unit)})?`, "u"), " ");
  }
  // "호칭 슬럼프 180mm" · "배합 슬럼프는 180" · "지정 180mm"
  const labelRe = new RegExp(
    `(?:${keywords.map(escapeRegExp).join("|")})\\s*(?:${escapeRegExp(quantity)})?\\s*(?:값|치)?\\s*(?:은|는|이|가|의|:|=)?\\s*(${NUMBER})\\s*(?:${escapeRegExp(unit)})?`,
    "u",
  );
  const label = rest.match(labelRe);
  if (label) {
    if (reading.target === undefined || reading.targetSource === "mix_code") {
      reading.target = Number(label[1]);
      reading.targetSource = "label";
    }
    rest = rest.replace(label[0], " ");
  }

  rest = rest.replace(COUNTER_RE, " ");
  const withUnit = [...rest.matchAll(new RegExp(`(${NUMBER})\\s*${escapeRegExp(unit)}`, "gu"))].map((m) => Number(m[1]));
  const bare = [...rest.matchAll(new RegExp(NUMBER, "gu"))].map((m) => Number(m[0]));
  // 단위가 붙은 수가 있으면 그것만 측정값으로 본다
  reading.measured = withUnit.length > 0 ? withUnit : bare;
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
