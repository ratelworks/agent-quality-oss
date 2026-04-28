/**
 * alias → canonical id 해석기.
 * 1차: exact   2차: substring   3차: suffix 제거 후 재시도.
 * LLM fallback은 호출자에서.
 *
 * R0-G4 (2026-04-28): MIN_SCORE 게이트 도입 — 환각성 substring 매칭 차단.
 * "fcn fcr fck"가 "광역자치단체"와 score 0.413 매칭되던 환각 등을 차단한다.
 */

import type { OntologyGraph } from './graph.js';
import type { EntityType } from './schema.js';

/** R0-G4: substring 매칭 최소 점수. 미달 시 hit에서 제외. */
export const MIN_SUBSTRING_SCORE = 0.5;
/** R0-G4: 매칭 키 최소 길이. 1자 매칭은 환각 위험. */
export const MIN_KEY_LENGTH = 2;
/** R0-G4: 쿼리 최소 길이. 1자 쿼리는 거의 모든 노드와 매칭됨. */
export const MIN_QUERY_LENGTH = 2;

export type MatchSource = 'exact' | 'alias' | 'substring' | 'normalized';

export interface ResolveHit {
  id: string;
  type: EntityType;
  name: string;
  score: number;
  matchedBy: MatchSource;
  /** R0-G3 연계: entity meta.sourceStatus 통과 (verified | indirect_source | skeleton). */
  sourceStatus?: 'verified' | 'indirect_source' | 'skeleton' | 'unknown';
}

const SUFFIX_STRIPS = ['공사', '작업', '시공', '타설', '검사', '시험'];

function readSourceStatus(meta: unknown): ResolveHit['sourceStatus'] {
  if (!meta || typeof meta !== 'object') return 'unknown';
  const v = (meta as Record<string, unknown>)['sourceStatus'];
  if (v === 'verified' || v === 'indirect_source' || v === 'skeleton') return v;
  return 'unknown';
}

export interface SearchOptions {
  /** 이 점수 미만은 결과에서 제외. 기본 MIN_SUBSTRING_SCORE. */
  minScore?: number;
  /** false면 indirect_source/skeleton 노드 제외. 기본 true. */
  includeUnverified?: boolean;
}

export function searchEntities(
  graph: OntologyGraph,
  query: string,
  typeFilter?: EntityType,
  limit = 10,
  options: SearchOptions = {},
): ResolveHit[] {
  if (typeof query !== 'string' || !query.trim()) return [];
  const q = normalize(query);
  if (q.length < MIN_QUERY_LENGTH) return [];
  const minScore = options.minScore ?? MIN_SUBSTRING_SCORE;
  const includeUnverified = options.includeUnverified ?? true;
  const hits: ResolveHit[] = [];
  const seen = new Set<string>();

  const pushHit = (
    id: string,
    e: { type: EntityType; name: string; meta?: unknown },
    score: number,
    matchedBy: MatchSource,
  ): void => {
    const sourceStatus = readSourceStatus(e.meta);
    if (!includeUnverified && (sourceStatus === 'skeleton' || sourceStatus === 'indirect_source'))
      return;
    hits.push({ id, type: e.type, name: e.name, score, matchedBy, sourceStatus });
  };

  // 1차: exact (score 1.0 — 항상 통과)
  const exact = graph.aliasIndex.get(q);
  if (exact) {
    for (const id of exact) {
      const e = graph.entities.get(id);
      if (!e || (typeFilter && e.type !== typeFilter)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      pushHit(id, e, 1.0, q === normalize(e.name) ? 'exact' : 'alias');
    }
  }

  // 2차: substring (R0-G4 — minScore + minKeyLength 게이트)
  for (const [key, ids] of graph.aliasIndex.entries()) {
    if (hits.length >= limit * 3) break;
    if (key === q) continue;
    if (key.length < MIN_KEY_LENGTH) continue;
    if (!(key.includes(q) || q.includes(key))) continue;
    const ratio = Math.min(key.length, q.length) / Math.max(key.length, q.length);
    const score = 0.4 + 0.4 * ratio;
    if (score < minScore) continue;
    for (const id of ids) {
      const e = graph.entities.get(id);
      if (!e || (typeFilter && e.type !== typeFilter)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      pushHit(id, e, score, 'substring');
    }
  }

  // 3차: 접미사 제거 (score 0.6 — 기본 minScore 0.5 통과)
  if (hits.length === 0) {
    const stripped = stripSuffix(q);
    if (stripped && stripped !== q && stripped.length >= MIN_KEY_LENGTH) {
      const ids = graph.aliasIndex.get(stripped);
      if (ids) {
        for (const id of ids) {
          const e = graph.entities.get(id);
          if (!e || (typeFilter && e.type !== typeFilter)) continue;
          if (seen.has(id)) continue;
          seen.add(id);
          if (0.6 < minScore) continue;
          pushHit(id, e, 0.6, 'normalized');
        }
      }
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/**
 * 공종(WorkType) 전용 단일 해석.
 */
export function resolveWorkType(graph: OntologyGraph, query: string): ResolveHit | null {
  const hits = searchEntities(graph, query, 'WorkType', 5);
  return hits[0] ?? null;
}

function normalize(s: string): string {
  return String(s).trim().toLowerCase().replace(/\s+/g, ' ');
}

function stripSuffix(s: string): string {
  let cur = s;
  for (const suf of SUFFIX_STRIPS) {
    if (cur.endsWith(suf)) cur = cur.slice(0, -suf.length).trim();
  }
  return cur;
}
