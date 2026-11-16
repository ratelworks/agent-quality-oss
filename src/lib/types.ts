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
// 도구 파일은 spec(이름·설명·입력 형식)과 run(args, graph)을 내보낸다 — ToolModule.
// 등록 모듈(tool-registry)이 이를 ToolDefinition 으로 묶어 stdio·HTTP·명령줄에 준다.
// 입력 형식은 JSON Schema 가 정본이고, 호출 때 그 형식대로 검사한다(lib/input-schema).
export interface ToolContext {
  graph: OntologyGraph;
}

/**
 * MCP 도구 주의 표시. AI 비서 프로그램이 실행 전 사용자 확인을 받을지 정하는 데 쓴다.
 * 표시가 없는 도구는 읽기 전용으로 등록한다(등록 모듈의 기본값).
 */
export interface ToolAnnotations {
  /** 아무것도 바꾸지 않는다 */
  readOnlyHint?: boolean;
  /** 지우거나 덮어쓴다 */
  destructiveHint?: boolean;
  /** 같은 입력으로 여러 번 불러도 결과가 같다 */
  idempotentHint?: boolean;
  /** 이 컴퓨터 밖과 통신한다 */
  openWorldHint?: boolean;
}

// args 를 any 로 둔 이유: 도구마다 좁은 args 타입(예: SearchArgs)을 쓰는데,
// 매개변수 위치에서는 Record<string, unknown> 과 호환되지 않는다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolRun = (args: any, graph: OntologyGraph) => ToolResponse;

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations?: ToolAnnotations;
}

export interface ToolModule {
  spec: ToolSpec;
  run: ToolRun;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations: ToolAnnotations;
  /** 입력 검사를 마친 args 로 도구를 실행한다 */
  run: (args: Record<string, unknown>, ctx: ToolContext) => ToolResponse;
}

// ───── A2UI (Google Agent-UI 프로토콜) 메시지 타입 ─────
// agent-safety-oss 와 통일한 구조. render_quality_form 이 이 JSONL 배열을 반환하고,
// viewer(브라우저 폼) 또는 A2UI 호환 클라이언트가 순차 소비해 폼을 렌더한다.
// 참조: https://github.com/google/a2ui
export interface A2UIComponent {
  id: string;
  component: string;
  [key: string]: unknown;
}

export interface A2UIMessage {
  createSurface?: { surfaceId: string; catalogId: string };
  updateComponents?: {
    surfaceId: string;
    root: string;
    components: A2UIComponent[];
  };
  updateDataModel?: {
    surfaceId: string;
    op: string;
    path: string;
    value: unknown;
  };
}
