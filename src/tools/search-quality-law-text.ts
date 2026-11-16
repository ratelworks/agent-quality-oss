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
import { lawSearchTerms, lawTermAlternatives, searchLawText } from "../knowledge/law-text-search.js";
import { penaltyWho, searchPenaltyItems } from "../knowledge/penalty-points.js";
import { searchSanctionItems } from "../knowledge/sanctions.js";
import type { ToolSpec, BasisRef } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

// ───── 상수 ─────
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
/** 함께 돌려줄 벌점 항목 수 */
const PENALTY_ITEM_LIMIT = 4;
/** 함께 돌려줄 형벌·과태료 호의 최대 수 */
const SANCTION_ITEM_LIMIT = 3;
const ACT_ID = "btia";
/** 벌점·벌칙을 찾을 때 상황 낱말에서 빼는 말 — 조문 어디에나 있어 이것만 맞은 항목·호는 상황과 무관하다("정당한 사유 없이", "신고를 하면서") */
const FUNCTION_WORD_RE = /^(?:없이|하면|안|안하면|안하고|안함|안해|않으면|못하면|되면|해야|되나|되는지|하나|있나|있어|뭐|뭐야|어떻게|경우|때)$/u;
/** 제재를 묻는 말 — 벌점 항목을 찾을 때는 빼고(항목 글에 없는 말이다), 이런 말이 있으면 낱말 하나만 맞아도 벌점 항목을 붙인다 */
const SANCTION_WORD_RE = /^(?:벌점|부실벌점|처벌|형사처벌|벌칙|벌금|징역|과태료|제재|불이익|위반|어기면|걸리면|점검|몇점|몇)$/u;

