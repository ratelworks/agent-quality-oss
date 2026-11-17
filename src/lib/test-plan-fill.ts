// ─────────────────────────────────────────────────────────────────────────────
// test-plan-fill.ts — 품질시험계획서의 시험 빈도 칸을 업무지침 별표 2 원문으로 채운다.
//
// 시험 빈도는 매번 같은 값이 나와야 하는 원문 값이라 AI 비서가 옮겨 적게 두지 않는다.
//   1. 온톨로지 먼저 — 시험종목에 시험 노드의 이름·별칭이 있으면 그 노드가 잇는 별표 2 행(_meta.testStandardRows)에서 찾는다.
//      "압축강도" 는 시험 노드가 레미콘 공시체 시험이라 굳은 콘크리트 행, "다짐도" 는 현장밀도 행이다.
//      줄의 나머지 말(자재·부위)로 좁히고, 자재를 적지 않았고 빈도가 갈리면 노드가 기본으로 정한 행(default)을 쓴다.
//      노드가 잇는 행이 없거나 나머지 말로 좁힌 결과가 없으면 2 로 간다.
//   2. 시험종목이 별표 2 의 시험종목과 맞으면 그 행
//   3. 아니면 시험종목에 적힌 자재 이름("레미콘", "철근")을 현장 말 자료로 별표 2 종별에 잇는다
// 찾은 행의 빈도가 하나로 같을 때만 칸을 채우고(출처를 붙인다), 여럿이면 칸은 비워 둔 채 후보를 작성 안내로 알린다.
// 시험 횟수는 1일 타설량 등 입력이 더 있어야 정해지므로 채우지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

import { loadTestStandards } from "../knowledge/test-standards.js";
import type { TestStandardRow } from "../knowledge/test-standards.js";
import { loadFieldPhrases } from "../knowledge/field-phrases.js";
import { loadOntologySync } from "../ontology/loader.js";
import { linkedRows, linksOf, type StandardLink } from "../knowledge/test-standard-links.js";
import type { DocumentBody } from "./document-body.js";

// ───── 상수 ─────
const SOURCE = "업무지침 별표 2";
/** 후보로 보여 줄 시험종목의 최대 수 */
const CANDIDATES_MAX = 10;
/** 자재 이름으로 보는 낱말의 최소 길이 */
const TOKEN_MIN = 2;
/** 시험종목 끝에 붙는 일반 말 — "평판재하시험" 은 "평판재하" 로도 찾는다 */
const GENERIC_SUFFIX = /(?:시험|검사|측정)$/u;
/** 줄에 따로 적혀도 뜻을 더하지 않는 말 */
const GENERIC_WORDS = new Set(["시험", "검사", "측정", "시험빈도"]);
/** 종별에서 "X…용 Y" 의 X 는 쓰임새를 꾸미는 말이다("아스팔트 포장용 채움재" 는 아스팔트가 아니다) — X 와 "용" 사이에 올 수 있는 글자 수 */
const MODIFIER_GAP = 4;
/** 규격 표기 — 숫자가 든 말(SD400 · D16 · 25-24-120 · 300톤) */
const SPEC_TOKEN = /\d/u;

export interface FrequencyFill {
  /** 시험계획 표에서 몇 번째 줄인가 (1부터) */
  row: number;
  testItem: string;
  frequency: string;
  /** 어느 행에서 옮겼나 — "1. 공통 > 나. 철근콘크리트공사 · 굳지 아니한 콘크리트 · 슬럼프" */
  from: string[];
  /** 자재를 적지 않아 시험의 일반적인 대상(온톨로지 기본 행)으로 골랐다 */
  assumedMaterial?: true;
}

export interface FrequencyCandidates {
  row: number;
  testItem: string;
  candidates: Array<{ category: string; item: string; frequency: string }>;
  note: string;
}

const squash = (s: string): string => s.replace(/\s+/g, "").toLowerCase();
const tidy = (s: string): string => s.replace(/\s+/g, " ").trim();

