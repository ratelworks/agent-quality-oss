// ─────────────────────────────────────────────────────────────────────────────
// test-standard-links.ts — 온톨로지의 시험 노드와 업무지침 별표 2(품질시험기준) 행의 연결.
//
// 시험 노드는 _meta.testStandardRows 로 별표 2 의 행을 가리킨다 — {category, item, section?, default?}.
// 종별·시험종목·구분은 글자 포함으로 찾는다(띄어쓰기 무시). default 는 자재를 적지 않았을 때 쓰는 행이다.
// 별표 2 에 없는 시험은 testStandardRows 를 비우고 testStandardNote 에 까닭을 적는다.
//
// 이 연결로 시험 노드를 내는 도구가 노드의 요약 글(frequency) 대신 별표 2 원문의 빈도를 함께 낸다.
// 검사: scripts/test/test-plan-frequency.ts (모든 연결이 원문에 있고, 노드의 기본 행은 빈도가 한 가지).
// ─────────────────────────────────────────────────────────────────────────────

import type { BaseEntity } from "../ontology/schema.js";
import { loadTestStandards, type TestStandardRow } from "./test-standards.js";

// ───── 상수 ─────
/** 도구 응답에 싣는 별표 2 행의 최대 수 (시험 하나에) */
const ROWS_PER_TEST = 8;
const SOURCE = "업무지침 별표 2";

export interface StandardLink {
  category: string;
  item: string;
  section?: string;
  default?: boolean;
}

/** 도구 응답에 싣는 별표 2 행 */
export interface StandardRowView {
  id: string;
  category: string;
  item: string;
  frequency: string;
  /** 자재를 적지 않았을 때 이 시험의 일반적인 대상인 행 */
  default?: true;
  source: string;
}

const squash = (s: string): string => s.replace(/\s+/g, "").toLowerCase();
const tidy = (s: string): string => s.replace(/\s+/g, " ").trim();

/** 시험 노드의 별표 2 연결 */
export function linksOf(entity: BaseEntity): StandardLink[] {
  const value = (entity.meta as Record<string, unknown>)["testStandardRows"];
  return Array.isArray(value) ? (value as StandardLink[]) : [];
}

/** 연결 하나가 가리키는 별표 2 행 */
export function linkedRows(link: StandardLink): TestStandardRow[] {
  return loadTestStandards().rows.filter(
    (r) => squash(r.category).includes(squash(link.category)) && squash(r.item).includes(squash(link.item)) && (!link.section || squash(r.section).includes(squash(link.section))),
  );
}

/** 시험 노드가 잇는 별표 2 행 — 도구 응답용 (기본 행 먼저) */
export function standardRowsOf(entity: BaseEntity): StandardRowView[] {
  const seen = new Map<string, StandardRowView>();
  for (const link of linksOf(entity)) {
    for (const r of linkedRows(link)) {
      const prev = seen.get(r.id);
      if (prev) {
        if (link.default) prev.default = true;
        continue;
      }
      seen.set(r.id, { id: r.id, category: tidy(r.category), item: tidy(r.item), frequency: tidy(r.frequency), ...(link.default ? { default: true as const } : {}), source: SOURCE });
    }
  }
  return [...seen.values()].sort((a, b) => Number(Boolean(b.default)) - Number(Boolean(a.default))).slice(0, ROWS_PER_TEST);
}
