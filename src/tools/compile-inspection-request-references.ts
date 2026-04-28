/**
 * 검측 신청서 작성 1건에 필요한 재료 패키지.
 * workType + inspectionPoint → 적용 KCS·KS 표준 + 사전 자체 검측 체크포인트 + 감리 routing.
 */

import { getSchema } from '../schemas/loader.js';
import { buildResponse } from './_response.js';
import type { BasisRef, ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';
import type { BaseEntity } from '../ontology/schema.js';

export const spec: ToolSpec = {
  name: 'compile_inspection_request_references',
  description:
    '검측 신청서 작성 1건에 필요한 재료 패키지를 반환한다 (양식 스키마 + workType별 적용 표준 자동 추출 + 사전 자체검측 체크포인트 + leadTime 가이드). [근거 제공용 · 최종 판정은 품질관리자·감리원·발주청]',
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

  const basisIds = ['standard.law.btia_55', 'standard.kcs_14_20.10', ...appliedStandardIds];
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
      leadTimeGuide: {
        recommended: '24~48시간 전 제출',
        minimum: '8시간 (발주청·감리 별도 약정 우선)',
        rationale:
          '감리원 일정 조율 + 자체 사전 검측 + 도면·서류 준비 + 후속 공정 영향 평가에 필요한 시간. 미달 시 감리 거절 또는 검측 지연 사유.',
      },
      consequenceOfSkip: {
        legal: '감리 미입회 검측은 인정되지 않음 (감리계약 + 시행규칙 §51 보고 의무 위반 가능)',
        practical: '재시공·인증 누락·후속 검측 거절 위험',
      },
      usage:
        '본 패키지를 LLM에 입력 → 양식 sections 채움. 적용 표준은 그래프에서 자동 추출, 추가 시방서 강화분은 수동 보완.',
    },
    basis,
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
