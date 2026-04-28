import { searchEntities } from '../ontology/resolver.js';
import { buildResponse, entityBasis } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';
import type { BaseEntity } from '../ontology/schema.js';

export const spec: ToolSpec = {
  name: 'get_standard_form_locator',
  description:
    '법정 별지 서식(시행규칙 별지 제XX호, 업무지침 별표/별지)의 locator를 반환한다. 원본 양식은 포함되지 않으며 공식 출처에서 다운로드해야 한다. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      formId: { type: 'string', description: '서식 id (예: standard.form.rule_no42_quality_inspection_register). query와 택1' },
      query: { type: 'string', description: '서식 검색어 (선택, formId와 택1)' },
    },
  },
};

export interface FormLocatorArgs {
  formId?: string;
  query?: string;
}

export function run(args: FormLocatorArgs, graph: OntologyGraph) {
  const { formId, query } = args ?? {};
  if (!formId && !query) throw new Error('formId 또는 query 중 하나는 필수입니다.');

  if (formId) {
    const e = graph.get(formId);
    if (!e || e.meta?.['category'] !== 'form') {
      return buildResponse(
        'get_standard_form_locator',
        graph.version,
        { form: null },
        [{ type: 'ontology_meta', id: 'not_found', priority: 3, note: '서식 아님' }],
        { required: true, reason: `${formId}는 법정 서식이 아닙니다.` },
      );
    }
    return buildResponse(
      'get_standard_form_locator',
      graph.version,
      { form: toLocator(e), mode: 'single' },
      entityBasis([e.id], 1),
    );
  }

  const hits = searchEntities(graph, query!, 'Standard', 30);
  const forms = hits
    .map((h) => graph.get(h.id))
    .filter((e): e is BaseEntity => e != null && e.meta?.['category'] === 'form');

  if (forms.length === 0) {
    // 환각 명칭(incorrectAliases) 매칭 — 사용자가 잘못된 명칭으로 검색해도 정정 안내
    const norm = query!.toLowerCase();
    const allForms = graph.byStandardCategory('form');
    const corrected = allForms.find((f) => {
      const incorrect = (f.meta?.['incorrectAliases'] as string[] | undefined) ?? [];
      return incorrect.some((bad) => bad.toLowerCase().includes(norm) || norm.includes(bad.toLowerCase()));
    });
    if (corrected) {
      return buildResponse(
        'get_standard_form_locator',
        graph.version,
        {
          mode: 'search',
          query,
          count: 1,
          forms: [toLocator(corrected)],
          correctionNote: `"${query}"는 알려진 환각 명칭. 정확한 명칭은 "${corrected.name}".`,
        },
        entityBasis([corrected.id], 1),
        {
          required: true,
          reason: `"${query}"는 잘못된 명칭. "${corrected.name}"로 정정 권고.`,
        },
      );
    }
    return buildResponse(
      'get_standard_form_locator',
      graph.version,
      { forms: [], mode: 'search', query },
      [{ type: 'ontology_meta', id: 'no_match', priority: 3, note: '일치 서식 없음' }],
      { required: true, reason: `"${query}"에 해당하는 법정 서식이 내장되어 있지 않음.` },
    );
  }

  return buildResponse(
    'get_standard_form_locator',
    graph.version,
    { mode: 'search', query, count: forms.length, forms: forms.map(toLocator) },
    entityBasis(forms.map((f) => f.id), 1),
  );
}

function toLocator(e: BaseEntity) {
  return {
    id: e.id,
    name: e.name,
    issuer: e.meta?.['issuer'] as string | undefined,
    referenceDoc: e.meta?.['referenceDoc'] as string | undefined,
    section: (e.meta?.['section'] as string | undefined) ?? null,
    relatedArticle: (e.meta?.['relatedArticle'] as string | undefined) ?? null,
    effectiveFrom: (e.meta?.['effectiveFrom'] as string | undefined) ?? null,
    sourceUrl: (e.meta?.['sourceUrl'] as string | undefined) ?? null,
    sourceHash: (e.meta?.['sourceHash'] as string | null | undefined) ?? null,
    sourceHashAlgo: (e.meta?.['sourceHashAlgo'] as string | undefined) ?? 'sha256',
    license: (e.meta?.['license'] as string | undefined) ?? 'unspecified',
    legalWeight: (e.meta?.['legalWeight'] as string | undefined) ?? null,
    redistributionNote:
      '본 서식의 원본은 공공누리 4유형(변경금지)이므로 npm/GitHub에 포함되지 않는다. 공식 출처에서 다운로드하여 사용할 것.',
  };
}
