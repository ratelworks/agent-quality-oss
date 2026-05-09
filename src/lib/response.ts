// ─────────────────────────────────────────────────────────────────────────────
// response.ts — quality-oss ToolResponse 빌더 (lib 표준 위치).
//
// 기존 src/tools/_response.ts 의 buildResponse·annotateResponse·canonicalize 등을
// lib/ 표준 경로로 재노출한다. _schema-factory 등 기존 사용처 호환을 위해
// _response.ts는 잠시 유지(re-export)되며, 신규 도구는 이 파일에서 import 한다.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID, createHash } from "node:crypto";
import { LEGAL_NOTE, SOURCE_STATUS_RANK } from "../config/constants.js";
import type {
  BasisRef,
  HumanCheckpoint,
  Lineage,
  NextStepHint,
  SourceStatusSummary,
  ToolResponse,
} from "./types.js";
import type { OntologyGraph } from "../ontology/graph.js";
import type { SourceStatus } from "../config/constants.js";

// ───── entity meta 에서 sourceStatus 안전 추출 ─────
function readEntityStatus(meta: unknown): SourceStatus {
  if (!meta || typeof meta !== "object") return "unknown";
  const v = (meta as Record<string, unknown>)["sourceStatus"];
  if (v === "verified" || v === "indirect_source" || v === "skeleton") return v;
  return "unknown";
}

// ───── basis[] → SourceStatusSummary ─────
function summarizeStatus(basis: BasisRef[]): SourceStatusSummary {
  const counts: Record<SourceStatus, number> = {
    verified: 0,
    indirect_source: 0,
    skeleton: 0,
    unknown: 0,
  };
  let worst: SourceStatus = "verified";
  const warnings: string[] = [];
  for (const b of basis) {
    const s: SourceStatus = b.sourceStatus ?? "unknown";
    counts[s]++;
    if (SOURCE_STATUS_RANK[s] < SOURCE_STATUS_RANK[worst]) worst = s;
    if (s === "skeleton")
      warnings.push(`skeleton 근거: ${b.id} — 출처 미확정. 재인용 금지.`);
    else if (s === "indirect_source")
      warnings.push(
        `indirect_source 근거: ${b.id} — 호수·발행기관 검증 미완. 인용 시 검증 필요.`,
      );
  }
  return { worst, counts, warnings };
}

// ───── stable JSON canonicalize (contentHash 결정론) ─────
//
// undefined 처리는 JSON.stringify 의미를 따른다:
//   - 객체 키 값 undefined·function·symbol → 키 자체 omit
//   - 배열 요소 undefined·function·symbol → null로 직렬화
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") {
    if (
      typeof value === "function" ||
      typeof value === "symbol" ||
      typeof value === "undefined"
    ) {
      return "null";
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const parts = value.map((v) =>
      v === undefined ||
      typeof v === "function" ||
      typeof v === "symbol"
        ? "null"
        : canonicalize(v),
    );
    return "[" + parts.join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => {
      const val = obj[k];
      return val !== undefined && typeof val !== "function" && typeof val !== "symbol";
    })
    .sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") +
    "}"
  );
}

// ───── basis 보강 ─────
export function entityBasis(entityIds: string[], priority = 2): BasisRef[] {
  return entityIds.map((id) => ({ type: "ontology", id, priority }));
}

/**
 * graph 인자를 받아 entity meta.sourceStatus를 자동 주입.
 */
export function entityBasisWithStatus(
  graph: OntologyGraph,
  entityIds: string[],
  priority = 2,
): BasisRef[] {
  return entityIds.map((id) => {
    const e = graph.get(id);
    return {
      type: "ontology",
      id,
      priority,
      sourceStatus: readEntityStatus(e?.meta),
    };
  });
}

/**
 * 외부 호출자가 임의 BasisRef[]를 만든 뒤 graph에서 sourceStatus를
 * 일괄 주입할 때 사용. id 기반 entity만 보강하고 사용자 지정 sourceStatus는 보존.
 */
export function annotateBasisWithStatus(
  graph: OntologyGraph,
  basis: BasisRef[],
): BasisRef[] {
  return basis.map((b) => {
    if (b.sourceStatus) return b;
    const e = graph.get(b.id);
    if (!e) return b;
    return { ...b, sourceStatus: readEntityStatus(e.meta) };
  });
}

