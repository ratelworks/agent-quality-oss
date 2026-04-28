import { buildResponse, entityBasis } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

export const spec: ToolSpec = {
  name: 'list_core_quality_laws',
  description:
    '한국 건설 품질관리에 관련된 핵심 법령(법률·시행령·시행규칙·행정규칙) 목록을 반환한다. 원문은 포함하지 않으며 조항 요약·식별자·링크만 제공. category(law/decree/rule/guideline)로 필터 가능. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'law | decree | rule | guideline (선택)' },
    },
  },
};

const LAW_CATEGORIES = ['law', 'decree', 'rule', 'guideline'] as const;
type LawCategory = (typeof LAW_CATEGORIES)[number];

export interface ListLawsArgs {
  category?: LawCategory;
}

export function run(args: ListLawsArgs, graph: OntologyGraph) {
  const { category } = args ?? {};
  const all = graph.all('Standard').filter((s) => {
    const cat = s.meta?.['category'];
    return typeof cat === 'string' && (LAW_CATEGORIES as readonly string[]).includes(cat);
  });
  const filtered = category ? all.filter((s) => s.meta?.['category'] === category) : all;

  const result = {
    category: category ?? 'all',
    count: filtered.length,
    items: filtered.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.meta?.['category'] as string | undefined,
      articleNo: (s.meta?.['articleNo'] as string | undefined) ?? null,
      legalWeight: s.meta?.['legalWeight'] as string | undefined,
      basisType: s.meta?.['basisType'] as string | undefined,
      scope: (s.meta?.['scope'] as string | undefined) ?? null,
    })),
    sourceNote:
      '원문은 국가법령정보센터(law.go.kr)에서 최신 개정본 확인 필수. 본 데이터는 식별자·조항 요약만 제공.',
  };

  return buildResponse(
    'list_core_quality_laws',
    graph.version,
    result,
    entityBasis(filtered.map((s) => s.id), 1),
  );
}