/** 공종 이름으로 구분을 찾는 말 — 끝의 공·공사를 떼고, 표에서만 쓰는 표기("철골" → 철강구조물)를 더한다 */
function sectionKeys(workType: string): string[] {
  const base = squash(workType);
  const key = base.replace(/(?:공사|공)$/u, "");
  const { rowTerms } = loadFieldPhrases();
  // "토공" 처럼 떼고 나면 한 글자인 공종도 표기가 있으면 그 구분으로 찾는다
  const named = (lookupTerm(rowTerms, base) ?? lookupTerm(rowTerms, key) ?? []).map(squash);
  return [...new Set([...(key.length >= TOKEN_MIN ? [key] : []), ...named])];
}

const inSectionOf = (keys: string[]) => (r: TestStandardRow): boolean => keys.some((k) => squash(r.section).includes(k));

/** 공종 이름이 구분에 맞는 행만 — 맞는 행이 없으면 공종을 보지 않는다. "아스팔트포장공"·"철근콘크리트공사" 는 끝의 공·공사를 떼고 견준다 */
function bySection(rows: TestStandardRow[], workType: string): TestStandardRow[] {
  const keys = sectionKeys(workType);
  if (keys.length === 0) return rows;
  const hit = rows.filter(inSectionOf(keys));
  return hit.length > 0 ? hit : rows;
}

/** 현장 말 자료의 표기 — 열쇠는 띄어쓰기·대소문자를 가리지 않는다 */
function lookupTerm(dict: Record<string, string[]>, key: string): string[] | undefined {
  const k = squash(key);
  for (const [term, names] of Object.entries(dict)) if (squash(term) === k) return names;
  return undefined;
}

/** 낱말 하나를 찾는 말들 — item·구분에 쓰는 것(넓게)과 종별에 쓰는 것.
 *  표에서만 쓰는 표기(rowTerms)가 있는 낱말은 종별을 그 표기로만 찾는다("철근" 이 "철근 이음" 종별에 걸리지 않게).
 *  사전에 없는 겹낱말은 사전 낱말을 바꿔 끼운 말도 더한다("경질우레탄폼" → "경질폴리우레탄폼"). */
function wordAlts(word: string): { any: string[]; category: string[] } {
  const { terms, rowTerms } = loadFieldPhrases();
  const w = squash(word);
  const stripped = w.replace(GENERIC_SUFFIX, "");
  const rowNames = lookupTerm(rowTerms, w) ?? [];
  const termNames = lookupTerm(terms, w) ?? [];
  const compound: string[] = [];
  if (rowNames.length === 0 && termNames.length === 0) {
    for (const dict of [rowTerms, terms]) {
      for (const [term, names] of Object.entries(dict)) {
        const t = squash(term);
        if (t.length < TOKEN_MIN || t === w || !w.includes(t)) continue;
        for (const name of names) compound.push(w.replace(t, squash(name)));
      }
    }
  }
  const any = [...new Set([w, ...(stripped.length >= TOKEN_MIN ? [stripped] : []), ...rowNames.map(squash), ...termNames.map(squash), ...compound])];
  const category = rowNames.length > 0 ? [...new Set(rowNames.map(squash))] : any;
  return { any, category };
}

/** 종별 글자 — 띄어쓰기를 뺀 글과, 그 글의 각 글자가 원래 글에서 낱말 끝인지 */
function categoryWords(category: string): { text: string; wordEnd: boolean[] } {
  let text = "";
  const wordEnd: boolean[] = [];
  const chars = [...category.toLowerCase()];
  chars.forEach((ch, i) => {
    if (/\s/u.test(ch)) return;
    text += ch;
    const next = chars[i + 1];
    wordEnd.push(next === undefined || /[\s()>,·/]/u.test(next) || !/[가-힣a-z0-9]/u.test(ch));
  });
  return { text, wordEnd };
}

/** 종별에 그 말이 자재 이름으로 들어 있나 —
 *  "X…용" 의 X 는 꾸미는 말이라 치지 않고, 낱말 가운데에 박힌 말도 치지 않는다
 *  ("수경성시멘트무수축 그라우트" 는 시멘트가 아니라 그라우트다, "속빈콘크리트블록" 은 콘크리트가 아니라 블록이다) */
function categoryHas(category: string, key: string): boolean {
  const { text: c, wordEnd } = categoryWords(category);
  for (let at = c.indexOf(key); at >= 0; at = c.indexOf(key, at + 1)) {
    const after = c.slice(at + key.length, at + key.length + MODIFIER_GAP + 1);
    if (new RegExp(`^[가-힣]{0,${MODIFIER_GAP}}용`, "u").test(after)) continue;
    if (wordEnd[at + key.length - 1]) return true;
  }
  return false;
}

