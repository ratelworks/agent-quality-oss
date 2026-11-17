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
import { describeTable, isToleranceTable } from '../judgment/target-tolerance.js';
import { searchEntities } from '../ontology/resolver.js';
import { spotNodes } from '../knowledge/field-search.js';
import { expandFieldTerms } from '../knowledge/field-phrases.js';
import { buildResponse, entityBasis } from './_response.js';
import { cite } from '../knowledge/cite.js';
import { relatedPenalties, relatedSanctions } from '../knowledge/penalty-points.js';
import type { ToolSpec, BasisRef } from '../lib/types.js';
import type { OntologyGraph } from '../ontology/graph.js';
import type { BaseEntity } from '../ontology/schema.js';

/** 콘크리트공사 표준시방서 노드 id 의 앞부분 */
const CONCRETE_STANDARD_PREFIX = 'standard.kcs_14_20';
const QUALITY_GUIDELINE = '건설공사 품질관리 업무지침';
/**
 * 불합격이면 즉시 반품하는 시험 — 업무지침 제41조제1항의 호와 그 호의 원문 구절.
 * 판정만 주고 그다음 처리(반품·확약서·재시공)를 주지 않아 AI 비서가 반품을 빠뜨린 답이 있었다.
 */
const REJECT_ITEM_BY_TEST: Record<string, { item: string; quote: string }> = {
  'test.slump': { item: '1', quote: '슬럼프(Slump) 측정결과 해당공사 시방기준에 벗어나는 경우' },
  'test.air_content': { item: '2', quote: '공기량 측정결과 해당공사 시방기준에 벗어나는 경우' },
  'test.chloride': { item: '3', quote: '염화물이온량(Cl-) 측정결과 해당공사 시방기준에 벗어나는 경우' },
  'test.asphalt_marshall': { item: '6', quote: '마샬 안정도 측정결과 해당공사 시방기준에 벗어나는 경우' },
  'test.asphalt_content': { item: '7', quote: '역청함유량 및 추출입도 측정결과 해당공사 시방기준에 벗어나는 경우' },
};

/**
 * 불합격 뒤의 처리 — 즉시 반품·확약서·재시공 원칙(업무지침 제41조)과 자재 벌점·벌칙. 원문 구절 그대로.
 * 제41조의 반품 조건은 "해당 공사 시방기준"을 벗어난 경우다. 판정에 쓴 기준이 표준시방서 값(공사시방서에 다른 값이
 * 없을 때 쓰는 기준)이면 이 공사의 시방기준으로도 벗어났는지 확인한 뒤 적용하도록 조건을 단다 — 단정하지 않는다.
 */
function rejectionHandling(testId: string | undefined, criterion: BaseEntity | null): Record<string, unknown> | null {
  const rule = testId ? REJECT_ITEM_BY_TEST[testId] : undefined;
  if (!rule) return null;
  const reference = typeof criterion?.meta?.['reference'] === 'string' ? (criterion.meta['reference'] as string) : '표준시방서';
  const appliesIf =
    criterion?.meta?.['fallbackToProject'] === true
      ? `판정에 쓴 기준은 ${reference} 의 값으로, 공사시방서에 다른 값이 없을 때 쓰는 기준입니다. 아래 처리는 이 공사의 공사시방서 기준으로도 벗어났을 때 적용합니다 — 공사시방서 값이 다르면 그 값으로 다시 판정하세요.`
      : `아래 처리는 이 공사의 시방기준을 벗어났을 때 적용합니다 — 판정에 쓴 기준(${reference})이 이 공사의 공사시방서 기준과 같은지 확인하세요.`;
  return {
    /** 이 처리를 적용하는 조건 — 이 공사의 시방기준을 벗어났을 때 */
    appliesIf,
    ref: `${QUALITY_GUIDELINE} 제41조제1항제${rule.item}호`,
    returnImmediately: cite({ law: QUALITY_GUIDELINE, article: '41', quote: '불량자재가 발생한 경우 즉시 반품하여야 한다' }),
    item: cite({ law: QUALITY_GUIDELINE, article: '41', quote: rule.quote }),
    disposalPledge: cite({ law: QUALITY_GUIDELINE, article: '41', quote: '불량자재폐기 확약서를 생산자에게 징구하여 준공시까지 보관하여야 한다' }),
    ifAlreadyPlaced: cite({ law: QUALITY_GUIDELINE, article: '41', quote: '불량자재가 사용되어 시공된 부위는 재시공함을 원칙으로 한다' }),
    relatedPenalties: relatedPenalties(['topic:material']),
    relatedSanctions: relatedSanctions(['topic:material']),
    note: '이 공사의 시방기준을 벗어난 자재는 즉시 반품하고(제1항), 생산자에게 불량자재폐기 확약서(별지 제13호)를 받아 준공 때까지 보관합니다(제2항). 이미 시공했으면 재시공이 원칙이고, 발주청 승인을 받아 안전진단 등으로 안전에 이상이 없다고 판명된 경우만 그 결과를 따를 수 있습니다(제5항). 벌점·벌칙은 who·조건과 함께 알립니다. 반품·재시공 결정은 공사감독자·감리원이 합니다.',
  };
}

