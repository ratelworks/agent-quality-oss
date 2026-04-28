/**
 * Tool: map_quality_basis
 */

import { resolveWorkType, searchEntities } from '../ontology/resolver.js';
import { buildResponse, entityBasis } from './_response.js';
import type { ToolSpec, HumanCheckpoint } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

export const spec: ToolSpec = {
  name: 'map_quality_basis',
  description:
    '공종·자재·시험항목에 적용되는 근거 기준을 factualBasis(확인됨)와 applicableBasis(검토 후보)로 분리해 반환. 프로젝트 문서는 projectContext 제공 시에만 factualBasis로 승격. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      workType: { type: 'string', description: '공종 id 또는 자연어 (선택)' },
      material: { type: 'string', description: '자재 id 또는 자연어 (선택)' },
      testItem: { type: 'string', description: '시험항목 id 또는 자연어 (선택)' },
      nonconformance: { type: 'string', description: 'NCR id (선택)' },
      agencyId: { type: 'string', description: '발주처 id (agency.*)' },
      projectContext: {
        type: 'object',
        description: '프로젝트 문서 존재 확인 컨텍스트',
      },
    },
  },
};

interface ProjectContext {
  projectId?: string;
  availableDocuments?: string[];
}

export interface MapBasisArgs {
  workType?: string;
  material?: string;
  testItem?: string;
  nonconformance?: string;
  agencyId?: string;
  projectContext?: ProjectContext;
}

const PRIORITY = {
  project_document: 1,
  project_specification: 2,
  kcs_kds: 3,
  administrative_rule: 4,
  ks_standard: 5,
  other: 99,
} as const;

interface BasisItem {
  type: string;
  id: string;
  name?: string;
  priority: number;
  reason: string | null;
  source: string;
  approverRole?: string | undefined;
  typicalSpecSource?: string | undefined;
  note?: string;
}

