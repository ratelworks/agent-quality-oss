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
/** 항(①②…) 하나를 통째로 보여 줄 때의 최대 길이 */
const PARAGRAPH_SNIPPET_MAX = 420;
/** 항의 첫머리 — "① …" */
const PARAGRAPH_HEAD_RE = /^\s*([①-⑳])/u;
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
/** 항 안의 호 — "  5. …" */
const ITEM_HEAD_RE = /^\s+(\d+)\.\s/u;
/** 항의 머리글(호 앞의 문장)을 호와 함께 보여 줄 때의 최대 길이 — 머리글에는 단서("다만, …")가 들어 있어 자르지 않는다(수록 원문 최대 373자) */
const PARAGRAPH_LEAD_MAX = 400;
/** 같은 조에서 가장 많이 맞은 항과 똑같이 맞은 다른 항을 몇 개까지 함께 보여 줄지 */
const ALSO_PARAGRAPHS_MAX = 2;
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
  /** 낱말 그대로는 없고 법령 본문의 말로 찾은 것 ("겸직" → "각 호 외의 업무") */
  matchedAsLawWord: Array<{ term: string; lawWord: string }>;
  /** 어디에도 없는 낱말 */
  missingTerms: string[];
  /** 낱말이 가장 많이 든 항 ("제5항", 긴 항이면 "제11항 제5호") — 긴 조문에서 볼 자리 */
  paragraph?: string;
  /** 같은 조에서 낱말이 똑같이 많이 든 다른 항 — 한 조에 같은 일을 정한 항이 여럿일 때 하나만 보고 답하지 않게 */
  alsoParagraphs?: Array<{ paragraph: string; snippet: string }>;
}

/** 낱말과, 법령 본문에서 같은 말로 치는 말 ("KS" → ["KS", "한국산업표준"]) */
export function lawTermAlternatives(term: string, lawTerms: Record<string, string[]> = loadFieldPhrases().lawTerms): string[] {
  const key = Object.keys(lawTerms).find((k) => compactOf(k).toLowerCase() === compactOf(term).toLowerCase());
  return [...new Set([term, ...(key ? lawTerms[key] ?? [] : [])])];
}