export const spec: ToolSpec = {
  name: 'evaluate_observation',
  description:
    '관측값 1건을 적용 기준(AcceptanceCriteria)과 비교한 expertAssessment를 반환한다. verdict 단언이 아닌 "적용 기준·비교 결과·도메인 맥락·후보 NCR·다음 단계·법적 근거"를 LLM에 공급. 최종 판정은 품질관리자·감리원·발주자. [근거 제공용]',
  inputSchema: {
    type: 'object',
    properties: {
      observation: {
        type: 'string',
        description:
          '관측값 문장. 값 하나에 한 번 부른다 — 같은 시험의 측정값이 여러 개면(여러 차량·측점·재시험) 값마다 따로 부르고, 하나만 골라 넣지 않는다. ' +
          '슬럼프는 호칭 슬럼프를 함께 적는다 (예: "슬럼프 210mm, 호칭 슬럼프 150mm"). 레미콘 규격은 풀어 쓰지 말고 그대로 적는다 (예: "슬럼프 195mm, 규격 25-27-180" — 굵은골재 최대치수-호칭강도-슬럼프 순서라 셋째 수 180 을 호칭 슬럼프로 읽는다). ' +
          '압축강도는 회마다의 기록을 한 문장에 함께 적는다 (예: "압축강도 1회 25.1 24.6 25.9 / 2회 23.8 24.4 23.6 / 3회 26.2 25.5 25.7 MPa, 호칭강도 24MPa" — 공시체 3개의 평균이 1회 시험값이고 합격은 연속 3회로 본다. 1회만 있으면 "압축강도 공시체 3개 25.1, 26.4, 27.8 MPa, 호칭강도 27MPa"). ' +
          '사용자가 말한 기준 강도의 이름을 그대로 적는다 — 설계기준강도라고 했으면 "설계기준강도 27MPa" 로 적고 호칭강도로 바꿔 적지 않는다(둘은 다른 값이다). 콘크리트 종류(경량골재·포장·고강도)와 부위·조건(노상·한중 등)도 함께 적는다.',
      },
      criterionId: {
        type: 'string',
        description: 'AcceptanceCriteria id (없으면 testId·관측값에서 자동 해석)',
      },
      testId: {
        type: 'string',
        description:
          '시험 id (예: test.slump). 생략하면 문장에 적힌 시험 이름으로 찾는다. id 는 search_quality_ontology 로 확인한다 — 짐작해서 넣지 않는다.',
      },
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
  /** 판정에 쓴 시험 — 어떻게 정했는지와 함께 답에 밝힌다 */
  let resolvedTest: { id: string; name: string; by: 'testId' | 'observation' } | null = null;
  /** 받은 id 가 온톨로지에 없을 때의 안내 */
  const idNotes: string[] = [];
  if (criterionId && graph.get(criterionId)?.type !== 'AcceptanceCriteria') {
    idNotes.push(`criterionId '${criterionId}' 는 온톨로지에 없는 판정기준 id 입니다`);
  }
  if (criterionId && idNotes.length === 0) {
    criterion = graph.get(criterionId);
    j = evaluate(observation, criterion ?? null);
  } else {
    const given = testId ? graph.get(testId) : undefined;
    if (testId && given?.type !== 'TestItem') {
      idNotes.push(`testId '${testId}' 는 온톨로지에 없는 시험 id 입니다`);
    }
    if (given?.type === 'TestItem') {
      resolvedTest = { id: given.id, name: given.name, by: 'testId' };
    } else {
      const found = searchEntities(graph, observation, 'TestItem', 1)[0]?.id ?? spotTest(graph, observation);
      const entity = found ? graph.get(found) : undefined;
      if (entity) resolvedTest = { id: entity.id, name: entity.name, by: 'observation' };
    }
    const cids = (resolvedTest ? graph.get(resolvedTest.id)?.relations?.['hasAcceptanceCriteria'] : undefined) ?? [];
    const selected = judgeBestCriterion(graph, cids, observation);
    criterion = selected.criterion;
    j = selected.judgment;
    selectionNote = selected.selectionNote;
    if (!criterion) {
      // 기준을 찾지 못한 까닭을 구분해 알린다 — 시험을 못 알아본 것과 그 시험의 기준이 없는 것은 다르다
      const why = resolvedTest
        ? `'${resolvedTest.name}'(${resolvedTest.id}) 의 판정기준이 온톨로지에 없습니다 — 시험방법·시험빈도는 search_quality_test_standards 로, 합격 기준은 공사시방서와 해당 표준시방서로 확인하세요.`
        : '문장에서 어떤 시험인지 알아보지 못했습니다 — 시험 이름을 문장에 적거나, search_quality_ontology 로 찾은 testId·criterionId 를 지정하세요.';
      // 기준이 없으면 문장의 수가 무엇의 값인지 정할 수 없다 — 여러 수의 평균("항복강도 412 인장강도 548" → 480)을 측정값으로 내보내지 않는다
      j = { ...j, observedValue: null, observedUnit: null, reasoning: [...idNotes, why].join(' / ') };
    } else if (idNotes.length > 0 && resolvedTest) {
      idNotes.push(`문장에 적힌 이름으로 '${resolvedTest.name}'(${resolvedTest.id}) 시험을 골라 판정했습니다`);
    }
  }

  const criterionExpr = criterion ? formatCriterion(criterion, j.appliedCriterion) : null;
  const baseContext = inferExpertContext(j.verdict, j.direction, criterion ?? null);
  // 입력 자연어 단서와 testId 의미가 어긋나면(예: "외기온도 33℃" + testId=test.concrete_temperature)
  // 베테랑이 옆에서 환기시킬 만한 한 줄을 prepend.
  const semanticHint = detectSemanticMismatch(observation, criterion ?? null);
  const hints = [...(criterion ? idNotes : []), semanticHint, selectionNote].filter((h): h is string => !!h);
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

  const suggestedNextSteps = buildNextSteps(
    j.verdict,
    candidateNcrs,
    criterion ?? null,
    j.neededInputs ?? [],
    // 콘크리트공사 표준시방서(KCS 14 20)에 근거한 기준인가
    (criterion?.relations?.['derivedFrom'] ?? []).some((id) => id.startsWith(CONCRETE_STANDARD_PREFIX)),
  );

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

  // 같은 시험에 조건별 기준이 여럿이면(공기량: 보통·경량골재·포장·고강도) 어느 조건의 기준으로 판정했는지 밝힌다
  const siblingCriteria = resolvedTest ? (graph.get(resolvedTest.id)?.relations?.['hasAcceptanceCriteria'] ?? []) : [];
  const condition = typeof criterion?.meta?.['condition'] === 'string' ? (criterion.meta['condition'] as string) : null;
  const appliedCondition =
    criterion && condition && siblingCriteria.length > 1 && (legalVerdict === 'PASS' || legalVerdict === 'FAIL')
      ? {
          condition,
          note: `'${condition}' 조건의 기준으로 판정했습니다. 문장에 다른 조건이 적혀 있지 않으면 이 결과를 그대로 씁니다. 조건이 다르면(${siblingCriteria
            .filter((id) => id !== criterion?.id)
            .map((id) => graph.get(id)?.name)
            .filter((name): name is string => !!name)
            .join(' · ')}) 그 조건을 문장에 적어 다시 판정하세요.`,
        }
      : null;
  // 판정에 쓴 기준의 근거 상태를 한 문장으로 — basis 목록의 다른 항목(시험 항목·시험방법 표준) 상태와 섞어 읽지 않게 한다
  const criterionStatus = typeof criterion?.meta?.['sourceStatus'] === 'string' ? (criterion.meta['sourceStatus'] as string) : null;
  const reference = typeof criterion?.meta?.['reference'] === 'string' ? (criterion.meta['reference'] as string) : null;
  const criterionSource = criterion
    ? criterionStatus === 'verified'
      ? `판정에 쓴 기준${reference ? `(${reference})` : ''}은 기준 원문과 대조했습니다. basis 의 시험 항목·시험방법 표준(KS)에 붙은 상태 표시는 판정 수치와 무관합니다 — KS 는 표준 번호와 이름만 대조했고 본문은 싣지 않습니다.`
      : `판정에 쓴 기준의 근거 상태는 '${criterionStatus ?? 'unknown'}' 입니다 — 기준 원문을 확인하기 전에는 이 결과를 확정으로 쓰지 마세요.`
    : null;

  const expertAssessment = {
    observation,
    /** 판정에 쓴 시험 — by: 'testId'(받은 id) | 'observation'(문장에 적힌 이름으로 찾음) */
    resolvedTest,
    applicableCriterion: criterionExpr,
    criterionId: j.criterionId,
    /** 판정에 쓴 기준이 적용되는 조건 — 같은 시험에 조건별 기준이 여럿일 때만 (없으면 null) */
    appliedCondition,
    /** 판정에 쓴 기준의 근거 상태 */
    criterionSource,
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
    /** 불합격이면 그다음 처리 — 즉시 반품·확약서·재시공(업무지침 제41조), 자재 벌점·벌칙. 반품 대상 시험이 아니거나 불합격이 아니면 null */
    ifRejected: legalVerdict === 'FAIL' ? rejectionHandling(resolvedTest?.id ?? (criterion?.relations?.['appliesTo'] ?? [])[0], criterion ?? null) : null,
    suggestedNextSteps,
    legalBasis,
    judgmentEngineNote:
      'legalVerdict(법적 합부) ≠ qualitySignal(도메인 경계 신호). MARGINAL은 합부 판정에서 분리 — legalVerdict=PASS이지만 qualitySignal=marginal. UNDETERMINED는 판정 불가(수동). 본 expertAssessment는 LLM이 최종 판정을 작성할 재료.',
  };

  const basisIds: string[] = [];
  if (criterion) basisIds.push(criterion.id);
  if (resolvedTest) basisIds.push(resolvedTest.id);
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

function formatCriterion(
  c: { id: string; name: string; meta?: Record<string, unknown> },
  applied?: { target?: number; plusMinus?: number } | null,
): string {
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
    case 'tolerance_by_target': {
      // 지정값을 읽었으면 그 값의 허용범위를, 아니면 허용오차 표를 보여 준다
      const table = m['toleranceTable'];
      const label = (m['targetLabel'] as string | undefined) ?? '지정값';
      if (applied?.target !== undefined && applied.plusMinus !== undefined) {
        expr = `${label} ${applied.target} ± ${applied.plusMinus} ${unit}`;
      } else if (isToleranceTable(table)) {
        expr = `${label} ± 허용오차 (${describeTable(table, unit)})`;
      }
      break;
    }
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
  if (id === 'criteria.slump_tolerance') {
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

/** 문장에 이름·별칭이 그대로 적힌 시험 — 이름이 긴 것, 판정기준이 있는 것부터 */
function spotTest(graph: OntologyGraph, observation: string): string | undefined {
  const hasCriteria = (id: string): number => ((graph.get(id)?.relations?.['hasAcceptanceCriteria'] ?? []).length > 0 ? 1 : 0);
  const tests = spotNodes(graph, expandFieldTerms(observation))
    .filter((h) => h.entity.type === 'TestItem')
    .sort(
      (a, b) =>
        b.score - a.score ||
        hasCriteria(b.entity.id) - hasCriteria(a.entity.id) ||
        (a.entity.id < b.entity.id ? -1 : 1),
    );
  return tests[0]?.entity.id;
}

function buildNextSteps(
  verdict: string,
  candidateNcrs: Array<{ id: string }>,
  criterion: { id: string } | null,
  neededInputs: string[],
  isConcreteTest: boolean,
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
      if (neededInputs.some((n) => n.includes('연속 3회'))) {
        steps.push(
          '다른 회의 시험값이 있으면 따로 부르지 말고 한 문장에 함께 적어 다시 판정 — 예: "압축강도 1회 25.1 24.6 25.9 / 2회 23.8 24.4 23.6 / 3회 26.2 25.5 25.7 MPa, 호칭강도 24MPa"',
        );
      }
    } else if (criterion) {
      steps.push('단위·기준값 주입 또는 수동 판정 검토');
    }
    if (!criterion) {
      steps.push('search_quality_ontology 또는 discover_relevant_domain 으로 시험·판정기준을 찾아 testId·criterionId 를 지정해 다시 판정');
      steps.push('search_quality_test_standards 로 시험방법·시험빈도 확인');
    } else if (isConcreteTest) {
      steps.push('compile_concrete_pour_references 호출로 도메인 재료 종합 수집');
    } else {
      steps.push('discover_relevant_domain 으로 관련 공종·검측·부적합 확인');
    }
  } else if (verdict === 'PASS') {
    steps.push('해당 시험 통과 — 다음 검측·시험 항목으로 이동');
  }
  return steps;
}
