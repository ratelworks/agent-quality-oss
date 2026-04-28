/**
 * Tool: get_work_quality_profile
 */

import { resolveWorkType } from '../ontology/resolver.js';
import { buildResponse, entityBasis } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

export const spec: ToolSpec = {
  name: 'get_work_quality_profile',
  description:
    '공종 하나의 전체 품질관리 프로파일(자재/시험/검측/리스크/증빙)을 반환한다. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      workType: { type: 'string', description: '공종 id(work.*) 또는 자연어 표현' },
    },
    required: ['workType'],
  },
};

export interface WorkProfileArgs {
  workType: string;
}

export function run(args: WorkProfileArgs, graph: OntologyGraph) {
  const { workType } = args ?? ({ workType: '' } as WorkProfileArgs);
  if (!workType) throw new Error('workType은 필수입니다.');

  let workId = workType;
  let matchedBy: string = 'exact';
  if (!graph.get(workType)) {
    const hit = resolveWorkType(graph, workType);
    if (!hit) {
      return buildResponse(
        'get_work_quality_profile',
        graph.version,
        { input: workType, profile: null },
        [{ type: 'ontology_meta', id: 'no_match', priority: 3, note: '공종 해석 실패' }],
        { required: true, reason: `공종 해석 실패: ${workType}` },
      );
    }
    workId = hit.id;
    matchedBy = hit.matchedBy;
  }

  const work = graph.get(workId);
  if (!work || work.type !== 'WorkType') {
    return buildResponse(
      'get_work_quality_profile',
      graph.version,
      { input: workType, profile: null },
      [{ type: 'ontology_meta', id: 'not_worktype', priority: 3, note: `${workId}는 WorkType 아님` }],
      { required: true, reason: `id ${workId}는 WorkType이 아닙니다.` },
    );
  }

  const n1 = graph.neighbors(workId);
  const materials = (n1['usesMaterial'] ?? []).map((m) => ({ id: m.id, name: m.name }));

  const tests = new Map<string, { id: string; name: string; meta: Record<string, unknown> }>();
  const testDocs = new Map<string, { id: string; name: string; mandatory: boolean }>();
  for (const m of n1['usesMaterial'] ?? []) {
    const mn = graph.neighbors(m.id);
    for (const t of mn['requiresTest'] ?? []) {
      tests.set(t.id, { id: t.id, name: t.name, meta: t.meta ?? {} });
      for (const d of graph.neighbors(t.id)['requiresEvidence'] ?? []) {
        testDocs.set(d.id, { id: d.id, name: d.name, mandatory: Boolean(d.meta?.['mandatory']) });
      }
    }
    for (const d of mn['requiresDocument'] ?? []) {
      testDocs.set(d.id, { id: d.id, name: d.name, mandatory: Boolean(d.meta?.['mandatory']) });
    }
  }

  const checkpoints = (n1['hasInspectionCheckpoint'] ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    stage: (c.meta?.['stage'] as string | undefined) ?? null,
  }));

  for (const c of n1['hasInspectionCheckpoint'] ?? []) {
    for (const d of graph.neighbors(c.id)['requiresEvidence'] ?? []) {
      testDocs.set(d.id, { id: d.id, name: d.name, mandatory: Boolean(d.meta?.['mandatory']) });
    }
  }

  const risks = (n1['hasQualityRisk'] ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    severity: (r.meta?.['severity'] as string | undefined) ?? 'medium',
  }));

  const standards = (n1['requiresStandard'] ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    reference: (s.meta?.['reference'] as string | undefined) ?? null,
  }));

  const result = {
    workType: {
      id: work.id,
      name: work.name,
      parent: (work.meta?.['parent'] as string | undefined) ?? null,
      matchedBy,
    },
    materials,
    tests: [...tests.values()],
    inspectionCheckpoints: checkpoints,
    qualityRisks: risks,
    standards,
    requiredEvidence: [...testDocs.values()].sort(
      (a, b) => Number(b.mandatory === true) - Number(a.mandatory === true),
    ),
  };

  const basisIds = [
    work.id,
    ...materials.map((m) => m.id),
    ...tests.keys(),
    ...checkpoints.map((c) => c.id),
    ...risks.map((r) => r.id),
    ...standards.map((s) => s.id),
  ];

  return buildResponse('get_work_quality_profile', graph.version, result, entityBasis(basisIds, 1));
}
