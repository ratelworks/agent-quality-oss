#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// cli.ts — 명령줄 진입점.
//   serve                 → stdio MCP 서버 (--http 는 HTTP 서버)
//   viewer                → 브라우저 입력 폼
//   tools                 → 등록된 도구 목록
//   tools describe <name> → 도구 한 개의 설명·입력 형식
//   call <name>           → 도구 직접 호출 (--key value · --inputJson '{...}')
//   doctor                → 설치 상태 점검
// ─────────────────────────────────────────────────────────────────────────────

import { Command } from "commander";
import { createServer } from "node:http";
import { SERVER_NAME, VERSION, PROVIDED_BY, DEVELOPED_BY } from "./version.js";
import { TOOL_DEFS, callTool, findTool, getToolSpecs } from "./tool-registry.js";
import { toMcpErrorContent } from "./lib/errors.js";
import { coerceCliArgs } from "./lib/input-schema.js";
import { loadOntologySync } from "./ontology/loader.js";
import { OntologyGraph } from "./ontology/graph.js";
import { validateOntology } from "./ontology/validator.js";
import { createHttpHandler, describeHttpAccess, resolveHttpAccess } from "./server/http.js";
import { listSchemaIds } from "./schemas/loader.js";

// ───── 상수 ─────
const CMD = {
  SERVE: "serve",
  VIEWER: "viewer",
  TOOLS: "tools",
  CALL: "call",
  DOCTOR: "doctor",
} as const;
/** package.json engines 와 같은 값 — doctor 가 실행 환경을 견줄 때 쓴다 */
const MIN_NODE = { major: 22, minor: 12 } as const;
const DESCRIPTION_PREVIEW_CHARS = 110;
const EXIT_USAGE = 2;

/* eslint-disable no-console */

const program = new Command();

program
  .name(SERVER_NAME)
  .description(`한국 건설 품질관리 MCP 서버 (제공: ${PROVIDED_BY} · 개발: ${DEVELOPED_BY})`)
  .version(VERSION);

// 도움말이 아닐 때만 크레딧 배너 (stdout 은 결과 전용이라 stderr 로)
if (process.argv.length > 2 && !process.argv.includes("--help") && !process.argv.includes("-h")) {
  console.error(`[${SERVER_NAME} v${VERSION}] 제공: ${PROVIDED_BY} · 개발: ${DEVELOPED_BY}`);
}

// ───── serve ─────
program
  .command(CMD.SERVE)
  .description("MCP 서버를 띄운다 (기본 stdio, --http 는 HTTP)")
  .option("--http", "HTTP 모드로 기동 (기본 stdio)")
  .option("--port <port>", "HTTP 포트 (기본 8080 또는 PORT 환경 변수)")
  .action(async (opts: { http?: boolean; port?: string }) => {
    const graph = loadAndValidateGraph();
    if (opts.http) {
      const port = Number(opts.port ?? process.env["PORT"] ?? 8080);
      const access = resolveHttpAccess();
      createServer(createHttpHandler(graph, access)).listen(port, access.host, () => {
        process.stdout.write(
          `[${SERVER_NAME}] HTTP 서버 기동 http://localhost:${port} — ${describeHttpAccess(access)} ` +
            `(ontology v${graph.version}, ${graph.entities.size} entities)\n`,
        );
      });
    } else {
      const { startStdioServer } = await import("./server/stdio.js");
      startStdioServer(graph);
    }
  });

// ───── viewer ─────
program
  .command(CMD.VIEWER)
  .description("브라우저 입력 폼을 띄운다 (AI 비서·명령줄 없이 사용)")
  .option("--port <port>", "포트 (기본 5273 또는 PORT 환경 변수)")
  .action(async (opts: { port?: string }) => {
    const { startViewer } = await import("./viewer.js");
    await startViewer({ port: opts.port ? Number(opts.port) : undefined });
  });

// ───── tools ─────
const toolsCommand = program
  .command(CMD.TOOLS)
  .description("등록된 도구 목록")
  .option("--json", "JSON 으로 출력")
  .action((opts: { json?: boolean }) => {
    const specs = getToolSpecs();
    if (opts.json) {
      console.log(JSON.stringify(specs, null, 2));
      return;
    }
    console.log(`[${SERVER_NAME} v${VERSION}] ${specs.length} tools\n`);
    for (const s of specs) {
      const short = s.description.replace(/\s+/g, " ").slice(0, DESCRIPTION_PREVIEW_CHARS);
      const more = short.length >= DESCRIPTION_PREVIEW_CHARS ? "…" : "";
      console.log(`  • ${s.name}\n    ${short}${more}`);
    }
    console.log(`\n  '--json' 으로 전체 출력 · '${CMD.TOOLS} describe <name>' 으로 도구 한 개 보기`);
  });

