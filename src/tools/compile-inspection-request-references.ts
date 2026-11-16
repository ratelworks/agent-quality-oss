/**
 * 검측 신청서 작성 1건에 필요한 재료 패키지.
 * workType + inspectionPoint → 적용 KCS·KS 표준 + 사전 자체 검측 체크포인트 + 감리 routing.
 */

import { getSchema } from '../schemas/loader.js';
import { buildResponse } from './_response.js';
import { mergeBasis, schemaLegalBasisRefs } from "./_compile-common.js";
import { cite } from '../knowledge/cite.js';

const CM_GUIDELINE = '건설공사 사업관리방식 검토기준 및 업무수행지침';
import type { BasisRef, ToolSpec } from '../lib/types.js';
import type { OntologyGraph } from '../ontology/graph.js';
import type { BaseEntity } from '../ontology/schema.js';

export const spec: ToolSpec = {
  name: 'compile_inspection_request_references',
  description:
    '검측요청서(사업관리방식 지침 별지 제36호) 작성 1건에 필요한 재료 패키지를 반환한다 (양식 스키마 + 공종별 적용 표준 + 사전 자체 점검 항목 + 검측 절차의 근거 문장). [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      workType: { type: 'string', description: '공종 id (예: work.concrete_placement)' },
      inspectionPoint: { type: 'string', description: '검측 포인트 id (예: inspection.rebar_placement_slab)' },
      stage: { type: 'string', description: 'pre / during / post' },
    },
  },
};

export interface CompileInspectionRequestArgs {
  workType?: string;
  inspectionPoint?: string;
  stage?: 'pre' | 'during' | 'post';
}

interface InspectionPointRef {
  id: string;
  name: string;
  appliedStandards: string[];
  verifies: string[];
  requiredEvidence: string[];
}

export function run(args: CompileInspectionRequestArgs, graph: OntologyGraph) {
  const { workType, inspectionPoint, stage } = args ?? {};
  const schema = getSchema('inspection_request');

  // workType → InspectionCheckpoint 자동 추출
  const checkpoints: InspectionPointRef[] = [];
  if (inspectionPoint) {
    const ip = graph.get(inspectionPoint);
    if (ip && ip.type === 'InspectionCheckpoint') {
      checkpoints.push(toRef(ip));
    }
  } else if (workType) {
    const wt = graph.get(workType);
    if (wt && wt.type === 'WorkType') {
      const ipIds = wt.relations?.['hasInspectionCheckpoint'] ?? [];
      for (const id of ipIds) {
        const ip = graph.get(id);
        if (ip && ip.type === 'InspectionCheckpoint') checkpoints.push(toRef(ip));
      }
    }
  }

  // 적용 standard·KCS 통합
  const appliedStandardIds = new Set<string>();
  for (const cp of checkpoints) for (const s of cp.appliedStandards) appliedStandardIds.add(s);
  const appliedStandards = [...appliedStandardIds]
    .map((id) => graph.get(id))
    .filter((e): e is BaseEntity => e != null);

  const basisIds = ['standard.form.cm_a36', ...appliedStandardIds];
  const basis: BasisRef[] = [...new Set(basisIds)]
    .filter((id) => graph.get(id))
    .map((id) => ({ type: 'ontology', id, priority: 1 }));

  // 사전 자체검측 체크포인트 — selfInspection ready 판정 보조
  const selfChecklist: string[] = [
    '검측 대상 부재·구획 명확히 식별 (위치·수량 기재)',
    '시공자 자체 검측 1차 수행 (간단 육안·수치 확인)',
    '관련 도면·시방서 발췌본 준비',
    '이전 검측 합격기록 참조 (해당 시)',
    '검측에 사용될 측정 장비 교정상태 확인',
    '입회 인원·시간 사전 통보 (감리원 일정 조율)',
  ];
  for (const cp of checkpoints) {
    for (const ev of cp.requiredEvidence) {
      const evE = graph.get(ev);
      if (evE) selfChecklist.push(`증빙 준비: ${evE.name} (${ev})`);
    }
  }

  return buildResponse(
    'compile_inspection_request_references',
    graph.version,
    {
      workType: workType ?? null,
      inspectionPoint: inspectionPoint ?? null,
      stage: stage ?? null,
      formSchema: schema,
      checkpoints,
      appliedStandards: appliedStandards.map((s) => ({ id: s.id, name: s.name })),
      selfInspectionChecklist: selfChecklist,
      requestTiming: {
        note: '검측을 몇 시간·며칠 전에 요청해야 하는지는 사업관리방식 지침과 별지 제36호 서식에 정해져 있지 않습니다. 현장별 검측업무지침(검측절차·검측시기·검측빈도)과 계약에서 정한 대로 요청합니다.',
        basis: cite({ law: CM_GUIDELINE, article: '86', quote: '「검측업무지침」을 현장별로 작성ㆍ수립하여 발주청의 승인을 득한 후' }),
      },
      procedure: [
        cite({ law: CM_GUIDELINE, article: '86', quote: '검측요청서(별지 제36호 서식)를 제출받아' }),
        cite({ law: CM_GUIDELINE, article: '86', quote: '1차적으로 시공자의 담당기술인이 검측체크리스트를 첨부하여' }),
        cite({ law: CM_GUIDELINE, article: '86', quote: '공사참여자 실명부가 첨부 되었는지를 확인' }),
        cite({ law: '건설기술 진흥법 시행규칙', article: '50', quote: '구조물의 안전에 중요한 영향을 미치는 시험종목의 품질시험을 할 때에는 발주자가 확인하여야 한다' }),
      ],
      usage:
        '본 패키지를 LLM에 입력 → 양식 sections 채움. 적용 표준은 그래프에서 자동 추출, 추가 시방서 강화분은 수동 보완.',
    },
    mergeBasis(basis, schemaLegalBasisRefs(graph, 'inspection_request')),
  );
}

function toRef(ip: BaseEntity): InspectionPointRef {
  return {
    id: ip.id,
    name: ip.name,
    appliedStandards: ip.relations?.['isBasedOn'] ?? [],
    verifies: ip.relations?.['verifies'] ?? [],
    requiredEvidence: ip.relations?.['requiresEvidence'] ?? [],
  };
}
