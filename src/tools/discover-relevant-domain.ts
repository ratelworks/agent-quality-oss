/**
 * Tool: discover_relevant_domain
 *
 * "내가 지금 이런 상황인데 뭘 알아야 하나?" — 자연어 상황 입력을 받아
 * 관련 공종·자재·시험·기준·법령·서식을 한 번에 모은 도메인 지식 패키지로 반환.
 *
 * korean-law-mcp의 chain_full_research / discover_tools와 동일 철학.
 */

import { searchEntities } from '../ontology/resolver.js';
import { buildResponse } from './_response.js';
import type { ToolSpec, NextStepHint } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';
import type { BaseEntity, EntityType } from '../ontology/schema.js';

export const spec: ToolSpec = {
  name: 'discover_relevant_domain',
  description:
    '"내가 지금 이런 상황인데 뭘 알아야 하나?" 자연어 상황 입력을 받아 관련 도메인 지식(공종·자재·시험·기준·법령·서식)을 한 번에 묶은 패키지를 반환. 길잡이 + 도메인 전문성 공급. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      situation: { type: 'string', description: '상황 자연어 (예: "오늘 슬래브 콘크리트 타설")' },
      maxResults: { type: 'number', description: '카테고리별 최대 결과 수 (기본 5)' },
    },
    required: ['situation'],
  },
};

export interface DiscoverArgs {
  situation: string;
  maxResults?: number;
}

const DOMAIN_TYPES: EntityType[] = [
  'WorkType',
  'Material',
  'TestItem',
  'InspectionCheckpoint',
  'AcceptanceCriteria',
  'QualityRisk',
  'Nonconformance',
  'Standard',
];

