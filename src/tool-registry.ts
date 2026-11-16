// ─────────────────────────────────────────────────────────────────────────────
// tool-registry.ts — 도구의 단일 등록 지점 (도구 수는 TOOL_MODULES 길이로 정해진다).
//
// 도구 파일은 spec(이름·설명·입력 형식 JSON Schema)과 run(args, graph)을 내보낸다.
// 이 모듈이 주의 표시 기본값을 붙여 ToolDefinition 으로 묶고, stdio·HTTP·명령줄·
// 브라우저 폼은 여기의 TOOL_DEFS·TOOL_MAP·callTool 만 쓴다.
// 입력은 callTool 에서 공개한 형식대로 검사한다(lib/input-schema).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ToolAnnotations,
  ToolContext,
  ToolDefinition,
  ToolModule,
  ToolResponse,
  ToolSpec,
} from "./lib/types.js";
import { ERROR_CODES, QualityMcpError } from "./lib/errors.js";
import { assertValidInput } from "./lib/input-schema.js";
import { annotateResponse } from "./lib/response.js";

// ───── 모든 도구 import ─────
import * as searchQualityOntology from "./tools/search-quality-ontology.js";
import * as resolveWorktype from "./tools/resolve-worktype.js";
import * as getWorkQualityProfile from "./tools/get-work-quality-profile.js";
import * as getMaterialQualityProfile from "./tools/get-material-quality-profile.js";
import * as inferQualityRisks from "./tools/infer-quality-risks.js";
import * as mapQualityBasis from "./tools/map-quality-basis.js";
import * as listCoreQualityLaws from "./tools/list-core-quality-laws.js";
import * as getQualityLawArticle from "./tools/get-quality-law-article.js";
import * as searchQualityTestStandards from "./tools/search-quality-test-standards.js";
import * as searchQualityManagementGuideline from "./tools/search-quality-management-guideline.js";
import * as getQualityGuidelineArticle from "./tools/get-quality-guideline-article.js";
import * as searchConstructionStandards from "./tools/search-construction-standards.js";
import * as getStandardFormLocator from "./tools/get-standard-form-locator.js";
import * as getNcrSchema from "./tools/get-ncr-schema.js";
import * as getConcreteDeliveryRecordSchema from "./tools/get-concrete-delivery-record-schema.js";
import * as getSpecimenRecordSchema from "./tools/get-specimen-record-schema.js";
import * as getItpSchema from "./tools/get-itp-schema.js";
import * as getTestReportReviewSchema from "./tools/get-test-report-review-schema.js";
import * as getQcAssignmentNoticeSchema from "./tools/get-qc-assignment-notice-schema.js";
import * as getQualityTestPlanSchema from "./tools/get-quality-test-plan-schema.js";
import * as getQualityInspectionRegisterSchema from "./tools/get-quality-inspection-register-schema.js";
import * as getInspectionRequestSchema from "./tools/get-inspection-request-schema.js";
import * as getQualityPlanSchema from "./tools/get-quality-plan-schema.js";
import * as getQualityInspectionSummarySchema from "./tools/get-quality-inspection-summary-schema.js";
import * as getNcCorrectiveResultSchema from "./tools/get-nc-corrective-result-schema.js";
import * as getQualityInspectionReportSchema from "./tools/get-quality-inspection-report-schema.js";
import * as getTestRequestSchema from "./tools/get-test-request-schema.js";
import * as getInspectionChecklistSchema from "./tools/get-inspection-checklist-schema.js";
import * as getMaterialSourceApprovalSchema from "./tools/get-material-source-approval-schema.js";
import * as getQualityDailyLogSchema from "./tools/get-quality-daily-log-schema.js";
import * as getCorrectiveActionRequestSchema from "./tools/get-corrective-action-request-schema.js";
import * as getQualityAuditReportSchema from "./tools/get-quality-audit-report-schema.js";
import * as compileConcretePourReferences from "./tools/compile-concrete-pour-references.js";
import * as compileInspectionReferences from "./tools/compile-inspection-references.js";
import * as compileNcrReferences from "./tools/compile-ncr-references.js";
import * as compileQcAssignmentNoticeReferences from "./tools/compile-qc-assignment-notice-references.js";
import * as compileQualityTestPlanReferences from "./tools/compile-quality-test-plan-references.js";
import * as compileQualityInspectionRegisterReferences from "./tools/compile-quality-inspection-register-references.js";
import * as compileInspectionRequestReferences from "./tools/compile-inspection-request-references.js";
import * as evaluateObservation from "./tools/evaluate-observation.js";
import * as verifyQualityBasis from "./tools/verify-quality-basis.js";
import * as getProjectInfo from "./tools/get-project-info.js";
import * as discoverRelevantDomain from "./tools/discover-relevant-domain.js";
import * as explainQualityDecisionPath from "./tools/explain-quality-decision-path.js";
import * as verifyFormReference from "./tools/verify-form-reference.js";
import * as renderQualityForm from "./tools/render-quality-form.js";
import * as composeWritingContext from "./tools/compose-writing-context.js";
import * as compileDocumentReferences from "./tools/compile-document-references.js";
import * as chainQualityInspection from "./tools/chain-quality-inspection.js";
import * as chainQualityTestPlan from "./tools/chain-quality-test-plan.js";
import * as chainTestReportReview from "./tools/chain-test-report-review.js";
import * as chainNonconformanceReport from "./tools/chain-nonconformance-report.js";
import * as chainDailyQualityBriefing from "./tools/chain-daily-quality-briefing.js";

