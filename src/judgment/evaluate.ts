/**
 * AcceptanceCriteria 엔티티 + 관측 토큰 → 판정 결과.
 * MARGINAL은 주의 플래그 — 합부(PASS/FAIL) 판정과 분리.
 *
 * 연산자(operator):
 *   tolerance · between · le · lt · ge · gt — 수치 하나를 기준값과 견준다
 *   tolerance_by_target — 지정값(호칭값)에 따라 허용오차가 달라진다. 슬럼프 (target-tolerance.ts)
 *   statistical_threshold — 압축강도. 경우(레디믹스트·현장 배치플랜트·현장양생·코어)에 따라
 *     기준 강도와 규칙이 다르다 (strength.ts)
 *   strip_slab_bottom — 슬래브·보 밑면 거푸집 해체 강도 (단층·다층구조에 따라 다르다)
 *   condition_dependent — 조건(예: 한중·서중)을 알아야 기준이 정해진다. 수치 판정을 내지 않는다
 */

import { parseObservation, unitsCompatible, parseValueList } from './parse-observation.js';
import type { ObservationContext, ObservationToken } from './parse-observation.js';
import { judgeSlabBottomStripping, judgeStrength } from './strength.js';
import type { StrengthCase } from './strength.js';
import { describeTable, isToleranceTable, readTargetAndMeasured, toleranceFor } from './target-tolerance.js';
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
  /** 압축강도 기준이 다루는 기준 강도의 범위 ('le35' | 'gt35') */
  statisticalRule?: string;
  /** 압축강도 판정에서 기준 강도를 어떻게 정했는지 */
  referenceSource?: string;
}

export interface Judgment {
  verdict: Verdict;
  direction: FailDirection;
  observedValue: number | null;
  observedUnit: string | null;
  appliedCriterion: AppliedCriterion | null;
  reasoning: string;
  criterionId: string | null;
  /** 압축강도 판정의 세부 */
  statistical?: {
    case: StrengthCase;
    n?: number;
    mean?: number;
    min?: number;
    /** 기준 강도의 이름 (호칭강도 · 품질기준강도) */
    referenceLabel: string;
    /** 기준 강도. referenceExact 가 false 면 하한값 */
    reference: number;
    referenceExact: boolean;
    /** null = 확인하지 못함 */
    meanCheck: boolean | null;
    singleCheck: boolean | null;
    /** 확인하지 못한 기준이 있는지 */
    partial: boolean;
  };
  /** 합격·불합격을 확정하려면 필요한 입력 */
  neededInputs?: string[];
  /** 가정을 둔 결과 — 확정이 아니다 */
  provisional?: { assumption: string; verdict: 'PASS' };
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
    strengthCase?: StrengthCase;
    condition?: string;
    neededInputs?: string[];
    /** tolerance_by_target — 허용오차 표, 지정값의 이름·가리키는 말, 항목 이름 */
    toleranceTable?: unknown;
    targetLabel?: string;
    targetKeywords?: string[];
    quantity?: string;
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

  // 압축강도 — 여러 번의 시험값(series)과 값 하나(scalar) 모두 다룬다
  if (meta.operator === 'statistical_threshold') {
    return evalStrength(base, meta, seriesToken ?? null, obsToken ?? null, context);
  }

  // 조건을 알아야 기준이 정해지는 항목 — 수치를 견주지 않는다
  if (meta.operator === 'condition_dependent') {
    base.reasoning = meta.condition ?? '조건에 따라 기준이 달라 수치만으로 판정하지 않습니다.';
    if (meta.neededInputs && meta.neededInputs.length > 0) base.neededInputs = meta.neededInputs;
    return base;
  }

  // 지정값에 따라 허용오차가 달라지는 항목 (슬럼프)
  if (meta.operator === 'tolerance_by_target') {
    return evalByTarget(base, meta, observationText);
  }

