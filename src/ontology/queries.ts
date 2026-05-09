// ─────────────────────────────────────────────────────────────────────────────
// queries.ts — 도메인 traversal 표준 helper.
//
// 본 모듈은 **도구가 그래프 내부 구조에 직접 의존하지 않도록** 추상화한다.
// 도구는 graph.relations 의 관계명을 외우거나 BFS 를 수동 구현하지 말고,
// 의도가 분명한 함수(workTypeMaterials 등)를 호출한다.
//
// 추가 이점:
//   - 결과가 type-narrow 한 EntityOf<...> 배열로 반환
//   - 점진적 마이그레이션 시 관계명이 바뀌어도 helper 한 곳만 고치면 됨
// ─────────────────────────────────────────────────────────────────────────────

import type { OntologyGraph } from "./graph.js";
import type {
  BaseEntity,
  EntityOf,
  RelationName,
} from "./schema.js";
import { isStandardRelation, type EntityType } from "./schema.js";

// ───── 1. WorkType 중심 ─────

export function workTypeTasks(graph: OntologyGraph, workTypeId: string): EntityOf<"Task">[] {
  return graph.neighborsOf(workTypeId, "hasTask", "Task");
}

export function workTypeMaterials(
  graph: OntologyGraph,
  workTypeId: string,
): EntityOf<"Material">[] {
  return graph.neighborsOf(workTypeId, "usesMaterial", "Material");
}

export function workTypeStandards(
  graph: OntologyGraph,
  workTypeId: string,
): EntityOf<"Standard">[] {
  return graph.neighborsOf(workTypeId, "requiresStandard", "Standard");
}

export function workTypeInspections(
  graph: OntologyGraph,
  workTypeId: string,
): EntityOf<"InspectionCheckpoint">[] {
  return graph.neighborsOf(workTypeId, "hasInspectionCheckpoint", "InspectionCheckpoint");
}

export function workTypeRisks(
  graph: OntologyGraph,
  workTypeId: string,
): EntityOf<"QualityRisk">[] {
  return graph.neighborsOf(workTypeId, "hasQualityRisk", "QualityRisk");
}

// ───── 2. Material 중심 ─────

export function materialTests(
  graph: OntologyGraph,
  materialId: string,
): EntityOf<"TestItem">[] {
  return graph.neighborsOf(materialId, "requiresTest", "TestItem");
}

export function materialDocuments(
  graph: OntologyGraph,
  materialId: string,
): EntityOf<"EvidenceDocument">[] {
  return graph.neighborsOf(materialId, "requiresDocument", "EvidenceDocument");
}

export function materialAcceptanceCriteria(
  graph: OntologyGraph,
  materialId: string,
): EntityOf<"AcceptanceCriteria">[] {
  return graph.neighborsOf(materialId, "hasAcceptanceCriteria", "AcceptanceCriteria");
}

// ───── 3. TestItem 중심 ─────

export function testTargetMaterials(
  graph: OntologyGraph,
  testId: string,
): EntityOf<"Material">[] {
  return graph.neighborsOf(testId, "targetMaterial", "Material");
}

export function testRelatedWorkTypes(
  graph: OntologyGraph,
  testId: string,
): EntityOf<"WorkType">[] {
  return graph.neighborsOf(testId, "relatedWork", "WorkType");
}

export function testAcceptanceCriteria(
  graph: OntologyGraph,
  testId: string,
): EntityOf<"AcceptanceCriteria">[] {
  return graph.neighborsOf(testId, "hasAcceptanceCriteria", "AcceptanceCriteria");
}

export function testPossibleNonconformance(
  graph: OntologyGraph,
  testId: string,
): EntityOf<"Nonconformance">[] {
  return graph.neighborsOf(testId, "possibleNonconformance", "Nonconformance");
}

export function testCorrectiveActions(
  graph: OntologyGraph,
  testId: string,
): EntityOf<"CorrectiveAction">[] {
  return graph.neighborsOf(testId, "correctiveActions", "CorrectiveAction");
}

export function testEvidenceDocuments(
  graph: OntologyGraph,
  testId: string,
): EntityOf<"EvidenceDocument">[] {
  return graph.neighborsOf(testId, "requiresEvidence", "EvidenceDocument");
}

// ───── 4. Nonconformance 중심 ─────

export function ncrRelatedTest(
  graph: OntologyGraph,
  ncrId: string,
): EntityOf<"TestItem">[] {
  return graph.neighborsOf(ncrId, "relatedTest", "TestItem");
}

export function ncrRelatedMaterial(
  graph: OntologyGraph,
  ncrId: string,
): EntityOf<"Material">[] {
  return graph.neighborsOf(ncrId, "relatedMaterial", "Material");
}

