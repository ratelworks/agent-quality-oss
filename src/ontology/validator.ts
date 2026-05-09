// ─────────────────────────────────────────────────────────────────────────────
// validator.ts — 온톨로지 무결성 검사. CLI: `npm run validate:ontology`.
//
// 변경(2026-04-30):
//   1) STANDARD_RELATIONS 화이트리스트를 isStandardRelation 헬퍼로 통합
//   2) RELATION_SPECS 기반 src/dst 타입 위반 warn 추가
//   3) sourceStatus 누락 entity warn 추가 (R0-G3)
//   4) ID prefix 위반은 zod 단계에서 차단되므로 본 파일에서는 제거
// ─────────────────────────────────────────────────────────────────────────────

import { isStandardRelation, type EntityType } from "./schema.js";
import { isAllowedSrc, isAllowedDst, getRelationSpec } from "./relations.js";
import type { OntologyGraph, GraphStats } from "./graph.js";

export type IssueLevel = "error" | "warn";

export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  entityId?: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: Issue[];
  stats: GraphStats;
}

export function validateOntology(graph: OntologyGraph): ValidationReport {
  const issues: Issue[] = [];
  const entities = graph.entities;

  // ───── 1. 비표준 관계명 + dangling ref + src/dst 타입 위반 ─────
  for (const e of entities.values()) {
    for (const [rel, ids] of Object.entries(e.relations ?? {})) {
      if (!isStandardRelation(rel)) {
        issues.push({
          level: "warn",
          code: "NON_STANDARD_RELATION",
          message: `관계명이 표준 집합에 없음: ${rel}`,
          entityId: e.id,
        });
      } else {
        // 표준 관계명에 한해 src 타입 검사
        if (!isAllowedSrc(rel, e.type)) {
          const spec = getRelationSpec(rel);
          issues.push({
            level: "warn",
            code: "SRC_TYPE_MISMATCH",
            message: `${rel} 의 src 허용 타입(${formatTypeList(spec?.src)})에 ${e.type} 미포함`,
            entityId: e.id,
          });
        }
      }
      if (!Array.isArray(ids)) {
        issues.push({
          level: "error",
          code: "RELATION_NOT_ARRAY",
          message: `관계 ${rel} 이 배열이 아님`,
          entityId: e.id,
        });
        continue;
      }
      for (const target of ids) {
        const dst = entities.get(target);
        if (!dst) {
          issues.push({
            level: "error",
            code: "DANGLING_REFERENCE",
            message: `${rel} → ${target} (존재하지 않는 엔티티)`,
            entityId: e.id,
          });
          continue;
        }
        if (isStandardRelation(rel) && !isAllowedDst(rel, dst.type)) {
          const spec = getRelationSpec(rel);
          issues.push({
            level: "warn",
            code: "DST_TYPE_MISMATCH",
            message: `${rel} 의 dst 허용 타입(${formatTypeList(spec?.dst)})에 ${dst.type} (${target}) 미포함`,
            entityId: e.id,
          });
        }
      }
    }
  }

  // ───── 2. 고아 노드 (인스턴스 타입 정의 성격은 제외) ─────
  const orphanExemptTypes: ReadonlySet<EntityType> = new Set<EntityType>([
    "WorkType",
    "Project",
    "Standard",
    "Agency",
    "Equipment",
    "Specification",
  ]);
  const referenced = new Set<string>();
  for (const e of entities.values()) {
    for (const ids of Object.values(e.relations ?? {})) {
      if (Array.isArray(ids)) for (const id of ids) referenced.add(id);
    }
  }
  for (const e of entities.values()) {
    if (orphanExemptTypes.has(e.type)) continue;
    if (!referenced.has(e.id)) {
      issues.push({
        level: "warn",
        code: "ORPHAN_NODE",
        message: `${e.type} ${e.id}는 어디에서도 참조되지 않음`,
        entityId: e.id,
      });
    }
  }

  // ───── 3. 순환 참조 (isBasedOn / requires 계통) ─────
  const cycleRelations = ["isBasedOn", "requires"] as const;
  for (const e of entities.values()) {
    const path: string[] = [];
    if (hasCycle(graph, e.id, cycleRelations, new Set<string>(), path)) {
      issues.push({
        level: "error",
        code: "CYCLE_DETECTED",
        message: `순환 참조: ${path.join(" → ")}`,
        entityId: e.id,
      });
    }
  }

  const errors = issues.filter((i) => i.level === "error");
  return { ok: errors.length === 0, issues, stats: graph.stats() };
}

// ───── R0-G3 헬퍼 — sourceStatus 라벨 커버리지 통계 ─────
//
// 본 통계는 separate 함수로 노출. validator 자체는 warn 으로 노이즈를 만들지 않고,
// 도구·report 가 필요할 때 호출.
export function sourceStatusCoverage(graph: OntologyGraph): {
  total: number;
  labeled: number;
  byStatus: Record<string, number>;
  unlabeledIds: string[];
} {
  const byStatus: Record<string, number> = {};
  const unlabeledIds: string[] = [];
  for (const e of graph.entities.values()) {
    const ss = e.meta?.sourceStatus;
    if (typeof ss === "string") {
      byStatus[ss] = (byStatus[ss] ?? 0) + 1;
    } else {
      unlabeledIds.push(e.id);
    }
  }
  return {
    total: graph.entities.size,
    labeled: graph.entities.size - unlabeledIds.length,
    byStatus,
    unlabeledIds,
  };
}

function hasCycle(
  graph: OntologyGraph,
  id: string,
  relations: readonly string[],
  visiting: Set<string>,
  path: string[],
): boolean {
  if (visiting.has(id)) {
    path.push(id);
    return true;
  }
  visiting.add(id);
  path.push(id);
  const e = graph.entities.get(id);
  if (e) {
    for (const rel of relations) {
      const ids = e.relations?.[rel];
      if (!Array.isArray(ids)) continue;
      for (const nid of ids) {
        if (hasCycle(graph, nid, relations, visiting, path)) return true;
      }
    }
  }
  visiting.delete(id);
  path.pop();
  return false;
}

function formatTypeList(types: readonly EntityType[] | "*" | undefined): string {
  if (!types) return "?";
  if (types === "*") return "any";
  return types.join("|");
}
