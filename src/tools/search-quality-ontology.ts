/**
 * Tool: search_quality_ontology
 */

import { searchEntities } from '../ontology/resolver.js';
import { buildResponse, entityBasis } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';
import type { EntityType } from '../ontology/schema.js';

export const spec: ToolSpec = {
  name: 'search_quality_ontology',
  description:
    '건설 품질관리 온톨로지에서 공종·자재·시험·검측·리스크·부적합 노드를 검색한다. alias·부분 일치 지원. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '검색어 (한국어 자유 표현 가능)' },
      entityType: {
        type: 'string',
        description:
          '선택: 특정 엔티티 타입만 (WorkType, Material, TestItem, InspectionCheckpoint, QualityRisk, Nonconformance, CorrectiveAction, EvidenceDocument, Standard)',
      },
      limit: { type: 'number', description: '최대 결과 수 (기본 10)' },
    },
    required: ['query'],
  },
};

export interface SearchArgs {
  query: string;
  entityType?: EntityType;
  limit?: number;
}

export function run(args: SearchArgs, graph: OntologyGraph) {
  const { query, entityType, limit = 10 } = args ?? ({ query: '' } as SearchArgs);
  if (!query || typeof query !== 'string') {
    throw new Error('query는 필수 문자열입니다.');
  }
  const hits = searchEntities(graph, query, entityType, limit);

  const result = {
    query,
    entityType: entityType ?? null,
    matchCount: hits.length,
    matches: hits.map((h) => ({
      id: h.id,
      type: h.type,
      name: h.name,
      matchedBy: h.matchedBy,
      score: Number(h.score.toFixed(3)),
    })),
  };

  const basis =
    hits.length > 0
      ? entityBasis(
          hits.map((h) => h.id),
          1,
        )
      : [
          {
            type: 'ontology_meta',
            id: 'no_match',
            priority: 3,
            note: '매칭 0건 — 온톨로지 확장 필요 가능성',
          },
        ];

  const humanCheckpoint =
    hits.length === 0
      ? {
          required: true,
          reason: `검색어 "${query}"에 매칭되는 온톨로지 노드 없음. 표현 변경 또는 신규 엔티티 등록 필요.`,
        }
      : undefined;

  return buildResponse('search_quality_ontology', graph.version, result, basis, humanCheckpoint);
}