// ───── 온톨로지: 시험 노드 → 별표 2 행 ─────
interface TestConcept { id: string; aliases: Array<{ text: string; key: string }>; links: StandardLink[] }

let conceptsCache: TestConcept[] | null = null;

/** 시험 노드와 그 노드가 잇는 별표 2 행 — 잇는 행이 없는 노드도 둔다(그 노드가 가장 잘 맞으면 온톨로지로 정하지 않는다) */
function testConcepts(): TestConcept[] {
  if (!conceptsCache) {
    conceptsCache = [...loadOntologySync().entities.values()]
      .filter((e) => e.type === "TestItem")
      .map((e) => ({
        id: e.id,
        aliases: [e.name, ...e.aliases].map((text) => ({ text, key: squash(text) })).filter((a) => a.key.length >= TOKEN_MIN),
        links: linksOf(e),
      }));
  }
  return conceptsCache;
}

export { linkedRows };

/** 시험 노드의 별표 2 연결 — 검사용 (노드 id, 연결) */
export function testStandardLinks(): Array<{ id: string; link: StandardLink }> {
  return testConcepts().flatMap((c) => c.links.map((link) => ({ id: c.id, link })));
}

const distinctFrequencies = (rows: TestStandardRow[]): number => new Set(rows.map((r) => squash(r.frequency))).size;

/**
 * 온톨로지로 찾은 별표 2 행 — 시험 노드가 정해지지 않거나 노드가 잇는 행으로 줄을 설명하지 못하면 null.
 */
function graphPlanRows(workType: string, words: string[]): { rows: TestStandardRow[]; namedMaterial: boolean; allDefault: boolean } | null {
  const text = squash(words.join(""));
  // 공종 이름을 앞에 붙인 글에서도 찾는다 — 아스팔트포장공의 "다짐도" 는 "포장 다짐도", 콘크리트공의 "온도" 는 "콘크리트 온도".
  // 그때 별칭은 시험종목 쪽 글에 걸쳐야 한다(공종 이름만으로 시험을 정하지 않는다)
  const work = squash(workType).replace(/(?:공사|공)$/u, "");
  const withWork = work + text;
  const inLine = (key: string): boolean => {
    if (text.includes(key)) return true;
    for (let at = withWork.indexOf(key); at >= 0; at = withWork.indexOf(key, at + 1)) if (at + key.length > work.length && at < work.length) return true;
    return false;
  };
  // 1) 줄 글에 들어 있는 가장 긴 이름·별칭의 시험 노드
  let best = 0;
  let hits: Array<{ concept: TestConcept; alias: { text: string; key: string } }> = [];
  for (const concept of testConcepts()) {
    for (const alias of concept.aliases) {
      if (!inLine(alias.key) || alias.key.length < best) continue;
      if (alias.key.length > best) hits = [];
      best = alias.key.length;
      hits.push({ concept, alias });
    }
  }
  if (hits.length === 0 || hits.some((h) => h.concept.links.length === 0)) return null;

  // 2) 노드가 잇는 행. 별칭의 낱말이 시험종목에 있으면 그 행으로 좁힌다("정재하시험" → 정재하, "철근 인장강도" → 인장강도)
  const linked = hits.flatMap((h) => h.concept.links.map((link) => ({ link, rows: linkedRows(link) })));
  let rows = [...new Set(linked.flatMap((x) => x.rows))];
  if (rows.length === 0) return null;
  const aliasWords = [...new Set(hits.flatMap((h) => h.alias.text.split(/[\s,·/]+/u)))].map((w) => squash(w).replace(GENERIC_SUFFIX, "")).filter((w) => w.length >= TOKEN_MIN);
  const byAlias = rows.filter((r) => aliasWords.some((w) => squash(r.item).includes(w)));
  if (byAlias.length > 0) rows = byAlias;
  // 별칭이 자재를 가리키면 그 종별로("벽돌 압축강도" → 벽돌, "블록 강도" → 블록)
  const byAliasMaterial = rows.filter((r) => aliasWords.some((w) => categoryHas(r.category, w)));
  if (byAliasMaterial.length > 0) rows = byAliasMaterial;

  // 3) 별칭 밖의 말(자재·부위)로 좁힌다 — 하나라도 행에 없으면 이 노드로는 정하지 않는다
  const aliasKey = hits[0]?.alias.key ?? "";
  const rest = words
    .map((w) => squash(w))
    .map((w) => (aliasKey.includes(w) ? "" : w.includes(aliasKey) ? w.replace(aliasKey, "") : w))
    .filter((w) => w.length >= TOKEN_MIN && !GENERIC_WORDS.has(w));
  let namedMaterial = false;
  for (const word of rest) {
    const alts = wordAlts(word);
    const narrowed = rows.filter((r) => {
      const inCategory = alts.category.some((k) => categoryHas(r.category, k));
      if (inCategory) return true;
      return alts.any.some((k) => squash(r.item).includes(k) || squash(r.section).includes(k));
    });
    if (narrowed.length === 0) return null;
    if (narrowed.some((r) => alts.category.some((k) => categoryHas(r.category, k)))) namedMaterial = true;
    rows = narrowed;
  }

  // 4) 공종 — 공종의 구분이 있는데 노드의 행이 그 구분에 하나도 없으면 이 공종의 시험이 아니다
  const keys = sectionKeys(workType);
  if (keys.length > 0) {
    const allRows = loadTestStandards().rows;
    const sectionExists = allRows.some(inSectionOf(keys));
    const inSection = rows.filter(inSectionOf(keys));
    if (inSection.length > 0) rows = inSection;
    else if (sectionExists) return null;
  }

  // 5) 자재를 적지 않았고 빈도가 갈리면 노드가 기본으로 정한 행
  if (!namedMaterial && distinctFrequencies(rows) > 1) {
    const defaults = new Set(linked.filter((x) => x.link.default).flatMap((x) => x.rows));
    const picked = rows.filter((r) => defaults.has(r));
    if (picked.length > 0) rows = picked;
  }
  const defaultRows = new Set(linked.filter((x) => x.link.default).flatMap((x) => x.rows));
  return { rows, namedMaterial, allDefault: rows.every((r) => defaultRows.has(r)) };
}

