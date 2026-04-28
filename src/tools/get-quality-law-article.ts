import { buildResponse, entityBasis } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

export const spec: ToolSpec = {
  name: 'get_quality_law_article',
  description:
    '법령 조항 id(standard.law.*) 또는 조항 이름을 받아 요약·적용 범위·법적 구속력·공식 링크를 반환한다. 원문 텍스트는 포함하지 않는다. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      articleId: { type: 'string', description: '법령 조항 id (예: standard.law.btia_55)' },
    },
    required: ['articleId'],
  },
};

export interface GetArticleArgs {
  articleId: string;
}

export function run(args: GetArticleArgs, graph: OntologyGraph) {
  const { articleId } = args ?? ({ articleId: '' } as GetArticleArgs);
  if (!articleId) throw new Error('articleId는 필수입니다.');

  const entity = graph.get(articleId);
  if (!entity || entity.type !== 'Standard' || !entity.meta?.['category']) {
    return buildResponse(
      'get_quality_law_article',
      graph.version,
      { article: null },
      [{ type: 'ontology_meta', id: 'not_found', priority: 3, note: `법령 조항 아님: ${articleId}` }],
      {
        required: true,
        reason: `${articleId}는 내장 법령/지침/서식이 아닙니다. list_core_quality_laws로 조회 가능 목록 확인.`,
      },
    );
  }

  const meta = entity.meta;
  const result = {
    article: {
      id: entity.id,
      name: entity.name,
      category: meta['category'] as string | undefined,
      lawName:
        (meta['lawName'] as string | undefined) ??
        (meta['referenceDoc'] as string | undefined) ??
        null,
      articleNo:
        (meta['articleNo'] as string | undefined) ??
        (meta['section'] as string | undefined) ??
        null,
      scope: meta['scope'] as string | undefined,
      legalWeight: meta['legalWeight'] as string | undefined,
      basisType: meta['basisType'] as string | undefined,
      issuer: (meta['issuer'] as string | undefined) ?? null,
      effectiveFrom: (meta['effectiveFrom'] as string | undefined) ?? null,
      url:
        (meta['url'] as string | undefined) ??
        (meta['sourceUrl'] as string | undefined) ??
        null,
      aliases: entity.aliases ?? [],
    },
    sourceNote: '원문 텍스트는 국가법령정보센터(law.go.kr)에서 확인. 본 서버는 조항 요약·식별자만 제공.',
  };

  return buildResponse('get_quality_law_article', graph.version, result, entityBasis([entity.id], 1));
}
