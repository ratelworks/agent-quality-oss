// ─────────────────────────────────────────────────────────────────────────────
// cite.ts — 법령·고시 원문에서 문장을 찾아 "어디의 어떤 문장"으로 돌려준다.
//
// 도구와 양식이 법령을 근거로 들 때 문장을 손으로 옮겨 적지 않고 수록 원문에서 가져온다.
// 원문에 없는 문장을 찾으면 오류다 — 근거 없는 인용이 응답에 섞이지 않게 한다.
// ─────────────────────────────────────────────────────────────────────────────

import { editionLabel, findAnnex, findArticle, findLaw, normalizeLawText } from "../ontology/laws.js";
import { boxTableCells } from "../lib/box-table.js";

// ───── 상수 ─────
const SENTENCE_END = /[.。)]$/;
const MAX_JOINED_LINES = 6;

export interface Citation {
  /** "건설기술 진흥법 시행령 제89조" */
  source: string;
  /** 판본 — "대통령령 제36404호 (시행 2026-06-09)" */
  edition: string;
  /** 원문 문장 (찾은 줄 그대로) */
  text: string;
}

export interface CitationSpec {
  law: string;
  /** 조문 번호 — "89", "45의2" */
  article?: string;
  /** 별표·서식 — "별표 5", "별지 제42호" */
  annex?: string;
  /** 원문에 있어야 하는 구절 */
  quote: string;
}

/** 인용이 가리키는 원문 전체. 없으면 null. */
export function sourceTextOf(spec: CitationSpec): { label: string; edition: string; text: string } | null {
  const law = findLaw(spec.law);
  if (!law) return null;
  if (spec.article) {
    const article = findArticle(law, spec.article);
    if (!article) return null;
    return { label: `${law.name} 제${article.number}조${article.branch ? `의${article.branch}` : ""}`, edition: editionLabel(law), text: article.text };
  }
  if (spec.annex) {
    const annex = findAnnex(law, spec.annex);
    if (!annex) return null;
    return { label: `${law.name} ${annex.kind} ${annex.kind === "별지" ? `제${annex.key}호` : annex.key}`, edition: editionLabel(law), text: `${annex.title}\n${annex.text}` };
  }
  return null;
}

/**
 * 구절을 찾을 글 — 원문 전체와, 표가 있으면 칸마다 이어 붙인 글.
 * 표는 좁은 칸에서 줄이 나뉘고 옆 칸과 섞여 있어, 칸으로 풀어야 문장이 이어진다.
 */
function searchTexts(text: string, isAnnex: boolean): string[] {
  const whole = normalizeLawText(text);
  return isAnnex ? [whole, ...boxTableCells(text).map(normalizeLawText)] : [whole];
}

/** 구절이 원문에 있는가 (공백·표 그리는 문자는 무시) */
export function quoteExists(spec: CitationSpec): boolean {
  const source = sourceTextOf(spec);
  if (!source) return false;
  const wanted = normalizeLawText(spec.quote);
  return searchTexts(source.text, !!spec.annex).some((t) => t.includes(wanted));
}

/** 구절이 들어 있는 원문 줄을 찾아 인용으로 돌려준다. 조문에 없으면 오류. */
export function cite(spec: CitationSpec): Citation {
  const source = sourceTextOf(spec);
  if (!source) throw new Error(`수록 원문에 없는 조문·별표입니다: ${spec.law} ${spec.article ?? spec.annex ?? ""}`);
  const wanted = normalizeLawText(spec.quote);
  const lines = source.text.split("\n");
  const at = lines.findIndex((l) => normalizeLawText(l).includes(wanted));
  if (at >= 0) {
    // 별표의 글은 좁은 폭에서 줄이 나뉘어 있다 — 문장이 끝날 때까지 다음 줄을 이어 붙인다
    let text = (lines[at] ?? "").trim();
    for (let i = at + 1; spec.annex && i < lines.length && i <= at + MAX_JOINED_LINES && !SENTENCE_END.test(text); i += 1) {
      text += (lines[i] ?? "").trim();
    }
    return { source: source.label, edition: source.edition, text };
  }
  // 표의 칸처럼 여러 줄에 걸친 구절은 원문 전체에서 확인하고 구절 자체를 돌려준다
  if (!searchTexts(source.text, !!spec.annex).some((t) => t.includes(wanted))) {
    throw new Error(`원문에 없는 구절입니다: ${source.label} — "${spec.quote}"`);
  }
  return { source: source.label, edition: source.edition, text: spec.quote };
}
