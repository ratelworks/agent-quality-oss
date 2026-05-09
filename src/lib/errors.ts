// ─────────────────────────────────────────────────────────────────────────────
// errors.ts — quality-oss MCP 표준 에러 타입과 직렬화.
//
// 도구 핸들러 내부에서는 QualityMcpError를 throw하고,
// 라우터(mcp/stdio.ts, mcp/http.ts, cli.ts)는 toMcpErrorContent로 직렬화.
// ─────────────────────────────────────────────────────────────────────────────

import { ZodError } from "zod";

// 파일 최상단 상수 — 표준 에러 코드
export const ERROR_CODES = {
  INVALID_INPUT: "INVALID_INPUT",
  NOT_FOUND: "NOT_FOUND",
  ONTOLOGY_INVALID: "ONTOLOGY_INVALID",
  SCHEMA_NOT_FOUND: "SCHEMA_NOT_FOUND",
  UNKNOWN_TOOL: "UNKNOWN_TOOL",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class QualityMcpError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "QualityMcpError";
    this.code = code;
    this.details = details;
  }
}

export function isQualityMcpError(err: unknown): err is QualityMcpError {
  return err instanceof QualityMcpError;
}

// ZodError → INVALID_INPUT 페이로드
function zodErrorToPayload(err: ZodError): {
  code: ErrorCode;
  message: string;
  details: Array<{ path: string; message: string; code: string }>;
} {
  return {
    code: ERROR_CODES.INVALID_INPUT,
    message: "Input validation failed",
    details: err.issues.map((i) => ({
      path: i.path.join(".") || "(root)",
      message: i.message,
      code: i.code,
    })),
  };
}

// ───── MCP CallTool 응답용 에러 페이로드 직렬화 ─────
export interface McpErrorContent {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
}

export function toMcpErrorContent(err: unknown): McpErrorContent {
  // 1) Zod 입력 검증 실패
  if (err instanceof ZodError) {
    const payload = zodErrorToPayload(err);
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      isError: true,
    };
  }

  // 2) 내부 표준 에러
  if (isQualityMcpError(err)) {
    const payload: Record<string, unknown> = {
      code: err.code,
      message: err.message,
    };
    if (err.details !== undefined) payload.details = err.details;
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      isError: true,
    };
  }

  // 3) 그 외 예기치 못한 오류만 INTERNAL
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ code: ERROR_CODES.INTERNAL, message }, null, 2),
      },
    ],
    isError: true,
  };
}

// ───── HTTP 응답용 ─────
export interface HttpErrorPayload {
  ok: false;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export function toHttpErrorPayload(err: unknown): { status: number; payload: HttpErrorPayload } {
  if (err instanceof ZodError) {
    return {
      status: 400,
      payload: {
        ok: false,
        code: ERROR_CODES.INVALID_INPUT,
        message: "Input validation failed",
        details: err.issues.map((i) => ({
          path: i.path.join(".") || "(root)",
          message: i.message,
          code: i.code,
        })),
      },
    };
  }
  if (isQualityMcpError(err)) {
    const status =
      err.code === ERROR_CODES.NOT_FOUND || err.code === ERROR_CODES.UNKNOWN_TOOL
        ? 404
        : err.code === ERROR_CODES.INVALID_INPUT
          ? 400
          : 500;
    return {
      status,
      payload: {
        ok: false,
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    };
  }
  return {
    status: 500,
    payload: {
      ok: false,
      code: ERROR_CODES.INTERNAL,
      message: err instanceof Error ? err.message : String(err),
    },
  };
}
