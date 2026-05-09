// ─────────────────────────────────────────────────────────────────────────────
// graph.ts — 온톨로지 그래프 (인접 리스트 + BFS).
//
// 변경(2026-04-30):
//   1) get<T>(id, expectedType?) — type-narrow 결과
//   2) allOf<T>(type) — 타입별 컬렉션
//   3) neighborsOf(id, relation) — 단일 관계명 전용 type-safe 조회
//   4) reachablePath(from, to) — 경로 + relation chain 반환
//   5) RelationName 으로 키 좁힘 (string typo 차단)
//   6) byCategory 인덱스를 lazy 로 (Standard 만 사용하므로 부담 줄임)
//
// 본 그래프는 in-memory · readonly 다. 로더가 구성한 entities Map 은 mutation 금지.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  BaseEntity,
  EntityType,
  EntityOf,
  RelationName,
} from "./schema.js";
import { isStandardRelation } from "./schema.js";
import { inverseOf } from "./relations.js";
import type { OntologyData } from "./loader.js";

export interface GraphStats {
  total: number;
  byType: Record<EntityType, number> & { total: number };
  relations: number;
  version: string;
}

export interface IncomingRef {
  from: BaseEntity;
  relation: string;
}

export interface ReachablePathStep {
  fromId: string;
  toId: string;
  relation: string;
}

export interface ReachablePath {
  ids: string[];
  steps: ReachablePathStep[];
}

export class OntologyGraph {
  readonly entities: Map<string, BaseEntity>;
  readonly aliasIndex: Map<string, string[]>;
  readonly version: string;
  /** byCategory 인덱스 (lazy 초기화) */
  private categoryIndex: Map<string, BaseEntity[]> | null = null;
  /** byType 인덱스 (lazy 초기화) */
  private typeIndex: Map<EntityType, BaseEntity[]> | null = null;

  constructor(data: OntologyData) {
    this.entities = data.entities;
    this.aliasIndex = data.aliasIndex;
    this.version = data.version;
  }

  // ───── 1. 단일 조회 (generics 로 type-narrow) ─────

  /**
   * id 로 entity 조회. expectedType 지정 시 해당 타입으로 좁혀 반환.
   * 타입 불일치하면 undefined.
   */
  get<T extends EntityType>(id: string, expectedType: T): EntityOf<T> | undefined;
  get(id: string): BaseEntity | undefined;
  get(id: string, expectedType?: EntityType): BaseEntity | undefined {
    const e = this.entities.get(id);
    if (!e) return undefined;
    if (expectedType && e.type !== expectedType) return undefined;
    return e;
  }

  /**
   * id 로 entity 가 반드시 존재해야 하는 경우. 없으면 throw.
   */
  require(id: string): BaseEntity {
    const e = this.entities.get(id);
    if (!e) throw new Error(`OntologyGraph.require: entity not found: ${id}`);
    return e;
  }

  // ───── 2. 컬렉션 ─────

  all(typeFilter?: EntityType): BaseEntity[] {
    if (!typeFilter) return [...this.entities.values()];
    return this.allOf(typeFilter);
  }

  /** 타입별 컬렉션 (캐시) */
  allOf<T extends EntityType>(type: T): EntityOf<T>[] {
    if (!this.typeIndex) {
      const idx = new Map<EntityType, BaseEntity[]>();
      for (const e of this.entities.values()) {
        const arr = idx.get(e.type);
        if (arr) arr.push(e);
        else idx.set(e.type, [e]);
      }
      this.typeIndex = idx;
    }
    return (this.typeIndex.get(type) ?? []) as EntityOf<T>[];
  }

  /** Standard.meta.category 인덱스 조회 (form / guideline / law 등) */
  byStandardCategory(category: string): BaseEntity[] {
    if (!this.categoryIndex) {
      const idx = new Map<string, BaseEntity[]>();
      for (const e of this.entities.values()) {
        const cat = e.meta?.category;
        if (typeof cat === "string") {
          const arr = idx.get(cat);
          if (arr) arr.push(e);
          else idx.set(cat, [e]);
        }
      }
      this.categoryIndex = idx;
    }
    return this.categoryIndex.get(category) ?? [];
  }

  // ───── 3. 이웃 (1-hop) ─────

  /**
   * 1-hop 이웃 (관계명별 entity 배열).
   * 비표준 관계명도 그대로 노출 (validator 가 별도로 warn).
   */
  neighbors(id: string): Record<string, BaseEntity[]> {
    const entity = this.entities.get(id);
    if (!entity) return {};
    const out: Record<string, BaseEntity[]> = {};
    for (const [rel, ids] of Object.entries(entity.relations ?? {})) {
      if (!Array.isArray(ids)) continue;
      const arr: BaseEntity[] = [];
      for (const nid of ids) {
        const e = this.entities.get(nid);
        if (e) arr.push(e);
      }
      out[rel] = arr;
    }
    return out;
  }

