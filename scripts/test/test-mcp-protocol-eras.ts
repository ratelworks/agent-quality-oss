#!/usr/bin/env tsx
/**
 * test-mcp-protocol-eras.ts — MCP 서버가 두 세대의 프로토콜을 모두 받는지 확인 (네트워크 없음)
 *
 * 빌드된 서버(build/cli.js serve)를 stdio 로 띄워 실제 클라이언트로 접속한다.
 *   1. 이전 세대(initialize 핸드셰이크) 클라이언트
 *   2. 현행 세대(2026-07-28, 핸드셰이크 없음)로 고정한 클라이언트
 * 두 세대에서 다음이 같아야 한다:
 *   - 도구 정의 전체(이름·설명·입력 형식·주의 표시 — 현행 세대가 덧붙이는 `$schema` 표지 제외)
 *   - 리소스 목록과 모든 리소스의 본문
 *   - 서버가 공개하는 도구 정의는 도구가 선언한 입력 형식 그대로다
 *   - 필수 입력이 없는 도구를 빈 입력으로 부른 결과 (호출마다 달라지는 식별자·시각·해시는 지우고 비교)
 * 그리고 형식에 맞지 않는 입력은 두 세대 모두 같은 입력 오류로 거절해야 한다.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "..", "..", "build", "cli.js");
const SERVER_ARGS = [SERVER_ENTRY, "serve"];
const REGISTRY = resolve(__dirname, "..", "..", "build", "tool-registry.js");
const MODERN_PROTOCOL_VERSION = "2026-07-28";
const EXPECTED_TOOL_COUNT_MIN = 52;
/** 호출마다 달라지는 값 — 비교 전에 지운다 */
const VOLATILE_KEYS = new Set(["toolCallId", "generatedAt", "contentHash"]);
/** 형식에 맞지 않는 입력 — 문자열 칸에 숫자 */
const BAD_CALL = { name: "resolve_worktype", arguments: { input: 123 } };

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !VOLATILE_KEYS.has(k))
        .map(([k, v]) => [k, stripVolatile(v)]),
    );
  }
  return value;
}

/** 도구 결과의 text 는 JSON 이다 — 풀어서 변동 값을 지운 뒤 다시 직렬화한다 */
function normalizeContent(content: unknown): string {
  const blocks = Array.isArray(content) ? content : [];
  return JSON.stringify(
    blocks.map((b) => {
      const text = (b as { text?: unknown }).text;
      if (typeof text !== "string") return b;
      try {
        return stripVolatile(JSON.parse(text));
      } catch {
        return text;
      }
    }),
  );
}

interface EraResult {
  era: string | undefined;
  protocolVersion: string | undefined;
  toolNames: string[];
  toolDefinitions: string;
  annotatedTools: number;
  resourceUris: string[];
  resourceBodies: Record<string, string>;
  callResults: Record<string, string>;
  callErrors: Record<string, string>;
  badCall: { isError: boolean; body: string };
}

