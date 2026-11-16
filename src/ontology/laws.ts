// ─────────────────────────────────────────────────────────────────────────────
// laws.ts — 수록한 법령·고시 원문(전 조문·별표·서식)을 읽고 찾는다.
//
// 원문은 scripts/sync/sync-laws.ts 가 법제처 국가법령정보센터에서 받아
// src/ontology/laws/<id>.json 에 싣는다(빌드 때 build/ontology/laws 로 복사).
// 조문 요약·관계는 온톨로지 노드가 갖고, 글자 그대로의 원문은 이 모듈이 준다.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ───── 상수 ─────
const LAWS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "laws");
const ARTICLE_REF = /^(?:제\s*)?(\d+)\s*(?:조)?\s*(?:의\s*(\d+))?/;
const ANNEX_REF = /^(별표|별지)\s*(?:제\s*)?(\d+)\s*(?:호)?\s*(?:의\s*(\d+))?/;

export type LawKind = "act" | "decree" | "rule" | "notice";

export interface LawArticle {
  key: string;
  number: number;
  branch: number;
  title: string;
  heading: string;
  text: string;
  deleted: boolean;
}

export interface LawAnnex {
  kind: "별표" | "별지";
  key: string;
  number: number;
  branch: number;
  title: string;
  text: string;
}

export interface LawBundle {
  id: string;
  kind: LawKind;
  name: string;
  aliases: string[];
  promulgationNumber: string;
  promulgationDate: string;
  effectiveDate: string;
  revisionType: string;
  source: { provider: string; url: string; license: string };
  articles: LawArticle[];
  annexes: LawAnnex[];
}

let cache: LawBundle[] | null = null;

/** 수록한 법령·고시 전부 (처음 부를 때 한 번 읽는다) */
export function loadLaws(): LawBundle[] {
  cache ??= readdirSync(LAWS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(LAWS_DIR, f), "utf8")) as LawBundle);
  return cache;
}

function squash(s: string): string {
  return s.replace(/[\s「」『』·ㆍ]/g, "");
}

/** 이름·다른 이름·id 로 법령을 찾는다 (띄어쓰기·낫표는 무시) */
export function findLaw(nameOrId: string): LawBundle | null {
  const key = squash(nameOrId);
  if (!key) return null;
  return (
    loadLaws().find((law) => law.id === nameOrId || squash(law.name) === key || law.aliases.some((a) => squash(a) === key)) ??
    null
  );
}

/** "89", "제89조", "45의2", "제45조의2" → 조문 */
export function findArticle(law: LawBundle, ref: string | number): LawArticle | null {
  const m = ARTICLE_REF.exec(String(ref).trim());
  if (!m) return null;
  const number = Number(m[1]);
  const branch = Number(m[2] ?? "0");
  return law.articles.find((a) => a.number === number && a.branch === branch) ?? null;
}

/** "별표 5", "별지 제42호", "별지 13의2" → 별표·서식 */
export function findAnnex(law: LawBundle, ref: string): LawAnnex | null {
  const m = ANNEX_REF.exec(ref.trim().replace(/서식$/, "").trim());
  if (!m) return null;
  const number = Number(m[2]);
  const branch = Number(m[3] ?? "0");
  return law.annexes.find((a) => a.kind === m[1] && a.number === number && a.branch === branch) ?? null;
}

/** 판본 표기 — "대통령령 제36404호 (시행 2026-06-09)" */
export function editionLabel(law: LawBundle): string {
  return `${law.promulgationNumber} (시행 ${law.effectiveDate})`;
}

/**
 * 글자 대조용 정규화 — 공백·표 그리는 문자·굵은 글씨 표시를 지운다.
 * 원문에 있는 문장인지 볼 때 양쪽을 이 함수로 바꾼 뒤 견준다.
 */
export function normalizeLawText(s: string): string {
  return s.replace(/[\s\u2500-\u257F*]/g, "");
}

export interface LawSearchHit {
  lawId: string;
  lawName: string;
  kind: "article" | "annex";
  ref: string;
  title: string;
  snippet: string;
}

/** 수록 원문에서 낱말을 찾는다 — 모든 낱말이 들어 있는 조문·별표를 돌려준다 */
export function searchLaws(query: string, limit = 20): LawSearchHit[] {
  const terms = query.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (terms.length === 0) return [];
  const hits: LawSearchHit[] = [];
  const snippetOf = (text: string): string => {
    const at = text.indexOf(terms[0] ?? "");
    const start = Math.max(0, at - 40);
    return text.slice(start, start + 160).replace(/\s+/g, " ").trim();
  };
  for (const law of loadLaws()) {
    for (const a of law.articles) {
      if (terms.every((t) => a.text.includes(t))) {
        hits.push({ lawId: law.id, lawName: law.name, kind: "article", ref: `제${a.number}조${a.branch ? `의${a.branch}` : ""}`, title: a.title, snippet: snippetOf(a.text) });
      }
    }
    for (const x of law.annexes) {
      const haystack = `${x.title}\n${x.text}`;
      if (terms.every((t) => haystack.includes(t))) {
        hits.push({ lawId: law.id, lawName: law.name, kind: "annex", ref: `${x.kind} ${x.key}`, title: x.title, snippet: snippetOf(haystack) });
      }
    }
    if (hits.length >= limit) break;
  }
  return hits.slice(0, limit);
}
