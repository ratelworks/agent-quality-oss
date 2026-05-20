// ─────────────────────────────────────────────────────────────────────────────
// types.ts — quality-oss MCP Tool 공통 타입.
//
// 본 OSS의 본질 contract는 ToolResponse:
//   { result, basis, humanCheckpoint, lineage, nextSteps?, sourceStatusSummary }
//
// safety-oss와의 차이:
//   - safety: McpToolResult { content, structuredContent } — MCP SDK 기본
//   - quality: ToolResponse — 근거(basis) + lineage(contentHash) + sourceStatus 요약을
//              LLM에게 강제로 노출. 환각 방지 + 인용 검증의 contract.
// ─────────────────────────────────────────────────────────────────────────────

import type { z } from "zod";
import type { OntologyGraph } from "../ontology/graph.js";
import type { SourceStatus, BasisType } from "../config/constants.js";

// ───── 근거 단위 ─────
export interface BasisRef {
  type: BasisType | string;
  id: string;
  priority?: number;
  section?: string;
  note?: string;
  /**
   * R0-G3: 근거 출처 검증 상태 라벨.
   * - verified         : 본문 1:1 대조 완료 (evaluation/sources)
   * - indirect_source  : 간접 인용 (호수·발행기관 검증 미완)
   * - skeleton         : 출처 미확정 — LLM에게 재인용 금지 신호
   * - unknown          : 라벨 미지정 (점진 마이그레이션 대상)
   */
  sourceStatus?: SourceStatus;
  [key: string]: unknown;
}

// ───── 응답 sourceStatus 요약 ─────
export interface SourceStatusSummary {
  worst: SourceStatus;
  counts: Record<SourceStatus, number>;
  warnings: string[];
}

// ───── 사람 검토 게이트 ─────
export interface HumanCheckpoint {
  required: boolean;
  reason?: string | null;
  a2ui?: { type: string; options?: string[] } | null;
  legalNote?: string;
}

// ───── 결정론적 lineage (contentHash로 재현성 검증) ─────
export interface Lineage {
  toolName: string;
  toolCallId: string;
  ontologyVersion: string;
  generatedAt: string;
  contentHashAlgo: "sha256";
  contentHash: string;
}

// ───── 다음 조회 hint (korean-law-mcp 패턴 차용) ─────
export interface NextStepHint {
  tool: string;
  args?: Record<string, unknown>;
  reason: string;
}

// ───── 핵심 Tool 응답 ─────
export interface ToolResponse<T = unknown> {
  result: T;
  basis: BasisRef[];
  humanCheckpoint: HumanCheckpoint;
  lineage: Lineage;
  nextSteps?: NextStepHint[];
  sourceStatusSummary: SourceStatusSummary;
}

// ───── MCP Tool input schema (raw JSON Schema subset, MCP wire format) ─────
export interface ToolInputSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

// ───── Tool 등록 단위 ─────
// safety의 ToolDefinition + quality의 graph 의존성을 결합.
// inputSchema는 zod (런타임 검증 + 타입 추론). MCP wire는 zod-to-json-schema로 파생.
export interface ToolContext {
  graph: OntologyGraph;
}

export interface ToolDefinition<TInput = unknown, TResult = unknown> {
  name: string;
  title?: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  /**
   * 내부 호출 표준 — input은 zod parse 이전의 unknown.
   * tool-registry가 zod parse 후 ctx와 함께 호출.
   */
  run: (input: TInput, ctx: ToolContext) => ToolResponse<TResult> | Promise<ToolResponse<TResult>>;
}

// ───── Legacy ToolModule 호환 (마이그레이션 기간 동안만 유지) ─────
// 기존 mcp/registry.ts가 사용하던 형태. 새 도구는 ToolDefinition 사용 권장.
//
// args를 any로 둔 이유: 33개 기존 도구가 각기 다른 좁은 args 타입(예: SearchArgs)으로
// 정의되어 invariant 매개변수 위치에서 Record<string, unknown>과 호환되지 않는다.
// 마이그레이션 도중 호환을 유지하기 위해 의도적으로 any 허용.
// 기존 33개 도구가 모두 동기 반환이므로 sync로 좁힌다.
// 외부에서 Promise를 반환하는 legacy 도구가 추가되면 그때 union으로 확장.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolRunLegacy = (args: any, graph: OntologyGraph) => ToolResponse;

export interface ToolSpecLegacy {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

export interface ToolModuleLegacy {
  spec: ToolSpecLegacy;
  run: ToolRunLegacy;
}

// ───── Legacy 이름 alias (33개 도구 호환) ─────
// mcp/types.ts 가 제공하던 짧은 이름을 lib/types 에서 동일하게 노출한다.
// 도구 코드는 ToolSpec / ToolModule 짧은 이름으로 import 가능.
export type ToolSpec = ToolSpecLegacy;
export type ToolModule = ToolModuleLegacy;