toolsCommand
  .command("describe <toolName>")
  .description("도구 한 개의 설명과 입력 형식")
  .option("--json", "JSON 으로 출력")
  .action((toolName: string, opts: { json?: boolean }) => {
    const tool = findTool(toolName);
    if (!tool) {
      console.error(`Unknown tool: ${toolName}`);
      process.exit(EXIT_USAGE);
    }
    if (opts.json) {
      console.log(JSON.stringify(tool, null, 2));
      return;
    }
    const properties = (tool.inputSchema.properties ?? {}) as Record<
      string,
      { type?: string; description?: string; enum?: unknown[] }
    >;
    const required = new Set(tool.inputSchema.required ?? []);
    console.log(`${tool.name}\n\n${tool.description}\n`);
    const names = Object.keys(properties);
    if (names.length === 0) {
      console.log("입력: 없음");
    } else {
      console.log("입력:");
      for (const name of names) {
        const p = properties[name] ?? {};
        const mark = required.has(name) ? "필수" : "선택";
        const choices = Array.isArray(p.enum) ? ` — ${p.enum.join(" | ")}` : "";
        console.log(`  --${name} <${p.type ?? "값"}>  (${mark})${choices}`);
        if (p.description) console.log(`      ${p.description}`);
      }
    }
    const a = tool.annotations;
    console.log(
      `\n주의 표시: ${a.readOnlyHint ? "읽기 전용" : "파일을 쓰거나 상태를 바꿈"}` +
        `${a.openWorldHint ? " · 이 컴퓨터 밖과 통신" : ""}`,
    );
  });

// ───── call ─────
program
  .command(`${CMD.CALL} <toolName>`)
  .description("도구를 직접 부른다 (--key value · --inputJson '{...}')")
  .allowUnknownOption(true)
  // 도구 입력은 commander 가 모르는 인자다 — 남는 인자를 받게 한다
  .allowExcessArguments(true)
  .action(async (toolName: string, _opts: unknown, cmd: Command) => {
    const tool = findTool(toolName);
    if (!tool) {
      console.error(`Unknown tool: ${toolName}`);
      process.exit(EXIT_USAGE);
    }

    const raw = parseKeyValueArgs(cmd.args.slice(1));
    let input: unknown;
    try {
      // 값의 모양이 아니라 도구의 입력 형식을 보고 바꾼다 — 문자열 칸의 "123" 은 문자열이다
      input =
        typeof raw["inputJson"] === "string"
          ? (JSON.parse(raw["inputJson"]) as unknown)
          : coerceCliArgs(tool.inputSchema, raw);
    } catch (err) {
      console.error(`--inputJson 을 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(EXIT_USAGE);
    }

    try {
      const graph = loadAndValidateGraph();
      console.log(JSON.stringify(await callTool(toolName, input, { graph }), null, 2));
    } catch (err) {
      console.log(JSON.stringify(toMcpErrorContent(err), null, 2));
      process.exit(1);
    }
  });

// ───── doctor ─────
program
  .command(CMD.DOCTOR)
  .description("설치 상태를 점검한다 (실행 환경·내장 자료·도구 등록)")
  .action(() => {
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

    const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
    checks.push({
      name: "Node.js",
      ok: major > MIN_NODE.major || (major === MIN_NODE.major && minor >= MIN_NODE.minor),
      detail: `${process.versions.node} (필요: ${MIN_NODE.major}.${MIN_NODE.minor} 이상)`,
    });

    try {
      const graph = new OntologyGraph(loadOntologySync());
      const report = validateOntology(graph);
      const errors = report.issues.filter((i) => i.level === "error").length;
      checks.push({
        name: "온톨로지",
        ok: report.ok,
        detail: `v${graph.version} · 노드 ${graph.entities.size}개 · 오류 ${errors}건`,
      });
    } catch (err) {
      checks.push({
        name: "온톨로지",
        ok: false,
        detail: `읽지 못함 — ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const schemaCount = listSchemaIds().length;
    checks.push({ name: "문서 양식", ok: schemaCount > 0, detail: `${schemaCount}종` });
    checks.push({ name: "도구 등록", ok: TOOL_DEFS.length > 0, detail: `${TOOL_DEFS.length}개` });

    for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
    if (checks.some((c) => !c.ok)) process.exit(1);
  });

// ───── 공통: 온톨로지 로드 + 검증 ─────
function loadAndValidateGraph(): OntologyGraph {
  const graph = new OntologyGraph(loadOntologySync());
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

// ───── 인자 파싱 (--key value 또는 --flag) — 값은 문자열 그대로 둔다 ─────
function parseKeyValueArgs(tokens: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (typeof tok !== "string" || !tok.startsWith("--")) continue;
    const key = tok.slice(2);
    const next = tokens[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