/** 칸에서 괄호 안 설명을 뺀 이름 — "굳지 아니한 콘크리트 (레미콘포함)" → "굳지아니한콘크리트" */
const bare = (s: string): string => squash(s.replace(/\([^)]*\)/g, ""));

/** 시험계획 한 줄을 별표 2 에서 찾은 결과 — 행과, 시험종목 낱말이 있었는지 */
export interface PlanRowMatch {
  rows: TestStandardRow[];
  /** 시험종목 칸에 걸린 낱말이 있었나 (없으면 자재 이름만으로 찾은 것) */
  byTestItem: boolean;
  /** 적은 KS 번호와 시험방법이 맞는 행이 없었다 — 그 번호 (빈도를 채우지 않고 확인을 구한다) */
  ksMismatch?: string;
  /** 자재를 적지 않아 온톨로지의 시험 노드가 기본으로 정한 행을 골랐다 */
  assumedDefault?: true;
}

/**
 * 시험계획 한 줄에 맞는 별표 2 행.
 *   낱말마다 시험종목 칸에 걸리는지, 종별(자재) 칸에 걸리는지를 따로 본다("레미콘 슬럼프" = 자재 + 시험종목).
 *   모든 낱말이 어딘가(시험종목·종별·구분)에 걸리고 시험종목 칸에 하나 이상 걸린 행만 남기고,
 *   시험종목 이름이 낱말과 꼭 같은 행이 있으면 그 행을 먼저 쓴다("공기량" → "모르타르 공기량" 보다 "공기량").
 *   괄호 안의 KS 번호는 그 번호가 적힌 행으로 좁힌다. 시험종목 낱말이 없으면 자재 이름으로 종별의 행을 모두 돌려준다.
 */
