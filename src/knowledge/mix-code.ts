// ─────────────────────────────────────────────────────────────────────────────
// mix-code.ts — 레디믹스트 콘크리트 규격 "굵은골재 최대치수-호칭강도-슬럼프"(예: 25-24-150)를 풀어 읽는다.
//
// 규격의 세 수와, 그 규격으로 정해지는 판정 조건을 계산해 돌려준다.
//   슬럼프 허용범위   — 셋째 수(호칭 슬럼프)와 슬럼프 허용오차 표(기준 노드)
//   압축강도 조건     — 둘째 수(호칭강도)와 표 3.5-3 규칙(기준 노드: 35 MPa 이하 / 초과)
// 둘째 수는 호칭강도다 — 설계기준강도가 아니다. AI 비서가 규격을 스스로 풀다 수의 자리를 바꿔 읽던 일을 막는다.
// ─────────────────────────────────────────────────────────────────────────────

import { MIX_CODE_RE } from '../judgment/parse-observation.js';
import { isToleranceTable, toleranceFor } from '../judgment/target-tolerance.js';
import type { OntologyGraph } from '../ontology/graph.js';
import type { BaseEntity } from '../ontology/schema.js';

// ───── 상수 ─────
/** 압축강도 1회 시험값 조건이 바뀌는 호칭강도 (KCS 14 20 10 표 3.5-3) */
const STRENGTH_RANGE_SPLIT_MPA = 35;
/** 호칭강도 35 MPa 이하 — 1회 시험값 ≥ 호칭강도 − 3.5 MPa */
const LOW_RANGE_MARGIN_MPA = 3.5;
/** 호칭강도 35 MPa 초과 — 1회 시험값 ≥ 호칭강도 × 0.9 */
const HIGH_RANGE_RATIO = 0.9;
const NOTATION = '굵은골재 최대치수(mm)-호칭강도(MPa)-슬럼프(mm)';

export interface MixCodeReading {
  code: string;
  /** 규격으로 읽지 못했으면 그 까닭 */
  error?: string;
  notation?: string;
  maxAggregateSizeMm?: number;
  nominalStrengthMPa?: number;
  nominalSlumpMm?: number;
  slump?: { range: [number, number]; plusMinus: number; criterionId: string; reference: string | null } | null;
  strength?: { meanAtLeast: number; singleAtLeast: number; rule: string; criterionId: string; reference: string | null } | null;
  notes: string[];
}

function metaOf(e: BaseEntity): Record<string, unknown> {
  return (e.meta ?? {}) as Record<string, unknown>;
}

function criteriaOf(graph: OntologyGraph, testId: string): BaseEntity[] {
  return graph.neighbors(testId)['hasAcceptanceCriteria'] ?? [];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** 레미콘 규격을 풀어 읽는다 */
export function decodeMixCode(code: string, graph: OntologyGraph): MixCodeReading {
  const m = String(code ?? '').match(MIX_CODE_RE);
  if (!m) {
    return {
      code,
      error: `레미콘 규격으로 읽지 못했습니다 — "${NOTATION}" 모양으로 적어 주세요 (예: 25-24-150).`,
      notes: [],
    };
  }
  const aggregate = Number(m[1]);
  const strength = Number(m[2]);
  const slump = Number(m[3]);
  const notes = [
    `둘째 수 ${strength} 은 호칭강도(MPa)입니다 — 설계기준강도가 아닙니다. 첫째 수 ${aggregate} 은 굵은골재 최대치수(mm)입니다.`,
  ];

  // 슬럼프 허용범위 — 호칭 슬럼프에 따른 허용오차 표
  let slumpView: MixCodeReading['slump'] = null;
  const slumpCriterion = criteriaOf(graph, 'test.slump').find((c) => metaOf(c)['operator'] === 'tolerance_by_target');
  const table = slumpCriterion ? metaOf(slumpCriterion)['toleranceTable'] : undefined;
  if (slumpCriterion && isToleranceTable(table)) {
    const pm = toleranceFor(slump, table);
    if (pm !== null) {
      slumpView = {
        range: [slump - pm, slump + pm],
        plusMinus: pm,
        criterionId: slumpCriterion.id,
        reference: (metaOf(slumpCriterion)['reference'] as string | undefined) ?? null,
      };
    } else {
      notes.push(`호칭 슬럼프 ${slump} mm 에 맞는 허용오차가 표에 없어 허용범위를 계산하지 않았습니다.`);
    }
  }

  // 압축강도 판정 조건 — 레디믹스트 콘크리트, 호칭강도로부터 배합을 정한 경우
  let strengthView: MixCodeReading['strength'] = null;
  const wantedRule = strength <= STRENGTH_RANGE_SPLIT_MPA ? 'le35' : 'gt35';
  const strengthCriterion = criteriaOf(graph, 'test.compressive_strength').find(
    (c) => metaOf(c)['operator'] === 'statistical_threshold' && metaOf(c)['statisticalRule'] === wantedRule && (metaOf(c)['strengthCase'] ?? 'ready_mixed') === 'ready_mixed',
  );
  if (strengthCriterion) {
    const single = wantedRule === 'le35' ? round1(strength - LOW_RANGE_MARGIN_MPA) : round1(strength * HIGH_RANGE_RATIO);
    strengthView = {
      meanAtLeast: strength,
      singleAtLeast: single,
      rule:
        wantedRule === 'le35'
          ? `① 연속 3회 시험값의 평균 ≥ ${strength} MPa ② 1회 시험값 ≥ ${strength} − ${LOW_RANGE_MARGIN_MPA} = ${single} MPa (공시체 3개의 평균이 1회 시험값)`
          : `① 연속 3회 시험값의 평균 ≥ ${strength} MPa ② 1회 시험값 ≥ ${strength} × ${HIGH_RANGE_RATIO} = ${single} MPa (공시체 3개의 평균이 1회 시험값)`,
      criterionId: strengthCriterion.id,
      reference: (metaOf(strengthCriterion)['reference'] as string | undefined) ?? null,
    };
  }

  return {
    code: m[0],
    notation: NOTATION,
    maxAggregateSizeMm: aggregate,
    nominalStrengthMPa: strength,
    nominalSlumpMm: slump,
    slump: slumpView,
    strength: strengthView,
    notes,
  };
}
