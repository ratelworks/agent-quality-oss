// ─────────────────────────────────────────────────────────────────────────────
// input-schema.ts — 도구가 공개한 입력 형식(JSON Schema)으로 입력을 실제로 검사한다.
//
// 도구는 입력 형식을 JSON Schema 로 선언한다(spec.inputSchema). 이 모듈은
//   1) 그 형식대로 입력을 검사하고(validateInput),
//   2) 명령줄의 문자열 인자를 형식에 맞는 값으로 바꾼다(coerceCliArgs).
//
// 지원 범위는 도구들이 실제로 쓰는 키워드다: type(object·string·number·integer·
// boolean·array), properties, required, additionalProperties, items, enum.
// 그 밖의 키워드를 쓰는 도구가 생기면 여기에 검사를 더한다 — 모르는 키워드를
// 조용히 통과시키지 않도록 UNSUPPORTED 로 알린다.
// ─────────────────────────────────────────────────────────────────────────────

import { ERROR_CODES, QualityMcpError } from "./errors.js";
import type { ToolInputSchema } from "./types.js";

// ───── 상수 ─────
/** 검사하지는 않지만 있어도 되는 키워드(설명용) */
const ANNOTATION_KEYWORDS = new Set(["description", "title", "default", "examples"]);
/** 이 모듈이 검사하는 키워드 */
const CHECKED_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
]);
const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;

export interface InputIssue {
  /** 입력 안의 위치 — 예: "observations[0].value". 최상위면 "(root)" */
  path: string;
  message: string;
}

export type InputCheck =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; issues: InputIssue[] };

type SchemaNode = Record<string, unknown>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function describeType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * 값 하나를 형식 노드와 견준다. 맞으면 (필요하면 바꾼) 값을 돌려주고,
 * 틀리면 issues 에 사유를 쌓고 원래 값을 돌려준다.
 */
function checkNode(schema: SchemaNode, value: unknown, path: string, issues: InputIssue[]): unknown {
  for (const key of Object.keys(schema)) {
    if (!CHECKED_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) {
      issues.push({ path, message: `입력 형식 정의가 지원하지 않는 키워드를 씁니다: ${key}` });
    }
  }

  const enumValues = schema["enum"];
  if (Array.isArray(enumValues) && !enumValues.includes(value)) {
    issues.push({
      path,
      message: `허용된 값이 아닙니다. 가능한 값: ${enumValues.map((e) => JSON.stringify(e)).join(", ")}`,
    });
    return value;
  }

  const type = schema["type"];
  if (typeof type !== "string") return value;

  switch (type) {
    case "string":
      if (typeof value !== "string") {
        issues.push({ path, message: `문자열이어야 합니다 (받은 값: ${describeType(value)})` });
      }
      return value;
    case "number":
    case "integer": {
      // 숫자를 문자열로 보내는 클라이언트가 있어 숫자 모양 문자열은 숫자로 받는다
      const n =
        typeof value === "string" && NUMERIC_STRING.test(value.trim()) ? Number(value) : value;
      if (typeof n !== "number" || !Number.isFinite(n)) {
        issues.push({ path, message: `숫자여야 합니다 (받은 값: ${describeType(value)})` });
        return value;
      }
      if (type === "integer" && !Number.isInteger(n)) {
        issues.push({ path, message: "정수여야 합니다" });
      }
      return n;
    }
    case "boolean":
      if (typeof value !== "boolean") {
        issues.push({ path, message: `true/false 여야 합니다 (받은 값: ${describeType(value)})` });
      }
      return value;
    case "array": {
      if (!Array.isArray(value)) {
        issues.push({ path, message: `배열이어야 합니다 (받은 값: ${describeType(value)})` });
        return value;
      }
      const items = schema["items"];
      if (!isPlainObject(items)) return value;
      return value.map((item, i) => checkNode(items, item, `${path}[${i}]`, issues));
    }
    case "object": {
      if (!isPlainObject(value)) {
        issues.push({ path, message: `객체여야 합니다 (받은 값: ${describeType(value)})` });
        return value;
      }
      return checkObject(schema, value, path, issues);
    }
    default:
      issues.push({ path, message: `입력 형식 정의가 지원하지 않는 type 을 씁니다: ${type}` });
      return value;
  }
}

