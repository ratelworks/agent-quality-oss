// ─────────────────────────────────────────────────────────────────────────────
// zod-helpers.ts — quality-oss zod 공통 헬퍼.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

// 파일 최상단 상수 — 안전한 boolean 파서
// z.coerce.boolean()은 Boolean(input)을 사용해 "false" 같은 비어있지 않은
// 문자열을 전부 true로 만든다. 품질관리 도구에서는 이 부작용이 치명적이므로
// 별도 헬퍼를 사용한다.
const TRUE_LITERALS = new Set(["true", "1", "yes", "on"]);
const FALSE_LITERALS = new Set(["false", "0", "no", "off"]);

/**
 * 진짜 boolean, 또는 사전 정의 literal 문자열만 허용.
 * 그 외 (빈 문자열, 임의 문자열, 숫자 등)는 거절.
 */
export const stringBool = z.union([z.boolean(), z.string()]).transform((v, ctx) => {
  if (typeof v === "boolean") return v;
  const normalized = v.trim().toLowerCase();
  if (TRUE_LITERALS.has(normalized)) return true;
  if (FALSE_LITERALS.has(normalized)) return false;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `"${v}"는 boolean 값이 아님. true/false, 1/0, yes/no 중 하나여야 함.`,
  });
  return z.NEVER;
});

/**
 * 콤마 구분 문자열 → string[] (CLI 인자 호환).
 * 빈 문자열은 빈 배열 반환.
 */
export const stringList = z.union([z.array(z.string()), z.string()]).transform((v) => {
  if (Array.isArray(v)) return v;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
});

/**
 * 음수 차단 정수 (사용자 입력 우발 음수 방지).
 */
export const nonNegativeInt = z.coerce.number().int().nonnegative();

/**
 * 1 이상 양수 (limit·top 등 페이지네이션).
 */
export const positiveInt = z.coerce.number().int().min(1);
