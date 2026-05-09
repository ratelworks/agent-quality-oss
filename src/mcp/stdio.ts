// ─────────────────────────────────────────────────────────────────────────────
// mcp/stdio.ts — Claude Desktop 등 MCP 클라이언트와 stdio로 통신.
// SDK 미설치 시 친절한 에러로 종료.
// ─────────────────────────────────────────────────────────────────────────────

import { TOOL_MAP, getToolSpecs } from "../tool-registry.js";
import type { OntologyGraph } from "../ontology/graph.js";
import { annotateResponse } from "../lib/response.js";
import { toMcpErrorContent } from "../lib/errors.js";
import type { ToolResponse } from "../lib/types.js";

// 도구 응답이 ToolResponse 형식이면 graph로 sourceStatus annotate.
function isToolResponse(x: unknown): x is ToolResponse {
  return (
    typeof x === "object" &&
    x !== null &&
    "basis" in x &&
    "lineage" in x &&
    Array.isArray((x as ToolResponse).basis)
  );
}

export async function startStdioServer(graph: OntologyGraph): Promise<void> {
  try {
    const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
    const { StdioServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/stdio.js"
    );
    const { ListToolsRequestSchema, CallToolRequestSchema } = await import(
      "@modelcontextprotocol/sdk/types.js"
    );

    const server = new Server(
      { name: "agent-quality-oss-mcp", version: graph.version },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: getToolSpecs() };
    });

    // SDK 1.29의 ServerResult 타입은 task 필드를 포함한 union이라
    // 일반 CallTool 응답과 strict 매칭이 안 된다. setRequestHandler 자체를
    // any로 캐스트해 핸들러 시그니처 검증을 우회한다 (런타임 동작은 동일).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server.setRequestHandler as any)(
      CallToolRequestSchema,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (req: any) => {
        const { name, arguments: args } = req.params as {
          name: string;
          arguments?: unknown;
        };
        const tool = TOOL_MAP.get(name);
        if (!tool) {
          return {
            content: [{ type: "text", text: `unknown tool: ${name}` }],
            isError: true,
          };
        }
        try {
          const parsed = tool.inputSchema.parse(args ?? {});
          const raw = await tool.run(parsed, { graph });
          const response = isToolResponse(raw) ? annotateResponse(graph, raw) : raw;
          return {
            content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
          };
        } catch (err) {
          return toMcpErrorContent(err);
        }
      },
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(
      `[agent-quality-oss-mcp] stdio MCP 서버 기동 (${TOOL_MAP.size} tools, ontology v${graph.version})\n`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[agent-quality-oss-mcp] @modelcontextprotocol/sdk 미설치 — 'npm install'을 먼저 실행하세요.\n` +
        `원인: ${msg}\n`,
    );
    process.exit(1);
  }
}
