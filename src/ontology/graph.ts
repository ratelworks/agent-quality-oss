/**
 * 온톨로지 그래프. 인접 리스트 + BFS.
 */

import type { BaseEntity, EntityType } from './schema.js';
import type { OntologyData } from './loader.js';

export interface GraphStats {
  total: number;
  byType: Record<string, number>;
  relations: number;
  version: string;
}

export interface IncomingRef {
  from: BaseEntity;
  relation: string;
}

export class OntologyGraph {
  readonly entities: Map<string, BaseEntity>;
  readonly aliasIndex: Map<string, string[]>;
  readonly version: string;
  private readonly byCategory: Map<string, BaseEntity[]>;

  constructor(data: OntologyData) {
    this.entities = data.entities;
    this.aliasIndex = data.aliasIndex;
    this.version = data.version;
    this.byCategory = new Map();
    for (const e of this.entities.values()) {
      const cat = e.meta?.['category'];
      if (typeof cat === 'string') {
        const arr = this.byCategory.get(cat);
        if (arr) arr.push(e);
        else this.byCategory.set(cat, [e]);
      }
    }
  }

  get(id: string): BaseEntity | undefined {
    return this.entities.get(id);
  }

  all(typeFilter?: EntityType): BaseEntity[] {
    const out: BaseEntity[] = [];
    for (const e of this.entities.values()) {
      if (!typeFilter || e.type === typeFilter) out.push(e);
    }
    return out;
  }

  /** Standard.meta.category 인덱스 조회 (form / guideline 등) */
  byStandardCategory(category: string): BaseEntity[] {
    return this.byCategory.get(category) ?? [];
  }

  /**
   * 1-hop 이웃 (관계명별 엔티티 배열).
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
   * n-hop 이웃 id 집합 (자신 제외).
   */
  reachable(startId: string, maxDepth = 2, relationFilter?: string[]): string[] {
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
        if (relationFilter && !relationFilter.includes(rel)) continue;
        if (!Array.isArray(ids)) continue;
        for (const nid of ids) {
          if (!visited.has(nid)) queue.push([nid, depth + 1]);
        }
      }
    }
    visited.delete(startId);
    return [...visited];
  }

  /**
   * 역방향 — 어떤 엔티티가 이 id를 참조하는가.
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

  stats(): GraphStats {
    const byType: Record<string, number> = {};
    let relationCount = 0;
    for (const e of this.entities.values()) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      for (const ids of Object.values(e.relations ?? {})) {
        if (Array.isArray(ids)) relationCount += ids.length;
      }
    }
    return { total: this.entities.size, byType, relations: relationCount, version: this.version };
  }
}
