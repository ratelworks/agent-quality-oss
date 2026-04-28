/**
 * MCP Tool 공통 타입.
 */

import type { OntologyGraph } from '../ontology/graph.js';

export type SourceStatus = 'verified' | 'indirect_source' | 'skeleton' | 'unknown';

export interface BasisRef {
  type: string;
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

/**
 * R0-G3: 응답 전체의 근거 검증 상태 요약. 가장 약한 등급(worst)이
 * skeleton이면 LLM·소비자가 즉시 식별 가능하도록 visible 영역에 강제 노출.
 */
export interface SourceStatusSummary {
  worst: SourceStatus;
  counts: Record<SourceStatus, number>;
  warnings: string[];
}

export interface HumanCheckpoint {
  required: boolean;
  reason?: string | null;
  a2ui?: { type: string; options?: string[] } | null;
  legalNote?: string;
}

export interface Lineage {
  toolName: string;
  toolCallId: string;
  ontologyVersion: string;
  generatedAt: string;
  contentHashAlgo: 'sha256';
  contentHash: string;
}

/** 응답 끝의 "💡 다음 조회" hint (korean-law-mcp 패턴 차용) */
export interface NextStepHint {
  tool: string;
  args?: Record<string, unknown>;
  reason: string;
}

export interface ToolResponse<T = unknown> {
  result: T;
  basis: BasisRef[];
  humanCheckpoint: HumanCheckpoint;
  lineage: Lineage;
  nextSteps?: NextStepHint[];
  /** R0-G3: 응답 전체의 근거 검증 상태 요약. */
  sourceStatusSummary: SourceStatusSummary;
}

/** MCP Tool input schema (JSON Schema subset) */
export interface ToolInputSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

/** run: args + graph → response */
export type ToolRun = (args: any, graph: OntologyGraph) => ToolResponse;

export interface ToolModule {
  spec: ToolSpec;
  run: ToolRun;
}
