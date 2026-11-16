/**
 * 품질관리 건설기술인 배치 문서 작성 1건에 필요한 재료 패키지.
 *
 * 배치기준은 시행규칙 제50조제4항 · 별표 5 를 수록 원문에서 읽어 그대로 싣는다
 * (대상공사 구분, 시험·검사장비, 시험실 규모, 건설기술인 구성, 비고).
 * 대상공사 구분 판정은 knowledge/plan-rules.ts — 입력이 모자라면 판정하지 않는다.
 */

import { getSchema } from "../schemas/loader.js";
import { buildResponse } from "./_response.js";
import { mergeBasis, schemaLegalBasisRefs } from "./_compile-common.js";
import { cite } from "../knowledge/cite.js";
import { judgePlanTarget, judgeStaffingGrade, staffingStandard, type ProjectFacts } from "../knowledge/plan-rules.js";
import type { BasisRef, ToolSpec } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

// ───── 상수 ─────
const WORK_KINDS = ["civil", "building", "specialty"];
const EXEMPT_KINDS = ["nuclear", "landscaping", "demolition"];
const CM_GUIDELINE = "건설공사 사업관리방식 검토기준 및 업무수행지침";

/** 구분을 잘못 읽기 쉬운 곳 — 별표 5 의 특급·고급 요건은 제1호·제2호 공사로 한정된다 */
const GRADE_SCOPE_NOTE =
  "특급·고급 구분은 시행령 제89조제1항제1호·제2호에 따라 품질관리계획을 수립해야 하는 공사만 해당합니다(시행규칙 별표 5). 계약에 따라 품질관리계획을 수립하는 공사(같은 항 제3호)는 이 두 구분의 요건에 들어 있지 않습니다 — 계약에 품질관리계획이 있다는 이유만으로 고급이 되지 않습니다.";

export const spec: ToolSpec = {
  name: "compile_qc_assignment_notice_references",
  description:
    "품질관리 건설기술인 배치 문서 작성 1건에 필요한 재료 패키지를 반환한다 — 양식 스키마 + 시행규칙 별표 5 배치기준 원문(대상공사 구분·시험실 규모·건설기술인 구성) + 입력한 공사 조건에 대한 구분 판정 + 제출 경로 근거. " +
    "입력이 모자라면 판정하지 않고 필요한 입력을 알려 준다. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]",
  inputSchema: {
    type: "object",
    properties: {
      noticeType: { type: "string", description: "문서 구분: initial(최초) / change(변경) / replacement(교체) / withdrawal(철수)" },
      totalContractValue: { type: "number", description: "총공사비(원) — 관급자재비 포함, 보상비 제외" },
      workKind: { type: "string", enum: WORK_KINDS, description: "공사 종류: civil(토목) / building(건축) / specialty(전문)" },
      floorArea: { type: "number", description: "연면적(㎡)" },
      multiUse: { type: "boolean", description: "건축법 시행령 제2조제17호의 다중이용 건축물인가" },
      cmSupervised: { type: "boolean", description: "감독 권한대행 등 건설사업관리 대상 공사인가" },
      contractRequiresQualityPlan: { type: "boolean", description: "계약에 품질관리계획을 수립하도록 되어 있는가" },
      exempt: { type: "string", enum: EXEMPT_KINDS, description: "계획을 수립하지 않을 수 있는 공사: nuclear(원자력시설) / landscaping(조경식재) / demolition(철거)" },
    },
  },
};

export interface CompileQcAssignmentArgs {
  noticeType?: "initial" | "change" | "replacement" | "withdrawal";
  totalContractValue?: number;
  workKind?: ProjectFacts["workKind"];
  floorArea?: number;
  multiUse?: boolean;
  cmSupervised?: boolean;
  contractRequiresQualityPlan?: boolean;
  exempt?: ProjectFacts["exempt"];
}