function checkObject(
  schema: SchemaNode,
  value: Record<string, unknown>,
  path: string,
  issues: InputIssue[],
): Record<string, unknown> {
  const properties = isPlainObject(schema["properties"]) ? schema["properties"] : {};
  const required = Array.isArray(schema["required"]) ? (schema["required"] as string[]) : [];
  const at = (key: string): string => (path === "(root)" ? key : `${path}.${key}`);
  const out: Record<string, unknown> = {};

  for (const key of required) {
    if (value[key] === undefined || value[key] === null) {
      issues.push({ path: at(key), message: "필수 입력입니다" });
    }
  }
  for (const [key, raw] of Object.entries(value)) {
    const propSchema = properties[key];
    if (isPlainObject(propSchema)) {
      // 선택 입력에 null·undefined 를 보내면 "보내지 않음"으로 본다
      if (raw === undefined || raw === null) continue;
      out[key] = checkNode(propSchema, raw, at(key), issues);
      continue;
    }
    if (schema["additionalProperties"] === false) {
      issues.push({ path: at(key), message: "이 도구가 받지 않는 입력입니다" });
      continue;
    }
    out[key] = raw;
  }
  return out;
}

/** 입력을 도구의 입력 형식과 견준다. 입력이 없으면 빈 객체로 본다. */
export function validateInput(schema: ToolInputSchema, input: unknown): InputCheck {
  const issues: InputIssue[] = [];
  const value = input === undefined || input === null ? {} : input;
  if (!isPlainObject(value)) {
    return {
      ok: false,
      issues: [{ path: "(root)", message: `객체여야 합니다 (받은 값: ${describeType(value)})` }],
    };
  }
  const checked = checkObject(schema as unknown as SchemaNode, value, "(root)", issues);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: checked };
}

/** 검사에 실패하면 INVALID_INPUT 오류를 던지고, 통과하면 (필요하면 바꾼) 입력을 돌려준다. */
export function assertValidInput(
  toolName: string,
  schema: ToolInputSchema,
  input: unknown,
): Record<string, unknown> {
  const check = validateInput(schema, input);
  if (check.ok) return check.value;
  throw new QualityMcpError(
    ERROR_CODES.INVALID_INPUT,
    `${toolName} 입력이 형식에 맞지 않습니다: ` +
      check.issues.map((i) => `${i.path} — ${i.message}`).join("; "),
    check.issues,
  );
}

/**
 * 명령줄의 `--key value` 인자를 입력 형식에 맞는 값으로 바꾼다.
 * 형식이 문자열이면 숫자처럼 보여도 문자열로 둔다. 형식에 없는 키는 그대로 둔다
 * (받지 않는 입력이면 검사 단계가 알려 준다).
 */
export function coerceCliArgs(
  schema: ToolInputSchema,
  raw: Record<string, string | true>,
): Record<string, unknown> {
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const prop = properties[key];
    out[key] = isPlainObject(prop) ? coerceCliValue(prop, value) : value;
  }
  return out;
}

function coerceCliValue(schema: SchemaNode, raw: string | true): unknown {
  const type = schema["type"];
  if (raw === true) return type === "boolean" || type === undefined ? true : raw;
  switch (type) {
    case "boolean":
      if (raw === "true") return true;
      if (raw === "false") return false;
      return raw;
    case "number":
    case "integer":
      return NUMERIC_STRING.test(raw.trim()) ? Number(raw) : raw;
    case "array": {
      const trimmed = raw.trim();
      if (trimmed.startsWith("[")) {
        try {
          return JSON.parse(trimmed) as unknown;
        } catch {
          return raw;
        }
      }
      const items = isPlainObject(schema["items"]) ? schema["items"] : {};
      return trimmed
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => coerceCliValue(items, part));
    }
    case "object":
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return raw;
      }
    default:
      return raw;
  }
}
