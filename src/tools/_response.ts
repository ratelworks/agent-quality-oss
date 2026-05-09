// ─────────────────────────────────────────────────────────────────────────────
// _response.ts — DEPRECATED shim. lib/response.ts가 표준 위치.
// 도구 마이그레이션 기간 동안 기존 import 경로를 유지하기 위한 re-export.
// 신규 도구는 직접 ../lib/response.js 에서 import 할 것.
// ─────────────────────────────────────────────────────────────────────────────

export {
  buildResponse,
  canonicalize,
  entityBasis,
  entityBasisWithStatus,
  annotateBasisWithStatus,
  annotateResponse,
} from "../lib/response.js";
export { LEGAL_NOTE } from "../config/constants.js";

// Tool 에러 페이로드 (ToolErrorShape) — 일부 도구가 사용 중. 새 코드는 QualityMcpError 권장.
export interface ToolErrorShape {
  ok: false;
  toolName: string;
  code: string;
  message: string;
  details?: unknown;
}

export function toolError(
  toolName: string,
  code: string,
  message: string,
  details?: unknown,
): ToolErrorShape {
  return { ok: false, toolName, code, message, details };
}