  // 값이 여러 개면 하나를 골라 판정하지 않는다 — 고르지 않은 값이 기준을 벗어났을 수 있다
  const listed = parseValueList(observationText);
  if (listed) {
    base.reasoning = `값이 여러 개로 읽힙니다(${listed.values.join(', ')} ${listed.unit}) — 어느 값을 판정할지 정할 수 없어 판정하지 않습니다. 값 하나에 문장 하나로 나눠 주세요.`;
    base.neededInputs = ['값 하나씩 나눈 관측값 (문장 하나에 값 하나)'];
    return base;
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
    case 'strip_slab_bottom': {
      const j = judgeSlabBottomStripping(v, context);
      if (base.appliedCriterion && j.threshold !== undefined) base.appliedCriterion.threshold = j.threshold;
      if (j.neededInputs.length > 0) base.neededInputs = j.neededInputs;
      const direction: FailDirection = j.verdict === 'FAIL' ? 'too_low' : j.verdict === 'PASS' ? 'in_range' : 'n/a';
      return mk(base, j.verdict, direction, v, unit, j.reasoning);
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

/** 지정값(호칭값)에 따라 허용오차가 달라지는 항목 — 지정값을 모르면 판정하지 않는다 */
function evalByTarget(
  base: Judgment,
  meta: { unit?: string | null; toleranceTable?: unknown; targetLabel?: string; targetKeywords?: string[]; quantity?: string },
  text: string,
): Judgment {
  const unit = meta.unit ?? '';
  const table = meta.toleranceTable;
  const label = meta.targetLabel ?? '지정값';
  const quantity = meta.quantity ?? '';
  if (!isToleranceTable(table) || !Array.isArray(meta.targetKeywords) || !quantity) {
    base.reasoning = `판정기준에 허용오차 표나 지정값 표현이 없어 판정하지 못합니다. (criterion=${base.criterionId})`;
    return base;
  }
  const reading = readTargetAndMeasured(text, meta.targetKeywords, quantity, unit);
  const tableText = describeTable(table, unit);
  if (reading.measured.length === 0) {
    base.reasoning = `측정값을 읽지 못했습니다 — 예: "${quantity} 185${unit}, ${label} 150${unit}".`;
    base.neededInputs = [`${quantity} 측정값`];
    return base;
  }
  if (reading.measured.length > 1) {
    base.reasoning = `측정값이 여러 개로 읽힙니다(${reading.measured.join(', ')} ${unit}) — 어느 값을 판정할지 정할 수 없어 판정하지 않습니다. 값 하나에 문장 하나로 나눠 주세요.`;
    base.neededInputs = ['값 하나씩 나눈 관측값 (문장 하나에 값 하나)'];
    return base;
  }
  const v = reading.measured[0] as number;
  const seen: Judgment = { ...base, observedValue: v, observedUnit: unit };
  if (reading.target === undefined) {
    seen.reasoning = `${label} 값이 없어 판정하지 않습니다 — 허용오차가 ${label}에 따라 다릅니다(${tableText}). 납품서·배합설계서에 적힌 ${label} 값을 함께 적어 주세요 (예: "${quantity} ${v}${unit}, ${label} 150${unit}").`;
    seen.neededInputs = [`${label} (납품서·배합설계서에 적힌 값)`];
    return seen;
  }
  const target = reading.target;
  const pm = toleranceFor(target, table);
  if (pm === null) {
    seen.reasoning = `${label} ${target}${unit} 은 허용오차 표에 없는 값입니다(${tableText}) — 공사시방서·배합설계서가 정한 허용오차로 판정하세요.`;
    seen.neededInputs = [`${label} ${target}${unit} 에 적용할 허용오차 (공사시방서)`];
    return seen;
  }
  const side = (tol: number): 'low' | 'high' | 'in' => (v < target - tol ? 'low' : v > target + tol ? 'high' : 'in');
  const main = side(pm);
  let note = '';
  if (reading.statedPlusMinus !== undefined && reading.statedPlusMinus !== pm) {
    if ((side(reading.statedPlusMinus) === 'in') !== (main === 'in')) {
      seen.reasoning = `문장에 적힌 허용오차 ±${reading.statedPlusMinus}${unit} 와 표의 허용오차 ±${pm}${unit}(${label} ${target}${unit})가 달라 결과가 갈립니다 — 공사시방서가 허용오차를 따로 정했는지 확인하세요.`;
      seen.neededInputs = ['적용할 허용오차의 근거 (공사시방서 또는 표준시방서)'];
      return seen;
    }
    note = ` (문장에 적힌 허용오차 ±${reading.statedPlusMinus}${unit} 로도 결과가 같습니다)`;
  }
  const min = target - pm;
  const max = target + pm;
  const applied: Judgment = {
    ...seen,
    appliedCriterion: { ...(seen.appliedCriterion ?? { unit }), target, plusMinus: pm, min, max },
  };
  const head = `${label} ${target}${unit} → 허용오차 ±${pm}${unit} → 허용범위 ${min}~${max}${unit}.`;
  if (main === 'low') return mk(applied, 'FAIL', 'too_low', v, unit, `${head} 측정 ${v}${unit} < 허용하한 ${min}${unit}${note}`);
  if (main === 'high') return mk(applied, 'FAIL', 'too_high', v, unit, `${head} 측정 ${v}${unit} > 허용상한 ${max}${unit}${note}`);
  const margin = pm * MARGINAL_RATIO;
  if (v < min + margin || v > max - margin) {
    return mk(applied, 'MARGINAL', 'in_range', v, unit, `${head} 측정 ${v}${unit} — 범위 안이지만 경계에서 ${margin}${unit} 이내${note}`);
  }
  return mk(applied, 'PASS', 'in_range', v, unit, `${head} 측정 ${v}${unit} — 범위 안${note}`);
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

const STRENGTH_CASE_LABEL: Record<StrengthCase, string> = {
  ready_mixed: '레디믹스트 콘크리트의 표준양생 공시체',
  site_batch: '현장 배치플랜트 콘크리트',
  field_cured: '현장양생공시체',
  core: '코어',
};
const STRENGTH_CASE_CRITERION: Record<StrengthCase, string> = {
  ready_mixed: 'criteria.compressive_strength_statistical_le35 (호칭강도 35 MPa 초과는 _gt35)',
  site_batch: 'criteria.compressive_strength_site_batch',
  field_cured: 'criteria.compressive_strength_field_cured',
  core: 'criteria.compressive_strength_core',
};
/** 기준 강도 범위를 나누는 경계 (표 3.5-3) */
const RANGE_SPLIT_MPA = 35;

/**
 * 압축강도 판정 — 규칙과 기준 강도는 strength.ts 가 정한다.
 * 입력이 말하는 공시체 종류와 기준 노드가 다루는 종류가 다르면 판정하지 않고 맞는 기준을 알려 준다.
 */
function evalStrength(
  base: Judgment,
  meta: { unit?: string | null; statisticalRule?: string; strengthCase?: StrengthCase },
  series: ObservationToken | null,
  scalar: ObservationToken | null,
  context: ObservationContext,
): Judgment {
  const unit = meta.unit ?? 'MPa';
  const kind: StrengthCase = meta.strengthCase ?? 'ready_mixed';

  if (context.strengthCase !== undefined && context.strengthCase !== kind) {
    return mk(base, 'UNDETERMINED', 'n/a', 0, unit,
      `입력은 ${STRENGTH_CASE_LABEL[context.strengthCase]}의 시험값인데 이 기준은 ${STRENGTH_CASE_LABEL[kind]}용입니다. ${STRENGTH_CASE_CRITERION[context.strengthCase]} 로 판정하세요.`);
  }
  const token = series ?? scalar;
  if (token && !unitsCompatible(token.unit ?? null, meta.unit ?? null)) {
    return mk(base, 'UNDETERMINED', 'n/a', token.value ?? token.mean ?? 0, unit,
      `단위 불일치: 관측 ${token.unit} vs 기준 ${meta.unit}.`);
  }

  const j = judgeStrength(kind, series, scalar, context);
  const observed = j.observedMean ?? j.observedMin ?? 0;

  // 기준 강도가 정해졌는데 이 기준 노드가 다루는 범위 밖이면 다른 쪽 기준으로 보낸다
  const exact = j.bounds !== null && j.bounds.lo === j.bounds.hi;
  if (kind === 'ready_mixed' && exact && j.bounds && (meta.statisticalRule === 'le35' || meta.statisticalRule === 'gt35')) {
    const over = j.bounds.lo > RANGE_SPLIT_MPA;
    if (over !== (meta.statisticalRule === 'gt35')) {
      return mk(base, 'UNDETERMINED', 'n/a', observed, unit,
        `호칭강도 ${j.bounds.lo} MPa 는 이 기준이 다루는 범위(${meta.statisticalRule === 'gt35' ? '35 MPa 초과' : '35 MPa 이하'})가 아닙니다. criteria.compressive_strength_statistical_${over ? 'gt35' : 'le35'} 로 판정하세요.`);
    }
  }

  if (j.bounds) {
    if (base.appliedCriterion) {
      base.appliedCriterion.threshold = exact ? j.bounds.lo : null;
      base.appliedCriterion.referenceSource = j.bounds.basis;
    }
    base.statistical = {
      case: kind,
      ...(j.n !== undefined ? { n: j.n } : {}),
      ...(j.observedMean !== undefined ? { mean: j.observedMean } : {}),
      ...(j.observedMin !== undefined ? { min: j.observedMin } : {}),
      referenceLabel: j.bounds.label,
      reference: j.bounds.lo,
      referenceExact: exact,
      meanCheck: j.meanCheck,
      singleCheck: j.singleCheck,
      partial: j.verdict === 'UNDETERMINED',
    };
  }
  if (j.neededInputs.length > 0) base.neededInputs = j.neededInputs;
  if (j.provisional) base.provisional = j.provisional;

  const direction: FailDirection = j.verdict === 'FAIL' ? 'too_low' : j.verdict === 'PASS' ? 'in_range' : 'n/a';
  return mk(base, j.verdict, direction, observed, unit, j.reasoning);
}
