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
import type { Judgment } from '../judgment/evaluate.js';
import { judgeBestCriterion } from '../judgment/select-criterion.js';
import { searchEntities } from '../ontology/resolver.js';
import { buildResponse, entityBasis } from './_response.js';
import type { ToolSpec, BasisRef } from '../lib/types.js';
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

  // 기준을 직접 지정하면 그 기준으로, 아니면 시험의 기준 후보 가운데 문장에 맞는 것으로 판정한다
  let criterion: BaseEntity | null | undefined = null;
  let j: Judgment;
  let selectionNote: string | null = null;
  if (criterionId) {
    criterion = graph.get(criterionId);
    j = evaluate(observation, criterion ?? null);
  } else {
    const resolvedTestId = testId ?? searchEntities(graph, observation, 'TestItem', 1)[0]?.id;
    const cids = (resolvedTestId ? graph.get(resolvedTestId)?.relations?.['hasAcceptanceCriteria'] : undefined) ?? [];
    const selected = judgeBestCriterion(graph, cids, observation);
    criterion = selected.criterion;
    j = selected.judgment;
    selectionNote = selected.selectionNote;
  }

  const criterionExpr = criterion ? formatCriterion(criterion) : null;
  const baseContext = inferExpertContext(j.verdict, j.direction, criterion ?? null);
  // 입력 자연어 단서와 testId 의미가 어긋나면(예: "외기온도 33℃" + testId=test.concrete_temperature)
  // 베테랑이 옆에서 환기시킬 만한 한 줄을 prepend.
  const semanticHint = detectSemanticMismatch(observation, criterion ?? null);
  const hints = [semanticHint, selectionNote].filter((h): h is string => !!h);
  const expertContext =
    hints.length > 0 ? `[주의] ${hints.join(' / ')}${baseContext ? ' / ' + baseContext : ''}` : baseContext;

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

  const suggestedNextSteps = buildNextSteps(j.verdict, candidateNcrs, criterion ?? null, j.neededInputs ?? []);

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
    /** 합격·불합격을 확정하려면 더 알려 줘야 하는 것 (없으면 빈 목록) */
    neededInputs: j.neededInputs ?? [],
    /** 가정을 둔 결과 — 확정이 아니다. 가정이 맞는지 확인한 뒤에만 쓴다 */
    provisionalResult: j.provisional ?? null,
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
                : (j.neededInputs ?? []).length > 0
                  ? `판정하지 못함 — 더 필요한 입력: ${(j.neededInputs ?? []).join(' / ')}`
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
  if (criterion.id.startsWith('criteria.concrete_temperature_')) {
    if (/외기|기온|대기|기상|날씨/.test(obs) && !/콘크리트\s*온도|배합\s*온도|타설\s*직후/.test(obs)) {
      return '입력에 "외기/기온"이 포함됨 — 이 기준은 타설할 때의 콘크리트 자체 온도입니다. 기온은 한중·서중 콘크리트로 시공할지 정하는 조건입니다(한중: 타설일의 일평균기온 4℃ 이하 또는 타설 후 24시간 동안 일최저기온 0℃ 이하 예상 — KCS 14 20 40 1.1. 서중: 일평균기온 25℃ 초과 또는 타설 후 24시간 이내 일최고기온 30℃ 초과 예상 — KCS 14 20 41 1.1). 측정 대상을 다시 확인하세요.';
    }
  }
  if (criterion.id.startsWith('criteria.compressive_strength_') && /거푸집|해체|탈형|존치/.test(obs)) {
    return '입력에 거푸집 해체가 나옵니다 — 이 기준은 재령 28일 품질 검사입니다. 거푸집 해체 시기는 testId=test.formwork_stripping_strength 로 판정하세요(KCS 14 20 12 표 3.3-1).';
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
    return '합격·불합격을 정하지 못함 — comparison 의 사유와 neededInputs 를 확인하세요.';
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
  if (id.startsWith('criteria.concrete_temperature_')) {
    return '베테랑 시각: 한중·서중 대책 적용 여부 확인. 배합·운반·양생 단계 점검.';
  }
  if (id.startsWith('criteria.compressive_strength_')) {
    return '베테랑 시각: 양생·배합·공시체 관리 확인. 후속 절차는 KCS 14 20 10 3.5.5.7 — 구조 검토, 관리재령 연장, 비파괴 시험, 코어 채취 순.';
  }
  return '베테랑 시각: 부적합 추정 — 후속 NCR 재료 수집 후 감리 협의.';
}

function buildNextSteps(
  verdict: string,
  candidateNcrs: Array<{ id: string }>,
  criterion: { id: string } | null,
  neededInputs: string[],
): string[] {
  const steps: string[] = [];
  if (verdict === 'FAIL' && candidateNcrs.length > 0) {
    steps.push(
      `compile_ncr_references(ncrId='${candidateNcrs[0]!.id}') 호출해 NCR 작성 재료 수집`,
    );
    steps.push('현장 증빙(납품서·배합설계서·시험기록·사진) 확보');
    steps.push('감리원 결재 요청');
  } else if (verdict === 'UNDETERMINED') {
    if (neededInputs.length > 0) {
      steps.push(`다음을 확인해 observation 에 함께 적어 다시 판정: ${neededInputs.join(' / ')}`);
    } else if (criterion) {
      steps.push('단위·기준값 주입 또는 수동 판정 검토');
    }
    steps.push('compile_concrete_pour_references 호출로 도메인 재료 종합 수집');
  } else if (verdict === 'PASS') {
    steps.push('해당 시험 통과 — 다음 검측·시험 항목으로 이동');
  }
  return steps;
}