  /**
   * 단일 관계명 전용 — RelationName 만 허용해 typo 차단.
   * dst type 좁히기 옵션.
   */
  neighborsOf<T extends EntityType>(
    id: string,
    relation: RelationName,
    dstType: T,
  ): EntityOf<T>[];
  neighborsOf(id: string, relation: RelationName): BaseEntity[];
  neighborsOf(
    id: string,
    relation: RelationName,
    dstType?: EntityType,
  ): BaseEntity[] {
    const entity = this.entities.get(id);
    if (!entity) return [];
    const ids = entity.relations?.[relation];
    if (!Array.isArray(ids)) return [];
    const out: BaseEntity[] = [];
    for (const nid of ids) {
      const e = this.entities.get(nid);
      if (!e) continue;
      if (dstType && e.type !== dstType) continue;
      out.push(e);
    }
    return out;
  }

  // ───── 4. 역방향 ─────

  /**
   * 어떤 entity 가 이 id 를 참조하는가.
   * 전체 그래프 스캔이라 자주 호출 시 비싸다.
   */
  incoming(id: string): IncomingRef[] {
    const out: IncomingRef[] = [];
    for (const e of this.entities.values()) {
      for (const [rel, ids] of Object.entries(e.relations ?? {})) {
        if (Array.isArray(ids) && ids.includes(id)) {
          out.push({ from: e, relation: rel });
        }
      }
    }
    return out;
  }

  /** 단일 관계명 역방향 (relation 또는 inverse 둘 다 검사). */
  incomingByRelation(id: string, relation: RelationName): BaseEntity[] {
    const inverse = inverseOf(relation);
    const out: BaseEntity[] = [];
    for (const e of this.entities.values()) {
      const direct = e.relations?.[relation];
      if (Array.isArray(direct) && direct.includes(id)) {
        out.push(e);
        continue;
      }
      if (inverse) {
        const inv = e.relations?.[inverse];
        if (Array.isArray(inv) && inv.includes(id)) out.push(e);
      }
    }
    return out;
  }

  // ───── 5. 도달 가능 (BFS) ─────

  /**
   * n-hop 이웃 id 집합 (자신 제외). RelationName 으로 좁힐 수 있음.
   */
  reachable(
    startId: string,
    maxDepth = 2,
    relationFilter?: readonly RelationName[],
  ): string[] {
    const visited = new Set<string>();
    const queue: Array<[string, number]> = [[startId, 0]];
    while (queue.length) {
      const next = queue.shift();
      if (!next) break;
      const [cur, depth] = next;
      if (visited.has(cur)) continue;
      visited.add(cur);
      if (depth >= maxDepth) continue;
      const entity = this.entities.get(cur);
      if (!entity) continue;
      for (const [rel, ids] of Object.entries(entity.relations ?? {})) {
        if (relationFilter && !this.matchesFilter(rel, relationFilter)) continue;
        if (!Array.isArray(ids)) continue;
        for (const nid of ids) {
          if (!visited.has(nid)) queue.push([nid, depth + 1]);
        }
      }
    }
    visited.delete(startId);
    return [...visited];
  }

  private matchesFilter(rel: string, filter: readonly RelationName[]): boolean {
    if (!isStandardRelation(rel)) return false;
    return filter.includes(rel);
  }

  /**
   * from → to 까지의 경로(BFS). 없으면 null.
   * 경로는 관계 chain 도 함께 반환해 explain_quality_decision_path 같은
   * 도구가 그대로 사용 가능.
   */
  reachablePath(
    fromId: string,
    toId: string,
    maxDepth = 6,
    relationFilter?: readonly RelationName[],
  ): ReachablePath | null {
    if (fromId === toId) return { ids: [fromId], steps: [] };
    if (!this.entities.has(fromId) || !this.entities.has(toId)) return null;

    interface Trace {
      id: string;
      via: ReachablePathStep[];
    }
    const visited = new Set<string>([fromId]);
    const queue: Trace[] = [{ id: fromId, via: [] }];

    while (queue.length) {
      const cur = queue.shift();
      if (!cur) break;
      if (cur.via.length >= maxDepth) continue;
      const entity = this.entities.get(cur.id);
      if (!entity) continue;
      for (const [rel, ids] of Object.entries(entity.relations ?? {})) {
        if (relationFilter && !this.matchesFilter(rel, relationFilter)) continue;
        if (!Array.isArray(ids)) continue;
        for (const nid of ids) {
          if (visited.has(nid)) continue;
          const nextVia = [...cur.via, { fromId: cur.id, toId: nid, relation: rel }];
          if (nid === toId) {
            return { ids: [fromId, ...nextVia.map((s) => s.toId)], steps: nextVia };
          }
          visited.add(nid);
          queue.push({ id: nid, via: nextVia });
        }
      }
    }
    return null;
  }

  // ───── 6. 통계 ─────

  stats(): GraphStats {
    const byType: Record<string, number> = {};
    let relationCount = 0;
    for (const e of this.entities.values()) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      for (const ids of Object.values(e.relations ?? {})) {
        if (Array.isArray(ids)) relationCount += ids.length;
      }
    }
    return {
      total: this.entities.size,
      byType: { ...byType, total: this.entities.size } as GraphStats["byType"],
      relations: relationCount,
      version: this.version,
    };
  }
}
