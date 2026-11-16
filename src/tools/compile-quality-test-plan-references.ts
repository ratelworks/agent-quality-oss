/**
 * 품질시험계획서 작성 1건에 필요한 재료 패키지.
 *
 * 대상 판정은 시행령 제89조(knowledge/plan-rules.ts) — 총공사비만으로 가리지 않는다.
 * 전문공사 2억원 이상, 연면적 660㎡ 이상 건축공사도 대상이고, 입력이 모자라면 판정하지 않는다.
 * 계획의 법정 내용은 시행령 별표 9 를 수록 원문에서 읽어 싣는다.
 */

import { getSchema } from '../schemas/loader.js';
import { buildResponse } from './_response.js';
import { mergeBasis, schemaLegalBasisRefs } from "./_compile-common.js";
import { cite } from '../knowledge/cite.js';
import { judgePlanTarget, type ProjectFacts } from '../knowledge/plan-rules.js';
import { findAnnex, findLaw } from '../ontology/laws.js';
import type { BasisRef, ToolSpec } from '../lib/types.js';
import type { OntologyGraph } from '../ontology/graph.js';
import type { BaseEntity } from '../ontology/schema.js';

export const spec: ToolSpec = {
  name: 'compile_quality_test_plan_references',
  description:
    '품질시험계획서 작성 1건에 필요한 재료 패키지를 반환한다 — 양식 스키마 + 시행령 제89조 대상 판정(공사 종류·총공사비·연면적 기준, 입력이 모자라면 판정하지 않음) + 시행령 별표 9 계획 내용 원문 + 공종별 시험 항목 + 수립·승인 절차 근거. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      workTypes: {
        type: 'array',
        items: { type: 'string' },
        description: '대상 공종 id 배열 (예: ["work.concrete_placement"])',
      },
      totalContractValue: { type: 'number', description: '총공사비(원) — 관급자재비 포함, 보상비 제외' },
      workKind: { type: 'string', enum: ['civil', 'building', 'specialty'], description: '공사 종류: civil(토목) / building(건축) / specialty(전문)' },
      floorArea: { type: 'number', description: '연면적(㎡)' },
      multiUse: { type: 'boolean', description: '건축법 시행령 제2조제17호의 다중이용 건축물인가' },
      cmSupervised: { type: 'boolean', description: '감독 권한대행 등 건설사업관리 대상 공사인가' },
      contractRequiresQualityPlan: { type: 'boolean', description: '계약에 품질관리계획을 수립하도록 되어 있는가' },
      exempt: { type: 'string', enum: ['nuclear', 'landscaping', 'demolition'], description: '계획을 수립하지 않을 수 있는 공사: nuclear(원자력시설) / landscaping(조경식재) / demolition(철거)' },
    },
  },
};

export interface CompileQtpArgs {
  workTypes?: string[];
  totalContractValue?: number;
  workKind?: ProjectFacts['workKind'];
  floorArea?: number;
  multiUse?: boolean;
  cmSupervised?: boolean;
  contractRequiresQualityPlan?: boolean;
  exempt?: ProjectFacts['exempt'];
}

const DECREE = '건설기술 진흥법 시행령';
const GUIDELINE = '건설공사 품질관리 업무지침';

