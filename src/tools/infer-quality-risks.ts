/**
 * Tool: infer_quality_risks
 */

import { resolveWorkType, searchEntities } from '../ontology/resolver.js';
import { evaluate } from '../judgment/evaluate.js';
import { buildResponse, entityBasis } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';
import type { BaseEntity } from '../ontology/schema.js';

export const spec: ToolSpec = {
  name: 'infer_quality_risks',
  description:
    '공종·자재·관측값을 받아 AcceptanceCriteria로 수치 판정한 뒤, PASS/FAIL/MARGINAL에 맞는 NCR·즉시조치·증빙을 반환. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      workType: { type: 'string', description: '공종 id 또는 자연어' },
      material: { type: 'string', description: '자재 id 또는 자연어 (선택)' },
      observations: {
        type: 'array',
        items: { type: 'string' },
        description: '현장 관측값. 예: ["슬럼프 210mm", "염화물 0.45 kg/㎥"]',
      },
    },
    required: ['workType'],
  },
};

export interface InferArgs {
  workType: string;
  material?: string;
  observations?: string[];
}

interface RiskAgg {
  risk: { id: string; name: string; severity: string };
  triggeringJudgments: Array<{ observation: string; verdict: string; direction: string; reasoning: string }>;
  nonconformance: Array<{
    id: string;
    name: string;
    direction: string | null;
    owner: string | null;
    approver: string | null;
    effectivenessCheck: string | null;
    closureCriteria: string | null;
    possibleCauses: string[];
  }>;
  immediateActions: Array<{ id: string; name: string; urgency?: string }>;
  correctiveActions: Array<{ id: string; name: string; urgency?: string }>;
  evidence: Array<{ id: string; name: string; mandatory: boolean }>;
  possibleCauses: string[];
  basisPriority: string[];
  matchedTests?: string[];
}

