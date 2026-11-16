/**
 * 품질검사 실시대장(별지 제42호) 작성 1건에 필요한 재료 패키지.
 * 시행규칙 §50① + 별지 제42호 + entry 템플릿(검사·시험 1건 단위) + 별지 제43호 산출 안내.
 */

import { penaltyBlock } from './_compile-common.js';
import { getSchema } from '../schemas/loader.js';
import { buildResponse } from './_response.js';
import { mergeBasis, schemaLegalBasisRefs } from "./_compile-common.js";
import { cite } from '../knowledge/cite.js';
import type { BasisRef, ToolSpec } from '../lib/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

export const spec: ToolSpec = {
  name: 'compile_quality_inspection_register_references',
  description:
    '품질검사 실시대장(시행규칙 별지 제42호) 작성에 필요한 재료 패키지를 반환한다 (양식 스키마 + 한 줄 기록 틀 + 성과 총괄표(별지 제43호) 연결 + 정보망 입력·보존 근거). 검사할 때마다 적고 7일 이내 정보망에 입력한다. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
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
    'standard.law.btia_rule_50',
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
        // 별지 제42호의 열 순서
        seq: '<일련번호>',
        inspectionDate: '<연월일 YYYY-MM-DD>',
        inspectionKind: '<시험 또는 검사>',
        material: '<품질검사 대상 재료>',
        supplyPlant: '<건설자재·부재를 공급받은 공장>',
        inspectionPlace: '<시험·검사 장소 — 예: 현장 시험실, 대행 기관명>',
        inspectionItem: testE?.name ?? '<시험·검사 종목>',
        criterion: accs[0]?.name ?? '<시험 기준>',
        testResult: '<시험 결과 — 측정값>',
        resultVerdict: '<시험 결과 판정>',
        qcEngineerName: '<품질관리기술인 성명 — 서명은 출력본·전자 서명에>',
        cmEngineerName: '<건설사업관리기술인 확인 성명 — 서명은 출력본·전자 서명에>',
        remarks: '<비고 — 성적서 번호, 부적합이면 부적합 보고서 번호 등>',
      },
    };
  } else if (mode === 'period_close') {
    modeSpecific = {
      mode,
      closingChecklist: [
        '기간 내 모든 검사·시험 entry 누락 없음 확인',
        '공종·시험 종류별로 횟수 집계 (계획·실시·합격·불합격·재시험)',
        '불합격 기록에 부적합 보고서 번호가 비고에 적혔는지 확인',
        '품질검사 대행 기관의 성적서와 기록 대조',
        '검사 완료일부터 7일 이내 정보망 입력 여부 확인 (법 제55조제3항)',
        '기간 합계 → 별지 제43호 (품질검사 성과 총괄표) 산출',
        '품질관리기술인 서명과 건설사업관리기술인 확인 서명이 빠진 줄이 없는지 확인',
      ],
      annex43LinkNote:
        '성과 총괄표(별지 제43호)는 이 대장의 기록을 공종·시험 종류별 횟수(계획·실시·합격·불합격·재시험)로 모은 것이다. 기성부분검사·예비준공검사 또는 준공검사를 신청할 때 발주자에게 제출한다(시행령 제93조제1항). 매월 실적은 사업관리방식 지침 별지 제18호(시험·검사실적보고서)로 낸다.',
    };
  } else {
    modeSpecific = {
      mode,
      setupChecklist: [
        '시행규칙 별지 제42호 서식의 열을 그대로 사용',
        '전자적 처리가 가능한 방법으로 작성·관리 (시행규칙 제50조제1항)',
        '품질관리기술인(기록·서명자)과 건설사업관리기술인(확인자) 지정',
        '정보망 입력 담당자 지정 — 품질관리 업무를 수행하는 건설기술인에게 입력하게 할 수 있다 (시행령 제91조제4항)',
      ],
    };
  }

  return buildResponse(
    'compile_quality_inspection_register_references',
    graph.version,
    {
      formSchema: schema,
      ...modeSpecific,
      ...penaltyBlock(['tool:compile_quality_inspection_register_references']),
      retentionRule: {
        period: '대장의 법정 보존기간은 없다. 집계 결과인 성과 총괄표는 시설물 존속기간 보존(시행령 제93조제4항).',
        recording: cite({ law: '건설기술 진흥법 시행규칙', article: '50', quote: '별지 제42호서식의 품질검사 대장에 품질검사의 결과를 적되' }),
        csiEntry: cite({ law: '건설기술 진흥법', article: '55', quote: '완료한 날부터 7일 이내에 그 결과 및 실시대장 등 증빙자료를' }),
        csiEntryContents: cite({ law: '건설기술 진흥법 시행령', article: '91', quote: '품질검사 실시대장에 기재해야 하는 내용' }),
        penalty: {
          ...cite({ law: '건설기술 진흥법', article: '91', quote: '정보망에 기한 내에 입력하지 아니하거나 거짓으로 입력한 자' }),
          note: '300만원 이하의 과태료(법 제91조제3항제12호의2). 위반 횟수별 금액은 시행령 별표 11.',
        },
      },
      usage:
        '이 패키지로 대장의 한 줄을 채운다. 기간을 마감할 때 성과 총괄표(별지 제43호)로 모은다. 서식 원본은 get_standard_form_locator 의 공식 링크에서 받는다.',
    },
    mergeBasis(basis, schemaLegalBasisRefs(graph, 'quality_inspection_register')),
  );
}
