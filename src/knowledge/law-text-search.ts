// ─────────────────────────────────────────────────────────────────────────────
// law-text-search.ts — 수록한 법령·고시의 조문·별표를 낱말로 찾는다(순위 있음).
//
// 조문 본문에서 찾고, 본문에 없는 현장 말은 현장 표현 자료(ontology/field-phrases.json)에서 찾는다.
//   "즉시 반품"  → 본문에 있다 — 업무지침 제41조
//   "겸직"       → 본문에는 없다("각 호 외의 업무") — 현장 표현으로 시행령 제91조
// 띄어쓰기가 달라도 찾는다(표 안에서 줄이 바뀐 낱말 포함).
// ─────────────────────────────────────────────────────────────────────────────

import { findLaw, loadLaws } from "../ontology/laws.js";
import type { LawBundle } from "../ontology/laws.js";
import { loadFieldPhrases } from "./field-phrases.js";

// ───── 상수 ─────
/** 낱말 끝에 붙은 조사 — 떼고 찾는다 ("겸직을" → "겸직") */
const TRAILING_PARTICLE_RE = /(?:에서는|에서|으로|에는|에게|까지|부터|이나|은|는|이|가|을|를|의|에|로|와|과|도|만)$/u;
/** 조사를 떼는 낱말의 최소 길이 — 짧은 낱말은 조사처럼 보이는 글자가 낱말의 일부일 수 있다 */
const PARTICLE_STRIP_MIN_LENGTH = 3;
const SNIPPET_BEFORE = 60;
const SNIPPET_LENGTH = 220;
const DEFAULT_LIMIT = 8;

export interface LawTextHit {
  lawId: string;
  lawName: string;
  kind: "article" | "annex";
  ref: string;
  title: string;
  snippet: string;
  /** 본문에서 찾은 낱말 */
  matchedTerms: string[];
  /** 본문에는 없고 현장 표현 자료에서 찾은 낱말 */
  matchedByFieldPhrase: string[];
  /** 어디에도 없는 낱말 */
  missingTerms: string[];
}

function searchTerms(query: string): string[] {
  const terms = query
    .split(/[\s,·/]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .map((t) => (t.length >= PARTICLE_STRIP_MIN_LENGTH ? t.replace(TRAILING_PARTICLE_RE, "") : t))
    .filter((t) => t.length >= 2);
  return [...new Set(terms)];
}

const compactOf = (text: string): string => text.replace(/\s+/gu, "");

/**
 * 낱말로 조문·별표를 찾는다. 낱말을 모두 가진 것을 앞에, 일부만 가진 것을 뒤에 둔다.
 * @param lawName 한 법령·고시로 좁힐 때
 */
export function searchLawText(query: string, lawName?: string, limit = DEFAULT_LIMIT): LawTextHit[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  const compactTerms = terms.map(compactOf);
  const only = lawName ? findLaw(lawName) : null;
  const laws = only ? [only] : loadLaws();
  const phrases = loadFieldPhrases().phrases;
  const scored: Array<{ hit: LawTextHit; score: number }> = [];
  const consider = (law: LawBundle, kind: "article" | "annex", ref: string, title: string, text: string): void => {
    const compact = compactOf(text);
    const fieldText = compactOf((phrases[`${law.id}:${ref}`] ?? []).join(" "));
    const inText = terms.filter((_, i) => compact.includes(compactTerms[i] as string));
    const inPhrase = terms.filter((t, i) => !inText.includes(t) && fieldText.includes(compactTerms[i] as string));
    if (inText.length + inPhrase.length === 0) return;
    const missing = terms.filter((t) => !inText.includes(t) && !inPhrase.includes(t));
    const inTitle = terms.filter((_, i) => compactOf(title).includes(compactTerms[i] as string)).length;
    // 낱말을 많이 가진 것이 먼저, 그다음 제목에 든 것, 그다음 짧은 조문(긴 별표는 어떤 낱말이든 들어 있기 쉽다)
    const score =
      (inText.length + inPhrase.length) * 100 + inTitle * 20 - Math.min(text.length / 2000, 15) + (missing.length === 0 ? 50 : 0);
    const first = inText.map((t) => text.indexOf(t)).filter((at) => at >= 0).sort((a, b) => a - b)[0] ?? 0;
    const start = Math.max(0, first - SNIPPET_BEFORE);
    const snippet = text.slice(start, start + SNIPPET_LENGTH).replace(/\s+/gu, " ").trim();
    scored.push({
      hit: { lawId: law.id, lawName: law.name, kind, ref, title, snippet, matchedTerms: inText, matchedByFieldPhrase: inPhrase, missingTerms: missing },
      score,
    });
  };
  for (const law of laws) {
    for (const a of law.articles) {
      if (!a.deleted) consider(law, "article", `제${a.number}조${a.branch ? `의${a.branch}` : ""}`, a.title, a.text);
    }
    for (const x of law.annexes) consider(law, "annex", `${x.kind} ${x.key}`, x.title, `${x.title}\n${x.text}`);
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.hit);
}
