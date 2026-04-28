import { searchEntities } from '../ontology/resolver.js';
import { buildResponse, entityBasis } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

export const spec: ToolSpec = {
  name: 'search_quality_management_guideline',
  description:
    '건설공사 품질관리 업무지침(국토교통부 고시 2025-311호) 조항을 검색한다. 키워드 또는 편(part) 번호로 조회. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '검색어 (선택)' },
      part: { type: 'string', description: '편 번호 예: 제2편, 제3편 (선택)' },
    },
  },
};

export interface SearchGuidelineArgs {
  query?: string;
  part?: string;
}

export function run(args: SearchGuidelineArgs, graph: OntologyGraph) {
  const { query, part } = args ?? {};
  const guidelines = graph.byStandardCategory('guideline');

  let filtered = guidelines;
  if (part) {
    filtered = filtered.filter((s) => String(s.meta?.['part'] ?? '').includes(part));
  }
  if (query) {
    // 1차: 전체 query로 substring 매칭
    const hits = searchEntities(graph, query, 'Standard', 30);
    const hitIds = new Set(hits.map((h) => h.id));
    // 2차: 다중 토큰 fallback. "부적합 발주청 보고"처럼 여러 키워드가 한 조항에 분산된 경우.
    // name·scope·meta.scope 본문에 토큰이 하나라도 포함되면 매칭.
    if (hitIds.size === 0) {
      const tokens = query
        .split(/\s+/)
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length >= 2);
      if (tokens.length > 0) {
        for (const s of guidelines) {
          const hay = [
            s.name,
            String(s.meta?.['scope'] ?? ''),
            String(s.meta?.['summary'] ?? ''),
          ]
            .join(' ')
            .toLowerCase();
          if (tokens.some((t) => hay.includes(t))) hitIds.add(s.id);
        }
      }
    }
    filtered = filtered.filter((s) => hitIds.has(s.id));
  }

  const result = {
    query: query ?? null,
    part: part ?? null,
    count: filtered.length,
    items: filtered.map((s) => ({
      id: s.id,
      name: s.name,
      part: s.meta?.['part'] as string | undefined,
      articleNo: (s.meta?.['articleNo'] as string | undefined) ?? null,
      scope: s.meta?.['scope'] as string | undefined,
      skeleton: Boolean(s.meta?.['skeleton']),
    })),
    sourceNote: '국토교통부 고시 2025-311호 (2025.6.12 시행). 원문은 국가법령정보센터 참조.',
  };

  return buildResponse(
    'search_quality_management_guideline',
    graph.version,
    result,
    filtered.length > 0
      ? entityBasis(filtered.map((s) => s.id), 1)
      : [{ type: 'ontology_meta', id: 'no_match', priority: 3, note: '검색 결과 없음' }],
  );
}
