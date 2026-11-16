// ─────────────────────────────────────────────────────────────────────────────
// server/mcp.ts — MCP 서버 인스턴스를 만든다 (도구·리소스 등록).
//
// 전송(stdio)은 server/stdio.ts 가 맡는다. 연결마다 이 팩토리로 서버를 하나 만든다.
// ─────────────────────────────────────────────────────────────────────────────

import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import type {
  CallToolResult,
  JsonSchemaType,
  JsonSchemaValidator,
  jsonSchemaValidator,
} from "@modelcontextprotocol/server";
import { TOOL_DEFS, callTool } from "../tool-registry.js";
import { toMcpErrorContent } from "../lib/errors.js";
import { registerResources } from "./resources.js";
import type { OntologyGraph } from "../ontology/graph.js";
import { SERVER_INSTRUCTIONS, SERVER_NAME, VERSION } from "../version.js";

// ───── 상수 ─────
/**
 * 등록 단계의 검사기 — 그대로 통과시킨다. 입력 검사는 도구 호출 경로(callTool)에서
 * 공개한 입력 형식대로 한다. stdio·HTTP·명령줄이 같은 검사와 같은 오류 형식을 쓰게
 * 하려는 것이다(등록 단계에서 거절하면 오류가 문장 한 줄로만 나간다).
 */
const PASS_THROUGH: jsonSchemaValidator = {
  getValidator<T>(): JsonSchemaValidator<T> {
    return (input: unknown) => ({ valid: true, data: input as T, errorMessage: undefined });
  },
};

export function buildMcpServer(graph: OntologyGraph): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    { instructions: SERVER_INSTRUCTIONS, capabilities: { tools: {}, resources: {} } },
  );

  for (const tool of TOOL_DEFS) {
    server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        // 공개하는 입력 형식은 도구가 선언한 JSON Schema 그대로다
        inputSchema: fromJsonSchema(tool.inputSchema as JsonSchemaType, PASS_THROUGH),
        annotations: tool.annotations,
      },
      async (input: unknown): Promise<CallToolResult> => {
        try {
          const response = await callTool(tool.name, input, { graph });
          return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
        } catch (err) {
          return toMcpErrorContent(err);
        }
      },
    );
  }

  registerResources(server, graph);
  return server;
}
