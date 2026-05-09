// ─────────────────────────────────────────────────────────────────────────────
// mcp/types.ts — DEPRECATED shim. lib/types.ts가 표준 위치.
// 기존 도구의 import 경로 호환을 위해 type을 그대로 re-export.
// 신규 도구는 ../lib/types.js 에서 직접 import 할 것.
// ─────────────────────────────────────────────────────────────────────────────

export type {
  BasisRef,
  HumanCheckpoint,
  Lineage,
  NextStepHint,
  SourceStatusSummary,
  ToolResponse,
  ToolInputSchema,
  ToolDefinition,
  ToolContext,
} from "../lib/types.js";

// ───── Legacy 별칭 (33개 도구가 사용 중인 이름 호환) ─────
export type { ToolModuleLegacy as ToolModule, ToolSpecLegacy as ToolSpec } from "../lib/types.js";
import type { ToolModuleLegacy } from "../lib/types.js";
export type ToolRun = ToolModuleLegacy["run"];

// SourceStatus는 config/constants 가 SSoT
export type { SourceStatus } from "../config/constants.js";