export function run(args: DiscoverArgs, graph: OntologyGraph) {
  const { situation, maxResults = 5 } = args ?? ({ situation: '' } as DiscoverArgs);
  if (!situation) throw new Error('situation은 필수입니다.');

  // 카테고리별로 검색
  const buckets: Record<string, Array<{ id: string; name: string; score: number }>> = {};
  const allBasis: string[] = [];

  for (const type of DOMAIN_TYPES) {
    const hits = searchEntities(graph, situation, type, maxResults);
    buckets[type] = hits.map((h) => ({
      id: h.id,
      name: h.name,
      score: Number(h.score.toFixed(3)),
    }));
    for (const h of hits) allBasis.push(h.id);
  }

  // 1순위 WorkType이 있으면 1-hop 이웃까지 함께 반환 (베테랑 시각: 공종 잡히면 관련 자재·시험·검측 자동 따라옴)
  let primaryWork: BaseEntity | null = null;
  let primaryNeighborhood: Record<string, Array<{ id: string; name: string }>> = {};
  if (buckets['WorkType'] && buckets['WorkType'].length > 0) {
    const id = buckets['WorkType'][0]!.id;
    primaryWork = graph.get(id) ?? null;
    if (primaryWork) {
      const n1 = graph.neighbors(primaryWork.id);
      for (const [rel, ents] of Object.entries(n1)) {
        primaryNeighborhood[rel] = ents.map((e) => ({ id: e.id, name: e.name }));
        for (const e of ents) allBasis.push(e.id);
      }
      allBasis.push(primaryWork.id);
      // primaryWork의 1-hop 이웃을 domainPackage에도 자동 채움 — 키워드 매칭만으론 빈 버킷이 생김.
      const REL_TO_TYPE: Record<string, EntityType> = {
        usesMaterial: 'Material',
        hasInspectionCheckpoint: 'InspectionCheckpoint',
        hasQualityRisk: 'QualityRisk',
        requiresStandard: 'Standard',
      };
      const DERIVED_TYPES: EntityType[] = ['TestItem', 'AcceptanceCriteria', 'Nonconformance'];
      for (const [rel, ents] of Object.entries(n1)) {
        const t = REL_TO_TYPE[rel];
        if (!t) continue;
        const arr = buckets[t] ?? (buckets[t] = []);
        const seen = new Set(arr.map((x) => x.id));
        for (const e of ents) {
          if (!seen.has(e.id)) arr.push({ id: e.id, name: e.name, score: 0.5 });
        }
      }
      // 자재 → 시험 (2-hop) 자동 확장. "콘크리트 타설" 입력 시 슬럼프/공기량 등 시험이 비어 있던 이슈 해소.
      const testArr = buckets['TestItem'] ?? (buckets['TestItem'] = []);
      const seenT = new Set(testArr.map((x) => x.id));
      for (const m of n1['usesMaterial'] ?? []) {
        for (const t of graph.neighbors(m.id)['requiresTest'] ?? []) {
          if (!seenT.has(t.id)) {
            testArr.push({ id: t.id, name: t.name, score: 0.4 });
            seenT.add(t.id);
            allBasis.push(t.id);
          }
        }
      }
      // 시험 → AcceptanceCriteria 1-hop도 채움.
      const acArr = buckets['AcceptanceCriteria'] ?? (buckets['AcceptanceCriteria'] = []);
      const seenAc = new Set(acArr.map((x) => x.id));
      for (const t of testArr) {
        for (const c of graph.neighbors(t.id)['hasAcceptanceCriteria'] ?? []) {
          if (!seenAc.has(c.id)) {
            acArr.push({ id: c.id, name: c.name, score: 0.3 });
            seenAc.add(c.id);
            allBasis.push(c.id);
          }
        }
      }
      // limit 적용
      for (const t of DERIVED_TYPES) {
        if (buckets[t] && buckets[t]!.length > maxResults) {
          buckets[t] = buckets[t]!.slice(0, maxResults);
        }
      }
    }
  }

  // 베테랑 시각 — 어떤 정보가 일반적으로 필요한지 안내
  const expertGuidance: string[] = [];
  if (primaryWork) {
    expertGuidance.push(
      `공종 "${primaryWork.name}"이 식별됨. 베테랑 시각: 자재·시험·검측·법령을 동시에 확인하라.`,
    );
  }
  if ((buckets['Nonconformance']?.length ?? 0) > 0) {
    expertGuidance.push('NCR 후보 식별됨 — compile_ncr_references로 작성 재료 수집 권고');
  }
  if ((buckets['Standard']?.length ?? 0) > 0) {
    expertGuidance.push('관련 표준·법령 발견 — verify_form_reference로 인용 정확성 검증');
  }
  if (expertGuidance.length === 0) {
    expertGuidance.push('직접 매칭된 도메인 노드가 적음. resolve_worktype로 공종 표현 정정 권고.');
  }

  const result = {
    situation,
    domainPackage: buckets,
    primaryWorkType: primaryWork
      ? {
          id: primaryWork.id,
          name: primaryWork.name,
          neighborhood: primaryNeighborhood,
        }
      : null,
    expertGuidance,
  };

  const uniqueBasis = [...new Set(allBasis)];

  // 동적 nextSteps — primaryWork에 따라 적합한 패키지만 추천.
  // default(_response.ts)는 콘크리트 미커버 도메인용 일반 가이드만 둠.
  const nextSteps: NextStepHint[] = [];
  if (primaryWork?.id === 'work.concrete_placement') {
    nextSteps.push({
      tool: 'compile_concrete_pour_references',
      reason: '콘크리트 타설 1회 도메인 재료 패키지',
    });
  }
  if (primaryWork) {
    nextSteps.push({
      tool: 'compile_inspection_references',
      reason: `"${primaryWork.name}" 검측 입회 재료 패키지`,
    });
  }
  nextSteps.push({ tool: 'list_core_quality_laws', reason: '관련 법령 목록' });
  if (!primaryWork) {
    nextSteps.push({
      tool: 'resolve_worktype',
      reason: '미매칭 — 공종 표현 정정 후 재호출',
    });
  }

  return buildResponse(
    'discover_relevant_domain',
    graph.version,
    result,
    uniqueBasis.length > 0
      ? uniqueBasis.map((id) => ({ type: 'ontology' as const, id, priority: 1 }))
      : [{ type: 'ontology_meta', id: 'no_match', priority: 3, note: '매칭 도메인 없음' }],
    uniqueBasis.length === 0
      ? { required: true, reason: `"${situation}"에서 도메인 매칭 0건 — 표현 정정 필요` }
      : undefined,
    nextSteps,
  );
}
