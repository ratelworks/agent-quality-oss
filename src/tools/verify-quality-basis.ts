// ─────────────────────────────────────────────────────────────────────────────
// verify_quality_basis — 품질 관련 문장의 근거를 검증한다.
//
//   1) 근거로 든 노드 id 가 실제로 있는지
//   2) 문장과 citations 에 적힌 법령 인용(제○조·§·별표·별지 서식)이 수록 원문에 있는지 —
//      확인됨 / 없는 조문 / 확인 불가 (lib/citation-resolver.ts)
//   3) "반드시·법적으로" 같은 강한 표현에 법령 근거가 있는지
// ─────────────────────────────────────────────────────────────────────────────

import { buildResponse, entityBasis } from './_response.js';
import { isStatute, resolveReference, scanCitations } from '../lib/citation-resolver.js';
import type { CitationResolution } from '../lib/citation-resolver.js';
import type { ToolSpec } from '../lib/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

const STRONG_TRIGGERS = [
  '반드시',
  '의무',
  '금지',
  '법적',
  '법적으로',
  '법령에 따라',
  'KCS에 따라',
  '무조건',
  '100%',
];

export const spec: ToolSpec = {
  name: 'verify_quality_basis',
  description:
    'AI 가 쓴 품질 관련 문장의 근거를 검증한다. ① 근거로 든 노드 id 가 실제로 있는지 ② 문장·citations 의 법령 인용(제○조·§·별표·별지 서식)이 수록 원문에 있는지 — 확인됨(confirmed)/없는 조문(not_found)/확인 불가(unverifiable) ③ "반드시·법적으로" 같은 강한 표현에 법령 근거가 있는지. 전 조문을 수록한 법령(건설기술 진흥법·시행령·시행규칙, 품질관리 업무지침, 사업관리방식 지침)에서만 없는 조문을 단정한다. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      statement: { type: 'string', description: '검증할 LLM 생성 문장' },
      claimedBasisIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'AI 가 제시한 근거 노드 id 배열',
      },
      citations: {
        type: 'array',
        items: { type: 'string' },
        description: '확인할 법령 인용 — 예: "건설기술 진흥법 시행령 제89조", "시행규칙 별지 제42호서식"',
      },
    },
    required: ['statement'],
  },
};

export interface VerifyArgs {
  statement: string;
  claimedBasisIds?: string[];
  citations?: string[];
}

interface CitationCheck extends CitationResolution {
  reference: string;
  /** claimed = citations 로 받은 인용 / inline = 문장에서 읽은 인용 */
  source: 'claimed' | 'inline';
}

type BasisReport =
  | { id: string; exists: false; issue: string }
  | {
      id: string;
      exists: true;
      name: string;
      type: string;
      category: string | null;
      legalWeight: string | null;
      basisType: string | null;
    };