export function ncrImmediateActions(
  graph: OntologyGraph,
  ncrId: string,
): EntityOf<"CorrectiveAction">[] {
  return graph.neighborsOf(ncrId, "immediateActions", "CorrectiveAction");
}

// ───── 5. AcceptanceCriteria 중심 ─────

export function criteriaAppliesTo(
  graph: OntologyGraph,
  criteriaId: string,
): BaseEntity[] {
  return graph.neighborsOf(criteriaId, "appliesTo");
}

export function criteriaDerivedFrom(
  graph: OntologyGraph,
  criteriaId: string,
): EntityOf<"Standard">[] {
  return graph.neighborsOf(criteriaId, "derivedFrom", "Standard");
}

// ───── 6. WorkType 도메인 패키지 (compile_* 도구 공통) ─────
//
// 한 공종에 대해 도메인 전체를 한 번에 모은 결과. 도구가 분리해 가공 가능.
export interface WorkTypeDomainPackage {
  workType: EntityOf<"WorkType">;
  tasks: EntityOf<"Task">[];
  materials: EntityOf<"Material">[];
  standards: EntityOf<"Standard">[];
  inspections: EntityOf<"InspectionCheckpoint">[];
  risks: EntityOf<"QualityRisk">[];
  /** materials 의 시험을 평탄화하여 tests 수집 (중복 제거) */
  tests: EntityOf<"TestItem">[];
  /** materials 의 문서 + inspections 의 evidence 를 평탄화하여 documents 수집 */
  documents: EntityOf<"EvidenceDocument">[];
}

export function workTypeDomainPackage(
  graph: OntologyGraph,
  workTypeId: string,
): WorkTypeDomainPackage | null {
  const workType = graph.get(workTypeId, "WorkType");
  if (!workType) return null;

  const materials = workTypeMaterials(graph, workTypeId);
  const tests = uniqueById(materials.flatMap((m) => materialTests(graph, m.id)));

  const inspections = workTypeInspections(graph, workTypeId);
  const documentsFromMaterials = materials.flatMap((m) => materialDocuments(graph, m.id));
  const documentsFromInspections = inspections.flatMap((i) =>
    graph.neighborsOf(i.id, "requiresEvidence", "EvidenceDocument"),
  );
  const documents = uniqueById([...documentsFromMaterials, ...documentsFromInspections]);

  return {
    workType,
    tasks: workTypeTasks(graph, workTypeId),
    materials,
    standards: workTypeStandards(graph, workTypeId),
    inspections,
    risks: workTypeRisks(graph, workTypeId),
    tests,
    documents,
  };
}

// ───── 7. 결정 경로 traversal — explain_quality_decision_path 지원 ─────
//
// 임의 entity 에서 시작해 표준/기준까지 거슬러 올라가는 경로 추출.
export function tracePathToStandard(
  graph: OntologyGraph,
  startId: string,
  maxDepth = 5,
): { ids: string[]; standardId: string | null } {
  const visited = new Set<string>([startId]);
  const queue: Array<{ id: string; trail: string[] }> = [{ id: startId, trail: [startId] }];
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || cur.trail.length > maxDepth) continue;
    const e = graph.entities.get(cur.id);
    if (!e) continue;
    if (e.type === "Standard" && cur.id !== startId) {
      return { ids: cur.trail, standardId: cur.id };
    }
    for (const [, ids] of Object.entries(e.relations ?? {})) {
      if (!Array.isArray(ids)) continue;
      for (const nid of ids) {
        if (visited.has(nid)) continue;
        visited.add(nid);
        queue.push({ id: nid, trail: [...cur.trail, nid] });
      }
    }
  }
  return { ids: [startId], standardId: null };
}

// ───── 8. 표준 관계 통계 (validator·dump-graph 사용) ─────

export function relationCounts(graph: OntologyGraph): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of graph.entities.values()) {
    for (const [rel, ids] of Object.entries(e.relations ?? {})) {
      if (!Array.isArray(ids)) continue;
      counts[rel] = (counts[rel] ?? 0) + ids.length;
    }
  }
  return counts;
}

export function nonStandardRelationKeys(graph: OntologyGraph): string[] {
  const out = new Set<string>();
  for (const e of graph.entities.values()) {
    for (const rel of Object.keys(e.relations ?? {})) {
      if (!isStandardRelation(rel)) out.add(rel);
    }
  }
  return [...out];
}

// ───── 9. type 별 컬렉션 helper ─────

export function entitiesOfType<T extends EntityType>(
  graph: OntologyGraph,
  type: T,
): EntityOf<T>[] {
  return graph.allOf(type);
}

// ───── 내부 헬퍼 ─────

function uniqueById<T extends BaseEntity>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

// 도구가 RelationName 을 동적으로 사용할 때를 위한 export
export type { RelationName };
