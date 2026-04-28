/**
 * 품질검사 실시대장(별지 제42호) 작성 1건에 필요한 재료 패키지.
 * 시행규칙 §51 + 별지 제42호 + entry 템플릿(검사·시험 1건 단위) + 별지 제43호 산출 안내.
 */

import { getSchema } from '../schemas/loader.js';
import { buildResponse } from './_response.js';
import type { BasisRef, ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

export const spec: ToolSpec = {
  name: 'compile_quality_inspection_register_references',
  description:
    '품질검사 실시대장(별지 제42호) 작성·운영에 필요한 재료 패키지를 반환한다 (양식 스키마 + entry 템플릿 + 별지 제43호 산출 안내 + 보존 의무 가이드). 시공자 매일 누적 작성 의무. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주청. 발주청 점검 시 즉시 제시 가능해야 함]',
  inputSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        description: 'register_setup(권 신설 시) / entry_template(1건 추가 시) / period_close(기간 마감 시)',
      },
      testItemId: {
        type: 'string',
        description: 'entry_template 모드에서 시험 종류 id (예: test.slump)',
      },
    },
  },
};

export interface CompileQirArgs {
  mode?: 'register_setup' | 'entry_template' | 'period_close';
  testItemId?: string;
}

export function run(args: CompileQirArgs, graph: OntologyGraph) {
  const { mode = 'register_setup', testItemId } = args ?? {};
  const schema = getSchema('quality_inspection_register');

  const basisIds = [
    'standard.law.btia_55',
    'standard.law.btia_rule_51',
    'standard.form.rule_no42_quality_inspection_register',
  ];
  const basis: BasisRef[] = basisIds
    .filter((id) => graph.get(id))
    .map((id) => ({ type: 'ontology', id, priority: 1 }));

  // mode별 재료 패키지
  let modeSpecific: Record<string, unknown>;
  if (mode === 'entry_template') {
    // 시험 종류 입력 시 해당 시험의 criterion·표준 자동 매핑
    const testE = testItemId ? graph.get(testItemId) : null;
    const accIds = testE?.relations?.['hasAcceptanceCriteria'] ?? [];
    const accs = accIds
      .map((id) => graph.get(id))
      .filter((e) => e != null)
      .map((e) => ({
        id: e!.id,
        name: e!.name,
        unit: (e!.meta as Record<string, unknown>)?.['unit'] ?? null,
        operator: (e!.meta as Record<string, unknown>)?.['operator'] ?? null,
        reference: (e!.meta as Record<string, unknown>)?.['reference'] ?? null,
      }));
    modeSpecific = {
      mode,
      testItem: testE
        ? { id: testE.id, name: testE.name, type: testE.type }
        : null,
      acceptanceCriteria: accs,
      entryTemplate: {
        seq: '<auto-increment>',
        inspectionDate: '<YYYY-MM-DD>',
        workType: '<work.* id>',
        location: '<예: B동 3층 슬래브 C4구역>',
        material: '<material.* id (해당 시)>',
        testItem: testE?.id ?? '<test.* id>',
        testMethod: '<KS/KCS 시험방법 reference>',
        criterionRef: accs[0]?.id ?? '<criteria.* id>',
        criterionThreshold: accs[0]
          ? `${accs[0].operator} ${'threshold' in (accs[0] as object) ? (accs[0] as any).threshold : ''}`
          : '<수치>',
        observedValue: '<측정값>',
        verdict: 'PASS|FAIL|MARGINAL|UNDETERMINED',
        samplingBy: '<품질관리자 이름·자격>',
        testedBy: '<현장/외부 KOLAS>',
        testReportNo: '<외부 시험 시 KOLAS 성적서 번호>',
        ncrLinked: '<FAIL 시 NCR documentId>',
        remarks: '<특이사항>',
      },
    };
  } else if (mode === 'period_close') {
    modeSpecific = {
      mode,
      closingChecklist: [
        '기간 내 모든 검사·시험 entry 누락 없음 확인',
        'verdict별 집계 (PASS/FAIL/MARGINAL/UNDETERMINED)',
        'FAIL entry의 NCR documentId 모두 연결 확인',
        '외부 KOLAS 성적서 원본·사본 매핑 확인',
        '기간 합계 → 별지 제43호 (품질검사 성과 총괄표) 산출',
        '책임자 서명 + 보관 위치 기재',
        '발주청 점검 시 즉시 제시 가능 상태 확인',
      ],
      annex43LinkNote:
        '본 대장의 summary section이 별지 제43호 산출의 1차 데이터 소스. 별지 제43호는 분기·연 단위로 발주청에 제출.',
    };
  } else {
    modeSpecific = {
      mode,
      setupChecklist: [
        '권 번호 부여 (Vol.1, 2, ... — 통상 월별 또는 분기별 분리)',
        '프로젝트 코드·기간 명시',
        '책임 품질관리자(서명자) 등록',
        '보관 위치 명시 (현장 사무실 또는 본사)',
        '시행규칙 §51 별지 제42호 양식 사용 확인',
        '발주청 점검 일정 사전 공지 시 즉시 응대 가능한 보관',
      ],
    };
  }

  return buildResponse(
    'compile_quality_inspection_register_references',
    graph.version,
    {
      formSchema: schema,
      ...modeSpecific,
      retentionRule: {
        period: '시설물 존속기간 또는 시행령 §93 명시 보존기간',
        scope: '시공자 매일 누적 작성·비치 의무',
        consequence: '미작성·미비치 시 시정명령 + 영업정지 (건진법 §61)',
      },
      usage:
        '본 패키지를 LLM에 입력 → entry 1건씩 자동 생성 + 기간 마감 시 별지 제43호 자동 산출 가능. 원본 별지 제42호 양식은 standard-forms locator의 sourceUrl에서 다운로드.',
    },
    basis,
  );
}