// ───── 도구별 기본 nextSteps (korean-law-mcp 패턴) ─────
// 명시적 nextSteps 미지정 시 자동 첨부. 신규 도구는 자기 nextSteps를 직접 제공 권장.
const DEFAULT_NEXT_STEPS: Record<string, NextStepHint[]> = {
  search_quality_ontology: [
    { tool: "get_work_quality_profile", reason: "특정 공종을 선택해 도메인 프로파일 전체 조회" },
  ],
  resolve_worktype: [
    { tool: "get_work_quality_profile", reason: "해석된 공종의 자재·시험·검측·리스크 프로파일" },
  ],
  list_core_quality_laws: [
    { tool: "get_quality_law_article", reason: "특정 조항의 적용 범위 조회" },
  ],
  search_construction_standards: [
    { tool: "verify_form_reference", reason: "특정 KCS 섹션 인용 명칭 검증" },
  ],
  get_standard_form_locator: [
    { tool: "verify_form_reference", reason: "서식 명칭·시행일 정확성 교차 검증" },
  ],
  evaluate_observation: [
    { tool: "compile_ncr_references", reason: "FAIL 판정 시 NCR 작성 재료 수집" },
  ],
  infer_quality_risks: [
    { tool: "compile_concrete_pour_references", reason: "도메인 재료 종합 수집" },
  ],
  map_quality_basis: [
    { tool: "verify_quality_basis", reason: "LLM 생성문 근거 인용 검증" },
  ],
  compile_concrete_pour_references: [
    { tool: "evaluate_observation", reason: "시험 관측값 들어오면 expert assessment" },
  ],
  compile_inspection_references: [
    { tool: "get_itp_schema", reason: "ITP 양식 필드 조회" },
  ],
  compile_ncr_references: [{ tool: "verify_quality_basis", reason: "NCR 초안 인용 검증" }],
  discover_relevant_domain: [
    { tool: "list_core_quality_laws", reason: "관련 법령 목록" },
    { tool: "get_standard_form_locator", reason: "관련 법정 별지·서식 카탈로그" },
  ],
  explain_quality_decision_path: [
    { tool: "verify_quality_basis", reason: "결정 경로의 인용 근거 검증" },
  ],
};

function defaultNextSteps(toolName: string): NextStepHint[] {
  return DEFAULT_NEXT_STEPS[toolName] ?? [];
}

// ───── 핵심 응답 빌더 ─────
export function buildResponse<T>(
  toolName: string,
  ontologyVersion: string,
  result: T,
  basis: BasisRef[] = [],
  humanCheckpoint?: HumanCheckpoint,
  nextSteps?: NextStepHint[],
  /** graph 전달 시 basis 누락 sourceStatus를 entity meta에서 자동 주입. */
  graph?: OntologyGraph,
): ToolResponse<T> {
  if (!Array.isArray(basis) || basis.length === 0) {
    throw new Error(
      `Tool ${toolName}: basis[]가 비어 있어 응답할 수 없습니다 (환각 방지 규칙).`,
    );
  }
  const toolCallId = randomUUID();
  const generatedAt = new Date().toISOString();
  const hc: HumanCheckpoint = humanCheckpoint ?? { required: false, reason: null };
  const humanCheckpointWithNote: HumanCheckpoint = { ...hc, legalNote: LEGAL_NOTE };

  // 명시적 nextSteps 미지정 시 도구별 기본 hint 적용 (기존 동작 보존)
  const hints = nextSteps ?? defaultNextSteps(toolName);

  const annotatedBasis = graph ? annotateBasisWithStatus(graph, basis) : basis;
  const sourceStatusSummary = summarizeStatus(annotatedBasis);

  const payload = {
    result,
    basis: annotatedBasis,
    humanCheckpoint: humanCheckpointWithNote,
    nextSteps: hints,
    sourceStatusSummary,
  };
  const contentHash = createHash("sha256").update(canonicalize(payload)).digest("hex");

  const lineage: Lineage = {
    toolName,
    toolCallId,
    ontologyVersion,
    generatedAt,
    contentHashAlgo: "sha256",
    contentHash,
  };

  return { ...payload, lineage };
}

// ───── 라우터 후처리: basis 일괄 annotate + sourceStatusSummary·contentHash 재계산 ─────
export function annotateResponse<T>(
  graph: OntologyGraph,
  response: ToolResponse<T>,
): ToolResponse<T> {
  const annotatedBasis = annotateBasisWithStatus(graph, response.basis);
  const sourceStatusSummary = summarizeStatus(annotatedBasis);
  const basisChanged = annotatedBasis.some((b, i) => b !== response.basis[i]);
  const summaryChanged =
    JSON.stringify(sourceStatusSummary) !== JSON.stringify(response.sourceStatusSummary);
  if (!basisChanged && !summaryChanged) return response;
  const payload = {
    result: response.result,
    basis: annotatedBasis,
    humanCheckpoint: response.humanCheckpoint,
    nextSteps: response.nextSteps,
    sourceStatusSummary,
  };
  const contentHash = createHash("sha256").update(canonicalize(payload)).digest("hex");
  return {
    ...payload,
    lineage: { ...response.lineage, contentHash },
  };
}
