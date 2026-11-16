/**
 * Tool: search_quality_ontology
 */

import { searchEntities } from '../ontology/resolver.js';
import { searchNodesBySentence } from '../knowledge/field-search.js';
import { buildResponse, entityBasis } from './_response.js';
import type { ToolSpec } from '../lib/types.js';
import type { OntologyGraph } from '../ontology/graph.js';
import type { EntityType } from '../ontology/schema.js';

export const spec: ToolSpec = {
  name: 'search_quality_ontology',
  description:
    '건설 품질관리 온톨로지에서 공종·자재·시험·판정기준·검측·리스크·부적합 노드를 검색한다. 이름·별칭으로 찾고, 여러 낱말이나 문장으로 넣어 이름으로 찾지 못하면 문장에 든 이름과 글 내용으로 찾는다. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '검색어 (한국어 자유 표현 가능)' },
      entityType: {
        type: 'string',
        description:
          '선택: 특정 엔티티 타입만 (WorkType, Material, TestItem, AcceptanceCriteria, InspectionCheckpoint, QualityRisk, Nonconformance, CorrectiveAction, EvidenceDocument, Standard)',
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
  let hits: Array<{ id: string; type: string; name: string; matchedBy: string; score: number }> = searchEntities(
    graph,
    query,
    entityType,
    limit,
  );
  if (hits.length === 0) {
    // 여러 낱말·문장으로 넣은 경우 — 문장에 든 이름(name_in_query)과 글 내용(sentence)으로 찾는다
    hits = searchNodesBySentence(graph, query, limit * 4)
      .filter((h) => !entityType || h.entity.type === entityType)
      .slice(0, limit)
      .map((h) => ({
        id: h.entity.id,
        type: h.entity.type,
        name: h.entity.name,
        matchedBy: h.matchedBy === 'name' ? 'name_in_query' : 'sentence',
        score: h.score,
      }));
  }

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