async function connectAndProbe(options: ConstructorParameters<typeof Client>[1]): Promise<EraResult> {
  const client = new Client({ name: "era-test", version: "1.0.0" }, options);
  const transport = new StdioClientTransport({ command: process.execPath, args: SERVER_ARGS, stderr: "ignore" });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const resources = await client.listResources();
    const resourceBodies: Record<string, string> = {};
    for (const r of resources.resources) {
      const read = await client.readResource({ uri: r.uri });
      resourceBodies[r.uri] = JSON.stringify(read.contents);
    }
    const callResults: Record<string, string> = {};
    const callErrors: Record<string, string> = {};
    for (const t of tools.tools) {
      const required = (t.inputSchema as { required?: string[] }).required ?? [];
      if (required.length > 0) continue;
      const called = await client.callTool({ name: t.name, arguments: {} });
      (called.isError ? callErrors : callResults)[t.name] = normalizeContent(called.content);
    }
    const bad = await client.callTool(BAD_CALL);
    return {
      era: client.getProtocolEra(),
      protocolVersion: client.getNegotiatedProtocolVersion(),
      toolNames: tools.tools.map((t) => t.name),
      toolDefinitions: JSON.stringify(
        tools.tools.map((t) => {
          const { $schema: _dialect, ...inputSchema } = t.inputSchema as Record<string, unknown>;
          return { name: t.name, title: t.title, description: t.description, inputSchema, annotations: t.annotations };
        }),
      ),
      annotatedTools: tools.tools.filter((t) => typeof t.annotations?.readOnlyHint === "boolean").length,
      resourceUris: resources.resources.map((r) => r.uri),
      resourceBodies,
      callResults,
      callErrors,
      badCall: { isError: bad.isError === true, body: normalizeContent(bad.content) },
    };
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const legacy = await connectAndProbe(undefined);
  check("이전 세대로 접속됨", legacy.era === "legacy", String(legacy.era));
  check("이전 세대: 도구 목록", legacy.toolNames.length >= EXPECTED_TOOL_COUNT_MIN, String(legacy.toolNames.length));
  check("모든 도구에 주의 표시가 있음", legacy.annotatedTools === legacy.toolNames.length, `${legacy.annotatedTools}/${legacy.toolNames.length}`);
  const calledTools = Object.keys(legacy.callResults);
  const erroredTools = Object.keys(legacy.callErrors);
  check("이전 세대: 성공한 도구 호출이 있음", calledTools.length > 0);
  check(
    "이전 세대: 리소스 본문을 실제로 읽었음",
    legacy.resourceUris.length > 0 && Object.values(legacy.resourceBodies).every((b) => b.length > 2),
  );
  check("형식에 맞지 않는 입력은 입력 오류로 거절", legacy.badCall.isError && legacy.badCall.body.includes("INVALID_INPUT"), legacy.badCall.body.slice(0, 160));

  // 서버가 공개하는 도구 정의는 도구가 선언한 그대로여야 한다
  const registry = (await import(pathToFileURL(REGISTRY).href)) as {
    getToolSpecs: () => Array<{ name: string; description: string; inputSchema: unknown; annotations: unknown }>;
  };
  const declared = JSON.stringify(
    registry.getToolSpecs().map((s) => ({
      name: s.name,
      title: s.name,
      description: s.description,
      inputSchema: s.inputSchema,
      annotations: s.annotations,
    })),
  );
  check("공개된 도구 정의가 선언한 입력 형식 그대로임", declared === legacy.toolDefinitions);

  const modern = await connectAndProbe({ versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } } });
  check("현행 세대로 접속됨", modern.era === "modern", String(modern.era));
  check("현행 세대: 협상된 버전", modern.protocolVersion === MODERN_PROTOCOL_VERSION, String(modern.protocolVersion));
  check("도구 정의(이름·설명·입력 형식·주의 표시)가 두 세대에서 같음", modern.toolDefinitions === legacy.toolDefinitions);
  check("리소스 목록이 두 세대에서 같음", JSON.stringify(modern.resourceUris) === JSON.stringify(legacy.resourceUris));
  const differingResources = legacy.resourceUris.filter((uri) => modern.resourceBodies[uri] !== legacy.resourceBodies[uri]);
  check("모든 리소스 본문이 두 세대에서 같음", differingResources.length === 0, differingResources.join(", "));
  const differingCalls = calledTools.filter((name) => modern.callResults[name] !== legacy.callResults[name]);
  check("성공한 도구 호출 결과가 두 세대에서 같음", differingCalls.length === 0, differingCalls.slice(0, 5).join(", "));
  check("성공한 도구 집합이 두 세대에서 같음", JSON.stringify(Object.keys(modern.callResults)) === JSON.stringify(calledTools));
  const differingErrors = erroredTools.filter((name) => modern.callErrors[name] !== legacy.callErrors[name]);
  check(
    "오류로 끝난 호출도 두 세대에서 같은 오류",
    differingErrors.length === 0 && JSON.stringify(Object.keys(modern.callErrors)) === JSON.stringify(erroredTools),
    differingErrors.slice(0, 5).join(", "),
  );
  check("입력 오류 응답이 두 세대에서 같음", JSON.stringify(modern.badCall) === JSON.stringify(legacy.badCall));

  console.log(
    `[mcp-eras] 이전 세대 ${legacy.protocolVersion} · 현행 세대 ${modern.protocolVersion} · 도구 정의 ${legacy.toolNames.length}개 · ` +
      `리소스 본문 ${legacy.resourceUris.length}건 · 호출 성공 ${calledTools.length}개 · 오류 ${erroredTools.length}개` +
      (erroredTools.length > 0 ? `(${erroredTools.join(", ")})` : ""),
  );
  console.log(`[mcp-eras] ${pass} 통과 / ${fail} 실패`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
