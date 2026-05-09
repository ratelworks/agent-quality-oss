#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// index.ts — 라이브러리 진입점 + 직접 실행 시 stdio MCP 또는 HTTP 기동.
//
//   node build/index.js          → HTTP 서버 (PORT env, 기본 8080)
//   node build/index.js --stdio  → stdio MCP 서버 (Claude Desktop 호환)
//
// 별도 명령줄 인터페이스는 build/cli.js (commander 기반)을 사용.
// ─────────────────────────────────────────────────────────────────────────────

import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { loadOntologySync } from "./ontology/loader.js";
import { OntologyGraph } from "./ontology/graph.js";
import { validateOntology } from "./ontology/validator.js";
import { createHttpHandler } from "./mcp/http.js";
import { SERVER_NAME, VERSION } from "./version.js";

const ontologyData = loadOntologySync();
const graph = new OntologyGraph(ontologyData);
const report = validateOntology(graph);
if (!report.ok) {
  process.stderr.write(
    `[${SERVER_NAME}] 온톨로지 검증 실패 — 서버를 기동할 수 없습니다.\n` +
      report.issues
        .filter((i) => i.level === "error")
        .map((i) => `  - ${i.code} ${i.entityId ?? ""}: ${i.message}`)
        .join("\n") +
      "\n",
  );
  process.exit(1);
}

/** HTTP handler — Cloud Run/custom server에서 재사용 가능 */
export const app = createHttpHandler(graph);

// 라이브러리 사용자에게 graph·tool registry도 노출
export { graph };
export { TOOL_DEFS, TOOL_MAP, getToolSpecs, callTool, findTool } from "./tool-registry.js";
export type { ToolDefinition, ToolContext, ToolResponse, BasisRef } from "./lib/types.js";

const entry = process.argv[1];
const isDirect = entry != null && import.meta.url === pathToFileURL(entry).href;
if (isDirect) {
  const mode = process.argv.includes("--stdio") ? "stdio" : "http";
  if (mode === "stdio") {
    const { startStdioServer } = await import("./mcp/stdio.js");
    await startStdioServer(graph);
  } else {
    const port = Number(process.env["PORT"] ?? 8080);
    createServer(app).listen(port, () => {
      process.stdout.write(
        `[${SERVER_NAME} v${VERSION}] HTTP 서버 기동 http://localhost:${port} ` +
          `(ontology v${graph.version}, ${graph.entities.size} entities)\n`,
      );
    });
  }
}
