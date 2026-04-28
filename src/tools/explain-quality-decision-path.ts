/**
 * Tool: explain_quality_decision_path
 *
 * "이 결정에 어떤 도메인 지식이 적용되는가?" — 엔티티(NCR·Risk·TestItem 등) id를 받아
 * "이 결정이 발동되는 이유" why-chain을 추적해서 반환.
 *
 * 베테랑 사고: NCR이 왜 발동? → 시험이 어떤 기준 위반? → 그 기준 어디 근거?
 * 길잡이 + 도메인 전문성 공급의 결합형.
 */

import { buildResponse } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';
import type { BaseEntity } from '../ontology/schema.js';

export const spec: ToolSpec = {
  name: 'explain_quality_decision_path',
  description:
    '엔티티 id (NCR / Risk / TestItem / AcceptanceCriteria / Standard 등)을 받아 "이 결정이 발동되는 도메인 추론 경로"를 반환한다. 베테랑 시각의 why-chain. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      entityId: {
        type: 'string',
        description:
          '엔티티 id. 예: ncr.slump_too_high / risk.slump_out_of_range / test.slump / criteria.slump_general_150',
      },
    },
    required: ['entityId'],
  },
};

export interface ExplainArgs {
  entityId: string;
}

interface PathNode {
  step: number;
  id: string;
  name: string;
  type: string;
  role: string;
  meta?: Record<string, unknown>;
}

export function run(args: ExplainArgs, graph: OntologyGraph) {
  const { entityId } = args ?? ({ entityId: '' } as ExplainArgs);
  if (!entityId) throw new Error('entityId는 필수입니다.');

  const target = graph.get(entityId);
  if (!target) {
    return buildResponse(
      'explain_quality_decision_path',
      graph.version,
      { entityId, path: null },
      [{ type: 'ontology_meta', id: 'not_found', priority: 3, note: '엔티티 없음' }],
      { required: true, reason: `${entityId} 미존재` },
    );
  }

  const path: PathNode[] = [];
  const allBasis = new Set<string>([target.id]);
  let step = 1;

  // 핵심 분기: 어떤 타입에서 시작했는지에 따라 다른 길 추적
  switch (target.type) {
    case 'Nonconformance':
      explainFromNcr(graph, target, path, allBasis, step);
      break;
    case 'QualityRisk':
      explainFromRisk(graph, target, path, allBasis, step);
      break;
    case 'TestItem':
      explainFromTest(graph, target, path, allBasis, step);
      break;
    case 'AcceptanceCriteria':
      explainFromCriterion(graph, target, path, allBasis, step);
      break;
    default:
      path.push({
        step: 1,
        id: target.id,
        name: target.name,
        type: target.type,
        role: '시작점',
        meta: target.meta,
      });
      explainGeneric(graph, target, path, allBasis, 2);
  }

  // 같은 노드가 두 경로에서 등장하면 role을 합쳐 한 step으로 표현 (중복 제거).
  const dedup: PathNode[] = [];
  const idxById = new Map<string, number>();
  for (const node of path) {
    const idx = idxById.get(node.id);
    if (idx === undefined) {
      idxById.set(node.id, dedup.length);
      dedup.push(node);
    } else {
      const existing = dedup[idx]!;
      if (!existing.role.includes(node.role)) {
        existing.role = `${existing.role} · ${node.role}`;
      }
    }
  }
  // step 번호 재정렬
  for (let i = 0; i < dedup.length; i++) dedup[i]!.step = i + 1;
  path.length = 0;
  path.push(...dedup);

  // 베테랑 reasoning summary
  const expertSummary = buildSummary(target, path);

  const result = {
    entityId,
    targetEntity: { id: target.id, name: target.name, type: target.type },
    path,
    expertSummary,
  };

  return buildResponse(
    'explain_quality_decision_path',
    graph.version,
    result,
    [...allBasis].map((id) => ({ type: 'ontology' as const, id, priority: 1 })),
  );
}

function explainFromNcr(
  graph: OntologyGraph,
  ncr: BaseEntity,
  path: PathNode[],
  allBasis: Set<string>,
  startStep: number,
): void {
  let step = startStep;
  path.push({
    step: step++,
    id: ncr.id,
    name: ncr.name,
    type: ncr.type,
    role: '부적합 (NCR) — 결정 종착점',
    meta: ncr.meta,
  });

  // NCR → relatedTest
  for (const tid of ncr.relations?.['relatedTest'] ?? []) {
    const t = graph.get(tid);
    if (!t) continue;
    allBasis.add(tid);
    path.push({
      step: step++,
      id: t.id,
      name: t.name,
      type: t.type,
      role: '발동 시험 — 이 시험에서 위반 발견 시 NCR 발동',
    });

    // test → criterion
    for (const cid of t.relations?.['hasAcceptanceCriteria'] ?? []) {
      const c = graph.get(cid);
      if (!c) continue;
      allBasis.add(cid);
      path.push({
        step: step++,
        id: c.id,
        name: c.name,
        type: c.type,
        role: '판정 기준 — 위반 여부 비교 대상',
        meta: c.meta,
      });

      // criterion → derivedFrom (Standard)
      for (const sid of c.relations?.['derivedFrom'] ?? []) {
        const s = graph.get(sid);
        if (!s) continue;
        allBasis.add(sid);
        path.push({
          step: step++,
          id: s.id,
          name: s.name,
          type: s.type,
          role: '기준의 법적·기술적 출처',
        });
      }
    }
  }

  // basisPriority — NCR이 직접 명시한 우선 근거
  for (const bid of ncr.relations?.['basisPriority'] ?? []) {
    const b = graph.get(bid);
    if (!b) continue;
    allBasis.add(bid);
    path.push({
      step: step++,
      id: b.id,
      name: b.name,
      type: b.type,
      role: '판정 우선 근거 (basisPriority)',
    });
  }
}

