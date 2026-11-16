#!/usr/bin/env tsx
/**
 * test-input-schema.ts — 도구가 공개한 입력 형식대로 입력을 실제로 검사하는지 확인
 *
 * 무엇을 재나
 *   1. 도구마다 형식에서 만든 "맞는 최소 입력"은 검사를 통과한다
 *   2. 도구마다 필수 입력을 빼거나, 칸의 타입을 틀리게 주거나, 받지 않는 칸을 주면 거절한다
 *   3. 손으로 적은 대조군 — 숫자 모양 문자열, 선택 칸의 null, 배열 항목 타입, enum
 *   4. 도구 호출 경로(callTool)가 형식 오류를 INVALID_INPUT 으로 돌려준다
 *   5. 명령줄 형변환이 입력 형식을 따른다 — 문자열 칸의 "123" 은 문자열로 남는다
 *
 * 빌드 산출물(build/)을 읽는다 — `npm run build` 뒤에 실행한다.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD = resolve(__dirname, "..", "..", "build");
const CLI = resolve(BUILD, "cli.js");
const EXPECTED_TOOL_COUNT_MIN = 52;
/** 타입별로 "틀린 값" — 그 타입이 아닌 값 */
const WRONG_VALUE: Record<string, unknown> = {
  string: 123,
  number: "열둘",
  integer: 1.5,
  boolean: "yes",
  array: "하나",
  object: "문자열",
};
const SAMPLE_VALUE: Record<string, unknown> = {
  string: "표본",
  number: 1,
  integer: 1,
  boolean: true,
};

interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: SchemaNode;
  enum?: unknown[];
}
interface ToolDef {
  name: string;
  inputSchema: SchemaNode;
}
type Check = { ok: true; value: Record<string, unknown> } | { ok: false; issues: Array<{ path: string; message: string }> };

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

/** 형식 노드에서 맞는 표본 값을 만든다 */
function sampleOf(node: SchemaNode): unknown {
  if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum[0];
  switch (node.type) {
    case "array":
      return node.items ? [sampleOf(node.items)] : [];
    case "object":
      return sampleObject(node);
    default:
      return SAMPLE_VALUE[node.type ?? "string"] ?? "표본";
  }
}
function sampleObject(node: SchemaNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of node.required ?? []) {
    out[key] = sampleOf(node.properties?.[key] ?? {});
  }
  return out;
}

