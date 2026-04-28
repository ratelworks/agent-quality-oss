/**
 * 온톨로지 무결성 검사. CLI: `npm run validate:ontology`.
 */

import { STANDARD_RELATIONS, type EntityType } from './schema.js';
import type { OntologyGraph, GraphStats } from './graph.js';

export type IssueLevel = 'error' | 'warn';

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

  // 1. dangling references + 관계명 표준 확인
  for (const e of entities.values()) {
    for (const [rel, ids] of Object.entries(e.relations ?? {})) {
      if (!STANDARD_RELATIONS.includes(rel)) {
        issues.push({
          level: 'warn',
          code: 'NON_STANDARD_RELATION',
          message: `관계명이 표준 집합에 없음: ${rel}`,
          entityId: e.id,
        });
      }
      if (!Array.isArray(ids)) {
        issues.push({
          level: 'error',
          code: 'RELATION_NOT_ARRAY',
          message: `관계 ${rel}이 배열이 아님`,
          entityId: e.id,
        });
        continue;
      }
      for (const target of ids) {
        if (!entities.has(target)) {
          issues.push({
            level: 'error',
            code: 'DANGLING_REFERENCE',
            message: `${rel} → ${target} (존재하지 않는 엔티티)`,
            entityId: e.id,
          });
        }
      }
    }
  }

  // 2. 고아 검출 — 인스턴스 타입 정의 성격의 타입은 제외.
  const orphanExemptTypes: ReadonlySet<EntityType> = new Set<EntityType>([
    'WorkType',
    'Project',
    'Standard',
    'Agency',
    'Equipment',
    'Specification',
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
        level: 'warn',
        code: 'ORPHAN_NODE',
        message: `${e.type} ${e.id}는 어디에서도 참조되지 않음`,
        entityId: e.id,
      });
    }
  }

  // 3. 순환 참조 (isBasedOn / requires 계통)
  const cycleRelations: ReadonlyArray<string> = ['isBasedOn', 'requires'];
  for (const e of entities.values()) {
    const path: string[] = [];
    if (hasCycle(graph, e.id, cycleRelations, new Set<string>(), path)) {
      issues.push({
        level: 'error',
        code: 'CYCLE_DETECTED',
        message: `순환 참조: ${path.join(' → ')}`,
        entityId: e.id,
      });
    }
  }

  const errors = issues.filter((i) => i.level === 'error');
  return { ok: errors.length === 0, issues, stats: graph.stats() };
}

function hasCycle(
  graph: OntologyGraph,
  id: string,
  relations: ReadonlyArray<string>,
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