export function matchPlanRow(workType: string, testItem: string): PlanRowMatch {
  if (!testItem.trim()) return { rows: [], byTestItem: false };
  const ks = /KS\s*[A-Z]\s*\d{3,5}(?:-\d+)?/i.exec(testItem)?.[0];
  /** 괄호 안 설명을 뺀 낱말 전부 (한 글자 낱말 포함 — "겉모양 및 모양" 의 "및") */
  const words = testItem
    .replace(/\([^)]*\)/g, " ")
    .split(/[\s,·/]+/)
    .filter(Boolean);
  const tokens = words.filter((t) => t.length >= TOKEN_MIN);
  // 괄호 안 KS 번호는 그 번호가 시험방법·종별·비고에 적힌 행으로 좁힌다. 맞는 행이 없으면 행은 그대로 주되 어긋남을 알린다
  let ksMismatch: string | undefined;
  const withKs = (list: TestStandardRow[]): TestStandardRow[] => {
    if (!ks || list.length === 0) return list;
    const key = squash(ks);
    const hit = list.filter((r) => squash(`${r.method} ${r.category} ${r.remarks}`).includes(key));
    if (hit.length === 0) ksMismatch = ks.replace(/\s+/g, " ").trim();
    return hit.length > 0 ? hit : list;
  };
  const done = (list: TestStandardRow[], byTestItem: boolean, assumed = false): PlanRowMatch => {
    const rowsWithKs = withKs(list);
    return { rows: rowsWithKs, byTestItem, ...(ksMismatch ? { ksMismatch } : {}), ...(assumed ? { assumedDefault: true as const } : {}) };
  };

  // 1) 온톨로지의 시험 노드가 잇는 행 — 별표 2 가 줄의 말을 그대로 시험종목 이름으로 갖고 있는데 노드가 그와 다른 행을 고르면
  //    표의 이름을 따른다("다짐" 은 표의 실내 다짐시험이지 현장밀도가 아니다, "압축강도의 비" 는 혼화제의 시험이다)
  const fromGraph = graphPlanRows(workType, words);
  const fromTable = tableRows(workType, words, tokens);
  // 표에서 줄의 말과 꼭 같은 시험종목이 여러 자재에 있고 빈도가 갈리면, 노드는 기본으로 정한 행이거나 줄이 자재를 적었을 때만 고른다
  //    ("투수계수" 를 토목섬유·흙의 행으로만 좁혀 다른 자재의 투수계수 빈도를 채우지 않게)
  const tableAmbiguous = fromTable.exact.length > 0 && distinctFrequencies(fromTable.exact) > 1;
  const decisive = fromGraph !== null && (fromGraph.namedMaterial || fromGraph.allDefault);
  if (fromGraph && !(fromTable.exact.length > 0 && !fromTable.exact.some((r) => fromGraph.rows.includes(r))) && (!tableAmbiguous || decisive)) {
    // 자재를 적지 않았는데 표의 글로는 여러 자재의 빈도가 갈렸다 — 온톨로지가 시험의 대상 자재로 골랐다는 것을 알린다
    const assumed = !fromGraph.namedMaterial && distinctFrequencies(fromTable.rows) > 1;
    return done(fromGraph.rows, true, assumed);
  }
  return done(fromTable.rows, fromTable.byTestItem);
}

