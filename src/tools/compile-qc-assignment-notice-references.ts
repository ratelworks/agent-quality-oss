/**
 * 품질관리자 배치 신고서 작성 1건에 필요한 재료 패키지.
 * 시행규칙 §50 별표7 등급·인원 가이드 + 양식 스키마 + 법령 근거.
 */

import { getSchema } from '../schemas/loader.js';
import { buildResponse } from './_response.js';
import type { BasisRef, ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

export const spec: ToolSpec = {
  name: 'compile_qc_assignment_notice_references',
  description:
    '품질관리자 배치 신고서 작성 1건에 필요한 재료 패키지를 반환한다 (양식 스키마 + 시행규칙 §50 등급·배치인원 가이드 + 법령 근거). [근거 제공용 · 최종 판정은 품질관리자·감리원·발주청]',
  inputSchema: {
    type: 'object',
    properties: {
      noticeType: {
        type: 'string',
        description: '신고 유형: initial / change / replacement / withdrawal',
      },
      totalContractValue: {
        type: 'number',
        description: '총공사비(원). 시행규칙 §50 별표7 등급·인원 산정 기준',
      },
    },
  },
};

export interface CompileQcAssignmentArgs {
  noticeType?: 'initial' | 'change' | 'replacement' | 'withdrawal';
  totalContractValue?: number;
}

export function run(args: CompileQcAssignmentArgs, graph: OntologyGraph) {
  const { noticeType, totalContractValue } = args ?? {};
  const schema = getSchema('qc_assignment_notice');

  // 시행규칙 §50 별표7 가이드 (간략 — 정확한 임계값은 본문 대조 후 별도 데이터화 예정)
  const sizeGuide = {
    note:
      '시행규칙 §50 별표7의 정확한 임계값(공사비/공기/공종)은 본문 대조 필요. 아래는 통상 분류:',
    grades: [
      { grade: '특급', threshold: '총공사비 700억 이상 또는 다중이용시설 등', minHeadcount: '특급 1, 고급 1+' },
      { grade: '고급', threshold: '500억~700억', minHeadcount: '고급 1, 중급 1+' },
      { grade: '중급', threshold: '100억~500억', minHeadcount: '중급 1+' },
      { grade: '초급', threshold: '5억~100억 (시행령 §90 대상)', minHeadcount: '초급 1+' },
    ],
    referenceVerification:
      '실제 적용 전 시행규칙 §50 별표7 본문 대조 필수. 발주청 추가 요건 가능.',
  };

  // 입력값 기반 자동 추정 (참고용 hint)
  let recommendation: string | null = null;
  if (typeof totalContractValue === 'number') {
    if (totalContractValue >= 70_000_000_000) recommendation = '특급 권장 (700억 이상)';
    else if (totalContractValue >= 50_000_000_000) recommendation = '고급 권장 (500~700억)';
    else if (totalContractValue >= 10_000_000_000) recommendation = '중급 권장 (100~500억)';
    else if (totalContractValue >= 500_000_000) recommendation = '초급 권장 (5~100억)';
    else recommendation = '시행령 §90 대상 여부부터 확인 필요 (5억 미만)';
  }

  const basisIds = ['standard.law.btia_55', 'standard.law.btia_rule_50'];
  const basis: BasisRef[] = basisIds
    .filter((id) => graph.get(id))
    .map((id) => ({ type: 'ontology', id, priority: 1 }));

  return buildResponse(
    'compile_qc_assignment_notice_references',
    graph.version,
    {
      noticeType: noticeType ?? 'unspecified',
      totalContractValue: totalContractValue ?? null,
      formSchema: schema,
      sizeGuide,
      recommendation,
      complianceChecklist: [
        '품질관리자 자격증·등록증 사본 첨부',
        '경력증명서 첨부 (등급 산정 근거)',
        '발주청 사업코드 정확 기재',
        '상주/비상주 구분 명시',
        '시행규칙 §50 별표7 등급·인원 자체 검증 결과 기재',
        '변경 신고 시 기존 인원 대비 차이 명시',
      ],
      usage:
        '본 패키지를 LLM에 입력 → 양식 sections 채움. 등급·인원의 적합성은 별표7 본문 대조 후 발주청 승인 필요.',
    },
    basis,
  );
}
