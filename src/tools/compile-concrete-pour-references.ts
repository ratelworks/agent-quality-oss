import { resolveWorkType } from '../ontology/resolver.js';
import { getSchema } from '../schemas/loader.js';
import { buildResponse } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

export const spec: ToolSpec = {
  name: 'compile_concrete_pour_references',
  description:
    '콘크리트 타설 1회에 필요한 모든 근거 재료를 한 패키지로 반환한다. 공종 프로파일 · 기준(criteria) · 관련 KCS·지침 · 레미콘 기록지·공시체 기록지 양식 스키마 포함. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      workType: { type: 'string', description: '공종 (기본 work.concrete_placement)' },
    },
  },
};

export interface CompilePourArgs {
  workType?: string;
}

export function run(args: CompilePourArgs, graph: OntologyGraph) {
  const { workType = 'work.concrete_placement' } = args ?? {};
  const workId = graph.get(workType)
    ? workType
    : resolveWorkType(graph, workType)?.id ?? 'work.concrete_placement';

  const work = graph.get(workId);
  if (!work) {
    return buildResponse(
      'compile_concrete_pour_references',
      graph.version,
      { error: 'workType 해석 실패' },
      [{ type: 'ontology_meta', id: 'no_match', priority: 3, note: '공종 해석 실패' }],
      { required: true, reason: `공종 해석 실패: ${workType}` },
    );
  }

  const n1 = graph.neighbors(workId);
  const materials = (n1['usesMaterial'] ?? []).map((m) => ({ id: m.id, name: m.name }));
  const checkpoints = (n1['hasInspectionCheckpoint'] ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    stage: c.meta?.['stage'] as string | undefined,
  }));
  const risks = (n1['hasQualityRisk'] ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    severity: (r.meta?.['severity'] as string | undefined) ?? 'medium',
  }));

  const tests = new Map<
    string,
    { id: string; name: string; method?: string; frequency?: string; typicalAcceptance?: string }
  >();
  const criteria = new Map<string, Record<string, unknown>>();
  for (const m of n1['usesMaterial'] ?? []) {
    for (const t of graph.neighbors(m.id)['requiresTest'] ?? []) {
      tests.set(t.id, {
        id: t.id,
        name: t.name,
        method: t.meta?.['method'] as string | undefined,
        frequency: t.meta?.['frequency'] as string | undefined,
        typicalAcceptance: t.meta?.['typicalAcceptance'] as string | undefined,
      });
      for (const c of graph.neighbors(t.id)['hasAcceptanceCriteria'] ?? []) {
        criteria.set(c.id, {
          id: c.id,
          name: c.name,
          operator: c.meta?.['operator'],
          target: c.meta?.['target'],
          plusMinus: c.meta?.['plusMinus'],
          min: c.meta?.['min'],
          max: c.meta?.['max'],
          threshold: c.meta?.['threshold'],
          unit: c.meta?.['unit'],
          reference: c.meta?.['reference'],
        });
      }
    }
  }

  const legal = (n1['requiresStandard'] ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    category: (s.meta?.['category'] as string | undefined) ?? null,
    legalWeight: (s.meta?.['legalWeight'] as string | undefined) ?? null,
    basisType: (s.meta?.['basisType'] as string | undefined) ?? null,
  }));
  for (const gid of [
    'standard.guideline.part2_art6',
    'standard.guideline.part2_art7',
    'standard.guideline.part3',
  ]) {
    const g = graph.get(gid);
    if (g && !legal.find((l) => l.id === gid)) {
      legal.push({
        id: g.id,
        name: g.name,
        category: (g.meta?.['category'] as string | undefined) ?? null,
        legalWeight: (g.meta?.['legalWeight'] as string | undefined) ?? null,
        basisType: (g.meta?.['basisType'] as string | undefined) ?? null,
      });
    }
  }

  const deliverySchema = getSchema('concrete_delivery_record');
  const specimenSchema = getSchema('specimen_record');

  const result = {
    workType: { id: work.id, name: work.name },
    materials,
    tests: [...tests.values()],
    acceptanceCriteria: [...criteria.values()],
    inspectionCheckpoints: checkpoints,
    qualityRisks: risks,
    legalReferences: legal,
    forms: {
      deliveryRecord: deliverySchema
        ? { schemaId: deliverySchema.id, title: deliverySchema.title, sections: deliverySchema.sections }
        : null,
      specimenRecord: specimenSchema
        ? { schemaId: specimenSchema.id, title: specimenSchema.title, sections: specimenSchema.sections }
        : null,
    },
    usage:
      '이 패키지를 LLM에 전달하면 타설 1회 기록 초안(레미콘·공시체·타설 중 검측)을 조립할 수 있다. 실제 판정은 evaluate_observation Tool + 사용자 서명.',
  };

  const basisIds = [
    work.id,
    ...materials.map((m) => m.id),
    ...[...tests.keys()],
    ...[...criteria.keys()],
    ...checkpoints.map((c) => c.id),
    ...risks.map((r) => r.id),
    ...legal.map((l) => l.id),
  ];

  return buildResponse(
    'compile_concrete_pour_references',
    graph.version,
    result,
    [...new Set(basisIds)].map((id) => ({ type: 'ontology', id, priority: 1 })),
  );
}
