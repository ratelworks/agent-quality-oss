#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// cli.ts — quality-oss MCP 단일 진입점.
//   serve       → stdio MCP 서버
//   serve --http → HTTP 서버 (PORT env)
//   tools       → 등록된 도구 목록
//   call <name> → 도구 직접 호출 (--key value · --inputJson '{...}')
// ─────────────────────────────────────────────────────────────────────────────

import { Command } from "commander";
import { createServer } from "node:http";
import { SERVER_NAME, VERSION, PROVIDED_BY, DEVELOPED_BY } from "./version.js";
import { TOOL_DEFS, callTool, getToolSpecs } from "./tool-registry.js";
import { toMcpErrorContent } from "./lib/errors.js";
import { loadOntologySync } from "./ontology/loader.js";
import { OntologyGraph } from "./ontology/graph.js";
import { validateOntology } from "./ontology/validator.js";
import { createHttpHandler } from "./server/http.js";
import { annotateResponse } from "./lib/response.js";

// 파일 최상단 상수 — CLI 서브커맨드 라벨
const CMD = {
  SERVE: "serve",
  TOOLS: "tools",
  CALL: "call",
} as const;

const program = new Command();

program
  .name(SERVER_NAME)
  .description(
    `한국 건설 품질관리 MCP 서버 (제공: ${PROVIDED_BY} · 개발: ${DEVELOPED_BY})`,
  )
  .version(VERSION);

// 도움말이 아닐 때만 크레딧 배너
if (
  process.argv.length > 2 &&
  !process.argv.includes("--help") &&
  !process.argv.includes("-h")
) {
  /* eslint-disable no-console */
  console.error(
    `[${SERVER_NAME} v${VERSION}] 제공: ${PROVIDED_BY} · 개발: ${DEVELOPED_BY}`,
  );
  /* eslint-enable no-console */
}

// ───── serve ─────
program
  .command(CMD.SERVE)
  .description("Start MCP server (stdio by default; --http for HTTP)")
  .option("--http", "HTTP 모드로 기동 (기본 stdio)")
  .option("--port <port>", "HTTP 포트 (기본 8080 또는 PORT env)")
  .action(async (opts: { http?: boolean; port?: string }) => {
    const graph = loadAndValidateGraph();
    if (opts.http) {
      const port = Number(opts.port ?? process.env["PORT"] ?? 8080);
      const handler = createHttpHandler(graph);
      createServer(handler).listen(port, () => {
        process.stdout.write(
          `[${SERVER_NAME}] HTTP 서버 기동 http://localhost:${port} ` +
            `(ontology v${graph.version}, ${graph.entities.size} entities)\n`,
        );
      });
    } else {
      const { startStdioServer } = await import("./server/stdio.js");
      await startStdioServer(graph);
    }
  });

// ───── tools ─────
program
  .command(CMD.TOOLS)
  .description("List registered MCP tools")
  .option("--json", "JSON 덤프 모드")
  .action((opts: { json?: boolean }) => {
    const specs = getToolSpecs();
    if (opts.json) {
      /* eslint-disable no-console */
      console.log(JSON.stringify(specs, null, 2));
      /* eslint-enable no-console */
      return;
    }
    /* eslint-disable no-console */
    console.log(`[${SERVER_NAME} v${VERSION}] ${specs.length} tools\n`);
    for (const s of specs) {
      const short = s.description.replace(/\s+/g, " ").slice(0, 110);
      console.log(`  • ${s.name}\n    ${short}${short.length >= 110 ? "…" : ""}`);
    }
    console.log("\n  '--json' 으로 raw 덤프");
    /* eslint-enable no-console */
  });

// ───── call ─────
program
  .command(`${CMD.CALL} <toolName>`)
  .description("Invoke a tool directly (--key value · --inputJson '{...}')")
  .allowUnknownOption(true)
  .action(async (toolName: string, _opts, cmd) => {
    const tool = TOOL_DEFS.find((t) => t.name === toolName);
    if (!tool) {
      /* eslint-disable no-console */
      console.error(`Unknown tool: ${toolName}`);
      /* eslint-enable no-console */
      process.exit(2);
    }

    const args = parseKeyValueArgs(cmd.args.slice(1));
    let input: unknown;
    if ("inputJson" in args) {
      const v = (args as Record<string, unknown>).inputJson;
      input = typeof v === "string" ? JSON.parse(v) : v;
    } else {
      input = args;
    }

    try {
      const graph = loadAndValidateGraph();
      const raw = await callTool(toolName, input, { graph });
      const response = annotateResponse(graph, raw);
      /* eslint-disable no-console */
      console.log(JSON.stringify(response, null, 2));
      /* eslint-enable no-console */
    } catch (err) {
      const payload = toMcpErrorContent(err);
      /* eslint-disable no-console */
      console.log(JSON.stringify(payload, null, 2));
      /* eslint-enable no-console */
      process.exit(1);
    }
  });

// ───── 공통: 온톨로지 로드 + 검증 ─────
function loadAndValidateGraph(): OntologyGraph {
  const data = loadOntologySync();
  const graph = new OntologyGraph(data);
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
  return graph;
}

// ───── 인자 파싱 (--key value 또는 --flag) ─────
function parseKeyValueArgs(tokens: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (typeof tok !== "string" || !tok.startsWith("--")) continue;
    const key = tok.slice(2);
    const next = tokens[i + 1];
    if (next === undefined || (typeof next === "string" && next.startsWith("--"))) {
      out[key] = true;
      continue;
    }
    out[key] = coerceArgValue(next);
    i += 1;
  }
  return out;
}

function coerceArgValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^[\[{]/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (raw.includes(",") && !/[A-Za-z가-힣\s]/.test(raw)) {
    const parts = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    return parts.map((p) => (isFiniteNumberString(p) ? Number(p) : p));
  }
  if (isFiniteNumberString(raw)) return Number(raw);
  return raw;
}

function isFiniteNumberString(s: string): boolean {
  if (!/^-?\d+(\.\d+)?$/.test(s)) return false;
  return Number.isFinite(Number(s));
}

program.parseAsync(process.argv).catch((err) => {
  /* eslint-disable no-console */
  console.error(err);
  /* eslint-enable no-console */
  process.exit(1);
});
