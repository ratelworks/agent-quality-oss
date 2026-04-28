/**
 * Tool: verify_form_reference
 *
 * 별지·고시 인용 검증 — 자연어로 "별지 제42호" 또는 form id를 받아
 * 우리 온톨로지의 실제 명칭과 일치하는지 확인.
 *
 * korean-law-mcp의 verify_citations 패턴 — LLM의 별지 환각 방지.
 *
 * 5차 GPT 검증에서 별지 제42·43·37호 명칭 오류가 발견된 후 신설.
 */

import { searchEntities } from '../ontology/resolver.js';
import { buildResponse } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';
import type { BaseEntity } from '../ontology/schema.js';

export const spec: ToolSpec = {
  name: 'verify_form_reference',
  description:
    'LLM이 인용한 별지·고시 명칭이 우리 온톨로지의 실제 명칭과 일치하는지 검증. 자연어 인용("별지 제42호 점검결과 통보서") 또는 form id를 받아 일치/오류/누락 보고. 환각 방지. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      claim: {
        type: 'string',
        description: 'LLM이 인용한 별지·고시 표현 (예: "별지 제42호 점검결과 통보서")',
      },
      formId: { type: 'string', description: 'form id (claim과 택1)' },
    },
  },
};

export interface VerifyFormArgs {
  claim?: string;
  formId?: string;
}

interface FormVerification {
  status: 'verified' | 'name_mismatch' | 'not_found';
  matchedForm?: { id: string; correctName: string; section?: string; issuer?: string };
  claimedNumber?: string | null;
  claimedName?: string | null;
  hint?: string;
}

const SECTION_PATTERNS = [
  /별지\s*제?\s*(\d+)\s*호/u,
  /별표\s*(\d+)/u,
  /제\s*(\d+)\s*호\s*서식/u,
];

const FORM_NUMBER_PREFIX_RE = /별지\s*제?\s*\d+\s*호/u;

/** 별지 번호 prefix를 떼고 명칭만 추출 */
function extractClaimedName(claim: string): string {
  return claim.replace(FORM_NUMBER_PREFIX_RE, '').replace(/\s+/g, ' ').trim();
}

/** claim 명칭이 entity name·alias와 substring 매칭되는가 (양방향) */
function nameMatchesEntity(claimedName: string, entity: BaseEntity): boolean {
  if (claimedName === '') return true;
  const claimNorm = claimedName.toLowerCase();
  const correctNorm = entity.name.toLowerCase();
  if (correctNorm.includes(claimNorm) || claimNorm.includes(correctNorm)) return true;
  return (entity.aliases ?? []).some((a) => {
    const an = a.toLowerCase();
    return an.includes(claimNorm) || claimNorm.includes(an);
  });
}

function formMeta(e: BaseEntity) {
  return {
    id: e.id,
    correctName: e.name,
    section: e.meta?.['section'] as string | undefined,
    issuer: e.meta?.['issuer'] as string | undefined,
  };
}

/**
 * incorrectAliases 매칭 — 사용자가 알려진 환각 명칭으로 인용했는지 탐지.
 * 검색 fallback이 실패했을 때 모든 form의 incorrectAliases를 훑어 정정 안내.
 * (verified로 매핑하지 않음 — 항상 name_mismatch + 정정 hint)
 */
function findByIncorrectAlias(claimedName: string, forms: BaseEntity[]): BaseEntity | null {
  if (!claimedName) return null;
  const norm = claimedName.toLowerCase();
  for (const f of forms) {
    const incorrect = (f.meta?.['incorrectAliases'] as string[] | undefined) ?? [];
    if (incorrect.some((bad) => bad.toLowerCase().includes(norm) || norm.includes(bad.toLowerCase()))) {
      return f;
    }
  }
  return null;
}

