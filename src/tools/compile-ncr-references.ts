import { getSchema } from '../schemas/loader.js';
import { buildResponse } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';
import type { BaseEntity } from '../ontology/schema.js';

export const spec: ToolSpec = {
  name: 'compile_ncr_references',
  description:
    'NCR 작성 1건에 필요한 재료 패키지를 반환한다. NCR 양식 스키마 + 해당 NCR 엔티티의 필드(owner·approver·effectivenessCheck·closureCriteria) + possibleCauses + 관련 기준·법령. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      ncrId: { type: 'string', description: 'Nonconformance id (예: ncr.slump_too_high).' },
      workType: { type: 'string', description: '공종 (ncrId 없을 때 후보 추출)' },
      testId: { type: 'string', description: '시험 id (ncrId 없을 때 후보 추출)' },
    },
  },
};

export interface CompileNcrArgs {
  ncrId?: string;
  workType?: string;
  testId?: string;
}

interface ActionRef {
  id: string;
  name: string;
  urgency: string | undefined;
}
interface EvidenceRef {
  id: string;
  name: string;
  mandatory: boolean;
}
interface BasisRefLite {
  id: string;
  name: string;
  category: string | null;
  legalWeight: string | undefined;
}

export function run(args: CompileNcrArgs, graph: OntologyGraph) {
  const { ncrId, workType, testId } = args ?? {};
  if (!ncrId && !workType && !testId) {
    throw new Error('ncrId · workType · testId 중 하나는 필수입니다.');
  }

  const ncrSchema = getSchema('ncr');

  let ncrIds: string[] = [];
  if (ncrId) {
    ncrIds = [ncrId];
  } else if (testId) {
    ncrIds = (graph.neighbors(testId)['possibleNonconformance'] ?? []).map((n) => n.id);
  } else if (workType) {
    const workEntity = graph.get(workType);
    if (workEntity) {
      for (const r of workEntity.relations?.['hasQualityRisk'] ?? []) {
        const riskE = graph.get(r);
        for (const nid of riskE?.relations?.['mayCause'] ?? []) ncrIds.push(nid);
      }
    }
    ncrIds = [...new Set(ncrIds)];
  }

  const ncrs: BaseEntity[] = ncrIds
    .map((id) => graph.get(id))
    .filter((e): e is BaseEntity => e != null && e.type === 'Nonconformance');

  if (ncrs.length === 0) {
    return buildResponse(
      'compile_ncr_references',
      graph.version,
      { ncrs: [], formSchema: ncrSchema },
      [{ type: 'schema_meta', id: 'ncr', priority: 2, note: 'NCR 양식 스키마만 반환' }],
      { required: true, reason: 'NCR 후보를 찾을 수 없음. ncrId·workType·testId 확인 필요.' },
    );
  }

  const allBasisIds = new Set<string>();
  const ncrPackages = ncrs.map((ncrE) => {
    const rel = ncrE.relations ?? {};
    const immediateActions: ActionRef[] = (rel['immediateActions'] ?? [])
      .map((id): ActionRef | null => {
        const a = graph.get(id);
        allBasisIds.add(id);
        return a
          ? { id, name: a.name, urgency: a.meta?.['urgency'] as string | undefined }
          : null;
      })
      .filter((x): x is ActionRef => x !== null);
    const correctiveActions: ActionRef[] = (rel['correctiveActions'] ?? [])
      .map((id): ActionRef | null => {
        const a = graph.get(id);
        allBasisIds.add(id);
        return a
          ? { id, name: a.name, urgency: a.meta?.['urgency'] as string | undefined }
          : null;
      })
      .filter((x): x is ActionRef => x !== null);
    const evidence: EvidenceRef[] = (rel['requiresEvidence'] ?? [])
      .map((id): EvidenceRef | null => {
        const d = graph.get(id);
        allBasisIds.add(id);
        return d ? { id, name: d.name, mandatory: Boolean(d.meta?.['mandatory']) } : null;
      })
      .filter((x): x is EvidenceRef => x !== null);
    const basisPriorityResolved: BasisRefLite[] = (rel['basisPriority'] ?? [])
      .map((id): BasisRefLite | null => {
        const b = graph.get(id);
        allBasisIds.add(id);
        return b
          ? {
              id,
              name: b.name,
              category: (b.meta?.['category'] as string | undefined) ?? null,
              legalWeight: b.meta?.['legalWeight'] as string | undefined,
            }
          : null;
      })
      .filter((x): x is BasisRefLite => x !== null);

    allBasisIds.add(ncrE.id);

    return {
      id: ncrE.id,
      name: ncrE.name,
      direction: (ncrE.meta?.['direction'] as string | undefined) ?? null,
      severity: (ncrE.meta?.['severity'] as string | undefined) ?? 'medium',
      possibleCauses: (ncrE.meta?.['possibleCauses'] as string[] | undefined) ?? [],
      owner: ncrE.meta?.['owner'] as string | undefined,
      approver: ncrE.meta?.['approver'] as string | undefined,
      effectivenessCheck: ncrE.meta?.['effectivenessCheck'] as string | undefined,
      closureCriteria: ncrE.meta?.['closureCriteria'] as string | undefined,
      immediateActions,
      correctiveActions,
      requiredEvidence: evidence,
      basisPriority: basisPriorityResolved,
    };
  });

  const result = {
    inputs: { ncrId, workType, testId },
    count: ncrPackages.length,
    ncrs: ncrPackages,
    formSchema: ncrSchema
      ? { schemaId: ncrSchema.id, title: ncrSchema.title, sections: ncrSchema.sections }
      : null,
    usage: 'LLM이 이 패키지를 받아 NCR 초안을 작성. 승인·서명은 품질관리자·감리원.',
  };

  return buildResponse(
    'compile_ncr_references',
    graph.version,
    result,
    [...allBasisIds].map((id) => ({ type: 'ontology', id, priority: 1 })),
    {
      required: true,
      reason: 'NCR은 감리원·발주자 승인이 필요한 법정 기록물. 초안 작성 후 반드시 결재.',
      a2ui: { type: 'decision', options: ['감리 결재 요청', '재시험 지시', '초안 수정'] },
    },
  );
}