/** 별표 2 의 글자로 찾은 행 — exact 는 시험종목 이름이 줄의 말과 꼭 같은 행 */
function tableRows(workType: string, words: string[], tokens: string[]): { rows: TestStandardRow[]; byTestItem: boolean; exact: TestStandardRow[] } {
  const { rows } = loadTestStandards();
  // 2) 낱말마다 시험종목·종별·구분 가운데 어디에 걸리나.
  //    종별의 "X…용" 에만 걸린 낱말은 다른 낱말이 그 종별의 이름(머리)에 걸릴 때만 종별로 친다 —
  //    "거푸집 합판" 은 "콘크리트 거푸집용 합판" 이지만 "아스팔트 함량" 의 아스팔트는 "아스팔트 포장용 채움재" 가 아니다
  const alts = tokens.map((t) => wordAlts(t));
  const located = rows.map((r) => {
    const item = squash(r.item);
    const category = squash(r.category);
    const head = alts.map((a) => a.category.some((k) => categoryHas(r.category, k)));
    const modifier = alts.map((a, i) => !head[i] && a.category.some((k) => category.includes(k)));
    const where = alts.map((a, i) =>
      a.any.some((k) => item.includes(k))
        ? "item"
        : head[i] || (modifier[i] && head.some((h, j) => h && j !== i))
          ? "category"
          : a.any.some((k) => squash(r.section).includes(k))
            ? "section"
            : null,
    );
    return { r, where, head };
  });
  /** 규격 표기(SD400·D16·25-24-120 처럼 숫자가 든 말)는 표의 글에 없어도 된다.
   *  다만 규격을 건너뛴 줄은 시험종목을 자재 이름이 아닌 말로 가리켜야 한다 — "철근 SD400 D16" 은 자재만 적은 줄이다
   *  ("철근" 이 "철근의 배치" 같은 시험종목에 걸려 다른 자재의 행을 고르지 않게) */
  const optional = tokens.map((t) => SPEC_TOKEN.test(t));
  const { terms, rowTerms } = loadFieldPhrases();
  const materialWord = tokens.map((t) => lookupTerm(rowTerms, t) !== undefined || lookupTerm(terms, t) !== undefined);
  const placed = (where: Array<string | null>): boolean => where.every((w, i) => w !== null || optional[i]);
  const namesTest = (where: Array<string | null>): boolean =>
    where.every((w) => w !== null) ? where.includes("item") : where.some((w, i) => w === "item" && !materialWord[i] && !optional[i]);
  const scored = located
    .map(({ r, where, head }) => {
      // 시험종목이 꼭 같은가 — 자재·공종 낱말을 뺀 나머지 글 전체가 시험종목 이름과 같을 때만("겉모양 및 모양" 은 "모양" 과 다르다).
      // 낱말이 하나뿐이면 그 낱말의 표준 말(현장 말 자료)과 같아도 같다고 본다
      const itemWords = words.filter((w) => {
        const i = tokens.indexOf(w);
        return i < 0 || where[i] === "item";
      });
      const itemOnly = alts.filter((_, i) => where[i] === "item");
      const exact = bare(r.item) === squash(itemWords.join("")) || (itemOnly.length === 1 && (itemOnly[0]?.any ?? []).some((k) => bare(r.item) === k));
      const categoryHits = head.filter((h, i) => h && where[i] === "category").length;
      return { r, where, exact, categoryHits };
    })
    .filter((x) => placed(x.where) && namesTest(x.where));
  if (scored.length > 0) {
    // 1) 공종으로 먼저 좁힌다 2) 시험종목 이름이 꼭 같은 행 3) 공종이 맞았을 때만 — 자재 낱말이 종별에 걸린 행을 공종 이름에만 걸린 행보다 먼저.
    // 공종을 모르면 3) 을 하지 않는다: "아스콘 온도" 의 "아스팔트" 가 방수시트 종별에 걸려 포장 공종의 온도 대신 고르는 일이 생긴다(틀린 빈도를 칸에 쓰게 된다)
    const keys = sectionKeys(workType);
    const inSection = keys.length > 0 ? scored.filter((x) => inSectionOf(keys)(x.r)) : [];
    const sectioned = inSection.length > 0 ? inSection : scored;
    const exact = sectioned.filter((x) => x.exact);
    let pool = exact.length > 0 ? exact : sectioned;
    if (inSection.length > 0) {
      const best = Math.max(...pool.map((x) => x.categoryHits));
      pool = pool.filter((x) => x.categoryHits === best);
    }
    return { rows: pool.map((x) => x.r), byTestItem: true, exact: exact.map((x) => x.r) };
  }
  // 3) 자재 이름만 있다 — 그 종별의 행 모두 (시험종목마다 빈도가 다를 수 있다).
  // 현장 말 자료에 표준 이름이 있으면 그 이름으로만 찾는다("철근" → "철근콘크리트용봉강" — "철근" 그대로면 "철근콘크리트용 방청제" 까지 걸린다).
  // 줄의 모든 낱말이 그 행(종별·구분)에 걸려야 한다 — 한 낱말만 걸린 다른 자재의 빈도를 채우지 않는다("거푸집 합판 함수율" 이 각형강관 행으로 가지 않게)
  const materialOnly = located.filter((x) => placed(x.where) && x.where.every((w) => w !== "item") && x.where.includes("category")).map((x) => x.r);
  if (materialOnly.length > 0) return { rows: bySection(materialOnly, workType), byTestItem: false, exact: [] };
  return { rows: [], byTestItem: false, exact: [] };
}