export function run(args: InferArgs, graph: OntologyGraph) {
  const { workType, material, observations = [] } = args ?? ({ workType: '' } as InferArgs);
  if (!workType) throw new Error('workType은 필수입니다.');

  let workId = workType;
  if (!graph.get(workType)) {
    const hit = resolveWorkType(graph, workType);
    if (!hit) {
      return buildResponse(
        'infer_quality_risks',
        graph.version,
        { judgments: [], inferredRisks: [] },
        [{ type: 'ontology_meta', id: 'no_match', priority: 3, note: '공종 해석 실패' }],
        { required: true, reason: `공종 해석 실패: ${workType}` },
      );
    }
    workId = hit.id;
  }
  const work = graph.get(workId)!;
  const n1 = graph.neighbors(workId);

  if (observations.length === 0) {
    return buildBaseline(graph, work, n1);
  }

  const judgments: Array<Record<string, unknown>> = [];
  const riskAgg = new Map<string, RiskAgg>();
  const allBasisIds = new Set<string>([workId]);
  let anyHigh = false;
  let anyMarginal = false;
  let anyUndetermined = false;

  for (const obs of observations) {
    const testHit = searchEntities(graph, obs, 'TestItem', 1)[0];
    if (!testHit) {
      judgments.push({
        observation: obs,
        matched: false,
        verdict: 'UNDETERMINED',
        reasoning: '관측값에서 해당 시험항목을 온톨로지에서 식별할 수 없음.',
      });
      anyUndetermined = true;
      continue;
    }

    const testE = graph.get(testHit.id)!;
    const criterionId = (testE.relations?.['hasAcceptanceCriteria'] ?? [])[0];
    const criterion = criterionId ? graph.get(criterionId) : null;
    const j = evaluate(obs, criterion);

    allBasisIds.add(testHit.id);
    if (criterionId) allBasisIds.add(criterionId);

    judgments.push({
      observation: obs,
      matched: true,
      testId: testHit.id,
      testName: testHit.name,
      criterionId: j.criterionId,
      verdict: j.verdict,
      direction: j.direction,
      observedValue: j.observedValue,
      observedUnit: j.observedUnit,
      reasoning: j.reasoning,
    });

    if (j.verdict === 'PASS') continue;
    if (j.verdict === 'UNDETERMINED') {
      anyUndetermined = true;
      continue;
    }
    if (j.verdict === 'MARGINAL') anyMarginal = true;

    const ncrCandidates = (graph.neighbors(testHit.id)['possibleNonconformance'] ?? []).filter(
      (nE) => {
        if (j.verdict === 'FAIL') {
          const ncrDir = nE.meta?.['direction'] as string | undefined;
          return !ncrDir || ncrDir === j.direction || ncrDir === 'out_of_range';
        }
        return true;
      },
    );

    for (const rE of n1['hasQualityRisk'] ?? []) {
      const riskRelTests = rE.relations?.['relatedTest'] ?? [];
      const riskNcrs = rE.relations?.['mayCause'] ?? [];
      const matchByTest = riskRelTests.includes(testHit.id);
      const matchByNcr = riskNcrs.some((id) =>
        (graph.get(id)?.relations?.['relatedTest'] ?? []).includes(testHit.id),
      );
      if (!matchByTest && !matchByNcr) continue;

      let agg = riskAgg.get(rE.id);
      if (!agg) {
        agg = {
          risk: { id: rE.id, name: rE.name, severity: (rE.meta?.['severity'] as string | undefined) ?? 'medium' },
          triggeringJudgments: [],
          nonconformance: [],
          immediateActions: [],
          correctiveActions: [],
          evidence: [],
          possibleCauses: [],
          basisPriority: [],
          matchedTests: [],
        };
        riskAgg.set(rE.id, agg);
      }

      agg.triggeringJudgments.push({
        observation: obs,
        verdict: j.verdict,
        direction: j.direction,
        reasoning: j.reasoning,
      });
      agg.matchedTests?.push(testHit.id);

      for (const nE of ncrCandidates) {
        if (agg.nonconformance.find((n) => n.id === nE.id)) continue;
        allBasisIds.add(nE.id);
        agg.nonconformance.push({
          id: nE.id,
          name: nE.name,
          direction: (nE.meta?.['direction'] as string | undefined) ?? null,
          owner: (nE.meta?.['owner'] as string | undefined) ?? null,
          approver: (nE.meta?.['approver'] as string | undefined) ?? null,
          effectivenessCheck: (nE.meta?.['effectivenessCheck'] as string | undefined) ?? null,
          closureCriteria: (nE.meta?.['closureCriteria'] as string | undefined) ?? null,
          possibleCauses: (nE.meta?.['possibleCauses'] as string[] | undefined) ?? [],
        });
        agg.possibleCauses.push(...((nE.meta?.['possibleCauses'] as string[] | undefined) ?? []));
        for (const aId of nE.relations?.['immediateActions'] ?? []) {
          const aE = graph.get(aId);
          if (aE && !agg.immediateActions.find((a) => a.id === aId)) {
            allBasisIds.add(aId);
            agg.immediateActions.push({
              id: aId,
              name: aE.name,
              urgency: aE.meta?.['urgency'] as string | undefined,
            });
          }
        }
        for (const aId of nE.relations?.['correctiveActions'] ?? []) {
          const aE = graph.get(aId);
          if (aE && !agg.correctiveActions.find((a) => a.id === aId)) {
            allBasisIds.add(aId);
            agg.correctiveActions.push({
              id: aId,
              name: aE.name,
              urgency: aE.meta?.['urgency'] as string | undefined,
            });
          }
        }
        for (const dId of nE.relations?.['requiresEvidence'] ?? []) {
          const dE = graph.get(dId);
          if (dE && !agg.evidence.find((d) => d.id === dId)) {
            allBasisIds.add(dId);
            agg.evidence.push({ id: dId, name: dE.name, mandatory: Boolean(dE.meta?.['mandatory']) });
          }
        }
        for (const bId of nE.relations?.['basisPriority'] ?? []) {
          if (!agg.basisPriority.includes(bId)) agg.basisPriority.push(bId);
          allBasisIds.add(bId);
        }
      }

      if ((agg.risk.severity === 'high' && j.verdict === 'FAIL') || rE.meta?.['severity'] === 'high') {
        anyHigh = true;
      }
    }
  }

  const inferredRisks = [...riskAgg.values()];
  for (const agg of inferredRisks) {
    agg.possibleCauses = [...new Set(agg.possibleCauses)];
  }
  const humanCheckpoint = buildCheckpoint(anyHigh, anyMarginal, anyUndetermined, inferredRisks);

  const summary = { totalObservations: observations.length, fail: 0, marginal: 0, pass: 0, undetermined: 0 };
  for (const j of judgments) {
    const verdict = j['verdict'];
    if (verdict === 'FAIL') summary.fail++;
    else if (verdict === 'MARGINAL') summary.marginal++;
    else if (verdict === 'PASS') summary.pass++;
    else if (verdict === 'UNDETERMINED') summary.undetermined++;
  }

  // 베테랑 품질관리자가 이 상황에서 LLM에 공급할 reasoning context
  const expertContext: string[] = [];
  if (summary.fail > 0) {
    expertContext.push(
      `${summary.fail}건 FAIL 발견. 베테랑 시각: NCR 작성·감리 결재 필요. compile_ncr_references로 작성 재료 수집.`,
    );
  }
  if (summary.marginal > 0) {
    expertContext.push(
      `${summary.marginal}건 경계 근접. 베테랑 시각: 다음 반입차·동일 위치에서 추적 권고. 합부 판정 단언 금지.`,
    );
  }
  if (summary.undetermined > 0) {
    expertContext.push(
      `${summary.undetermined}건 판정 불가. 베테랑 시각: 단위·기준 주입 또는 수동 검토. compile_concrete_pour_references로 도메인 종합 재료 확보.`,
    );
  }
  if (anyHigh) {
    expertContext.push('high severity 리스크 — 구조 안전 영향 가능. 즉시 감리·구조 검토 호출 검토.');
  }

  const result = {
    workType: { id: work.id, name: work.name },
    material: material ?? null,
    judgments,
    inferredRisks,
    summary,
    expertContext,
    humanFallbackNeeded: humanCheckpoint.required,
    judgmentEngineNote:
      '본 응답은 베테랑 품질관리자가 LLM에 공급하는 도메인 reasoning 재료. 부적합 판정·NCR 작성은 LLM·사용자가 별도 결정.',
  };

  return buildResponse(
    'infer_quality_risks',
    graph.version,
    result,
    entityBasis([...allBasisIds], 1),
    humanCheckpoint,
  );
}

