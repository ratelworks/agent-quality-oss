// ─────────────────────────────────────────────────────────────────────────────
// field-search.ts — 현장 말로 쓴 문장에서 그래프 노드·법령 조문·품질시험기준 행을 찾는다.
//
// 왜 따로 두나
//   현장 말("레미콘이 질다")과 자료의 말("슬럼프 기준 초과")은 낱말이 다르다. 이름과 조문 본문만 보면 못 찾는다.
//   그래서 찾는 글에 현장 표현(ontology/field-phrases.json)을 덧붙이고,
//   문장 쪽에는 현장 용어의 표준 말("들밀도" → "현장밀도")을 덧붙인 뒤 문장 검색(lib/sentence-search)으로 견준다.
//   현장 표현은 편집자가 쓴 글이라 찾는 데만 쓰고 답에는 내보내지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

import { SentenceIndex } from "../lib/sentence-search.js";
import type { SearchDocument } from "../lib/sentence-search.js";
import { loadLaws } from "../ontology/laws.js";
import type { OntologyGraph } from "../ontology/graph.js";
import type { BaseEntity } from "../ontology/schema.js";
import { expandFieldTerms, loadFieldPhrases } from "./field-phrases.js";
import { loadTestStandards } from "./test-standards.js";
import type { TestStandardRow } from "./test-standards.js";

// ───── 상수 ─────
/** 이름·제목을 본문보다 몇 배 무겁게 셀지 */
const TITLE_REPEAT = 3;
/** 별표·서식 본문은 앞부분만 본다 — 긴 표가 모든 문장에 조금씩 걸리지 않게 */
const ANNEX_BODY_CHARS = 1200;
/** 맨 위 결과 점수의 이 비율보다 낮은 결과는 버린다 */
const RELATIVE_FLOOR = 0.45;
/**
 * 맨 위 결과 점수가 이보다 낮으면 문장과 닿는 글이 없다고 본다.
 * 맞춰 보는 질문 묶음과 품질과 상관없는 문장 14개로 재서 정했다(2026-11-16).
 * 이 값에서 맞춰 보는 묶음의 적중률은 그대로이고, 상관없는 문장 14개 가운데 12개가 아무것도 내지 않는다.
 * 같은 결과를 내는 값 가운데 가장 낮은 것을 골랐다 — 올릴수록 맞는 질문이 빠진다
 * (15 · 18 · 14 면 상관없는 문장은 모두 걸러지지만 맞춰 보는 묶음에서 한 문항이 더 빠진다).
 */
const MIN_TOP_SCORE = { node: 10, law: 13, row: 10 } as const;
/** 문장 안에서 알아볼 이름·별칭의 최소 길이 */
const MIN_SPOT_LENGTH = 2;
/**
 * 현장 표현만 따로 견주는 글의 id 꼬리.
 * 긴 조문 본문에 붙여 넣으면 현장 표현이 본문에 묻혀 순위가 밀린다 — 따로 견줘 높은 쪽 점수를 쓴다.
 */
const FIELD_SUFFIX = "#field";
/**
 * 문장에서 세지 않는 글자 쌍 — 물음말·어미·조사. 어느 질문에나 있어 무엇을 묻는지 가리지 못하고,
 * 품질과 상관없는 문장("휴가는 언제 가나")이 현장 표현의 "언제" 와 걸리게 만든다.
 */
const IGNORED_GRAMS: ReadonlySet<string> = new Set(
  (
    "언제 어디 디에 어떻 떻게 무슨 뭔가 얼마 마나 마다 누가 누구 구한 한테 해야 야하 하나 되나 도되 인지 는지 모르 르겠 겠다 " +
    "있나 있다 없다 같다 같은 것같 는데 은데 했는 왔는 들어 어오 어왔 오면 나온 나왔 온다 한다 된다 봐야 야한 싶다 려면 라는 " +
    "어서 에서 으로 까지 부터 이다 입니 니다 습니 하는 하고 해도 어도 려는 는게 게좋 좋을 을까 될까 인가 가요 세요 주나 주세 알려 려줘 " +
    "그대 대로 어떤 이런 저런 그런 우리 오늘 내일 지금 너무 제대 정도"
  ).split(" "),
);
/** 부가 정보에서 찾는 글에 넣는 값의 깊이 */
const META_DEPTH = 2;

