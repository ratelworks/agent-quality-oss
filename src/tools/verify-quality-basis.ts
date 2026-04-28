import { buildResponse, entityBasis } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
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
    'LLM이 생성한 품질 관련 문장의 근거를 검증한다. 강한 표현("반드시·법적으로") 자동 탐지 + 근거 id 실존 확인 + legalWeight 분류. 환각 방지 게이트. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      statement: { type: 'string', description: '검증할 LLM 생성 문장' },
      claimedBasisIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'LLM이 제시한 근거 id 배열',
      },
    },
    required: ['statement'],
  },
};

export interface VerifyArgs {
  statement: string;
  claimedBasisIds?: string[];
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
  const { statement, claimedBasisIds = [] } = args ?? ({ statement: '' } as VerifyArgs);
  if (!statement) throw new Error('statement는 필수입니다.');

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

  const hasMandatory = validBases.some((b) => b.legalWeight === 'mandatory');

  let verification: 'unsupported_strong_claim' | 'partial_hallucination' | 'supported' | 'no_basis_provided';
  if (triggeredTerms.length > 0 && !hasMandatory) {
    verification = 'unsupported_strong_claim';
  } else if (invalidBases.length > 0) {
    verification = 'partial_hallucination';
  } else if (validBases.length > 0) {
    verification = 'supported';
  } else {
    verification = 'no_basis_provided';
  }

  const recommendation =
    verification === 'unsupported_strong_claim'
      ? '"반드시/법적으로" 같은 표현에는 mandatory 근거(법률·시행령·시행규칙)가 필요. 표현을 완화하거나 근거를 보강할 것.'
      : verification === 'partial_hallucination'
        ? `존재하지 않는 id ${invalidBases.length}개 — 환각 가능성. LLM이 id를 임의 생성했을 수 있음.`
        : verification === 'supported'
          ? '제시된 근거가 온톨로지에 실존하며 legalWeight 적절.'
          : '근거가 제시되지 않음. 모든 품질 주장은 basis[] 필수.';

  const result = {
    statement,
    triggeredStrongTerms: triggeredTerms,
    claimedBasis: basisReport,
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
