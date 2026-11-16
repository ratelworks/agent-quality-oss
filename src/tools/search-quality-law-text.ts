// ─────────────────────────────────────────────────────────────────────────────
// search-quality-law-text.ts — 법령·고시의 조문·별표 본문에서 낱말로 찾는다.
//
// 어느 조문에 있는지 모를 때 쓴다. 조문 번호를 알면 get_quality_law_article 로 바로 본다.
//   "겸직" → 건설기술 진흥법 시행령 제91조 (품질관리 건설기술인이 다른 업무를 하려면 승인)
//   "즉시 반품" → 건설공사 품질관리 업무지침 제41조 (불량자재의 처리)
// 수록 원문(src/ontology/laws)의 본문에서 찾고, 본문에 없는 현장 말은 현장 표현 자료에서 찾는다
// ("겸직" — 조문은 "각 호 외의 업무"라고 적는다).
// ─────────────────────────────────────────────────────────────────────────────

import { buildResponse } from "./_response.js";
import { ERROR_CODES, QualityMcpError } from "../lib/errors.js";
import { editionLabel, findLaw, loadLaws } from "../ontology/laws.js";
import { searchLawText } from "../knowledge/law-text-search.js";
import type { ToolSpec, BasisRef } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

// ───── 상수 ─────
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

export const spec: ToolSpec = {
  name: "search_quality_law_text",
  description:
    "법령·고시의 조문·별표 본문에서 낱말로 찾는다 — 어느 조문에 있는지 모를 때 쓴다. " +
    "수록 범위: 건설기술 진흥법·시행령·시행규칙, 건설공사 품질관리 업무지침, 건설공사 사업관리방식 검토기준 및 업무수행지침의 전 조문과 별표. " +
    '낱말은 조문에 적혀 있을 말로 2~3개만 넣는다(예: "겸직", "즉시 반품", "사전점검 레미콘", "벌점 품질관리"). 문장으로 넣지 않는다. ' +
    "찾은 조문의 전문은 get_quality_law_article 로 본다. 결과가 없으면 낱말을 줄이거나 조문에 쓰일 다른 말로 바꾼다. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: '찾을 낱말 (예: "겸직", "즉시 반품", "사전점검 레미콘")' },
      law: { type: "string", description: "한 법령·고시로 좁힐 때 (예: 건설기술 진흥법 시행령, 품질관리 업무지침) — 생략하면 수록한 전부에서 찾는다" },
      limit: { type: "number", description: `돌려줄 수 (기본 ${DEFAULT_LIMIT}, 최대 ${MAX_LIMIT})` },
    },
    required: ["query"],
  },
};

export interface SearchLawTextArgs {
  query: string;
  law?: string;
  limit?: number;
}

export function run(args: SearchLawTextArgs, graph: OntologyGraph) {
  const { query, law: lawName, limit } = args ?? ({ query: "" } as SearchLawTextArgs);
  if (!query || !query.trim()) throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, "query(찾을 낱말)는 필수입니다.");
  if (lawName && !findLaw(lawName)) {
    throw new QualityMcpError(
      ERROR_CODES.NOT_FOUND,
      `수록하지 않은 법령·고시입니다: ${lawName}. 수록: ${loadLaws().map((l) => l.name).join(" · ")}`,
    );
  }
  const count = Math.min(Math.max(1, Math.floor(limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
  const hits = searchLawText(query, lawName, count);
  const laws = new Map(loadLaws().map((l) => [l.id, l]));
  const items = hits.map((h) => ({
    law: h.lawName,
    ref: h.ref,
    kind: h.kind,
    title: h.title,
    snippet: h.snippet,
    matchedTerms: h.matchedTerms,
    /** 조문에는 이 낱말이 없다 — 현장에서 이 조문을 두고 쓰는 말로 찾았다. 조문의 표현은 전문에서 확인한다 */
    matchedByFieldPhrase: h.matchedByFieldPhrase,
    missingTerms: h.missingTerms,
    /** 전문을 볼 때 get_quality_law_article 에 넣을 값 */
    lookup: h.kind === "article" ? { law: h.lawName, article: h.ref } : { law: h.lawName, annex: h.ref },
  }));
  const basis: BasisRef[] =
    hits.length > 0
      ? hits.map((h) => {
          const law = laws.get(h.lawId);
          return { type: "law_text", id: `${h.lawId}:${h.ref}`, priority: 1, sourceStatus: "verified", note: `${h.lawName} ${h.ref}${law ? ` — ${editionLabel(law)}` : ""}` } as BasisRef;
        })
      : [{ type: "ontology_meta", id: "no_match", priority: 3, note: "검색 결과 없음" }];
  return buildResponse(
    "search_quality_law_text",
    graph.version,
    {
      query,
      law: lawName ?? null,
      count: items.length,
      items,
      note:
        items.length === 0
          ? "수록 원문에 이 낱말이 없습니다 — 낱말을 줄이거나 조문에 쓰일 다른 말로 바꿔 찾으세요. 없다는 것이 규정이 없다는 뜻은 아닙니다(수록 범위 밖의 법령일 수 있습니다)."
          : "낱말이 들어 있는 조문·별표입니다(낱말을 모두 가진 것이 앞). snippet 은 일부이므로 답하기 전에 get_quality_law_article 로 전문을 확인하세요.",
      searchedIn: (lawName ? [findLaw(lawName)?.name ?? lawName] : loadLaws().map((l) => l.name)),
    },
    basis,
    undefined,
    undefined,
    graph,
  );
}
