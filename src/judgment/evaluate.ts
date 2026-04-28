/**
 * AcceptanceCriteria 엔티티 + 관측 토큰 → 판정 결과.
 * MARGINAL은 주의 플래그 — 합부(PASS/FAIL) 판정과 분리.
 *
 * R1 (2026-04-28): statistical_threshold operator 추가.
 *   표 3.5-3 압축강도 통계 판정 (≤35MPa: 평균≥fcn AND 1회≥fcn-3.5 / >35MPa: 평균≥fcn AND 1회≥fcn×0.9).
 *   parseObservation의 ObservationContext.fcn/fck를 threshold로 자동 주입.
 */

import { parseObservation, unitsCompatible } from './parse-observation.js';
import type { ObservationContext, ObservationToken } from './parse-observation.js';
import type { BaseEntity } from '../ontology/schema.js';

export type Verdict = 'PASS' | 'FAIL' | 'MARGINAL' | 'UNDETERMINED';
export type FailDirection = 'too_high' | 'too_low' | 'in_range' | 'n/a';

export interface AppliedCriterion {
  operator?: string;
  target?: number;
  plusMinus?: number;
  min?: number;
  max?: number;
  threshold?: number | null;
  unit: string | null;
  /** R1: statistical_threshold 모드 분기 ('le35' | 'gt35') */
  statisticalRule?: string;
  /** R1: 통계 판정 시 사용된 fcn 출처 ('criterion.threshold' | 'observation.context.fcn' | 'observation.context.fck') */
  fcnSource?: string;
}

export interface Judgment {
  verdict: Verdict;
  direction: FailDirection;
  observedValue: number | null;
  observedUnit: string | null;
  appliedCriterion: AppliedCriterion | null;
  reasoning: string;
  criterionId: string | null;
  /** R1: 통계 판정 산출 메타 (시리즈 입력 시) */
  statistical?: {
    n?: number;
    mean?: number;
    min?: number;
    fcn: number;
    meanCheck?: boolean;
    singleCheck?: boolean;
    partial: boolean;
  };
}

/** 허용치 경계 margin 비율 (경험 규칙, 합부 판정에 쓰지 않음) */
const MARGINAL_RATIO = 0.1;

export function evaluate(
  observationText: string,
  criterionEntity: BaseEntity | null | undefined,
): Judgment {
  const { tokens, context } = parseObservation(observationText);
  const seriesToken = tokens.find((t) => t.kind === 'series');
  const obsToken: ObservationToken | undefined =
    tokens.find((t) => t.kind === 'scalar') ?? seriesToken ?? tokens[0];
  const meta = (criterionEntity?.meta ?? {}) as {
    operator?: string;
    target?: number;
    plusMinus?: number;
    min?: number;
    max?: number;
    threshold?: number | null;
    unit?: string | null;
    statisticalRule?: string;
  };

  const appliedCriterion: AppliedCriterion | null = criterionEntity
    ? {
        operator: meta.operator,
        target: meta.target,
        plusMinus: meta.plusMinus,
        min: meta.min,
        max: meta.max,
        threshold: meta.threshold ?? null,
        unit: meta.unit ?? null,
        ...(meta.statisticalRule ? { statisticalRule: meta.statisticalRule } : {}),
      }
    : null;

  const base: Judgment = {
    criterionId: criterionEntity?.id ?? null,
    appliedCriterion,
    observedValue: obsToken?.value ?? seriesToken?.mean ?? null,
    observedUnit: obsToken?.unit ?? null,
    verdict: 'UNDETERMINED',
    direction: 'n/a',
    reasoning: '',
  };

  if (!criterionEntity) {
    base.reasoning = '해당 시험에 대한 AcceptanceCriteria 엔티티가 온톨로지에 없음.';
    return base;
  }

  // R1: statistical_threshold 모드 — series 또는 scalar 모두 처리
  if (meta.operator === 'statistical_threshold') {
    return evalStatistical(base, meta, seriesToken ?? null, obsToken ?? null, context);
  }

  if (!obsToken || obsToken.kind !== 'scalar' || typeof obsToken.value !== 'number') {
    base.reasoning = `관측값에서 수치를 추출할 수 없음 (kind=${obsToken?.kind ?? 'none'}).`;
    return base;
  }

  if (!unitsCompatible(obsToken.unit ?? null, meta.unit ?? null)) {
    base.reasoning = `단위 불일치: 관측 ${obsToken.unit} vs 기준 ${meta.unit}.`;
    return base;
  }

  const v = obsToken.value;
  const unit = meta.unit ?? '';

  switch (meta.operator) {
    case 'tolerance': {
      // target/plusMinus 누락 시 silent wrong verdict 차단
      if (typeof meta.target !== 'number' || typeof meta.plusMinus !== 'number') {
        return mk(
          base,
          'UNDETERMINED',
          'n/a',
          v,
          unit,
          `tolerance 기준에 target/plusMinus 메타 누락 — 판정 불가. (criterion=${criterionEntity.id})`,
        );
      }
      const target = meta.target;
      const pm = meta.plusMinus;
      const min = target - pm;
      const max = target + pm;
      if (v < min) return mk(base, 'FAIL', 'too_low', v, unit, `${v}${unit} < 허용하한 ${min}${unit}`);
      if (v > max) return mk(base, 'FAIL', 'too_high', v, unit, `${v}${unit} > 허용상한 ${max}${unit}`);
      const margin = pm * MARGINAL_RATIO;
      if (v < min + margin || v > max - margin) {
        return mk(base, 'MARGINAL', 'in_range', v, unit, `${v}${unit} 허용치 경계 ±${margin}${unit} 이내`);
      }
      return mk(base, 'PASS', 'in_range', v, unit, `${v}${unit} ∈ [${min}, ${max}]${unit}`);
    }
    case 'between': {
      // min/max 누락 시 silent wrong verdict 차단
      if (typeof meta.min !== 'number' || typeof meta.max !== 'number') {
        return mk(
          base,
          'UNDETERMINED',
          'n/a',
          v,
          unit,
          `between 기준에 min/max 메타 누락 — 판정 불가. (criterion=${criterionEntity.id})`,
        );
      }
      const min = meta.min;
      const max = meta.max;
      if (v < min) return mk(base, 'FAIL', 'too_low', v, unit, `${v}${unit} < ${min}${unit}`);
      if (v > max) return mk(base, 'FAIL', 'too_high', v, unit, `${v}${unit} > ${max}${unit}`);
      const span = max - min;
      const margin = span * MARGINAL_RATIO;
      if (v < min + margin || v > max - margin) {
        return mk(base, 'MARGINAL', 'in_range', v, unit, `${v}${unit} 허용범위 경계 ${margin.toFixed(1)}${unit} 이내`);
      }
      return mk(base, 'PASS', 'in_range', v, unit, `${v}${unit} ∈ [${min}, ${max}]${unit}`);
    }
    case 'le':
    case 'lt':
    case 'ge':
    case 'gt':
      return evalThreshold(base, meta.operator, meta.threshold, v, unit);
    default:
      return mk(base, 'UNDETERMINED', 'n/a', v, unit, `알 수 없는 operator: ${meta.operator}`);
  }
}

