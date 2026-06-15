// ─────────────────────────────────────────────────────────────────────────────
// tool-registry.ts — 33개 quality-oss 도구의 단일 등록 지점.
//
// 두 가지 등록 형태를 지원한다:
//   1) ToolDefinition (신규, zod inputSchema + run(input, ctx)) — 권장
//   2) ToolModuleLegacy (기존, JSON Schema raw + run(args, graph)) — 점진 마이그레이션
//
// 라우터(mcp/stdio·http, cli)는 본 모듈의 TOOL_DEFS·TOOL_MAP 만을 신뢰한다.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import type {
  ToolDefinition,
  ToolModuleLegacy,
  ToolSpecLegacy,
  ToolContext,
  ToolResponse,
} from "./lib/types.js";
import { zodToMcpInputSchema } from "./lib/json-schema.js";

// ───── 모든 도구 import (legacy 형태) ─────
// 마이그레이션 진행에 따라 순차적으로 ToolDefinition 형태로 교체된다.
import * as searchQualityOntology from "./tools/search-quality-ontology.js";
import * as resolveWorktype from "./tools/resolve-worktype.js";
import * as getWorkQualityProfile from "./tools/get-work-quality-profile.js";
import * as getMaterialQualityProfile from "./tools/get-material-quality-profile.js";
import * as inferQualityRisks from "./tools/infer-quality-risks.js";
import * as mapQualityBasis from "./tools/map-quality-basis.js";
import * as listCoreQualityLaws from "./tools/list-core-quality-laws.js";
import * as getQualityLawArticle from "./tools/get-quality-law-article.js";
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

// ───── Legacy module 목록 (기존 ToolModule 인터페이스) ─────
// scripts/* 와 외부 도구가 직접 import 가능하도록 export 유지.
export const LEGACY_MODULES: ToolModuleLegacy[] = [
  searchQualityOntology,
  resolveWorktype,
  getWorkQualityProfile,
  getMaterialQualityProfile,
  inferQualityRisks,
  mapQualityBasis,
  listCoreQualityLaws,
  getQualityLawArticle,
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
  compileConcretePourReferences,
  compileInspectionReferences,
  compileNcrReferences,
  compileQcAssignmentNoticeReferences,
  compileQualityTestPlanReferences,
  compileQualityInspectionRegisterReferences,
  compileInspectionRequestReferences,
  evaluateObservation,
  verifyQualityBasis,
  getProjectInfo,
  discoverRelevantDomain,
  explainQualityDecisionPath,
  verifyFormReference,
  renderQualityForm,
  composeWritingContext,
];

// ───── Legacy ToolModule → ToolDefinition 어댑터 ─────
//
// JSON Schema raw inputSchema는 무손실 zod 변환이 어려우므로 z.unknown()을 사용해
// 검증을 도구 본체에 위임한다 (기존과 동작 동일). 마이그레이션 완료 시 도구별로
// 명시 zod 스키마로 교체한다.
function adaptLegacy(mod: ToolModuleLegacy): ToolDefinition {
  return {
    name: mod.spec.name,
    description: mod.spec.description,
    inputSchema: z.unknown(),
    run: (input: unknown, ctx: ToolContext): ToolResponse | Promise<ToolResponse> => {
      const args = (typeof input === "object" && input !== null
        ? (input as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      return mod.run(args, ctx.graph);
    },
  };
}

// ───── 신규 ToolDefinition 직접 등록 (명시 zod 스키마) ─────
// 마이그레이션이 진행되면 LEGACY_MODULES에서 빠지고 이 배열에 추가된다.
const NEW_DEFINITIONS: ToolDefinition[] = [];

// ───── 통합 TOOL_DEFS ─────
export const TOOL_DEFS: ToolDefinition[] = [
  ...LEGACY_MODULES.map(adaptLegacy),
  ...NEW_DEFINITIONS,
];

export const TOOL_MAP: Map<string, ToolDefinition> = new Map(
  TOOL_DEFS.map((t) => [t.name, t]),
);

// ───── Legacy TOOL_MAP (scripts/* 호환용) ─────
// 신규 라우터·CLI는 위의 TOOL_MAP (ToolDefinition) 을 사용한다.
// scripts/_dogfood-*, audit-ontology, smoke-test 등은 legacy m.spec/m.run 패턴이
// 박혀 있어 ToolModuleLegacy 형태를 그대로 노출한다.
export const LEGACY_TOOL_MAP: Map<string, ToolModuleLegacy> = new Map(
  LEGACY_MODULES.map((m) => [m.spec.name, m]),
);

// ───── Legacy Spec 노출 (mcp/stdio·http 가 listTools 에서 사용) ─────
//
// 신규 도구는 zod schema → JSON Schema 자동 파생.
// Legacy 모듈은 원본 spec.inputSchema를 그대로 노출한다.
const LEGACY_SPEC_BY_NAME: Map<string, ToolSpecLegacy> = new Map(
  LEGACY_MODULES.map((m) => [m.spec.name, m.spec]),
);

export function getToolSpecs(): ToolSpecLegacy[] {
  return TOOL_DEFS.map((def) => {
    const legacy = LEGACY_SPEC_BY_NAME.get(def.name);
    if (legacy) return legacy;
    return {
      name: def.name,
      description: def.description,
      inputSchema: zodToMcpInputSchema(def.inputSchema),
    };
  });
}

export function findTool(name: string): ToolDefinition | undefined {
  return TOOL_MAP.get(name);
}

// ───── 도구 실행 헬퍼 (CLI·라우터 공용) ─────
export async function callTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<ToolResponse> {
  const tool = findTool(name);
  if (!tool) {
    throw new Error(`unknown tool: ${name}`);
  }
  // zod 검증 — legacy 어댑터는 z.unknown() 이라 그대로 통과
  const parsed = tool.inputSchema.parse(input);
  return await tool.run(parsed, ctx);
}