export function run(args: MapBasisArgs, graph: OntologyGraph) {
  const { workType, material, testItem, nonconformance, agencyId, projectContext } = args ?? {};
  if (!workType && !material && !testItem && !nonconformance) {
    throw new Error('workType·material·testItem·nonconformance 중 최소 하나는 필수입니다.');
  }

  const resolvedIds: string[] = [];
  if (workType) {
    const id = graph.get(workType) ? workType : resolveWorkType(graph, workType)?.id;
    if (id) resolvedIds.push(id);
  }
  if (material) {
    const id = graph.get(material) ? material : searchEntities(graph, material, 'Material', 1)[0]?.id;
    if (id) resolvedIds.push(id);
  }
  if (testItem) {
    const id = graph.get(testItem) ? testItem : searchEntities(graph, testItem, 'TestItem', 1)[0]?.id;
    if (id) resolvedIds.push(id);
  }
  if (nonconformance && graph.get(nonconformance)) {
    resolvedIds.push(nonconformance);
  }

  if (resolvedIds.length === 0) {
    return buildResponse(
      'map_quality_basis',
      graph.version,
      { factualBasis: [], applicableBasis: [] },
      [{ type: 'ontology_meta', id: 'no_match', priority: 3, note: '입력 해석 실패' }],
      { required: true, reason: '입력값을 온톨로지에서 해석할 수 없습니다.' },
    );
  }

  const basisPriorityIds: string[] = [];
  if (nonconformance) {
    const ncrE = graph.get(nonconformance);
    for (const bid of ncrE?.relations?.['basisPriority'] ?? []) basisPriorityIds.push(bid);
  }

  const standardIds = new Set(basisPriorityIds.filter((id) => id.startsWith('standard.')));
  const projectDocIds = new Set(basisPriorityIds.filter((id) => id.startsWith('doc.')));

  for (const id of resolvedIds) {
    const e = graph.get(id);
    for (const sId of e?.relations?.['requiresStandard'] ?? []) standardIds.add(sId);
    for (const cId of e?.relations?.['hasAcceptanceCriteria'] ?? []) {
      const crit = graph.get(cId);
      for (const refId of crit?.relations?.['derivedFrom'] ?? []) standardIds.add(refId);
    }
  }

  const availableDocs = new Set(projectContext?.availableDocuments ?? []);
  const factualBasis: BasisItem[] = [];
  const applicableBasis: BasisItem[] = [];

  interface DocCandidate {
    id: string;
    type: string;
    priority: number;
    reason: string;
    appliesWhen: 'concrete' | 'all';
  }

  // 콘크리트 컨텍스트일 때만 mix_design·구조도면을 후보화 (그 외 공종에 잘못 추천 방지)
  const isConcreteContext = resolvedIds.some(
    (id) =>
      id === 'work.concrete_placement' ||
      id === 'material.ready_mixed_concrete' ||
      id.startsWith('test.slump') ||
      id.startsWith('test.air_content') ||
      id.startsWith('test.chloride') ||
      id.startsWith('test.concrete_temperature') ||
      id.startsWith('test.unit_water_content') ||
      id.startsWith('test.compressive_strength') ||
      id.startsWith('ncr.slump_') ||
      id.startsWith('ncr.air_content_') ||
      id.startsWith('ncr.chloride_') ||
      id.startsWith('ncr.low_compressive_strength') ||
      id.startsWith('ncr.honeycomb') ||
      id.startsWith('ncr.cold_joint'),
  );

  const allDocCandidates: DocCandidate[] = [
    {
      id: 'doc.mix_design',
      type: 'project_document',
      priority: PRIORITY.project_document,
      reason: '배합설계서는 콘크리트 판정 기준의 최우선 근거 (승인된 배합에 한함)',
      appliesWhen: 'concrete',
    },
    {
      id: 'doc.project_specification',
      type: 'project_specification',
      priority: PRIORITY.project_specification,
      reason: '공사시방서는 현장 계약 기준 (모든 공종 적용)',
      appliesWhen: 'all',
    },
    {
      id: 'doc.structural_drawing',
      type: 'project_specification',
      priority: PRIORITY.project_specification,
      reason: '구조 도면의 설계 값은 콘크리트·구조 판정의 계약 기준',
      appliesWhen: 'concrete',
    },
  ];
  const projectDocCandidates: DocCandidate[] = allDocCandidates.filter(
    (c) => c.appliesWhen === 'all' || (c.appliesWhen === 'concrete' && isConcreteContext),
  );

  // NCR.basisPriority에서 직접 참조된 문서는 컨텍스트 무관하게 추가 (NCR 자체가 도메인 신호)
  for (const docId of projectDocIds) {
    if (!projectDocCandidates.find((c) => c.id === docId)) {
      projectDocCandidates.push({
        id: docId,
        type: 'project_document',
        priority: PRIORITY.project_document,
        reason: 'NCR basisPriority에서 직접 참조',
        appliesWhen: 'all',
      });
    }
  }

  for (const cand of projectDocCandidates) {
    const docEntity = graph.get(cand.id);
    if (!docEntity) continue;
    const isAvailable = availableDocs.has(cand.id);
    const item: BasisItem = {
      type: cand.type,
      id: cand.id,
      name: docEntity.name,
      priority: cand.priority,
      reason: cand.reason,
      source: isAvailable ? 'project' : 'ontology_template',
    };
    if (isAvailable) {
      factualBasis.push(item);
    } else {
      applicableBasis.push({ ...item, note: 'projectContext.availableDocuments에 포함되지 않음 — 현장 확인 필요' });
    }
  }

  for (const sId of standardIds) {
    const s = graph.get(sId);
    if (!s) continue;
    let priority: number;
    let type: string;
    if (sId.startsWith('standard.kcs') || sId.startsWith('standard.kds')) {
      priority = PRIORITY.kcs_kds;
      type = 'kcs_kds';
    } else if (sId === 'standard.quality_management_guideline') {
      priority = PRIORITY.administrative_rule;
      type = 'administrative_rule';
    } else if (sId.startsWith('standard.ks_')) {
      priority = PRIORITY.ks_standard;
      type = 'ks_standard';
    } else {
      priority = PRIORITY.other;
      type = 'other';
    }
    factualBasis.push({
      type,
      id: sId,
      name: s.name,
      priority,
      reason:
        (s.meta?.['scope'] as string | undefined) ??
        (s.meta?.['sectionRef'] as string | undefined) ??
        (s.meta?.['reference'] as string | undefined) ??
        null,
      source: 'ontology_public_standard',
    });
  }

  let agencyEntity = null;
  if (agencyId) {
    const a = graph.get(agencyId);
    if (a && a.type === 'Agency') {
      agencyEntity = a;
      factualBasis.push({
        type: 'agency',
        id: a.id,
        name: a.name,
        priority: PRIORITY.project_document,
        reason: `${(a.meta?.['agencyType'] as string | undefined) ?? ''} — 승인자: ${
          (a.meta?.['approverRole'] as string | undefined) ?? '발주처 감독'
        }`,
        source: 'agency',
        approverRole: a.meta?.['approverRole'] as string | undefined,
        typicalSpecSource: a.meta?.['typicalSpecSource'] as string | undefined,
      });
    }
  }

  factualBasis.sort((a, b) => a.priority - b.priority);
  applicableBasis.sort((a, b) => a.priority - b.priority);

  const pendingProjectDocs = applicableBasis.filter(
    (b) => b.type === 'project_document' || b.type === 'project_specification',
  );
  const humanCheckpoint: HumanCheckpoint =
    pendingProjectDocs.length > 0
      ? {
          required: true,
          reason: `미확인 프로젝트 문서 ${pendingProjectDocs.length}건 (${pendingProjectDocs
            .map((b) => b.name)
            .join(', ')}). factualBasis 확정 전 현장 확인 필요.`,
          a2ui: {
            type: 'decision',
            options: ['문서 확인 후 projectContext 갱신해 재호출', '공개 기준만으로 판정 진행'],
          },
        }
      : { required: false, reason: null };

  const result = {
    inputs: { workType, material, testItem, nonconformance, agencyId: agencyId ?? null },
    resolvedEntities: resolvedIds,
    projectContext: projectContext ?? null,
    agency: agencyEntity
      ? { id: agencyEntity.id, name: agencyEntity.name, type: agencyEntity.meta?.['agencyType'] }
      : null,
    factualBasis,
    applicableBasis,
    priorityRule: '발주처 지침 / 프로젝트 승인문서 > 공사시방서 > KCS/KDS > 품질관리 업무지침 > KS',
  };

  const basisRefIds = [...resolvedIds, ...factualBasis.map((b) => b.id), ...applicableBasis.map((b) => b.id)];

  return buildResponse(
    'map_quality_basis',
    graph.version,
    result,
    entityBasis([...new Set(basisRefIds)], 1),
    humanCheckpoint,
  );
}