export interface NodeHit {
  entity: BaseEntity;
  /** 0~1 — 문장에 이름·별칭이 그대로 있으면 높다 */
  score: number;
  matchedBy: "name" | "sentence";
}

export interface LawArticleHit {
  law: string;
  lawName: string;
  kind: "article" | "annex";
  ref: string;
  title: string;
}

let lawIndexCache: { index: SentenceIndex; byId: Map<string, LawArticleHit> } | null = null;
let rowIndexCache: { index: SentenceIndex; byId: Map<string, TestStandardRow> } | null = null;
const nodeIndexCache = new WeakMap<OntologyGraph, SentenceIndex>();

const squash = (s: string): string => s.replace(/\s+/g, "").toLowerCase();

/** 본문 글과 현장 표현 글 — 현장 표현이 있으면 글을 둘로 만든다 */
function withFieldDocument(id: string, title: string, body: string, phrases: string[] | undefined): SearchDocument[] {
  const documents: SearchDocument[] = [{ id, title, body }];
  if (phrases && phrases.length > 0) documents.push({ id: `${id}${FIELD_SUFFIX}`, title, body: phrases.join("\n") });
  return documents;
}

/** 같은 대상의 본문 글·현장 표현 글 가운데 높은 점수 하나로 합친다 */
function mergeByTarget(hits: Array<{ id: string; score: number }>): Array<{ id: string; score: number }> {
  const best = new Map<string, number>();
  for (const hit of hits) {
    const id = hit.id.endsWith(FIELD_SUFFIX) ? hit.id.slice(0, -FIELD_SUFFIX.length) : hit.id;
    if ((best.get(id) ?? 0) < hit.score) best.set(id, hit.score);
  }
  return [...best].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

/** 맨 위 점수에 견줘 너무 낮은 결과를 버린다 */
function keepRelevant<T extends { score: number }>(hits: T[], minTop: number): T[] {
  const top = hits[0]?.score ?? 0;
  if (top < minTop) return [];
  return hits.filter((h) => h.score >= top * RELATIVE_FLOOR);
}

// ───── 그래프 노드 ─────

function metaStrings(value: unknown, depth: number, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (depth > 0 && Array.isArray(value)) for (const v of value) metaStrings(v, depth - 1, out);
  else if (depth > 0 && value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) metaStrings(v, depth - 1, out);
  }
}

function nodeIndex(graph: OntologyGraph): SentenceIndex {
  const cached = nodeIndexCache.get(graph);
  if (cached) return cached;
  const { phrases } = loadFieldPhrases();
  const documents: SearchDocument[] = [...graph.entities.values()].flatMap((e) => {
    const meta: string[] = [];
    metaStrings(e.meta, META_DEPTH, meta);
    return withFieldDocument(e.id, `${e.name} ${e.aliases.join(" ")}`, meta.join("\n"), phrases[e.id]);
  });
  const index = new SentenceIndex(documents, TITLE_REPEAT);
  nodeIndexCache.set(graph, index);
  return index;
}

/** 문장에 이름·별칭이 그대로 들어 있는 노드 — 긴 이름일수록 점수가 높다 */
function spotNodes(graph: OntologyGraph, sentence: string): NodeHit[] {
  const flat = squash(sentence);
  const best = new Map<string, number>();
  for (const [key, ids] of graph.aliasIndex) {
    const flatKey = squash(key);
    if (flatKey.length < MIN_SPOT_LENGTH || !flat.includes(flatKey)) continue;
    const score = Math.min(0.95, 0.7 + flatKey.length * 0.03);
    for (const id of ids) if ((best.get(id) ?? 0) < score) best.set(id, score);
  }
  const hits: NodeHit[] = [];
  for (const [id, score] of best) {
    const entity = graph.entities.get(id);
    if (entity) hits.push({ entity, score, matchedBy: "name" });
  }
  return hits;
}

