/**
 * stdio MCP 서버. Claude Desktop 등 MCP 클라이언트와 stdio로 통신.
 * SDK 미설치 시 친절한 에러로 종료.
 */

import { TOOL_MAP, getToolSpecs } from './registry.js';
import type { OntologyGraph } from '../ontology/graph.js';
import { annotateResponse } from '../tools/_response.js';
import type { ToolResponse } from './types.js';

/** R0-G3: 도구 응답이 ToolResponse 형식이면 graph로 sourceStatus annotate. */
function isToolResponse(x: unknown): x is ToolResponse {
  return (
    typeof x === 'object' &&
    x !== null &&
    'basis' in x &&
    'lineage' in x &&
    Array.isArray((x as ToolResponse).basis)
  );
}

export async function startStdioServer(graph: OntologyGraph): Promise<void> {
  try {
    const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const { ListToolsRequestSchema, CallToolRequestSchema } = await import(
      '@modelcontextprotocol/sdk/types.js'
    );

    const server = new Server(
      { name: 'agent-quality-oss-mcp', version: graph.version },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: getToolSpecs() };
    });

    server.setRequestHandler(CallToolRequestSchema, async (req: any) => {
      const { name, arguments: args } = req.params;
      const tool = TOOL_MAP.get(name);
      if (!tool) {
        return {
          content: [{ type: 'text', text: `unknown tool: ${name}` }],
          isError: true,
        };
      }
      try {
        const raw = tool.run(args ?? {}, graph);
        const response = isToolResponse(raw) ? annotateResponse(graph, raw) : raw;
        return {
          content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `tool error: ${msg}` }],
          isError: true,
        };
      }
    });

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
