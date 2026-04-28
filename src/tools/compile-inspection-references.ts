import { resolveWorkType } from '../ontology/resolver.js';
import { getSchema } from '../schemas/loader.js';
import { buildResponse } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

export const spec: ToolSpec = {
  name: 'compile_inspection_references',
  description:
    '검측 1회 입회에 필요한 재료 패키지를 반환한다. 체크포인트 + 증빙 목록 + ITP 양식 + 감리 입회 근거 법령. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      workType: { type: 'string', description: '공종' },
      stage: { type: 'string', description: 'before | during | after (선택)' },
    },
    required: ['workType'],
  },
};

export interface CompileInspectionArgs {
  workType: string;
  stage?: 'before' | 'during' | 'after';
}

export function run(args: CompileInspectionArgs, graph: OntologyGraph) {
  const { workType, stage } = args ?? ({ workType: '' } as CompileInspectionArgs);
  if (!workType) throw new Error('workType은 필수입니다.');

  const workId = graph.get(workType) ? workType : resolveWorkType(graph, workType)?.id;
  if (!workId) {
    return buildResponse(
      'compile_inspection_references',
      graph.version,
      { error: '공종 해석 실패' },
      [{ type: 'ontology_meta', id: 'no_match', priority: 3, note: '공종 해석 실패' }],
      { required: true, reason: `공종 해석 실패: ${workType}` },
    );
  }

  const work = graph.get(workId)!;
  const n1 = graph.neighbors(workId);
  let checkpoints = n1['hasInspectionCheckpoint'] ?? [];
  if (stage) {
    checkpoints = checkpoints.filter((c) => c.meta?.['stage'] === stage);
  }

  const allEvidence = new Map<string, { id: string; name: string; mandatory: boolean }>();
  const allStandards = new Map<
    string,
    { id: string; name: string; category?: string; legalWeight?: string }
  >();
  for (const c of checkpoints) {
    for (const d of graph.neighbors(c.id)['requiresEvidence'] ?? []) {
      allEvidence.set(d.id, {
        id: d.id,
        name: d.name,
        mandatory: Boolean(d.meta?.['mandatory']),
      });
    }
    for (const s of graph.neighbors(c.id)['isBasedOn'] ?? []) {
      allStandards.set(s.id, {
        id: s.id,
        name: s.name,
        category: s.meta?.['category'] as string | undefined,
        legalWeight: s.meta?.['legalWeight'] as string | undefined,
      });
    }
  }

  for (const id of ['standard.law.btia_55', 'standard.guideline.part2_art10']) {
    const e = graph.get(id);
    if (e && !allStandards.has(id)) {
      allStandards.set(id, {
        id: e.id,
        name: e.name,
        category: e.meta?.['category'] as string | undefined,
        legalWeight: e.meta?.['legalWeight'] as string | undefined,
      });
    }
  }

  const itpSchema = getSchema('itp');

  const result = {
    workType: { id: work.id, name: work.name },
    stage: stage ?? 'all',
    checkpoints: checkpoints.map((c) => ({
      id: c.id,
      name: c.name,
      stage: c.meta?.['stage'] as string | undefined,
    })),
    requiredEvidence: [...allEvidence.values()],
    legalReferences: [...allStandards.values()],
    forms: {
      itp: itpSchema
        ? { schemaId: itpSchema.id, title: itpSchema.title, sections: itpSchema.sections }
        : null,
    },
    usage: '이 패키지로 검측요청서·체크리스트 초안을 LLM이 조립. 감리 입회 결과는 별도 서명 필요.',
  };

  const basisIds = [
    work.id,
    ...checkpoints.map((c) => c.id),
    ...allEvidence.keys(),
    ...allStandards.keys(),
  ];

  return buildResponse(
    'compile_inspection_references',
    graph.version,
    result,
    [...new Set(basisIds)].map((id) => ({ type: 'ontology', id, priority: 1 })),
  );
}