/** le/lt/ge/gt 통합 평가 — 부호 방향만 다른 4 분기를 lookup으로 평탄화 */
function evalThreshold(
  base: Judgment,
  op: 'le' | 'lt' | 'ge' | 'gt',
  threshold: number | null | undefined,
  v: number,
  unit: string,
): Judgment {
  if (threshold === null || threshold === undefined) {
    const note = op === 'ge' || op === 'gt' ? ' (예: fck)' : '';
    return mk(base, 'UNDETERMINED', 'n/a', v, unit, `threshold가 프로젝트 주입 대기 상태${note}`);
  }
  const upper = op === 'le' || op === 'lt';
  const inclusive = op === 'le' || op === 'ge';
  const ok = upper ? (inclusive ? v <= threshold : v < threshold) : inclusive ? v >= threshold : v > threshold;
  const margin = threshold * MARGINAL_RATIO;

  if (!ok) {
    const failSym = upper ? (inclusive ? '>' : '≥') : inclusive ? '<' : '≤';
    return mk(
      base,
      'FAIL',
      upper ? 'too_high' : 'too_low',
      v,
      unit,
      `${v}${unit} ${failSym} ${threshold}${unit}`,
    );
  }
  const nearBoundary = upper ? v > threshold - margin : v < threshold + margin;
  if (nearBoundary) {
    const reasoning = upper
      ? `${v}${unit} 상한 근접 (${(threshold - margin).toFixed(2)} 이상)`
      : `${v}${unit} 하한 근접`;
    return mk(base, 'MARGINAL', 'in_range', v, unit, reasoning);
  }
  const passSym = upper ? (inclusive ? '≤' : '<') : inclusive ? '≥' : '>';
  return mk(base, 'PASS', 'in_range', v, unit, `${v}${unit} ${passSym} ${threshold}${unit}`);
}

function mk(
  base: Judgment,
  verdict: Verdict,
  direction: FailDirection,
  observedValue: number,
  unit: string,
  reasoning: string,
): Judgment {
  return {
    ...base,
    verdict,
    direction,
    observedValue,
    observedUnit: unit,
    reasoning,
  };
}

/**
 * R1: 표 3.5-3 통계 판정.
 *  - le35: 평균 ≥ fcn AND 1회 ≥ fcn - 3.5MPa
 *  - gt35: 평균 ≥ fcn AND 1회 ≥ fcn × 0.9
 *
 * 입력 모드:
 *  - series (n≥1, mean+min): 평균·1회 두 기준 모두 평가
 *  - scalar (단일값): 1회 기준만 평가, partial=true (평균 검증 불가)
 *
 * fcn 출처 우선순위: criterion.threshold > observation.context.fcn > observation.context.fck
 */