export function run(args: VerifyFormArgs, graph: OntologyGraph) {
  const { claim, formId } = args ?? {};
  if (!claim && !formId) throw new Error('claim 또는 formId 중 하나는 필수입니다.');

  let verification: FormVerification;
  const allBasis = new Set<string>();

  if (formId) {
    const e = graph.get(formId);
    if (!e || e.meta?.['category'] !== 'form') {
      verification = {
        status: 'not_found',
        hint: `${formId}는 form 엔티티가 아님. get_standard_form_locator로 가용 form 검색.`,
      };
    } else {
      allBasis.add(e.id);
      // formId만 있으면 verified, claim도 함께 주어졌다면 명칭 일치 추가 검증
      // (claim이 무시되면 환각 명칭이 통과되므로 별도 검사)
      if (claim && claim.trim()) {
        const claimedName = extractClaimedName(claim);
        const matched = nameMatchesEntity(claimedName, e);
        verification = matched
          ? { status: 'verified', claimedName: claimedName || null, matchedForm: formMeta(e) }
          : {
              status: 'name_mismatch',
              claimedName,
              matchedForm: formMeta(e),
              hint: `formId는 일치하나 claim 명칭 불일치 — claim="${claimedName}" vs 정확한 명칭="${e.name}". LLM 환각 가능성.`,
            };
      } else {
        verification = { status: 'verified', matchedForm: formMeta(e) };
      }
    }
  } else {
    // claim에서 별지 번호 추출
    let claimedNumber: string | null = null;
    for (const re of SECTION_PATTERNS) {
      const m = claim!.match(re);
      if (m && m[1]) {
        claimedNumber = m[1];
        break;
      }
    }

    // 우리 form 엔티티 중 같은 번호 찾기
    const allForms = graph.byStandardCategory('form');
    let candidate: BaseEntity | undefined;
    for (const f of allForms) {
      const sec = (f.meta?.['section'] as string | undefined) ?? '';
      if (claimedNumber && sec.includes(`제${claimedNumber}호`)) {
        candidate = f;
        break;
      }
    }

    const claimedName = extractClaimedName(claim!);

    if (!candidate) {
      // fallback: 검색
      const hits = searchEntities(graph, claim!, 'Standard', 5);
      candidate = hits.map((h) => graph.get(h.id)).find((e) => e?.meta?.['category'] === 'form');
    }

    // 검색 실패 시 환각 명칭(incorrectAliases) 매칭으로 정정 안내 (verified로 절대 매핑 안 함)
    const incorrectMatch = !candidate ? findByIncorrectAlias(claimedName, allForms) : null;

    if (incorrectMatch) {
      allBasis.add(incorrectMatch.id);
      verification = {
        status: 'name_mismatch',
        claimedNumber,
        claimedName: claimedName || null,
        matchedForm: formMeta(incorrectMatch),
        hint: `"${claimedName}"는 알려진 환각 명칭. 정확한 명칭은 "${incorrectMatch.name}". LLM 인용 정정 필요.`,
      };
    } else if (!candidate) {
      verification = {
        status: 'not_found',
        claimedNumber,
        claimedName: claimedName || null,
        hint: '온톨로지에 일치 form 없음 — get_standard_form_locator로 가용 목록 확인',
      };
    } else {
      allBasis.add(candidate.id);
      const matched = nameMatchesEntity(claimedName, candidate);
      verification = {
        status: matched ? 'verified' : 'name_mismatch',
        claimedNumber,
        claimedName: claimedName || null,
        matchedForm: formMeta(candidate),
        hint: matched
          ? '별지 번호·명칭 일치'
          : `명칭 불일치 — 사용자가 "${claimedName}"라 인용했으나 정확한 명칭은 "${candidate.name}". LLM 환각 가능성.`,
      };
    }
  }

  const result = {
    claim: claim ?? null,
    formId: formId ?? null,
    verification,
    domainNote: '5차 검증에서 시행규칙 별지 제42·43·37호 명칭 오류가 발견됨. LLM 인용은 항상 본 Tool로 교차검증 권고.',
  };

  return buildResponse(
    'verify_form_reference',
    graph.version,
    result,
    allBasis.size > 0
      ? [...allBasis].map((id) => ({ type: 'ontology' as const, id, priority: 1 }))
      : [{ type: 'verification_meta', id: 'no_match', priority: 3, note: verification.status }],
    verification.status !== 'verified'
      ? {
          required: true,
          reason: verification.hint ?? '인용 검증 실패 — LLM 출력 정정 필요',
          a2ui: { type: 'decision', options: ['인용 정정', '출처 확인 후 재호출', '주장 철회'] },
        }
      : { required: false, reason: null },
  );
}