/** 찾는 낱말 — 조사를 떼고, 겹친 것은 하나로 */
export function lawSearchTerms(query: string): string[] {
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
  const terms = lawSearchTerms(query);
  if (terms.length === 0) return [];
  // 낱말마다 본문에서 같은 말로 치는 말 — 현장 말이면 법령 본문의 말도 ("KS" → "한국산업표준")
  const { lawTerms } = loadFieldPhrases();
  const alternatives = terms.map((t) => lawTermAlternatives(t, lawTerms).map(compactOf));
  const has = (compactText: string, i: number): boolean => (alternatives[i] ?? []).some((a) => compactText.includes(a));
  const lawWordIn = (compactText: string, i: number): string | null => {
    const alts = lawTermAlternatives(terms[i] as string, lawTerms);
    return alts.slice(1).find((a) => compactText.includes(compactOf(a))) ?? null;
  };
  const only = lawName ? findLaw(lawName) : null;
  const laws = only ? [only] : loadLaws();
  const phrases = loadFieldPhrases().phrases;
  const scored: Array<{ hit: LawTextHit; score: number }> = [];
  const consider = (law: LawBundle, kind: "article" | "annex", ref: string, title: string, text: string): void => {
    const compact = compactOf(text);
    const fieldText = compactOf((phrases[`${law.id}:${ref}`] ?? []).join(" "));
    const inText = terms.filter((_, i) => has(compact, i));
    const asLawWord = terms
      .map((t, i) => ({ t, i }))
      .filter(({ t, i }) => inText.includes(t) && !compact.includes(compactOf(t)))
      .map(({ t, i }) => ({ term: t, lawWord: lawWordIn(compact, i) ?? "" }))
      .filter((x) => x.lawWord);
    const inPhrase = terms.filter((t, i) => !inText.includes(t) && has(fieldText, i));
    if (inText.length + inPhrase.length === 0) return;
    const missing = terms.filter((t) => !inText.includes(t) && !inPhrase.includes(t));
    const inTitle = terms.filter((_, i) => has(compactOf(title), i)).length;
    // 낱말을 많이 가진 것이 먼저, 그다음 제목에 든 것, 그다음 짧은 조문(긴 별표는 어떤 낱말이든 들어 있기 쉽다)
    const score =
      (inText.length + inPhrase.length) * 100 + inTitle * 20 - Math.min(text.length / 2000, 15) + (missing.length === 0 ? 50 : 0);
    // 항으로 나뉜 조문이면 낱말이 가장 많이 든 항을 통째로 보여 준다(긴 조문의 첫 일치 자리는 묻는 일과 다른 항이기 쉽다)
    const best = kind === "article" ? bestParagraph(text, terms.map((_, i) => i).filter((i) => inText.includes(terms[i] as string)), has) : null;
    let snippet: string;
    if (best) {
      snippet = best.text;
    } else {
      const first = inText.map((t) => text.indexOf(t)).filter((at) => at >= 0).sort((a, b) => a - b)[0] ?? 0;
      const start = Math.max(0, first - SNIPPET_BEFORE);
      snippet = text.slice(start, start + SNIPPET_LENGTH).replace(/\s+/gu, " ").trim();
    }
    scored.push({
      hit: {
        lawId: law.id, lawName: law.name, kind, ref, title, snippet,
        matchedTerms: inText.filter((t) => !asLawWord.some((x) => x.term === t)), matchedAsLawWord: asLawWord, matchedByFieldPhrase: inPhrase, missingTerms: missing,
        ...(best ? { paragraph: best.label } : {}),
        ...(best && best.also.length > 0 ? { alsoParagraphs: best.also } : {}),
      },
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

/** 줄을 이어 한 줄 글로 */
const flat = (lines: string[]): string => lines.join(" ").replace(/\s+/gu, " ").trim();

/**
 * 항 하나를 보여 줄 글. 짧으면 항 전체. 길면 항의 머리글과 낱말이 가장 많이 든 호를 보여 준다
 * (긴 항을 앞에서 자르면 뒤쪽 호에 있는 답이 잘린다 — 제11항 제5호 "계속적인 입회" 처럼).
 */
function paragraphView(
  label: string,
  lines: string[],
  termIndexes: number[],
  has: (compactText: string, i: number) => boolean,
): { label: string; text: string } {
  const body = flat(lines);
  if (body.length <= PARAGRAPH_SNIPPET_MAX) return { label, text: body };
  const lead: string[] = [];
  const items: { no: string; lines: string[] }[] = [];
  for (const line of lines) {
    const head = line.match(ITEM_HEAD_RE);
    if (head) items.push({ no: head[1] as string, lines: [line] });
    else if (items.length > 0) items[items.length - 1]?.lines.push(line);
    else lead.push(line);
  }
  if (items.length === 0) return { label, text: `${body.slice(0, PARAGRAPH_SNIPPET_MAX)}…` };
  const leadText = flat(lead);
  const leadShort = leadText.length <= PARAGRAPH_LEAD_MAX ? leadText : `${leadText.slice(0, PARAGRAPH_LEAD_MAX)}…`;
  let pick = items[0] as { no: string; lines: string[] };
  let pickCount = -1;
  for (const it of items) {
    const count = termIndexes.filter((i) => has(compactOf(`${leadText} ${flat(it.lines)}`), i)).length;
    if (count > pickCount) { pick = it; pickCount = count; }
  }
  const item = flat(pick.lines);
  const itemShort = item.length <= PARAGRAPH_SNIPPET_MAX ? item : `${item.slice(0, PARAGRAPH_SNIPPET_MAX)}…`;
  return { label: `${label} 제${pick.no}호`, text: `${leadShort} … ${itemShort}` };
}

/**
 * 항(①②…)마다 나눠 낱말이 가장 많이 든 항을 고른다. 똑같이 많이 든 다른 항은 also 로 함께 돌려준다.
 * 항이 둘 미만이거나 어느 항에도 낱말이 없으면 null
 */
function bestParagraph(
  text: string,
  termIndexes: number[],
  has: (compactText: string, i: number) => boolean,
): { label: string; text: string; also: Array<{ paragraph: string; snippet: string }> } | null {
  if (termIndexes.length === 0) return null;
  const paragraphs: { mark: string; lines: string[] }[] = [];
  for (const line of text.split("\n")) {
    const head = line.match(PARAGRAPH_HEAD_RE);
    if (head) paragraphs.push({ mark: head[1] as string, lines: [line] });
    else if (paragraphs.length > 0) paragraphs[paragraphs.length - 1]?.lines.push(line);
  }
  if (paragraphs.length < 2) return null;
  const counted = paragraphs.map((p) => ({ p, count: termIndexes.filter((i) => has(compactOf(flat(p.lines)), i)).length }));
  const top = Math.max(...counted.map((c) => c.count));
  if (top <= 0) return null;
  const tied = counted.filter((c) => c.count === top).map(({ p }) => paragraphView(`제${CIRCLED.indexOf(p.mark) + 1}항`, p.lines, termIndexes, has));
  const [first, ...rest] = tied as [{ label: string; text: string }, ...{ label: string; text: string }[]];
  return { label: first.label, text: first.text, also: rest.slice(0, ALSO_PARAGRAPHS_MAX).map((r) => ({ paragraph: r.label, snippet: r.text })) };
}