/** 시행령 별표 9 — 품질시험계획의 내용 (번호 붙은 줄만) */
function planContents(): { source: string; lines: string[] } {
  const law = findLaw(DECREE);
  const annex = law ? findAnnex(law, '별표 9') : null;
  if (!annex) throw new Error('시행령 별표 9가 수록본에 없습니다');
  const lines = annex.text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(\d+\.|[가-하]\.)/.test(l));
  return { source: `${DECREE} 별표 9 — ${annex.title}`, lines };
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
  const { workTypes = [], totalContractValue, ...rest } = args ?? {};
  const facts: ProjectFacts = { ...rest, ...(totalContractValue !== undefined ? { totalCost: totalContractValue } : {}) };
  const schema = getSchema('quality_test_plan');

  const planTarget = judgePlanTarget(facts);

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
    'standard.law.btia_decree_89',
    'standard.law.btia_decree_90',
    'standard.form.test_plan_template',
    'standard.form.guideline_annex2',
  ];
  const basis: BasisRef[] = basisIds
    .filter((id) => graph.get(id))
    .map((id) => ({ type: 'ontology', id, priority: 1 }));

  return buildResponse(
    'compile_quality_test_plan_references',
    graph.version,
    {
      planTarget: {
        qualityPlan: planTarget.qualityPlan,
        testPlan: planTarget.testPlan,
        conclusion: planTarget.conclusion,
        grounds: planTarget.grounds,
        missingInputs: planTarget.missingInputs,
        caveats: planTarget.caveats,
      },
      formSchema: schema,
      // 법령이 정한 계획 내용 — 이 항목은 빠지면 안 된다
      legalContents: planContents(),
      testItemsByWorkType: testItemRefs,
      testStandard: {
        note: '공종별 시험종목·방법·빈도는 업무지침 별표 2 가 기준입니다. 전문은 get_quality_law_article(law: "품질관리 업무지침", annex: "별표 2") 로 받습니다.',
        rules: [
          cite({ law: GUIDELINE, article: '8', quote: '건설공사 품질시험기준은 별표 2와 같다' }),
          cite({ law: GUIDELINE, article: '8', quote: '명시되지 아니한 공종이나 자재에 대해서는 시방서 등 설계도서에 제시된 시험종목ㆍ방법 및 빈도에 따른다' }),
          cite({ law: GUIDELINE, article: '8', quote: '시험빈도를 조정할 수 있다' }),
        ],
      },
      procedure: [
        cite({ law: DECREE, article: '90', quote: '미리 공사감독자 또는 건설사업관리기술인' }),
        cite({ law: DECREE, article: '90', quote: '적정: 품질관리에 필요한 조치가 구체적이고 명료하게 계획되어' }),
        cite({ law: DECREE, article: '90', quote: '조건부 적정:' }),
        cite({ law: DECREE, article: '90', quote: '부적정: 품질관리가 어려울 것으로 우려되거나' }),
      ],
      // 법령이 계획의 내용으로 정한 것은 아니지만 현장에서 함께 붙이는 자료
      practiceAttachments: [
        '시험·검사장비 교정성적서',
        '품질검사를 대행시킬 경우 대행 기관과의 계약서 (대행 기관은 법 제60조제1항의 국립·공립 시험기관 또는 건설엔지니어링사업자)',
      ],
      qualityCostNote: {
        note: '품질관리비는 시공자가 계획서에서 산출하는 항목이 아니라 발주자가 산출해 설계도서에 밝히는 항목입니다. 계획서에는 필요할 때 참고로만 적습니다.',
        basis: cite({ law: '건설기술 진흥법 시행규칙', annex: '별표 6', quote: '발주자는' }),
      },
      complianceChecklist: [
        '시행령 별표 9 의 네 항목(개요·시험계획·시험시설·건설기술인 배치계획)을 모두 적었는지',
        '시험계획에 공종·시험 종목·시험 계획물량·시험 빈도·시험 횟수를 적었는지 (별표 9 제2호)',
        '시험시설에 장비명·규격·단위·수량과 시험실 배치 평면도를 넣었는지 (별표 9 제3호)',
        '건설기술인 배치계획에 성명·등급·품질관리 업무 수행기간·자격 및 학력·경력을 적었는지 (별표 9 제4호)',
        '시험빈도가 업무지침 별표 2 와 설계도서에 맞는지 — 발주자가 조정한 빈도가 있으면 그 내용 반영 (업무지침 제8조)',
        '공사감독자 또는 건설사업관리기술인의 검토·확인을 받고 착공 전에 발주자 승인을 받는지 (시행령 제90조제1항)',
      ],
      usage:
        '이 패키지로 양식의 각 항목을 채운다. planTarget 에 missingInputs 가 있으면 그 입력을 확인한 뒤 다시 판정한다. 승인은 발주자.',
    },
    mergeBasis(basis, schemaLegalBasisRefs(graph, 'quality_test_plan')),
  );
}
