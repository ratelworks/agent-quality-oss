// ─────────────────────────────────────────────────────────────────────────────
// server/http.ts — HTTP JSON 어댑터. node:http RequestListener 시그니처로 반환.
//
// 접근 경계 (resolveHttpAccess):
//   기본              127.0.0.1 에만 바인딩, 이 컴퓨터의 같은 출처 요청만 받는다
//   밖에서 받기       HOST 환경 변수로 주소를 명시했을 때만(Cloud Run 은 자동 감지).
//                     이때 다른 출처의 브라우저 요청은 AGENT_QUALITY_HTTP_ORIGINS 에
//                     적은 출처만 허용하고, AGENT_QUALITY_HTTP_TOKEN 을 두면 접근 토큰을 요구한다
//   파일을 쓰는 도구  이 컴퓨터 전용이거나 접근 토큰을 둔 서버에서만 부를 수 있다
// 요청 본문은 1 MiB 까지만 받는다.
// ─────────────────────────────────────────────────────────────────────────────

import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { callTool, findTool, getToolSpecs } from "../tool-registry.js";
import type { OntologyGraph } from "../ontology/graph.js";
import { ERROR_CODES, QualityMcpError, toHttpErrorPayload } from "../lib/errors.js";
import {
  BodyTooLargeError,
  LOOPBACK_ADDRESS,
  isLoopbackAddress,
  readBodyText,
  requestRejection,
} from "../lib/request-guard.js";

// ───── 상수 ─────
const ENV_HOST = "HOST";
const ENV_CLOUD_RUN = "K_SERVICE";
const ENV_ORIGINS = "AGENT_QUALITY_HTTP_ORIGINS";
const ENV_TOKEN = "AGENT_QUALITY_HTTP_TOKEN";
const EXTERNAL_ADDRESS = "0.0.0.0";
/** 접근 토큰 없이도 열어 두는 경로 — 상태 확인용 */
const OPEN_PATHS = new Set(["/healthz", "/health"]);

export interface HttpAccess {
  /** 바인딩 주소 */
  host: string;
  /** 이 컴퓨터 전용인가 (Host·Origin 을 이 컴퓨터 주소로 제한) */
  loopbackOnly: boolean;
  /** 밖에서 받을 때 허용하는 브라우저 출처 */
  allowedOrigins: string[];
  /** 밖에서 받을 때 요구하는 접근 토큰 (없으면 요구하지 않음) */
  token: string | null;
}

/** 환경 변수에서 접근 경계를 정한다. 아무것도 적지 않으면 이 컴퓨터 전용이다. */
export function resolveHttpAccess(env: NodeJS.ProcessEnv = process.env): HttpAccess {
  const explicit = env[ENV_HOST]?.trim();
  const host = explicit || (env[ENV_CLOUD_RUN] ? EXTERNAL_ADDRESS : LOOPBACK_ADDRESS);
  return {
    host,
    loopbackOnly: isLoopbackAddress(host),
    allowedOrigins: (env[ENV_ORIGINS] ?? "")
      .split(",")
      .map((o) => o.trim().toLowerCase())
      .filter(Boolean),
    token: env[ENV_TOKEN]?.trim() || null,
  };
}

/** 서버를 띄울 때 한 줄로 알릴 접근 범위 설명 */
export function describeHttpAccess(access: HttpAccess): string {
  if (access.loopbackOnly) return "이 컴퓨터에서만 접속";
  const token = access.token ? "접근 토큰 필요" : "접근 토큰 없음 — 누구나 조회 가능";
  return `외부 접속 허용(${access.host}) · ${token}`;
}

