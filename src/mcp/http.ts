/**
 * HTTP 어댑터. node:http의 RequestListener 시그니처로 반환.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
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

export function createHttpHandler(graph: OntologyGraph) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const host = req.headers.host ?? 'localhost';
      const url = new URL(req.url ?? '/', `http://${host}`);
      const pathname = url.pathname.replace(/\/+$/, '') || '/';
      const method = (req.method ?? 'GET').toUpperCase();

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (pathname === '/healthz' || pathname === '/health') {
        send(res, 200, { ok: true, stats: graph.stats() });
        return;
      }

      if (pathname === '/' && method === 'GET') {
        send(res, 200, {
          name: 'agent-quality-oss-mcp',
          version: graph.version,
          description: 'Construction Quality Management MCP Server',
          endpoints: [
            '/healthz',
            '/mcp/tools',
            '/mcp/tools/:name',
            '/api',
            '/.well-known/agent.json',
          ],
        });
        return;
      }

      if (pathname === '/.well-known/agent.json') {
        send(res, 200, agentCard(graph));
        return;
      }

      if (pathname === '/mcp/tools' && method === 'GET') {
        send(res, 200, { tools: getToolSpecs() });
        return;
      }

      if (pathname.startsWith('/mcp/tools/') && method === 'POST') {
        const name = pathname.slice('/mcp/tools/'.length);
        const tool = TOOL_MAP.get(name);
        if (!tool) {
          send(res, 404, { error: `unknown tool: ${name}` });
          return;
        }
        const body = await readJson(req);
        const raw = tool.run(body ?? {}, graph);
        const response = isToolResponse(raw) ? annotateResponse(graph, raw) : raw;
        send(res, 200, response);
        return;
      }

      if (pathname === '/api' && method === 'POST') {
        const body = (await readJson(req)) as { action?: string; params?: unknown } | null;
        const action = body?.action;
        if (!action) {
          send(res, 400, { error: 'action is required' });
          return;
        }
        if (action === 'listTools') {
          send(res, 200, { tools: getToolSpecs() });
          return;
        }
        const tool = TOOL_MAP.get(action);
        if (!tool) {
          send(res, 404, { error: `unknown action: ${action}` });
          return;
        }
        const raw = tool.run(body?.params ?? {}, graph);
        const response = isToolResponse(raw) ? annotateResponse(graph, raw) : raw;
        send(res, 200, response);
        return;
      }

      send(res, 404, { error: `not found: ${method} ${pathname}` });
    } catch (err: unknown) {
      const status =
        err && typeof err === 'object' && 'statusCode' in err
          ? Number((err as { statusCode?: number }).statusCode ?? 500)
          : 500;
      const message = err instanceof Error ? err.message : String(err);
      send(res, status, { error: message });
    }
  };
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const e: Error & { statusCode?: number } = new Error(`invalid JSON body: ${msg}`);
        e.statusCode = 400;
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function agentCard(graph: OntologyGraph): unknown {
  const tools = getToolSpecs();
  return {
    schemaVersion: '0.1.0',
    name: 'agent-quality-oss-mcp',
    description: '건설 품질관리 온톨로지 기반 MCP 서버 (오픈소스)',
    version: graph.version,
    protocols: ['mcp', 'http-json'],
    skills: tools.map((t) => ({ id: t.name, description: t.description })),
    ontology: graph.stats(),
  };
}