function buildBaseline(
  graph: OntologyGraph,
  work: BaseEntity,
  n1: Record<string, BaseEntity[]>,
) {
  const risks = (n1['hasQualityRisk'] ?? []).map((r) => ({
    risk: { id: r.id, name: r.name, severity: (r.meta?.['severity'] as string | undefined) ?? 'medium' },
    triggeringJudgments: [] as unknown[],
    nonconformance: (r.relations?.['mayCause'] ?? [])
      .map((id) => {
        const nE = graph.get(id);
        return nE
          ? { id: nE.id, name: nE.name, direction: (nE.meta?.['direction'] as string | undefined) ?? null }
          : null;
      })
      .filter((x): x is { id: string; name: string; direction: string | null } => x !== null),
  }));
  const basisIds = [work.id, ...risks.map((r) => r.risk.id)];
  for (const r of risks) basisIds.push(...r.nonconformance.map((n) => n.id));

  return buildResponse(
    'infer_quality_risks',
    graph.version,
    {
      workType: { id: work.id, name: work.name },
      mode: 'baseline',
      judgments: [] as unknown[],
      inferredRisks: risks,
      summary: { totalObservations: 0, fail: 0, marginal: 0, pass: 0, undetermined: 0 },
      humanFallbackNeeded: false,
    },
    entityBasis([...new Set(basisIds)], 1),
    { required: false, reason: null },
  );
}

function buildCheckpoint(
  anyHigh: boolean,
  anyMarginal: boolean,
  anyUndetermined: boolean,
  risks: RiskAgg[],
) {
  const reasons: string[] = [];
  if (anyHigh) reasons.push('high severity FAIL 발생 — 품질관리자·감리원 서명 필요');
  if (anyMarginal) reasons.push('허용치 경계(MARGINAL) — 재시험 또는 서면 확인 필요');
  if (anyUndetermined) reasons.push('관측값이 기준과 매칭되지 않음 — 수동 판정 필요');
  if (reasons.length === 0 && risks.some((r) => r.nonconformance.length > 0)) {
    reasons.push('FAIL 부적합 발견 — 부적합 판정 결재 필요');
  }
  if (reasons.length === 0) return { required: false, reason: null };
  return {
    required: true,
    reason: reasons.join(' / '),
    a2ui: { type: 'decision', options: ['부적합 확정', '재시험 지시', '정상 처리 (이의 제기)'] },
  };
}