export function run(args: VerifyArgs, graph: OntologyGraph) {
  const { statement, claimedBasisIds = [], citations = [] } = args ?? ({ statement: '' } as VerifyArgs);
  if (!statement) throw new Error('statement는 필수입니다.');

  // 법령 인용 — 따로 받은 인용은 한 줄 전체를 읽었을 때만 확인됨으로 하고, 문장 속 인용은 하나씩 읽는다
  const citationChecks: CitationCheck[] = [
    ...citations.map((reference) => ({ reference, source: 'claimed' as const, ...resolveReference(reference) })),
    ...scanCitations(statement).map((c) => ({ ...c, source: 'inline' as const })),
  ];
  const citationSummary = {
    confirmed: citationChecks.filter((c) => c.outcome === 'confirmed').length,
    notFound: citationChecks.filter((c) => c.outcome === 'not_found').length,
    unverifiable: citationChecks.filter((c) => c.outcome === 'unverifiable').length,
  };
  const hasStatuteCitation = citationChecks.some((c) => c.outcome === 'confirmed' && isStatute(c.law));

  const triggeredTerms = STRONG_TRIGGERS.filter((t) => statement.includes(t));

  const basisReport: BasisReport[] = claimedBasisIds.map((id) => {
    const entity = graph.get(id);
    if (!entity) {
      return { id, exists: false, issue: '온톨로지에 존재하지 않는 id — 환각 가능성' };
    }
    return {
      id,
      exists: true,
      name: entity.name,
      type: entity.type,
      category: (entity.meta?.['category'] as string | undefined) ?? null,
      legalWeight: (entity.meta?.['legalWeight'] as string | undefined) ?? null,
      basisType: (entity.meta?.['basisType'] as string | undefined) ?? null,
    };
  });

  const validBases = basisReport.filter((b): b is Extract<BasisReport, { exists: true }> => b.exists);
  const invalidBases = basisReport.filter((b): b is Extract<BasisReport, { exists: false }> => !b.exists);

  // 강한 표현의 근거 — 법적 구속력이 있는 노드, 또는 수록 원문에서 확인된 법·시행령·시행규칙 조문
  const hasMandatory = validBases.some((b) => b.legalWeight === 'mandatory') || hasStatuteCitation;

  let verification:
    | 'nonexistent_citation'
    | 'unsupported_strong_claim'
    | 'partial_hallucination'
    | 'supported'
    | 'no_basis_provided';
  if (citationSummary.notFound > 0) {
    verification = 'nonexistent_citation';
  } else if (triggeredTerms.length > 0 && !hasMandatory) {
    verification = 'unsupported_strong_claim';
  } else if (invalidBases.length > 0) {
    verification = 'partial_hallucination';
  } else if (validBases.length > 0 || citationSummary.confirmed > 0) {
    verification = 'supported';
  } else {
    verification = 'no_basis_provided';
  }

  const notFoundList = citationChecks.filter((c) => c.outcome === 'not_found').map((c) => c.reference).join(', ');
  let recommendation =
    verification === 'nonexistent_citation'
      ? `수록 원문에 없는 조문·별표를 인용함 — ${notFoundList}. 조문 번호를 다시 확인할 것.`
      : verification === 'unsupported_strong_claim'
        ? '"반드시/법적으로" 같은 표현에는 법·시행령·시행규칙 근거가 필요. 표현을 완화하거나 근거를 보강할 것.'
        : verification === 'partial_hallucination'
          ? `존재하지 않는 id ${invalidBases.length}개 — AI 가 id 를 지어냈을 수 있음.`
          : verification === 'supported'
            ? '제시된 근거가 실제로 있음.'
            : '근거가 제시되지 않음. 품질에 관한 주장에는 근거가 있어야 함.';
  if (citationSummary.unverifiable > 0) {
    recommendation += ` 확인하지 못한 인용 ${citationSummary.unverifiable}건 — 틀렸다는 뜻이 아니라 이 도구의 자료로 확인하지 못했다는 뜻이다(법제처 원문으로 확인).`;
  }

  const result = {
    statement,
    triggeredStrongTerms: triggeredTerms,
    claimedBasis: basisReport,
    /** 법령 인용 하나하나의 판정 — outcome: confirmed · not_found · unverifiable */
    citations: citationChecks,
    citationSummary,
    validCount: validBases.length,
    invalidCount: invalidBases.length,
    hasMandatoryBasis: hasMandatory,
    verification,
    recommendation,
  };

  const toolBasisIds = validBases.map((b) => b.id);

  return buildResponse(
    'verify_quality_basis',
    graph.version,
    result,
    toolBasisIds.length > 0
      ? entityBasis(toolBasisIds, 1)
      : [{ type: 'verification_meta', id: 'no_valid_basis', priority: 3, note: verification }],
    verification === 'supported'
      ? { required: false, reason: null }
      : {
          required: true,
          reason: recommendation,
          a2ui: { type: 'decision', options: ['근거 보강', '표현 완화', '주장 철회'] },
        },
  );
}