// ───── 상수 ─────
/**
 * 주의 표시 기본값 — 내장 자료를 읽어 답을 돌려줄 뿐, 아무것도 바꾸지 않고
 * 이 컴퓨터 밖과 통신하지 않는다. 파일을 쓰는 도구는 spec.annotations 로 따로 밝힌다.
 */
const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

// ───── 등록 도구 목록 ─────
// scripts/* 와 외부 코드가 직접 import 할 수 있게 export 한다.
export const TOOL_MODULES: ToolModule[] = [
  searchQualityOntology,
  resolveWorktype,
  getWorkQualityProfile,
  getMaterialQualityProfile,
  inferQualityRisks,
  mapQualityBasis,
  listCoreQualityLaws,
  getQualityLawArticle,
  searchQualityTestStandards,
  searchQualityManagementGuideline,
  getQualityGuidelineArticle,
  searchConstructionStandards,
  getStandardFormLocator,
  getNcrSchema,
  getConcreteDeliveryRecordSchema,
  getSpecimenRecordSchema,
  getItpSchema,
  getTestReportReviewSchema,
  getQcAssignmentNoticeSchema,
  getQualityTestPlanSchema,
  getQualityInspectionRegisterSchema,
  getInspectionRequestSchema,
  getQualityPlanSchema,
  getQualityInspectionSummarySchema,
  getNcCorrectiveResultSchema,
  getQualityInspectionReportSchema,
  getTestRequestSchema,
  getInspectionChecklistSchema,
  getMaterialSourceApprovalSchema,
  getQualityDailyLogSchema,
  getCorrectiveActionRequestSchema,
  getQualityAuditReportSchema,
  compileConcretePourReferences,
  compileInspectionReferences,
  compileNcrReferences,
  compileQcAssignmentNoticeReferences,
  compileQualityTestPlanReferences,
  compileQualityInspectionRegisterReferences,
  compileInspectionRequestReferences,
  compileDocumentReferences,
  chainQualityInspection,
  chainQualityTestPlan,
  chainTestReportReview,
  chainNonconformanceReport,
  chainDailyQualityBriefing,
  evaluateObservation,
  verifyQualityBasis,
  getProjectInfo,
  discoverRelevantDomain,
  explainQualityDecisionPath,
  verifyFormReference,
  renderQualityForm,
  composeWritingContext,
];

function toDefinition(mod: ToolModule): ToolDefinition {
  return {
    name: mod.spec.name,
    description: mod.spec.description,
    inputSchema: mod.spec.inputSchema,
    annotations: mod.spec.annotations ?? READ_ONLY_ANNOTATIONS,
    run: (args, ctx) => mod.run(args, ctx.graph),
  };
}

export const TOOL_DEFS: ToolDefinition[] = TOOL_MODULES.map(toDefinition);

export const TOOL_MAP: Map<string, ToolDefinition> = new Map(TOOL_DEFS.map((t) => [t.name, t]));

/** 입력 검사 없이 도구 본체를 직접 부를 때 쓴다(회귀 시험·감사 스크립트). */
export const TOOL_MODULE_MAP: Map<string, ToolModule> = new Map(
  TOOL_MODULES.map((m) => [m.spec.name, m]),
);

/** 도구 목록 응답(tools/list)에 싣는 이름·설명·입력 형식·주의 표시 */
export function getToolSpecs(): Required<ToolSpec>[] {
  return TOOL_DEFS.map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    annotations: def.annotations,
  }));
}

export function findTool(name: string): ToolDefinition | undefined {
  return TOOL_MAP.get(name);
}

// ───── 도구 실행 (stdio·HTTP·명령줄·브라우저 폼 공용) ─────
export async function callTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<ToolResponse> {
  const tool = findTool(name);
  if (!tool) {
    throw new QualityMcpError(ERROR_CODES.UNKNOWN_TOOL, `unknown tool: ${name}`);
  }
  const args = assertValidInput(tool.name, tool.inputSchema, input);
  const response = tool.run(args, ctx);
  // 근거마다 출처 검증 상태를 붙이고 요약·해시를 다시 계산한다
  return annotateResponse(ctx.graph, response);
}
