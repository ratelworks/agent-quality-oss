/**
 * 품질시험계획서 작성 1건에 필요한 재료 패키지.
 * 시행령 §90 + 시행규칙 §53 + 업무지침 별표2(시험기준표) + workType별 시험 항목 자동 추출.
 */

import { getSchema } from '../schemas/loader.js';
import { buildResponse } from './_response.js';
import type { BasisRef, ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';
import type { BaseEntity } from '../ontology/schema.js';

export const spec: ToolSpec = {
  name: 'compile_quality_test_plan_references',
  description:
    '품질시험계획서 작성 1건에 필요한 재료 패키지를 반환한다 (양식 스키마 + 시행령 §90 대상 판정 가이드 + workType별 시험 항목 추출 + 업무지침 별표2 + 별지 양식 locator). [근거 제공용 · 최종 판정은 품질관리자·감리원·발주청]',
  inputSchema: {
    type: 'object',
    properties: {
      workTypes: {
        type: 'array',
        items: { type: 'string' },
        description: '대상 공종 id 배열 (예: ["work.concrete_placement"])',
      },
      totalContractValue: {
        type: 'number',
        description: '총공사비(원). 시행령 §89(품질관리계획) vs §90(품질시험계획) 대상 판정 기준',
      },
    },
  },
};

export interface CompileQtpArgs {
  workTypes?: string[];
  totalContractValue?: number;
}

interface TestItemRef {
  workType: string;
  workTypeName: string;
  material?: string;
  materialName?: string;
  testItem: string;
  testItemName: string;
  acceptanceCriterion?: string;
  acceptanceCriterionName?: string;
  standardRef?: string[];
}

export function run(args: CompileQtpArgs, graph: OntologyGraph) {
  const { workTypes = [], totalContractValue } = args ?? {};
  const schema = getSchema('quality_test_plan');

  // 시행령 §89 vs §90 대상 판정 (근사 — 본문 대조 권장)
  let eligibility: { decree89: boolean; decree90: boolean; rationale: string };
  if (typeof totalContractValue === 'number') {
    const decree89 = totalContractValue >= 50_000_000_000;
    const decree90 = !decree89 && totalContractValue >= 500_000_000;
    eligibility = {
      decree89,
      decree90,
      rationale: decree89
        ? '500억 이상 → 시행령 §89 품질관리계획서 대상. 본 시험계획은 §89 계획서의 부속으로 통합'
        : decree90
        ? '5억~500억 → 시행령 §90 품질시험계획서 대상'
        : '5억 미만 → 의무 작성 대상 외 (다중이용시설 등 별도 사유 시 §89 대상 가능)',
    };
  } else {
    eligibility = {
      decree89: false,
      decree90: false,
      rationale: 'totalContractValue 미입력. 발주청 사업서로 §89/§90 대상 판정 필요',
    };
  }

  // workType별 시험 항목 자동 추출 — 그래프 1-hop 순회
  const testItemRefs: TestItemRef[] = [];
  const seen = new Set<string>();
  for (const wtId of workTypes) {
    const wt = graph.get(wtId);
    if (!wt || wt.type !== 'WorkType') continue;
    const materials = wt.relations?.['usesMaterial'] ?? [];
    const tests = wt.relations?.['hasTest'] ?? wt.relations?.['requiresTest'] ?? [];
    for (const tId of tests) {
      const t = graph.get(tId);
      if (!t || t.type !== 'TestItem') continue;
      const key = `${wtId}::${tId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const acc = (t.relations?.['hasAcceptanceCriteria'] ?? [])[0];
      const accE = acc ? graph.get(acc) : undefined;
      testItemRefs.push({
        workType: wtId,
        workTypeName: wt.name,
        testItem: tId,
        testItemName: t.name,
        ...(acc !== undefined && accE
          ? { acceptanceCriterion: acc, acceptanceCriterionName: accE.name }
          : {}),
        ...(accE?.relations?.['derivedFrom']
          ? { standardRef: accE.relations['derivedFrom'] }
          : {}),
      });
    }
    for (const mId of materials) {
      const m = graph.get(mId);
      if (!m || m.type !== 'Material') continue;
      for (const tId of m.relations?.['requiresTest'] ?? []) {
        const t = graph.get(tId);
        if (!t || t.type !== 'TestItem') continue;
        const key = `${wtId}::${mId}::${tId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const acc = (t.relations?.['hasAcceptanceCriteria'] ?? [])[0];
        const accE = acc ? graph.get(acc) : undefined;
        testItemRefs.push({
          workType: wtId,
          workTypeName: wt.name,
          material: mId,
          materialName: m.name,
          testItem: tId,
          testItemName: t.name,
          ...(acc !== undefined && accE
            ? { acceptanceCriterion: acc, acceptanceCriterionName: accE.name }
            : {}),
          ...(accE?.relations?.['derivedFrom']
            ? { standardRef: accE.relations['derivedFrom'] }
            : {}),
        });
      }
    }
  }

  const basisIds = [
    'standard.law.btia_55',
    'standard.law.btia_decree_90',
    'standard.law.btia_rule_53',
    'standard.form.test_plan_template',
    'standard.form.guideline_annex2',
  ];
  const basis: BasisRef[] = basisIds
    .filter((id) => graph.get(id))
    .map((id) => ({ type: 'ontology', id, priority: 1 }));

  // 시험기준표(별표2) 보강 안내 — 그래프에 별표2 본문 미반영 상태
  const annex2Note =
    '업무지침 별표2(시험기준표)는 standard.form.guideline_annex2 locator만 내장. 정확한 시험빈도·방법은 본문(고시 2025-311호) 대조 필수.';

  return buildResponse(
    'compile_quality_test_plan_references',
    graph.version,
    {
      eligibility,
      formSchema: schema,
      testItemsByWorkType: testItemRefs,
      annex2Note,
      requiredAttachments: [
        '품질관리자 배치 신고서 (QCAN documentId 참조)',
        '시험실 평면도·장비 목록·교정성적서',
        '외부 시험소(KOLAS) 계약서',
        '품질관리비 산출서 (시행령 §91 기준)',
      ],
      complianceChecklist: [
        '시행령 §89/§90 대상 판정 근거 명시',
        '별표2 시험빈도 이상으로 자체 빈도 설정 (강화는 가능, 완화 불가)',
        '발주청 사양서 강화 시험 항목 통합',
        '품질관리비 산출 근거 첨부 (시행령 §91)',
        '감리원 검토 + 발주청 승인 (시행규칙 §53)',
      ],
      usage:
        '본 패키지를 LLM에 입력 → 양식 sections 채움. 별표2 본문은 별도 확보. 발주청 승인 필요.',
    },
    basis,
  );
}
