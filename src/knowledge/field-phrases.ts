// ─────────────────────────────────────────────────────────────────────────────
// field-phrases.ts — 현장에서 쓰는 말과 표준 용어를 잇는 자료(ontology/field-phrases.json)를 읽는다.
//   terms    현장 말 → 표준 말 ("들밀도" → "현장밀도")
//   rowTerms 품질시험기준(업무지침 별표 2)에서만 쓰는 표기 ("철근" → "철근콘크리트용봉강")
//   phrases 노드·조문이 걸리는 상황을 현장 말로 적은 글 — 찾는 데만 쓰고 답에는 내보내지 않는다
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ───── 상수 ─────
const FIELD_PHRASES_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ontology", "field-phrases.json");

export interface FieldPhrases {
  /** 현장 말 → 표준 말 */
  terms: Record<string, string[]>;
  /** 품질시험기준 표에서만 쓰는 표기 — 그 표의 행을 찾을 때만 덧붙인다(다른 곳에 덧붙이면 엉뚱한 글이 걸린다) */
  rowTerms: Record<string, string[]>;
  /** 대상(노드 id · "법령 id:조문") → 현장 표현 */
  phrases: Record<string, string[]>;
}

let cache: FieldPhrases | null = null;

const squash = (s: string): string => s.replace(/\s+/g, "").toLowerCase();

/** 현장 용어·현장 표현 자료. 파일이 없거나 깨졌으면 빈 값(이름과 본문만으로 찾는다) */
export function loadFieldPhrases(): FieldPhrases {
  if (cache) return cache;
  try {
    const data = JSON.parse(readFileSync(FIELD_PHRASES_PATH, "utf8")) as Partial<FieldPhrases>;
    cache = { terms: data.terms ?? {}, rowTerms: data.rowTerms ?? {}, phrases: data.phrases ?? {} };
  } catch {
    cache = { terms: {}, rowTerms: {}, phrases: {} };
  }
  return cache;
}

/**
 * 문장에 든 현장 용어의 표준 말을 문장 뒤에 덧붙인다.
 * @param forTestRows 품질시험기준 행을 찾을 때 — 그 표에서만 쓰는 표기도 덧붙인다
 */
export function expandFieldTerms(sentence: string, forTestRows = false): string {
  const flat = squash(sentence);
  const added: string[] = [];
  const { terms, rowTerms } = loadFieldPhrases();
  for (const [term, standards] of [...Object.entries(terms), ...(forTestRows ? Object.entries(rowTerms) : [])]) {
    if (flat.includes(squash(term))) added.push(...standards);
  }
  return added.length > 0 ? `${sentence} ${[...new Set(added)].join(" ")}` : sentence;
}