export function run(args: CompileQcAssignmentArgs, graph: OntologyGraph) {
  const { noticeType, totalContractValue, ...rest } = args ?? {};
  const schema = getSchema("qc_assignment_notice");
  const facts: ProjectFacts = { ...rest, ...(totalContractValue !== undefined ? { totalCost: totalContractValue } : {}) };

  const standard = staffingStandard();
  const target = judgePlanTarget(facts);
  const grade = judgeStaffingGrade(facts);

  // 제출 경로 — 법령에 "배치 신고서"라는 서식은 없다. 근거 문장은 원문에서 가져온다.
  const submission = {
    note:
      "건설기술 진흥법령에는 품질관리 건설기술인의 배치 신고 조항과 전용 서식이 없습니다. 배치 내용은 아래 문서로 발주자 쪽에 전달됩니다. 이 양식은 그 내용을 정리하는 실무 문서입니다.",
    routes: [
      { what: "착공신고서에 첨부하는 현장기술인 지정신고서", ...cite({ law: CM_GUIDELINE, article: "82", quote: "현장기술인 지정신고서(현장관리조직, 현장대리인, 품질관리자, 안전관리자, 보건관리자)" }) },
      { what: "착공신고서 검토 때 품질관리자의 적격 여부를 보는 기준", ...cite({ law: CM_GUIDELINE, article: "82", quote: "품질관리자 : 규칙 제50조" }) },
      { what: "품질시험계획에 넣는 건설기술인 배치계획", ...cite({ law: "건설기술 진흥법 시행령", annex: "별표 9", quote: "품질관리를 수행하는 건설기술인 배치계획" }) },
      { what: "배치 내용이 바뀌면 — 계획 변경도 검토·확인과 승인을 받는다", ...cite({ law: "건설기술 진흥법 시행령", article: "90", quote: "품질관리계획 또는 품질시험계획의 내용을 변경하는 경우에도 또한 같다" }) },
    ],
  };

  const basisIds = ["standard.law.btia_rule_50", "standard.law.btia_decree_89", "standard.law.btia_decree_91"];
  const basis: BasisRef[] = basisIds.filter((id) => graph.get(id)).map((id) => ({ type: "law", id, priority: 1 }));

  return buildResponse(
    "compile_qc_assignment_notice_references",
    graph.version,
    {
      noticeType: noticeType ?? "unspecified",
      totalContractValue: totalContractValue ?? null,
      formSchema: schema,
      staffingStandard: standard,
      planTarget: {
        qualityPlan: target.qualityPlan,
        testPlan: target.testPlan,
        conclusion: target.conclusion,
        grounds: target.grounds,
        caveats: target.caveats,
      },
      gradeJudgement: {
        grade: grade.grade,
        conclusion: grade.conclusion,
        scopeNote: GRADE_SCOPE_NOTE,
        requirement: grade.row,
        candidates: grade.candidates,
        missingInputs: grade.missingInputs,
      },
      submission,
      complianceChecklist: [
        "배치하는 건설기술인이 법 제21조제1항에 따른 신고를 마치고 품질관리 업무를 수행하는 사람인지 확인 (별표 5 비고 1)",
        "건설기술인의 등급을 시행령 별표 1에 따라 산정된 등급으로 기재 (별표 5 비고 1)",
        "대상공사 구분에 맞는 인원 구성과 품질관리 경력 연수 충족 여부 확인 (별표 5)",
        "시험실 규모와 시험·검사장비가 대상공사 구분의 기준을 충족하는지 확인 (별표 5)",
        "발주청 또는 인·허가기관의 장이 시험실 규모·인력을 조정한 경우 그 내용 기재 (별표 5 비고 2)",
        "자격증·경력사항 확인서 사본 첨부 (사업관리지침 제82조제3항제6호)",
      ],
      usage:
        "이 패키지로 양식의 각 항목을 채운다. 대상공사 구분은 gradeJudgement 를 따르되, missingInputs 가 있으면 그 입력을 확인한 뒤 다시 판정한다. 최종 확인은 공사감독자·건설사업관리기술인과 발주자.",
    },
    mergeBasis(basis, schemaLegalBasisRefs(graph, "qc_assignment_notice")),
  );
}
