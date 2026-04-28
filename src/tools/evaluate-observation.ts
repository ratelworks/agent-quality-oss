/**
 * Tool: evaluate_observation
 *
 * 출력 형태: **expertAssessment** — 베테랑 품질관리자가 LLM에게 가르치는 형태.
 * - verdict 단언이 아닌 "적용 기준 + 비교 결과 + 도메인 맥락 + 다음 단계" 공급
 * - LLM/사용자가 최종 판정 작성
 *
 * MARGINAL은 합부 판정에서 분리한 주의 플래그 — 업무지침 명시 기준 아님.
 */

import { evaluate } from '../judgment/evaluate.js';
import { parseContext } from '../judgment/parse-observation.js';
import { searchEntities } from '../ontology/resolver.js';
import { buildResponse, entityBasis } from './_response.js';
import type { ToolSpec, BasisRef } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';
import type { BaseEntity } from '../ontology/schema.js';

export const spec: ToolSpec = {
  name: 'evaluate_observation',
  description:
    '관측값 1건을 적용 기준(AcceptanceCriteria)과 비교한 expertAssessment를 반환한다. verdict 단언이 아닌 "적용 기준·비교 결과·도메인 맥락·후보 NCR·다음 단계·법적 근거"를 LLM에 공급. 최종 판정은 품질관리자·감리원·발주자. [근거 제공용]',
  inputSchema: {
    type: 'object',
    properties: {
      observation: { type: 'string', description: '관측값 문자열 (예: "슬럼프 210mm")' },
      criterionId: {
        type: 'string',
        description: 'AcceptanceCriteria id (없으면 testId·관측값에서 자동 해석)',
      },
      testId: { type: 'string', description: '시험 id (criterionId 미지정 시 사용)' },
    },
    required: ['observation'],
  },
};

export interface EvaluateArgs {
  observation: string;
  criterionId?: string;
  testId?: string;
}

export function run(args: EvaluateArgs, graph: OntologyGraph) {
  const { observation, criterionId, testId } = args ?? ({ observation: '' } as EvaluateArgs);
  if (!observation) throw new Error('observation은 필수입니다.');

  let criterion: BaseEntity | null | undefined = null;
  if (criterionId) {
    criterion = graph.get(criterionId);
  } else if (testId) {
    const testE = graph.get(testId);
    const cids = testE?.relations?.['hasAcceptanceCriteria'] ?? [];
    criterion = pickBestCriterion(graph, cids, observation);
  } else {
    const testHit = searchEntities(graph, observation, 'TestItem', 1)[0];
    if (testHit) {
      const testE = graph.get(testHit.id);
      const cids = testE?.relations?.['hasAcceptanceCriteria'] ?? [];
      criterion = pickBestCriterion(graph, cids, observation);
    }
  }

  const j = evaluate(observation, criterion ?? null);

  const criterionExpr = criterion ? formatCriterion(criterion) : null;
  const baseContext = inferExpertContext(j.verdict, j.direction, criterion ?? null);
  // 입력 자연어 단서와 testId 의미가 어긋나면(예: "외기온도 33℃" + testId=test.concrete_temperature)
  // 베테랑이 옆에서 환기시킬 만한 한 줄을 prepend.
  const semanticHint = detectSemanticMismatch(observation, criterion ?? null);
  const expertContext = semanticHint
    ? `[주의] ${semanticHint}${baseContext ? ' / ' + baseContext : ''}`
    : baseContext;

  const candidateNcrs: Array<{ id: string; name: string; direction?: string }> = [];
  if (j.verdict === 'FAIL' && criterion) {
    const targetTest = (criterion.relations?.['appliesTo'] ?? [])[0];
    if (targetTest) {
      const possibleNcrIds = graph.get(targetTest)?.relations?.['possibleNonconformance'] ?? [];
      for (const nid of possibleNcrIds) {
        const ne = graph.get(nid);
        if (!ne) continue;
        const dir = ne.meta?.['direction'] as string | undefined;
        if (!dir || dir === j.direction || dir === 'out_of_range') {
          candidateNcrs.push({ id: ne.id, name: ne.name, direction: dir });
        }
      }
    }
  }

  const suggestedNextSteps = buildNextSteps(j.verdict, candidateNcrs, criterion ?? null);

  const legalBasis: string[] = [];
  if (criterion) {
    for (const refId of criterion.relations?.['derivedFrom'] ?? []) legalBasis.push(refId);
  }

  // legalVerdict(법적 합부)와 qualitySignal(도메인 경계 신호) 분리.
  // PASS+marginalWarning 단일 필드로 두면 downstream이 verdict만 읽고 warning을 놓치므로 분리 필드 유지.
  // MARGINAL은 합부가 아닌 경계 신호이므로 legalVerdict=PASS로 매핑.
  type LegalVerdict = 'PASS' | 'FAIL' | 'UNDETERMINED';
  type QualitySignal = 'in_range' | 'marginal' | 'out_of_range_high' | 'out_of_range_low' | 'undetermined';
  let legalVerdict: LegalVerdict;
  let qualitySignal: QualitySignal;
  switch (j.verdict) {
    case 'PASS':
      legalVerdict = 'PASS';
      qualitySignal = 'in_range';
      break;
    case 'FAIL':
      legalVerdict = 'FAIL';
      qualitySignal = j.direction === 'too_high' ? 'out_of_range_high' : 'out_of_range_low';
      break;
    case 'MARGINAL':
      legalVerdict = 'PASS';
      qualitySignal = 'marginal';
      break;
    default:
      legalVerdict = 'UNDETERMINED';
      qualitySignal = 'undetermined';
  }

  const expertAssessment = {
    observation,
    applicableCriterion: criterionExpr,
    criterionId: j.criterionId,
    observedValue: j.observedValue,
    observedUnit: j.observedUnit,
    comparison: j.reasoning,
    legalVerdict,
    qualitySignal,
    /** @deprecated `legalVerdict` + `qualitySignal` 사용 권고. backward-compat 위해 유지. */
    verdict: legalVerdict,
    direction: j.direction,
    expertContext,
    marginalWarning:
      qualitySignal === 'marginal'
        ? {
            flagged: true,
            note:
              '허용치 경계 근접 — 재시험 또는 품질관리자 확인 권고. 본 경계치는 업무지침 명시 기준이 아닌 경험적 보조 지표.',
          }
        : null,
    candidateNonconformance: candidateNcrs,
    suggestedNextSteps,
    legalBasis,
    judgmentEngineNote:
      'legalVerdict(법적 합부) ≠ qualitySignal(도메인 경계 신호). MARGINAL은 합부 판정에서 분리 — legalVerdict=PASS이지만 qualitySignal=marginal. UNDETERMINED는 판정 불가(수동). 본 expertAssessment는 LLM이 최종 판정을 작성할 재료.',
  };

  const basisIds: string[] = [];
  if (criterion) basisIds.push(criterion.id);
  if (testId) basisIds.push(testId);
  for (const id of legalBasis) basisIds.push(id);
  for (const c of candidateNcrs) basisIds.push(c.id);

  const needsHuman =
    legalVerdict === 'FAIL' || legalVerdict === 'UNDETERMINED' || qualitySignal === 'marginal';

  return buildResponse(
    'evaluate_observation',
    graph.version,
    { expertAssessment },
    basisIds.length > 0
      ? entityBasis([...new Set(basisIds)], 1)
      : [{ type: 'judgment_meta', id: 'undetermined', priority: 3, note: '기준 미상' }],
    needsHuman
      ? {
          required: true,
          reason:
            legalVerdict === 'FAIL'
              ? '부적합 판정 후보 — NCR 작성 + 감리 결재 필요'
              : qualitySignal === 'marginal'
                ? '경계 근접 (qualitySignal=marginal) — 재시험 또는 품질관리자 확인 권고'
                : '판정 불가 (legalVerdict=UNDETERMINED) — 수동 처리 필요',
        }
      : { required: false, reason: null },
  );
}

