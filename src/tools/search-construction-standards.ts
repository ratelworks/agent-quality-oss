import { searchEntities } from '../ontology/resolver.js';
import { buildResponse, entityBasis } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

export const spec: ToolSpec = {
  name: 'search_construction_standards',
  description:
    '국가건설기준(KCS/KDS) 섹션을 검색한다. 원문은 포함하지 않으며 섹션 번호·제목·범위만 반환. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '검색어 (선택)' },
      series: { type: 'string', description: 'KCS | KDS (선택)' },
    },
  },
};

export interface SearchStandardsArgs {
  query?: string;
  series?: 'KCS' | 'KDS';
}

export function run(args: SearchStandardsArgs, graph: OntologyGraph) {
  const { query, series } = args ?? {};
  const standards = graph.all('Standard').filter((s) => {
    const id = s.id;
    if (series === 'KCS') return id.startsWith('standard.kcs_');
    if (series === 'KDS') return id.startsWith('standard.kds_');
    return id.startsWith('standard.kcs_') || id.startsWith('standard.kds_');
  });

  let filtered = standards;
  if (query) {
    const hits = searchEntities(graph, query, 'Standard', 50);
    const hitIds = new Set(hits.map((h) => h.id));
    filtered = standards.filter((s) => hitIds.has(s.id));
  }

  const result = {
    query: query ?? null,
    series: series ?? 'all',
    count: filtered.length,
    items: filtered.map((s) => ({
      id: s.id,
      name: s.name,
      sectionRef: (s.meta?.['sectionRef'] as string | undefined) ?? null,
      granularity: (s.meta?.['granularity'] as string | undefined) ?? null,
      scope: (s.meta?.['scope'] as string | undefined) ?? null,
      parent: (s.meta?.['parent'] as string | undefined) ?? null,
    })),
    sourceNote:
      '국가건설기준센터 kcsc.re.kr 원문 확인 필수. 공공누리 유형 2(변경금지) — 본 서버는 식별자·메타만 제공.',
  };

  return buildResponse(
    'search_construction_standards',
    graph.version,
    result,
    filtered.length > 0
      ? entityBasis(filtered.map((s) => s.id), 1)
      : [{ type: 'ontology_meta', id: 'no_match', priority: 3, note: '검색 결과 없음' }],
  );
}
