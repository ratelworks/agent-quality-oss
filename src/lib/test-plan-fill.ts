// ─────────────────────────────────────────────────────────────────────────────
// test-plan-fill.ts — 품질시험계획서의 시험 빈도 칸을 업무지침 별표 2 원문으로 채운다.
//
// 시험 빈도는 매번 같은 값이 나와야 하는 원문 값이라 AI 비서가 옮겨 적게 두지 않는다.
//   1. 시험종목이 별표 2 의 시험종목과 맞으면 그 행
//   2. 아니면 시험종목에 적힌 자재 이름("레미콘", "철근")을 현장 말 자료로 별표 2 종별에 잇는다
// 찾은 행의 빈도가 하나로 같을 때만 칸을 채우고(출처를 붙인다), 여럿이면 칸은 비워 둔 채 후보를 작성 안내로 알린다.
// 시험 횟수는 1일 타설량 등 입력이 더 있어야 정해지므로 채우지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

import { loadTestStandards } from "../knowledge/test-standards.js";
import type { TestStandardRow } from "../knowledge/test-standards.js";
import { loadFieldPhrases } from "../knowledge/field-phrases.js";
import type { DocumentBody } from "./document-body.js";

// ───── 상수 ─────
const SOURCE = "업무지침 별표 2";
/** 후보로 보여 줄 시험종목의 최대 수 */
const CANDIDATES_MAX = 10;
/** 자재 이름으로 보는 낱말의 최소 길이 */
const TOKEN_MIN = 2;

export interface FrequencyFill {
  /** 시험계획 표에서 몇 번째 줄인가 (1부터) */
  row: number;
  testItem: string;
  frequency: string;
  /** 어느 행에서 옮겼나 — "1. 공통 > 나. 철근콘크리트공사 · 굳지 아니한 콘크리트 · 슬럼프" */
  from: string[];
}

export interface FrequencyCandidates {
  row: number;
  testItem: string;
  candidates: Array<{ category: string; item: string; frequency: string }>;
  note: string;
}

const squash = (s: string): string => s.replace(/\s+/g, "").toLowerCase();
const tidy = (s: string): string => s.replace(/\s+/g, " ").trim();

/** 공종 이름이 구분에 맞는 행만 — 맞는 행이 없으면 공종을 보지 않는다. "아스팔트포장공"·"철근콘크리트공사" 는 끝의 공·공사를 떼고 견준다 */
function bySection(rows: TestStandardRow[], workType: string): TestStandardRow[] {
  const key = squash(workType).replace(/(?:공사|공)$/u, "");
  if (key.length < TOKEN_MIN) return rows;
  const hit = rows.filter((r) => squash(r.section).includes(key));
  return hit.length > 0 ? hit : rows;
}

/** 칸에서 괄호 안 설명을 뺀 이름 — "굳지 아니한 콘크리트 (레미콘포함)" → "굳지아니한콘크리트" */
const bare = (s: string): string => squash(s.replace(/\([^)]*\)/g, ""));

