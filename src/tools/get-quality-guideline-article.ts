import { buildResponse, entityBasis } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

export const spec: ToolSpec = {
  name: 'get_quality_guideline_article',
  description:
    '건설공사 품질관리 업무지침의 특정 조항(standard.guideline.*) 요약을 반환한다. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      articleId: { type: 'string', description: '조항 id (예: standard.guideline.part2_art7)' },
    },
    required: ['articleId'],
  },
};

export interface GetGuidelineArgs {
  articleId: string;
}

export function run(args: GetGuidelineArgs, graph: OntologyGraph) {
  const { articleId } = args ?? ({ articleId: '' } as GetGuidelineArgs);
  if (!articleId) throw new Error('articleId는 필수입니다.');

  const entity = graph.get(articleId);
  if (!entity || entity.meta?.['category'] !== 'guideline') {
    return buildResponse(
      'get_quality_guideline_article',
      graph.version,
      { article: null },
      [{ type: 'ontology_meta', id: 'not_found', priority: 3, note: '지침 조항 아님' }],
      {
        required: true,
        reason: `${articleId}는 업무지침 조항이 아닙니다. search_quality_management_guideline으로 조회.`,
      },
    );
  }

  const result = {
    article: {
      id: entity.id,
      name: entity.name,
      part: entity.meta?.['part'] as string | undefined,
      articleNo: (entity.meta?.['articleNo'] as string | undefined) ?? null,
      scope: entity.meta?.['scope'] as string | undefined,
      legalWeight: entity.meta?.['legalWeight'] as string | undefined,
      basisType: entity.meta?.['basisType'] as string | undefined,
      relatedForm: (entity.meta?.['relatedForm'] as string | undefined) ?? null,
      skeleton: Boolean(entity.meta?.['skeleton']),
    },
    sourceNote: '국토교통부 고시 2025-311호 — 원문 확인 필수.',
  };

  return buildResponse(
    'get_quality_guideline_article',
    graph.version,
    result,
    entityBasis([entity.id], 1),
  );
}
