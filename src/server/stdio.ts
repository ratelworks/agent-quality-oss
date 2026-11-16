// ─────────────────────────────────────────────────────────────────────────────
// server/stdio.ts — AI 비서 프로그램과 stdio 로 통신한다.
//
// serveStdio 가 전송을 맡고, 연결을 여는 첫 교환으로 프로토콜 세대를 정한다 —
// MCP 2026-07-28 규격(핸드셰이크 없음)과 그 이전 규격(initialize) 클라이언트를 모두 받는다.
// ─────────────────────────────────────────────────────────────────────────────

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { buildMcpServer } from "./mcp.js";
import { TOOL_DEFS } from "../tool-registry.js";
import type { OntologyGraph } from "../ontology/graph.js";
import { SERVER_NAME, VERSION } from "../version.js";

export function startStdioServer(graph: OntologyGraph): void {
  serveStdio(() => buildMcpServer(graph));
  // stdout 은 프로토콜 전용 — 상태는 stderr 로만 낸다
  process.stderr.write(
    `[${SERVER_NAME}] v${VERSION} stdio 준비 (도구 ${TOOL_DEFS.length}개, 온톨로지 v${graph.version})\n`,
  );
}