function evalStatistical(
  base: Judgment,
  meta: { threshold?: number | null; unit?: string | null; statisticalRule?: string },
  series: ObservationToken | null,
  scalar: ObservationToken | null,
  context: ObservationContext,
): Judgment {
  const unit = meta.unit ?? 'MPa';
  const rule = meta.statisticalRule;
  if (rule !== 'le35' && rule !== 'gt35') {
    return mk(base, 'UNDETERMINED', 'n/a', 0, unit,
      `statistical_threshold criterion에 statisticalRule(le35|gt35) 누락 — 판정 불가.`);
  }

  // fcn 우선순위 결정
  let fcn: number | null = null;
  let fcnSource = '';
  if (typeof meta.threshold === 'number') {
    fcn = meta.threshold;
    fcnSource = 'criterion.threshold';
  } else if (context.fcn !== undefined) {
    fcn = context.fcn;
    fcnSource = context.fck !== undefined && context.fcn === context.fck
      ? 'observation.context.fck (fcn=fck 추론)'
      : 'observation.context.fcn';
  } else if (context.fck !== undefined) {
    fcn = context.fck;
    fcnSource = 'observation.context.fck';
  }

  if (fcn === null) {
    return mk(base, 'UNDETERMINED', 'n/a', 0, unit,
      `통계 판정 불가 — fcn(호칭강도품질기준강도) 미주입. observation 텍스트에 'fcn N' / 'fck N' / '호칭강도 N' 명시 또는 criterion threshold 주입 필요.`);
  }

  if (base.appliedCriterion) {
    base.appliedCriterion.threshold = fcn;
    base.appliedCriterion.fcnSource = fcnSource;
  }

  const minBound = rule === 'le35' ? fcn - 3.5 : fcn * 0.9;
  const ruleLabel = rule === 'le35' ? '≤35MPa (1회 ≥ fcn-3.5)' : '>35MPa (1회 ≥ fcn×0.9)';

  // series 입력 — 양쪽 기준 평가
  if (series && series.kind === 'series') {
    const mean = series.mean;
    const seriesMin = series.min ?? (series.values ? Math.min(...series.values) : undefined);
    if (mean === undefined || seriesMin === undefined) {
      return mk(base, 'UNDETERMINED', 'n/a', mean ?? 0, unit,
        `series 입력에 평균·최저 모두 필요 — 누락. (현재: mean=${mean}, min=${seriesMin})`);
    }
    const meanCheck = mean >= fcn;
    const singleCheck = seriesMin >= minBound;
    base.statistical = {
      ...(series.n !== undefined ? { n: series.n } : {}),
      mean,
      min: seriesMin,
      fcn,
      meanCheck,
      singleCheck,
      partial: false,
    };
    if (meanCheck && singleCheck) {
      return mk(base, 'PASS', 'in_range', mean, unit,
        `[${ruleLabel}] 평균 ${mean}≥fcn ${fcn} AND 최저 ${seriesMin}≥${minBound.toFixed(2)} → 통과`);
    }
    const failReasons: string[] = [];
    if (!meanCheck) failReasons.push(`평균 ${mean}<fcn ${fcn}`);
    if (!singleCheck) failReasons.push(`최저 ${seriesMin}<${minBound.toFixed(2)} (fcn ${fcn} ${rule === 'le35' ? '-3.5' : '×0.9'})`);
    return mk(base, 'FAIL', 'too_low', mean, unit,
      `[${ruleLabel}] ${failReasons.join(' / ')}`);
  }

  // scalar 입력 — 1회 기준만 (partial)
  if (scalar && scalar.kind === 'scalar' && typeof scalar.value === 'number') {
    if (!unitsCompatible(scalar.unit ?? null, meta.unit ?? null)) {
      return mk(base, 'UNDETERMINED', 'n/a', scalar.value, unit,
        `단위 불일치: 관측 ${scalar.unit} vs 기준 ${meta.unit}.`);
    }
    const v = scalar.value;
    const singleCheck = v >= minBound;
    base.statistical = {
      mean: v,
      min: v,
      fcn,
      singleCheck,
      partial: true,
    };
    if (singleCheck) {
      return mk(base, 'MARGINAL', 'in_range', v, unit,
        `[${ruleLabel}, 1회 단독] ${v}≥${minBound.toFixed(2)} 통과 — 단 평균(연속 3회) 검증 부재. 추가 시험값 확보 시 재판정 필요. (PASS 단언 불가)`);
    }
    return mk(base, 'FAIL', 'too_low', v, unit,
      `[${ruleLabel}, 1회 단독] ${v}<${minBound.toFixed(2)} (fcn ${fcn} ${rule === 'le35' ? '-3.5' : '×0.9'})`);
  }

  return mk(base, 'UNDETERMINED', 'n/a', 0, unit,
    `통계 판정 입력 부적절 — series 또는 scalar 필요.`);
}