/** 문장과 닿는 그래프 노드 — 이름이 그대로 있는 것과 문장 검색으로 찾은 것을 합친다 */
export function searchNodesBySentence(graph: OntologyGraph, sentence: string, limit = 40): NodeHit[] {
  const expanded = expandFieldTerms(sentence);
  const merged = new Map<string, NodeHit>();
  for (const hit of spotNodes(graph, expanded)) merged.set(hit.entity.id, hit);
  const searched = keepRelevant(mergeByTarget(nodeIndex(graph).search(expanded, limit * 2, IGNORED_GRAMS)), MIN_TOP_SCORE.node).slice(0, limit);
  const top = searched[0]?.score ?? 1;
  for (const hit of searched) {
    const entity = graph.entities.get(hit.id);
    if (!entity) continue;
    // 문장 검색 점수는 맨 위를 0.8 로 두고 견준다 — 이름이 그대로 있는 것보다는 아래에 둔다
    const score = (hit.score / top) * 0.8;
    const before = merged.get(hit.id);
    if (!before || before.score < score) merged.set(hit.id, { entity, score, matchedBy: before ? before.matchedBy : "sentence" });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score || (a.entity.id < b.entity.id ? -1 : 1));
}

// ───── 법령 조문 ─────

function lawIndex(): { index: SentenceIndex; byId: Map<string, LawArticleHit> } {
  if (lawIndexCache) return lawIndexCache;
  const { phrases } = loadFieldPhrases();
  const byId = new Map<string, LawArticleHit>();
  const documents: SearchDocument[] = [];
  for (const law of loadLaws()) {
    for (const a of law.articles) {
      if (a.deleted || !a.title) continue;
      const ref = `제${a.number}조${a.branch ? `의${a.branch}` : ""}`;
      const id = `${law.id}:${ref}`;
      byId.set(id, { law: law.id, lawName: law.name, kind: "article", ref, title: a.title });
      documents.push(...withFieldDocument(id, a.title, a.text, phrases[id]));
    }
    for (const x of law.annexes) {
      const ref = `${x.kind} ${x.key}`;
      const id = `${law.id}:${ref}`;
      // 같은 번호의 별표·서식이 여럿이면 처음 것만 싣는다(주소가 같아 가릴 수 없다)
      if (byId.has(id)) continue;
      byId.set(id, { law: law.id, lawName: law.name, kind: "annex", ref, title: x.title });
      documents.push(...withFieldDocument(id, x.title, x.text.slice(0, ANNEX_BODY_CHARS), phrases[id]));
    }
  }
  lawIndexCache = { index: new SentenceIndex(documents, TITLE_REPEAT), byId };
  return lawIndexCache;
}

/** 문장과 닿는 조문·별표·서식 */
export function searchLawArticlesBySentence(sentence: string, limit = 5): LawArticleHit[] {
  const { index, byId } = lawIndex();
  const out: LawArticleHit[] = [];
  for (const hit of keepRelevant(mergeByTarget(index.search(expandFieldTerms(sentence), limit * 2, IGNORED_GRAMS)), MIN_TOP_SCORE.law).slice(0, limit)) {
    const found = byId.get(hit.id);
    if (found) out.push(found);
  }
  return out;
}

// ───── 품질시험기준 (업무지침 별표 2) ─────

function rowIndex(): { index: SentenceIndex; byId: Map<string, TestStandardRow> } {
  if (rowIndexCache) return rowIndexCache;
  const byId = new Map<string, TestStandardRow>();
  const documents: SearchDocument[] = [];
  for (const row of loadTestStandards().rows) {
    byId.set(row.id, row);
    // 빈도는 넣지 않는다 — "세제곱미터마다" 같은 말은 어느 행에나 있어 자재·시험을 가리지 못한다
    documents.push({ id: row.id, title: `${row.category} ${row.item}`, body: `${row.section} ${row.method}` });
  }
  rowIndexCache = { index: new SentenceIndex(documents, TITLE_REPEAT), byId };
  return rowIndexCache;
}

/** 문장과 닿는 품질시험기준 행 */
export function searchTestRowsBySentence(sentence: string, limit = 6): TestStandardRow[] {
  const { index, byId } = rowIndex();
  const out: TestStandardRow[] = [];
  for (const hit of keepRelevant(index.search(expandFieldTerms(sentence, true), limit, IGNORED_GRAMS), MIN_TOP_SCORE.row)) {
    const row = byId.get(hit.id);
    if (row) out.push(row);
  }
  return out;
}