export const spec: ToolSpec = {
  name: "search_quality_law_text",
  description:
    "법령·고시의 조문·별표 본문에서 낱말로 찾는다 — 어느 조문에 있는지 모를 때 쓴다. " +
    "수록 범위: 건설기술 진흥법·시행령·시행규칙, 건설공사 품질관리 업무지침, 건설공사 사업관리방식 검토기준 및 업무수행지침의 전 조문과 별표. " +
    '낱말은 조문에 적혀 있을 말로 2~3개만 넣는다(예: "겸직", "즉시 반품", "사전점검 레미콘", "벌점 품질관리"). 문장으로 넣지 않는다. ' +
    "찾은 조문의 전문은 get_quality_law_article 로 본다. 긴 조문은 낱말이 가장 많이 든 항(paragraph)을 snippet 으로 주고, 긴 항은 머리글과 맞는 호(예: 제11항 제5호)를 준다. 같은 조에서 똑같이 맞는 다른 항이 있으면 alsoParagraphs 로 함께 준다 — 한 항만 보고 '규정이 없다'고 답하지 않는다.결과가 없으면 낱말을 줄이거나 조문에 쓰일 다른 말로 바꾼다. " +
    "그 상황을 어기면 받는 벌점(시행령 별표 8)의 항목을 penaltyItems 로 함께 준다 — 항목 번호(제5호 가목 15)나) 등)와 점수는 이 값을 그대로 쓴다. 같은 상황의 형벌·과태료(건설기술 진흥법 제87조~제91조) 호는 sanctionItems 로 함께 준다 — 벌점과 형벌은 따로 매겨지므로 둘 다 알린다. 어기면 어떻게 되는지 물으면 상황 낱말에 \"벌점\" 또는 \"처벌\"을 붙여 찾는다. " +
    "[근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]",
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
  // 그 상황의 벌점 항목 — 낱말 둘 이상이 맞거나, 제재를 물었고 낱말 하나 이상이 맞을 때
  const allTerms = lawSearchTerms(query);
  const sanctionAsked = allTerms.some((t) => SANCTION_WORD_RE.test(t));
  const situationTerms = allTerms.filter((t) => !SANCTION_WORD_RE.test(t) && !FUNCTION_WORD_RE.test(t));
  const penaltyItems = (!lawName || /시행령/u.test(lawName) ? searchPenaltyItems(situationTerms.map((t) => lawTermAlternatives(t)), PENALTY_ITEM_LIMIT) : [])
    .filter((r) => r.matched.length >= 2 || (sanctionAsked && r.matched.length >= 1))
    .map((r) => ({
      law: "건설기술 진흥법 시행령",
      ref: `별표 8 ${r.item.path}`,
      points: r.item.points,
      appliesTo: r.item.part,
      who: penaltyWho(r.item.part),
      item: r.item.itemTitle,
      text: r.item.text,
      matchedTerms: r.matched,
    }));
  // 같은 상황의 형벌·과태료 호 — 맞지 않는 형벌을 옮겨 적으면 그 자체가 틀린 사실이므로 벌점보다 엄격하게:
  // 상황 낱말이 둘 이상이면 둘 이상 맞을 때, 하나면 그 하나가 맞고 제재를 물었을 때만
  const actScope = !lawName || findLaw(lawName)?.id === ACT_ID;
  const sanctionNeed = Math.min(2, situationTerms.length);
  const sanctionItems = (actScope && sanctionNeed > 0 ? searchSanctionItems(situationTerms.map((t) => lawTermAlternatives(t)), SANCTION_ITEM_LIMIT) : [])
    .filter((r) => r.matched.length >= sanctionNeed && (sanctionAsked || r.matched.length >= 2))
    .map((r) => ({ law: "건설기술 진흥법", ref: r.item.ref, kind: r.item.kind, punishment: r.item.punishment, text: r.item.text, matchedTerms: r.matched }));
  const items = hits.map((h) => ({
    law: h.lawName,
    ref: h.ref,
    kind: h.kind,
    title: h.title,
    snippet: h.snippet,
    /** 낱말이 가장 많이 든 항 — snippet 은 그 항이다 */
    ...(h.paragraph ? { paragraph: h.paragraph } : {}),
    /** 같은 조에서 낱말이 똑같이 많이 든 다른 항 — 같은 일을 정한 항이 여럿이면 모두 본다 */
    ...(h.alsoParagraphs ? { alsoParagraphs: h.alsoParagraphs } : {}),
    matchedTerms: h.matchedTerms,
    /** 조문에는 이 낱말이 없다 — 현장에서 이 조문을 두고 쓰는 말로 찾았다. 조문의 표현은 전문에서 확인한다 */
    matchedByFieldPhrase: h.matchedByFieldPhrase,
    /** 낱말 그대로는 조문에 없고, 조문이 쓰는 말로 찾았다 ("겸직" → "각 호 외의 업무") */
    ...(h.matchedAsLawWord.length > 0 ? { matchedAsLawWord: h.matchedAsLawWord } : {}),
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
  for (const p of penaltyItems) {
    basis.push({ type: "law_text", id: `btia_decree:${p.ref}`, priority: 1, sourceStatus: "verified", note: `건설기술 진흥법 시행령 ${p.ref} — 벌점 ${p.points}점` } as BasisRef);
  }
  for (const x of sanctionItems) {
    basis.push({ type: "law_text", id: `${ACT_ID}:${x.ref}`, priority: 1, sourceStatus: "verified", note: `건설기술 진흥법 ${x.ref} — ${x.punishment}` } as BasisRef);
  }
  return buildResponse(
    "search_quality_law_text",
    graph.version,
    {
      query,
      law: lawName ?? null,
      count: items.length,
      items,
      ...(penaltyItems.length > 0
        ? {
            penaltyItems,
            penaltyNote:
              "시행령 별표 8 제5호의 벌점 측정기준에서 이 낱말이 든 항목입니다. 벌점은 측정기관(발주청·인허가기관 등)이 부실 내용을 확인해 업체와 건설기술인등에 각각 매깁니다. 항목이 상황에 맞는지는 text 로 확인하세요(표의 줄바꿈 자리 띄어쓰기는 원문과 다를 수 있습니다). 점수는 text 의 조건(재시공이 필요한 경우 등)과 함께 말하고, who 로 시공 쪽·건설사업관리 쪽을 가려 씁니다.",
          }
        : {}),
      ...(sanctionItems.length > 0
        ? {
            sanctionItems,
            sanctionNote:
              "건설기술 진흥법 벌칙(제87조~제89조)·과태료(제91조)에서 이 낱말이 든 호입니다. 형벌·과태료는 벌점과 따로 매겨집니다 — 벌점만 있다고 답하지 않습니다. 형벌은 수사·재판으로, 과태료는 국토교통부장관 또는 시ㆍ도지사가 부과합니다(법 제91조제4항). 호가 상황에 맞는지는 text 로 확인하세요.",
          }
        : {}),
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