function explainFromRisk(
  graph: OntologyGraph,
  risk: BaseEntity,
  path: PathNode[],
  allBasis: Set<string>,
  startStep: number,
): void {
  let step = startStep;
  path.push({
    step: step++,
    id: risk.id,
    name: risk.name,
    type: risk.type,
    role: '품질 리스크 — 발생 가능 위험',
    meta: risk.meta,
  });
  for (const nid of risk.relations?.['mayCause'] ?? []) {
    const n = graph.get(nid);
    if (!n) continue;
    allBasis.add(nid);
    path.push({
      step: step++,
      id: n.id,
      name: n.name,
      type: n.type,
      role: '발생 가능 부적합 (mayCause)',
    });
  }
  for (const tid of risk.relations?.['relatedTest'] ?? []) {
    const t = graph.get(tid);
    if (!t) continue;
    allBasis.add(tid);
    path.push({
      step: step++,
      id: t.id,
      name: t.name,
      type: t.type,
      role: '관련 시험 (relatedTest)',
    });
  }
}

function explainFromTest(
  graph: OntologyGraph,
  test: BaseEntity,
  path: PathNode[],
  allBasis: Set<string>,
  startStep: number,
): void {
  let step = startStep;
  path.push({
    step: step++,
    id: test.id,
    name: test.name,
    type: test.type,
    role: '시험 항목',
    meta: test.meta,
  });
  for (const cid of test.relations?.['hasAcceptanceCriteria'] ?? []) {
    const c = graph.get(cid);
    if (!c) continue;
    allBasis.add(cid);
    path.push({
      step: step++,
      id: c.id,
      name: c.name,
      type: c.type,
      role: '적용 판정 기준',
      meta: c.meta,
    });
    for (const sid of c.relations?.['derivedFrom'] ?? []) {
      const s = graph.get(sid);
      if (!s) continue;
      allBasis.add(sid);
      path.push({
        step: step++,
        id: s.id,
        name: s.name,
        type: s.type,
        role: '기준 출처',
      });
    }
  }
  for (const nid of test.relations?.['possibleNonconformance'] ?? []) {
    const n = graph.get(nid);
    if (!n) continue;
    allBasis.add(nid);
    path.push({
      step: step++,
      id: n.id,
      name: n.name,
      type: n.type,
      role: '발생 가능 부적합 (possibleNonconformance)',
    });
  }
}

function explainFromCriterion(
  graph: OntologyGraph,
  criterion: BaseEntity,
  path: PathNode[],
  allBasis: Set<string>,
  startStep: number,
): void {
  let step = startStep;
  path.push({
    step: step++,
    id: criterion.id,
    name: criterion.name,
    type: criterion.type,
    role: '판정 기준 (시작점)',
    meta: criterion.meta,
  });
  for (const tid of criterion.relations?.['appliesTo'] ?? []) {
    const t = graph.get(tid);
    if (!t) continue;
    allBasis.add(tid);
    path.push({
      step: step++,
      id: t.id,
      name: t.name,
      type: t.type,
      role: '적용 시험 (appliesTo)',
    });
  }
  for (const sid of criterion.relations?.['derivedFrom'] ?? []) {
    const s = graph.get(sid);
    if (!s) continue;
    allBasis.add(sid);
    path.push({
      step: step++,
      id: s.id,
      name: s.name,
      type: s.type,
      role: '기준 출처 (derivedFrom)',
    });
  }
}

function explainGeneric(
  graph: OntologyGraph,
  entity: BaseEntity,
  path: PathNode[],
  allBasis: Set<string>,
  startStep: number,
): void {
  let step = startStep;
  for (const [rel, ids] of Object.entries(entity.relations ?? {})) {
    for (const id of ids) {
      const e = graph.get(id);
      if (!e) continue;
      allBasis.add(id);
      path.push({
        step: step++,
        id: e.id,
        name: e.name,
        type: e.type,
        role: `${rel}`,
      });
    }
  }
}

function buildSummary(target: BaseEntity, path: PathNode[]): string {
  const types = [...new Set(path.map((p) => p.type))];
  return (
    `[${target.type}] ${target.name}의 도메인 추론 경로 ${path.length}단계. ` +
    `포함 타입: ${types.join(' · ')}. 베테랑 시각: 이 경로의 각 노드는 결정의 ` +
    `근거 사슬 — LLM이 답변 생성 시 이 사슬을 인용해야 환각 방지.`
  );
}