/** 시험계획 한 줄을 별표 2 에서 찾은 결과 — 행과, 시험종목 낱말이 있었는지 */
export interface PlanRowMatch {
  rows: TestStandardRow[];
  /** 시험종목 칸에 걸린 낱말이 있었나 (없으면 자재 이름만으로 찾은 것) */
  byTestItem: boolean;
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
  const { terms, rowTerms } = loadFieldPhrases();
  const { rows } = loadTestStandards();
  const ks = /KS\s*[A-Z]\s*\d{3,5}(?:-\d+)?/i.exec(testItem)?.[0];
  /** 괄호 안 설명을 뺀 낱말 전부 (한 글자 낱말 포함 — "겉모양 및 모양" 의 "및") */
  const words = testItem
    .replace(/\([^)]*\)/g, " ")
    .split(/[\s,·/]+/)
    .filter(Boolean);
  const tokens = words.filter((t) => t.length >= TOKEN_MIN);
  const alts = tokens.map((t) => [...new Set([t, ...(rowTerms[t] ?? []), ...(terms[t] ?? [])].map(squash))]);
  const withKs = (list: TestStandardRow[]): TestStandardRow[] => {
    if (!ks) return list;
    const key = squash(ks);
    const hit = list.filter((r) => squash(`${r.method} ${r.category} ${r.remarks}`).includes(key));
    return hit.length > 0 ? hit : list;
  };
  // 낱말마다 시험종목·종별·구분 가운데 어디에 걸리나
  const scored = rows
    .map((r) => {
      const item = squash(r.item);
      const where = alts.map((keys) =>
        keys.some((k) => item.includes(k)) ? "item" : keys.some((k) => squash(r.category).includes(k)) ? "category" : keys.some((k) => squash(r.section).includes(k)) ? "section" : null,
      );
      // 시험종목이 꼭 같은가 — 자재·공종 낱말을 뺀 나머지 글 전체가 시험종목 이름과 같을 때만("겉모양 및 모양" 은 "모양" 과 다르다).
      // 낱말이 하나뿐이면 그 낱말의 표준 말(현장 말 자료)과 같아도 같다고 본다
      const itemWords = words.filter((w) => {
        const i = tokens.indexOf(w);
        return i < 0 || where[i] === "item";
      });
      const itemOnly = alts.filter((_, i) => where[i] === "item");
      const exact = bare(r.item) === squash(itemWords.join("")) || (itemOnly.length === 1 && (itemOnly[0] ?? []).some((k) => bare(r.item) === k));
      // "콘크리트용 팽창재" 의 "콘크리트용" 은 쓰임새를 꾸미는 말이라 그 자재가 아니다 — 종별 일치로 치지 않는다
      const category = squash(r.category);
      const categoryHits = alts.filter((keys, i) => where[i] === "category" && keys.some((k) => category.includes(k) && !category.includes(`${k}용`))).length;
      return { r, where, exact, categoryHits };
    })
    .filter((x) => x.where.every((w) => w !== null) && x.where.includes("item"));
  if (scored.length > 0) {
    // 1) 공종으로 먼저 좁힌다 2) 시험종목 이름이 꼭 같은 행 3) 공종이 맞았을 때만 — 자재 낱말이 종별에 걸린 행을 공종 이름에만 걸린 행보다 먼저.
    // 공종을 모르면 3) 을 하지 않는다: "아스콘 온도" 의 "아스팔트" 가 방수시트 종별에 걸려 포장 공종의 온도 대신 고르는 일이 생긴다(틀린 빈도를 칸에 쓰게 된다)
    const sectionKey = squash(workType).replace(/(?:공사|공)$/u, "");
    const inSection = sectionKey.length >= TOKEN_MIN ? scored.filter((x) => squash(x.r.section).includes(sectionKey)) : [];
    const sectioned = inSection.length > 0 ? inSection : scored;
    const exact = sectioned.filter((x) => x.exact);
    let pool = exact.length > 0 ? exact : sectioned;
    if (inSection.length > 0) {
      const best = Math.max(...pool.map((x) => x.categoryHits));
      pool = pool.filter((x) => x.categoryHits === best);
    }
    return { rows: withKs(pool.map((x) => x.r)), byTestItem: true };
  }
  // 자재 이름만 있다 — 그 종별의 행 모두 (시험종목마다 빈도가 다를 수 있다).
  // 현장 말 자료에 표준 이름이 있으면 그 이름으로만 찾는다("철근" → "철근콘크리트용봉강" — "철근" 그대로면 "철근콘크리트용 방청제" 까지 걸린다)
  for (const token of tokens) {
    const names = [...(rowTerms[token] ?? []), ...(terms[token] ?? [])];
    const keys = (names.length > 0 ? names : [token]).map(squash);
    const hit = rows.filter((r) => keys.some((k) => squash(r.category).includes(k)));
    if (hit.length > 0) return { rows: withKs(bySection(hit, workType)), byTestItem: false };
  }
  return { rows: [], byTestItem: false };
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
    const { rows: found, byTestItem } = matchPlanRow(row["workType"] ?? "", testItem);
    if (found.length === 0) return;
    const frequencies = [...new Set(found.map((r) => tidy(r.frequency)).filter(Boolean))];
    if (frequencies.length === 1) {
      const frequency = frequencies[0] as string;
      row["testFrequency"] = `${frequency} (${SOURCE})`;
      filled.push({ row: index + 1, testItem, frequency, from: [...new Set(found.map((r) => `${r.section} · ${tidy(r.category)} · ${tidy(r.item)}`))] });
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
    const note = byTestItem
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