function formatCriterion(c: {
  id: string;
  name: string;
  meta?: Record<string, unknown>;
}): string {
  const m = c.meta ?? {};
  const op = m['operator'] as string | undefined;
  const unit = (m['unit'] as string | undefined) ?? '';
  const ref = m['reference'] as string | undefined;
  let expr = c.name;
  // threshold가 프로젝트 주입 대기 상태일 때 "≥ null MPa" 같은 누출 텍스트를 막는다.
  const t = m['threshold'];
  const hasThreshold = t !== null && t !== undefined;
  const thresholdLabel = hasThreshold ? String(t) : '<프로젝트 주입 대기>';
  switch (op) {
    case 'tolerance':
      expr = `${m['target']} ± ${m['plusMinus']} ${unit}`;
      break;
    case 'between':
      expr = `[${m['min']} ~ ${m['max']}] ${unit}`;
      break;
    case 'le':
      expr = `≤ ${thresholdLabel} ${unit}`;
      break;
    case 'lt':
      expr = `< ${thresholdLabel} ${unit}`;
      break;
    case 'ge':
      expr = `≥ ${thresholdLabel} ${unit}`;
      break;
    case 'gt':
      expr = `> ${thresholdLabel} ${unit}`;
      break;
    default:
      break;
  }
  if (ref) expr += ` (${ref})`;
  return expr;
}

/**
 * 입력 자연어와 criterion이 가리키는 측정 대상의 의미가 어긋나면 환기 메시지 반환.
 * 예: 사용자는 "외기온도 33℃"라고 적었는데 testId/criterion은 콘크리트 자체 온도.
 */
function detectSemanticMismatch(
  observation: string,
  criterion: { id: string } | null,
): string | null {
  if (!criterion) return null;
  const obs = observation.toLowerCase();
  if (criterion.id === 'criteria.concrete_temperature_general') {
    if (/외기|기온|대기|기상|날씨/.test(obs) && !/콘크리트\s*온도|배합\s*온도|타설\s*직후/.test(obs)) {
      return '입력에 "외기/기온"이 포함됨 — 본 기준은 콘크리트 자체 온도(KCS 14 20 10). 외기온도 한도는 한중(<4℃)·서중(>30℃) 별도 규정. 측정 대상 재확인 필요.';
    }
  }
  return null;
}