export function createHttpHandler(graph: OntologyGraph, access: HttpAccess = resolveHttpAccess()) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const host = req.headers.host ?? "localhost";
      const url = new URL(req.url ?? "/", `http://${host}`);
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      const method = (req.method ?? "GET").toUpperCase();

      if (access.loopbackOnly) {
        // 이 컴퓨터의 같은 출처 요청만 — 다른 웹 페이지가 도구를 부르지 못하게 한다
        const rejection = requestRejection(req.headers, req.socket.localPort ?? 0);
        if (rejection) {
          send(res, 403, { ok: false, error: rejection });
          return;
        }
      } else {
        const origin = req.headers.origin?.toLowerCase();
        if (origin && access.allowedOrigins.includes(origin)) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Vary", "Origin");
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        }
        if (method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (access.token && !OPEN_PATHS.has(pathname) && !hasToken(req, access.token)) {
          res.setHeader("WWW-Authenticate", "Bearer");
          send(res, 401, { ok: false, error: "접근 토큰이 필요합니다" });
          return;
        }
      }

      if (pathname === "/healthz" || pathname === "/health") {
        send(res, 200, { ok: true, stats: graph.stats() });
        return;
      }

      if (pathname === "/" && method === "GET") {
        send(res, 200, {
          name: "agent-quality-oss",
          version: graph.version,
          description: "Construction Quality Management MCP Server",
          endpoints: [
            "/healthz",
            "/mcp/tools",
            "/mcp/tools/:name",
            "/api",
            "/.well-known/agent.json",
          ],
        });
        return;
      }

      if (pathname === "/.well-known/agent.json") {
        send(res, 200, agentCard(graph));
        return;
      }

      if (pathname === "/mcp/tools" && method === "GET") {
        send(res, 200, { tools: getToolSpecs() });
        return;
      }

      if (pathname.startsWith("/mcp/tools/") && method === "POST") {
        const name = pathname.slice("/mcp/tools/".length);
        await runToolHttp(name, await readJson(req), graph, res, access);
        return;
      }

      if (pathname === "/api" && method === "POST") {
        const body = (await readJson(req)) as
          | { action?: string; params?: unknown }
          | null;
        const action = body?.action;
        if (!action) {
          send(res, 400, { error: "action is required" });
          return;
        }
        if (action === "listTools") {
          send(res, 200, { tools: getToolSpecs() });
          return;
        }
        await runToolHttp(action, body?.params ?? null, graph, res, access);
        return;
      }

      send(res, 404, { error: `not found: ${method} ${pathname}` });
    } catch (err: unknown) {
      if (err instanceof BodyTooLargeError) {
        send(res, 413, { ok: false, error: err.message });
        return;
      }
      const { status, payload } = toHttpErrorPayload(err);
      send(res, status, payload);
    }
  };
}

/** 접근 토큰 대조 — 비교 시간으로 토큰을 추측하지 못하게 고정 시간 비교를 쓴다 */
function hasToken(req: IncomingMessage, token: string): boolean {
  const given = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function runToolHttp(
  name: string,
  body: unknown,
  graph: OntologyGraph,
  res: ServerResponse,
  access: HttpAccess,
): Promise<void> {
  // 파일을 쓰는 도구는 이 컴퓨터 전용이거나 접근 토큰을 둔 서버에서만 부른다
  const tool = findTool(name);
  if (tool && tool.annotations.readOnlyHint !== true && !access.loopbackOnly && !access.token) {
    send(res, 403, {
      ok: false,
      error: `${name} 은 파일을 쓰는 도구입니다. 접근 토큰(${ENV_TOKEN})을 설정한 서버에서만 부를 수 있습니다`,
    });
    return;
  }
  try {
    send(res, 200, await callTool(name, body, { graph }));
  } catch (err) {
    const { status, payload } = toHttpErrorPayload(err);
    send(res, status, payload);
  }
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readBodyText(req);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, `invalid JSON body: ${msg}`);
  }
}

function agentCard(graph: OntologyGraph): unknown {
  const tools = getToolSpecs();
  return {
    schemaVersion: "0.1.0",
    name: "agent-quality-oss",
    description: "건설 품질관리 온톨로지 기반 MCP 서버 (오픈소스)",
    version: graph.version,
    protocols: ["mcp", "http-json"],
    skills: tools.map((t) => ({ id: t.name, description: t.description })),
    ontology: graph.stats(),
  };
}
