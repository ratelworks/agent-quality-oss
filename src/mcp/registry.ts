// ─────────────────────────────────────────────────────────────────────────────
// mcp/registry.ts — DEPRECATED shim. ../tool-registry.ts가 표준 위치.
//
// scripts/* 가 사용하던 legacy 인터페이스(TOOLS / TOOL_MAP은 ToolModuleLegacy)
// 를 보존한다. 신규 라우터·CLI는 ../tool-registry.js 의 TOOL_DEFS·TOOL_MAP을
// 사용한다 (각각 ToolDefinition 형태).
// ─────────────────────────────────────────────────────────────────────────────

import { LEGACY_MODULES } from "../tool-registry.js";
import type { ToolModuleLegacy, ToolSpecLegacy } from "../lib/types.js";

export const TOOLS: ToolModuleLegacy[] = LEGACY_MODULES;
export const TOOL_MAP: Map<string, ToolModuleLegacy> = new Map(
  LEGACY_MODULES.map((m) => [m.spec.name, m]),
);

export function getToolSpecs(): ToolSpecLegacy[] {
  return LEGACY_MODULES.map((m) => m.spec);
}

// 신규 코드는 ../tool-registry.js 의 callTool/findTool 사용 권장.
export { callTool, findTool } from "../tool-registry.js";