function inferExpertContext(
  verdict: string,
  direction: string,
  criterion: { id: string; meta?: Record<string, unknown> } | null,
): string | null {
  if (!criterion) return null;
  if (verdict === 'PASS') return '관측값이 허용범위 내. 베테랑 시각: 일상 합격.';
  if (verdict === 'UNDETERMINED') {
    return '베테랑 시각: 자동 비교 불가 — 단위·기준 주입 또는 수동 검토 필요.';
  }
  if (verdict === 'MARGINAL') {
    return '베테랑 시각: 경계 근접 — 다음 반입차·동일 위치 후속 시험에서 흐름 추적 권고.';
  }
  const id = criterion.id;
  if (id === 'criteria.slump_general_150') {
    return direction === 'too_high'
      ? '베테랑 시각: 운반 지연·가수·혼화제 과다 의심. 납품서·배합설계 재확인 우선.'
      : '베테랑 시각: 외기 고온·배합수 부족·운반 시간 초과 의심. 펌프 압송 영향 확인.';
  }
  if (id === 'criteria.chloride_limit_030') {
    return '베테랑 시각: 해사 사용·배합수 오염 의심 — 강재 부식 직결되므로 즉시 반송이 표준.';
  }
  if (id === 'criteria.air_content_general' || id.startsWith('criteria.air_content_')) {
    return '베테랑 시각: AE제 투입량·배합 변경·운반 중 공기량 손실 의심.';
  }
  if (id === 'criteria.compressive_strength_design') {
    return '베테랑 시각: 양생 불량·배합수 과다·공시체 관리 의심 — 코어·비파괴로 후속 검증.';
  }
  if (id === 'criteria.concrete_temperature_general') {
    return '베테랑 시각: 한중·서중 대책 적용 여부 확인. 배합·운반·양생 단계 점검.';
  }
  return '베테랑 시각: 부적합 추정 — 후속 NCR 재료 수집 후 감리 협의.';
}

/**
 * R1: testItem.hasAcceptanceCriteria 후보 중 observation에 가장 적합한 것을 선택.
 *
 * 우선순위:
 *  1. statistical_threshold criterion 중 fcn(또는 fck)에 맞는 분기 (le35/gt35) 선택
 *  2. deprecated criterion은 항상 후순위
 *  3. 그 외에는 첫 번째
 */
function pickBestCriterion(
  graph: OntologyGraph,
  cids: string[],
  observation: string,
): BaseEntity | null {
  if (cids.length === 0) return null;
  const ctx = parseContext(observation);
  const candidates = cids.map((id) => graph.get(id)).filter((e): e is BaseEntity => e != null);

  // statistical 모드 분기 선택
  const statCandidates = candidates.filter(
    (c) => (c.meta as Record<string, unknown>)?.['operator'] === 'statistical_threshold',
  );
  if (statCandidates.length > 0 && (ctx.fcn !== undefined || ctx.fck !== undefined)) {
    const fcn = ctx.fcn ?? ctx.fck!;
    const wanted = fcn <= 35 ? 'le35' : 'gt35';
    const match = statCandidates.find(
      (c) => (c.meta as Record<string, unknown>)?.['statisticalRule'] === wanted,
    );
    if (match) return match;
    // fallback: statistical 첫 번째
    return statCandidates[0]!;
  }

  // deprecated 후순위 정렬
  const sorted = [...candidates].sort((a, b) => {
    const ad = (a.meta as Record<string, unknown>)?.['deprecated'] === true ? 1 : 0;
    const bd = (b.meta as Record<string, unknown>)?.['deprecated'] === true ? 1 : 0;
    return ad - bd;
  });

  // statistical criterion이 있으면 (fcn 미주입 상태) 그것을 우선 — UNDETERMINED라도
  // deprecated design보다 정확한 메시지("fcn 미주입")를 준다.
  const statFirst = sorted.find(
    (c) => (c.meta as Record<string, unknown>)?.['operator'] === 'statistical_threshold',
  );
  if (statFirst) return statFirst;

  return sorted[0] ?? null;
}

function buildNextSteps(
  verdict: string,
  candidateNcrs: Array<{ id: string }>,
  criterion: { id: string } | null,
): string[] {
  const steps: string[] = [];
  if (verdict === 'FAIL' && candidateNcrs.length > 0) {
    steps.push(
      `compile_ncr_references(ncrId='${candidateNcrs[0]!.id}') 호출해 NCR 작성 재료 수집`,
    );
    steps.push('현장 증빙(납품서·배합설계서·시험기록·사진) 확보');
    steps.push('감리원 결재 요청');
  } else if (verdict === 'UNDETERMINED') {
    if (criterion) steps.push('단위·기준값 주입 또는 수동 판정 검토');
    steps.push('compile_concrete_pour_references 호출로 도메인 재료 종합 수집');
  } else if (verdict === 'PASS') {
    steps.push('해당 시험 통과 — 다음 검측·시험 항목으로 이동');
  }
  return steps;
}
