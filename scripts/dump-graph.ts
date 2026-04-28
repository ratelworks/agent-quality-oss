#!/usr/bin/env node
/**
 * R0-G5: 온톨로지 그래프 시각화 dump.
 *
 * 출력:
 *  - build/graph/graph.cytoscape.json     : Cytoscape.js 호환 그래프 데이터
 *  - build/graph/graph.mermaid.md         : Mermaid flowchart (type 필터 옵션)
 *  - build/graph/graph.summary.json       : 노드 활용률·degree 분포·hub·고립 노드
 *  - 콘솔: 요약 메트릭 (라운드별 비교 베이스)
 *
 * 사용:
 *   tsx scripts/dump-graph.ts                   # 전체 dump
 *   tsx scripts/dump-graph.ts --type WorkType   # WorkType 중심 Mermaid
 *   tsx scripts/dump-graph.ts --json-only       # 요약 + Cytoscape만
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOntologySync } from '../src/ontology/loader.js';
import { OntologyGraph } from '../src/ontology/graph.js';
import type { BaseEntity, EntityType } from '../src/ontology/schema.js';

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'build', 'graph');

const args = process.argv.slice(2);
const typeFilter = pickArg('--type') as EntityType | undefined;
const jsonOnly = args.includes('--json-only');

mkdirSync(OUT_DIR, { recursive: true });
const data = loadOntologySync();
const graph = new OntologyGraph(data);

interface DegreeEntry {
  id: string;
  type: EntityType;
  name: string;
  out: number;
  in: number;
  degree: number;
  sourceStatus: string;
}

const degrees = computeDegrees(graph);
const summary = buildSummary(degrees);

writeFileSync(
  path.join(OUT_DIR, 'graph.summary.json'),
  JSON.stringify(summary, null, 2),
);
writeFileSync(
  path.join(OUT_DIR, 'graph.cytoscape.json'),
  JSON.stringify(buildCytoscape(graph), null, 2),
);
if (!jsonOnly) {
  writeFileSync(
    path.join(OUT_DIR, 'graph.mermaid.md'),
    buildMermaid(graph, typeFilter),
  );
}

printConsole(summary, degrees);

// =====================================================================

function computeDegrees(g: OntologyGraph): DegreeEntry[] {
  // outgoing: entity.relations의 id 수 합 (본인 제외, 미존재 제외)
  // incoming: 다른 entity가 이 id를 참조하는 횟수
  const incomingCount = new Map<string, number>();
  for (const e of g.entities.values()) {
    for (const ids of Object.values(e.relations ?? {})) {
      if (!Array.isArray(ids)) continue;
      for (const nid of ids) {
        if (nid === e.id) continue;
        if (!g.entities.has(nid)) continue;
        incomingCount.set(nid, (incomingCount.get(nid) ?? 0) + 1);
      }
    }
  }
  const out: DegreeEntry[] = [];
  for (const e of g.entities.values()) {
    let outDeg = 0;
    for (const ids of Object.values(e.relations ?? {})) {
      if (!Array.isArray(ids)) continue;
      for (const nid of ids) {
        if (nid === e.id) continue;
        if (g.entities.has(nid)) outDeg++;
      }
    }
    const inDeg = incomingCount.get(e.id) ?? 0;
    out.push({
      id: e.id,
      type: e.type,
      name: e.name,
      out: outDeg,
      in: inDeg,
      degree: outDeg + inDeg,
      sourceStatus: readSourceStatus(e.meta),
    });
  }
  return out;
}

function buildSummary(degrees: DegreeEntry[]) {
  const total = degrees.length;
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = { verified: 0, indirect_source: 0, skeleton: 0, unknown: 0 };
  let totalDegree = 0;
  let isolated = 0;
  for (const d of degrees) {
    byType[d.type] = (byType[d.type] ?? 0) + 1;
    if (d.sourceStatus in byStatus) byStatus[d.sourceStatus]!++;
    totalDegree += d.degree;
    if (d.degree === 0) isolated++;
  }
  const meanDegree = total > 0 ? totalDegree / total : 0;
  const hubs = [...degrees]
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 15)
    .map((d) => ({ id: d.id, type: d.type, name: d.name, degree: d.degree, in: d.in, out: d.out }));
  const isolatedNodes = degrees
    .filter((d) => d.degree === 0)
    .map((d) => ({ id: d.id, type: d.type, name: d.name }));

  // R0-G5 핵심 메트릭: 노드 활용률 = (참조된 노드 수 / 전체 노드 수)
  const referencedCount = degrees.filter((d) => d.in > 0).length;
  const utilizationRate = total > 0 ? referencedCount / total : 0;

  return {
    generatedAt: new Date().toISOString(),
    ontologyVersion: graph.version,
    counts: {
      total,
      byType,
      byStatus,
      isolated,
      referenced: referencedCount,
      utilizationRate: Number(utilizationRate.toFixed(3)),
    },
    degree: {
      mean: Number(meanDegree.toFixed(2)),
      total: totalDegree,
    },
    hubs,
    isolatedNodes,
  };
}

function buildCytoscape(g: OntologyGraph) {
  const nodes: unknown[] = [];
  const edges: unknown[] = [];
  for (const e of g.entities.values()) {
    nodes.push({
      data: {
        id: e.id,
        label: e.name,
        type: e.type,
        sourceStatus: readSourceStatus(e.meta),
      },
    });
    for (const [rel, ids] of Object.entries(e.relations ?? {})) {
      if (!Array.isArray(ids)) continue;
      for (const nid of ids) {
        if (!g.entities.has(nid)) continue;
        edges.push({
          data: {
            id: `${e.id}--${rel}--${nid}`,
            source: e.id,
            target: nid,
            label: rel,
          },
        });
      }
    }
  }
  return { elements: { nodes, edges } };
}

function buildMermaid(g: OntologyGraph, filter?: EntityType): string {
  const lines = ['# Ontology Graph (Mermaid)', '', '```mermaid', 'flowchart LR'];
  const seen = new Set<string>();
  const targets: BaseEntity[] = filter ? g.all(filter) : [...g.entities.values()];
  for (const e of targets) {
    const fromKey = sanitize(e.id);
    if (!seen.has(e.id)) {
      lines.push(`  ${fromKey}["${e.name}<br/>(${e.type})"]`);
      seen.add(e.id);
    }
    for (const [rel, ids] of Object.entries(e.relations ?? {})) {
      if (!Array.isArray(ids)) continue;
      for (const nid of ids) {
        const target = g.get(nid);
        if (!target) continue;
        if (!seen.has(target.id)) {
          lines.push(`  ${sanitize(target.id)}["${target.name}<br/>(${target.type})"]`);
          seen.add(target.id);
        }
        lines.push(`  ${fromKey} -->|${rel}| ${sanitize(target.id)}`);
      }
    }
  }
  lines.push('```');
  return lines.join('\n');
}

function printConsole(s: ReturnType<typeof buildSummary>, degrees: DegreeEntry[]): void {
  console.log(`\n=== R0-G5 Graph Dump (ontology v${s.ontologyVersion}) ===\n`);
  console.log(`총 노드: ${s.counts.total}`);
  console.log(`타입별: ${Object.entries(s.counts.byType).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(
    `검증 상태: verified=${s.counts.byStatus.verified} / indirect=${s.counts.byStatus.indirect_source} / skeleton=${s.counts.byStatus.skeleton} / unknown=${s.counts.byStatus.unknown}`,
  );
  console.log(`평균 차수(degree): ${s.degree.mean}`);
  console.log(`고립 노드: ${s.counts.isolated}`);
  console.log(`노드 활용률: ${(s.counts.utilizationRate * 100).toFixed(1)}% (${s.counts.referenced}/${s.counts.total})`);

  console.log(`\nTop 10 hubs (degree 기준):`);
  for (const h of s.hubs.slice(0, 10)) {
    console.log(`  ${String(h.degree).padStart(3)} (in ${h.in}/out ${h.out}) ${h.id} (${h.type})`);
  }

  if (s.isolatedNodes.length > 0) {
    console.log(`\n고립 노드 (참조 없음):`);
    for (const n of s.isolatedNodes.slice(0, 20)) {
      console.log(`  ${n.id} (${n.type}) ${n.name}`);
    }
    if (s.isolatedNodes.length > 20) console.log(`  ... +${s.isolatedNodes.length - 20}건 더`);
  }

  console.log(`\n출력:`);
  console.log(`  ${path.relative(PROJECT_ROOT, path.join(OUT_DIR, 'graph.summary.json'))}`);
  console.log(`  ${path.relative(PROJECT_ROOT, path.join(OUT_DIR, 'graph.cytoscape.json'))}`);
  if (!jsonOnly)
    console.log(`  ${path.relative(PROJECT_ROOT, path.join(OUT_DIR, 'graph.mermaid.md'))}`);
}

function pickArg(flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0 || i === args.length - 1) return undefined;
  return args[i + 1];
}

function readSourceStatus(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return 'unknown';
  const v = (meta as Record<string, unknown>)['sourceStatus'];
  if (v === 'verified' || v === 'indirect_source' || v === 'skeleton') return v;
  return 'unknown';
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}
