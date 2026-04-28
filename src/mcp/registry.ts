/**
 * MCP Tool registry. 모든 Tool을 한 곳에서 로드.
 */

import type { ToolModule, ToolSpec } from './types.js';

// Core ontology
import * as searchQualityOntology from '../tools/search-quality-ontology.js';
import * as resolveWorktype from '../tools/resolve-worktype.js';
import * as getWorkQualityProfile from '../tools/get-work-quality-profile.js';
import * as getMaterialQualityProfile from '../tools/get-material-quality-profile.js';
import * as inferQualityRisks from '../tools/infer-quality-risks.js';
import * as mapQualityBasis from '../tools/map-quality-basis.js';

// Legal / standards / forms
import * as listCoreQualityLaws from '../tools/list-core-quality-laws.js';
import * as getQualityLawArticle from '../tools/get-quality-law-article.js';
import * as searchQualityManagementGuideline from '../tools/search-quality-management-guideline.js';
import * as getQualityGuidelineArticle from '../tools/get-quality-guideline-article.js';
import * as searchConstructionStandards from '../tools/search-construction-standards.js';
import * as getStandardFormLocator from '../tools/get-standard-form-locator.js';

// Schemas
import * as getNcrSchema from '../tools/get-ncr-schema.js';
import * as getConcreteDeliveryRecordSchema from '../tools/get-concrete-delivery-record-schema.js';
import * as getSpecimenRecordSchema from '../tools/get-specimen-record-schema.js';
import * as getItpSchema from '../tools/get-itp-schema.js';
import * as getTestReportReviewSchema from '../tools/get-test-report-review-schema.js';
// R0+ 추가 schemas (19종 법정문서 커버 진행)
import * as getQcAssignmentNoticeSchema from '../tools/get-qc-assignment-notice-schema.js';
import * as getQualityTestPlanSchema from '../tools/get-quality-test-plan-schema.js';
import * as getQualityInspectionRegisterSchema from '../tools/get-quality-inspection-register-schema.js';
// R1 추가 schema
import * as getInspectionRequestSchema from '../tools/get-inspection-request-schema.js';

// Compile chains
import * as compileConcretePourReferences from '../tools/compile-concrete-pour-references.js';
import * as compileInspectionReferences from '../tools/compile-inspection-references.js';
import * as compileNcrReferences from '../tools/compile-ncr-references.js';
// R0+ 추가 compile chains
import * as compileQcAssignmentNoticeReferences from '../tools/compile-qc-assignment-notice-references.js';
import * as compileQualityTestPlanReferences from '../tools/compile-quality-test-plan-references.js';
import * as compileQualityInspectionRegisterReferences from '../tools/compile-quality-inspection-register-references.js';
// R1 추가 compile chain
import * as compileInspectionRequestReferences from '../tools/compile-inspection-request-references.js';

// Judgment / verification / meta
import * as evaluateObservation from '../tools/evaluate-observation.js';
import * as verifyQualityBasis from '../tools/verify-quality-basis.js';
import * as getProjectInfo from '../tools/get-project-info.js';

// Discovery + verification
import * as discoverRelevantDomain from '../tools/discover-relevant-domain.js';
import * as explainQualityDecisionPath from '../tools/explain-quality-decision-path.js';
import * as verifyFormReference from '../tools/verify-form-reference.js';

export const TOOLS: ToolModule[] = [
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
];

export const TOOL_MAP: Map<string, ToolModule> = new Map(TOOLS.map((t) => [t.spec.name, t]));

export function getToolSpecs(): ToolSpec[] {
  return TOOLS.map((t) => t.spec);
}
