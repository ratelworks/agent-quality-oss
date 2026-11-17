// ─────────────────────────────────────────────────────────────────────────────
// test-plan-fill.ts — 품질시험계획서의 시험 빈도 칸을 업무지침 별표 2 원문으로 채운다.
//
// 시험 빈도는 매번 같은 값이 나와야 하는 원문 값이라 AI 비서가 옮겨 적게 두지 않는다.
//   1. 시험종목이 별표 2 의 시험종목과 맞으면 그 행
//   2. 아니면 시험종목에 적힌 자재 이름("레미콘", "철근")을 현장 말 자료로 별표 2 종별에 잇는다
// 찾은 행의 빈도가 하나로 같을 때만 칸을 채우고(출처를 붙인다), 여럿이면 칸은 비워 둔 채 후보를 작성 안내로 알린다.
// 시험 횟수는 1일 타설량 등 입력이 더 있어야 정해지므로 채우지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

import { loadTestStandards, searchTestStandards } from "../knowledge/test-standards.js";
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

/** 공종 이름이 구분에 맞는 행만 — 맞는 행이 없으면 공종을 보지 않는다 */
function bySection(rows: TestStandardRow[], workType: string): TestStandardRow[] {
  const key = squash(workType);
  if (!key) return rows;
  const hit = rows.filter((r) => squash(r.section).includes(key));
  return hit.length > 0 ? hit : rows;
}

/** 시험계획 한 줄에 맞는 별표 2 행 */
export function planRowStandards(workType: string, testItem: string): TestStandardRow[] {
  if (!testItem.trim()) return [];
  // 1. 시험종목 칸과 맞는 행
  const byItem = searchTestStandards({ section: workType || undefined, item: testItem, limit: 200 });
  if (byItem.total > 0) return byItem.rows;
  if (workType) {
    const anySection = searchTestStandards({ item: testItem, limit: 200 });
    if (anySection.total > 0) return anySection.rows;
  }
  // 2. 자재 이름 → 별표 2 종별
  const { terms, rowTerms } = loadFieldPhrases();
  const { rows } = loadTestStandards();
  for (const token of testItem.split(/[\s,·/]+/).filter((t) => t.length >= TOKEN_MIN)) {
    const names = [...(rowTerms[token] ?? []), ...(terms[token] ?? [])];
    const keys = (names.length > 0 ? names : [token]).map(squash);
    const hit = rows.filter((r) => keys.some((k) => squash(r.category).includes(k)));
    if (hit.length > 0) return bySection(hit, workType);
  }
  return [];
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
    const found = planRowStandards(row["workType"] ?? "", testItem);
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
      const key = `${tidy(r.item)}|${tidy(r.frequency)}`;
      if (seen.has(key) || list.length >= CANDIDATES_MAX) continue;
      seen.add(key);
      list.push({ category: tidy(r.category), item: tidy(r.item), frequency: tidy(r.frequency) });
    }
    const note = `시험종목마다 빈도가 달라 칸을 비워 두었습니다 — 시험종목을 한 줄에 하나씩 나눠 적으면 ${SOURCE} 의 빈도를 채웁니다.`;
    candidates.push({ row: index + 1, testItem, candidates: list, note });
    hints.push(`${index + 1}번 줄 '${testItem}' 시험 빈도 — ${note} 후보(${SOURCE}): ${list.map((c) => `${c.item}: ${c.frequency}`).join(" / ")}`);
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