async function main(): Promise<void> {
  const registry = (await import(pathToFileURL(resolve(BUILD, "tool-registry.js")).href)) as {
    TOOL_DEFS: ToolDef[];
    callTool: (name: string, input: unknown, ctx: { graph: unknown }) => Promise<unknown>;
  };
  const inputSchema = (await import(pathToFileURL(resolve(BUILD, "lib", "input-schema.js")).href)) as {
    validateInput: (schema: SchemaNode, input: unknown) => Check;
    coerceCliArgs: (schema: SchemaNode, raw: Record<string, string | true>) => Record<string, unknown>;
  };
  const { validateInput, coerceCliArgs } = inputSchema;
  const tools = registry.TOOL_DEFS;
  check("도구 목록", tools.length >= EXPECTED_TOOL_COUNT_MIN, String(tools.length));

  // 1·2. 도구마다 — 형식에서 만든 맞는 입력은 통과, 틀린 입력은 거절
  let accepted = 0;
  let rejected = 0;
  for (const tool of tools) {
    const schema = tool.inputSchema;
    const good = sampleObject(schema);
    const goodCheck = validateInput(schema, good);
    check(`${tool.name}: 맞는 최소 입력 통과`, goodCheck.ok, goodCheck.ok ? "" : JSON.stringify(goodCheck.issues));
    if (goodCheck.ok) accepted += 1;

    for (const key of schema.required ?? []) {
      const { [key]: _omitted, ...missing } = good;
      const c = validateInput(schema, missing);
      check(`${tool.name}: 필수 입력 ${key} 누락 거절`, !c.ok && c.issues.some((i) => i.path === key));
      if (!c.ok) rejected += 1;
    }
    for (const [key, prop] of Object.entries(schema.properties ?? {})) {
      const wrong = WRONG_VALUE[prop.type ?? ""];
      if (wrong === undefined) continue;
      const c = validateInput(schema, { ...good, [key]: wrong });
      check(`${tool.name}: ${key} 에 ${prop.type} 아닌 값 거절`, !c.ok && c.issues.some((i) => i.path.startsWith(key)));
      if (!c.ok) rejected += 1;
    }
    if (schema.additionalProperties === false) {
      const c = validateInput(schema, { ...good, __없는칸: 1 });
      check(`${tool.name}: 받지 않는 칸 거절`, !c.ok);
      if (!c.ok) rejected += 1;
    }
    const notObject = validateInput(schema, 123);
    check(`${tool.name}: 객체가 아닌 입력 거절`, !notObject.ok);
  }

  // 3. 손으로 적은 대조군
  const demo: SchemaNode = {
    type: "object",
    properties: {
      name: { type: "string" },
      count: { type: "number" },
      whole: { type: "integer" },
      tags: { type: "array", items: { type: "string" } },
      mode: { type: "string", enum: ["a", "b"] },
      nested: { type: "object", properties: { depth: { type: "number" } }, required: ["depth"] },
    },
    required: ["name"],
    additionalProperties: false,
  };
  const numeric = validateInput(demo, { name: "x", count: "12.5" });
  check("숫자 모양 문자열은 숫자로 받음", numeric.ok && numeric.value["count"] === 12.5);
  check("숫자가 아닌 문자열은 숫자 칸에서 거절", !validateInput(demo, { name: "x", count: "12개" }).ok);
  check("정수 칸의 소수 거절", !validateInput(demo, { name: "x", whole: 1.5 }).ok);
  const nullOptional = validateInput(demo, { name: "x", count: null });
  check("선택 칸의 null 은 보내지 않은 것으로 봄", nullOptional.ok && !("count" in nullOptional.value));
  check("필수 칸의 null 거절", !validateInput(demo, { name: null }).ok);
  check("배열 항목 타입 거절", !validateInput(demo, { name: "x", tags: ["a", 1] }).ok);
  check("enum 밖의 값 거절", !validateInput(demo, { name: "x", mode: "c" }).ok);
  check("enum 안의 값 통과", validateInput(demo, { name: "x", mode: "b" }).ok);
  check("중첩 객체의 필수 칸 누락 거절", !validateInput(demo, { name: "x", nested: {} }).ok);
  check("입력이 없으면 빈 객체로 봄(필수 칸 누락으로 거절)", !validateInput(demo, undefined).ok);
  check("모르는 키워드를 쓰는 형식은 통과시키지 않음", !validateInput({ type: "object", properties: { a: { type: "string", pattern: "^x" } as SchemaNode } }, { a: "x" }).ok);

  // 4. 도구 호출 경로가 형식 오류를 INVALID_INPUT 으로 돌려준다
  let invalidCode = "";
  try {
    await registry.callTool("resolve_worktype", { input: 123 }, { graph: null });
  } catch (err) {
    invalidCode = String((err as { code?: unknown }).code ?? "");
  }
  check("callTool: 형식 오류는 INVALID_INPUT", invalidCode === "INVALID_INPUT", invalidCode);
  let unknownCode = "";
  try {
    await registry.callTool("없는_도구", {}, { graph: null });
  } catch (err) {
    unknownCode = String((err as { code?: unknown }).code ?? "");
  }
  check("callTool: 없는 도구는 UNKNOWN_TOOL", unknownCode === "UNKNOWN_TOOL", unknownCode);

  // 5. 명령줄 형변환은 입력 형식을 따른다
  const coerced = coerceCliArgs(demo, { name: "123", count: "7", tags: "a,b", nested: '{"depth":2}' });
  check("명령줄: 문자열 칸의 123 은 문자열", coerced["name"] === "123");
  check("명령줄: 숫자 칸의 7 은 숫자", coerced["count"] === 7);
  check("명령줄: 배열 칸의 a,b 는 배열", JSON.stringify(coerced["tags"]) === '["a","b"]');
  check("명령줄: 객체 칸의 JSON 은 객체", JSON.stringify(coerced["nested"]) === '{"depth":2}');
  const cliOut = execFileSync(process.execPath, [CLI, "call", "resolve_worktype", "--input", "123"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  check("명령줄 실제 호출: --input 123 이 형식 오류 없이 처리됨", !cliOut.includes("INVALID_INPUT") && cliOut.includes('"lineage"'), cliOut.slice(0, 200));

  console.log(`[input-schema] 도구 ${tools.length}개 · 맞는 입력 통과 ${accepted} · 틀린 입력 거절 ${rejected}`);
  console.log(`[input-schema] ${pass} 통과 / ${fail} 실패`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