/** 시험계획 한 줄에 맞는 별표 2 행 */
export function planRowStandards(workType: string, testItem: string): TestStandardRow[] {
  return matchPlanRow(workType, testItem).rows;
}

/**
 * 품질시험계획서 본문의 시험계획 표에서 빈도가 빈 줄을 채운다 — body 를 고친다.
 * 채운 칸과 후보를 돌려준다.
 */
export function fillTestPlanFrequencies(body: DocumentBody): { filled: FrequencyFill[]; candidates: FrequencyCandidates[] } {
  const filled: FrequencyFill[] = [];
  const candidates: FrequencyCandidates[] = [];
  const field = body.draft.fields.find((f) => f.name === "testItems");
  if (!field || !Array.isArray(field.value)) return { filled, candidates };
  const hints: string[] = [];
  field.value.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) return;
    const row = entry as Record<string, string>;
    const testItem = (row["testItem"] ?? "").trim();
    if (!testItem || (row["testFrequency"] ?? "").trim()) return;
    const { rows: found, byTestItem, ksMismatch, assumedDefault } = matchPlanRow(row["workType"] ?? "", testItem);
    if (found.length === 0) return;
    // 띄어쓰기만 다른 빈도 글("숫자 중"·"숫자중")은 같은 빈도로 본다
    const frequencies = [...new Map(found.map((r) => [squash(r.frequency), tidy(r.frequency)] as const).filter(([k]) => k)).values()];
    if (frequencies.length === 1 && !ksMismatch) {
      const frequency = frequencies[0] as string;
      row["testFrequency"] = `${frequency} (${SOURCE})`;
      filled.push({ row: index + 1, testItem, frequency, from: [...new Set(found.map((r) => `${r.section} · ${tidy(r.category)} · ${tidy(r.item)}`))], ...(assumedDefault ? { assumedMaterial: true as const } : {}) });
      if (assumedDefault) {
        const materials = [...new Set(found.map((r) => tidy(r.category)))].join(" · ");
        hints.push(`${index + 1}번 줄 '${testItem}' 시험 빈도 — 자재를 적지 않아 ${materials} 의 빈도로 채웠습니다(이 시험의 일반적인 대상). 다른 자재의 시험이면 자재 이름을 함께 적으세요.`);
      }
      return;
    }
    const seen = new Set<string>();
    const list: FrequencyCandidates["candidates"] = [];
    for (const r of found) {
      const key = `${tidy(r.category)}|${tidy(r.item)}|${tidy(r.frequency)}`;
      if (seen.has(key) || list.length >= CANDIDATES_MAX) continue;
      seen.add(key);
      list.push({ category: tidy(r.category), item: tidy(r.item), frequency: tidy(r.frequency) });
    }
    const note = ksMismatch
      ? `적은 ${ksMismatch} 와 시험방법이 맞는 행이 ${SOURCE} 에 없어 칸을 비워 두었습니다 — 시험종목이나 KS 번호를 확인하세요.`
      : byTestItem
      ? `같은 시험종목이 여러 자재·공종에 있고 빈도가 달라 칸을 비워 두었습니다 — 자재 이름(예: 레미콘·골재)이나 공종을 함께 적으면 ${SOURCE} 의 빈도를 채웁니다.`
      : `시험종목마다 빈도가 달라 칸을 비워 두었습니다 — 시험종목을 한 줄에 하나씩 나눠 적으면 ${SOURCE} 의 빈도를 채웁니다.`;
    candidates.push({ row: index + 1, testItem, candidates: list, note });
    hints.push(`${index + 1}번 줄 '${testItem}' 시험 빈도 — ${note} 후보(${SOURCE}): ${list.map((c) => `${byTestItem ? `${c.category} · ` : ""}${c.item}: ${c.frequency}`).join(" / ")}`);
  });
  if (hints.length > 0) field.hints = [...(field.hints ?? []), ...hints];
  if (filled.length > 0) {
    body.autoFilled = [
      ...(body.autoFilled ?? []),
      `시험 빈도 ${filled.length}칸은 ${SOURCE} 원문의 빈도를 옮겨 채웠습니다(칸에 출처를 적었습니다). 시험 횟수는 1일 타설량 등이 있어야 정해지므로 비워 두었습니다.`,
    ];
  }
  return { filled, candidates };
}
