// ─────────────────────────────────────────────────────────────────────────────
// json-schema.ts — zod 스키마를 MCP wire의 JSON Schema 형태로 변환.
//
// MCP listTools 응답은 inputSchema에 JSON Schema (object subset)을 요구한다.
// zod-to-json-schema 라이브러리를 thin wrapper로 감싸 일관된 출력 보장.
// ─────────────────────────────────────────────────────────────────────────────

import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolInputSchema } from "./types.js";

/**
 * zod 스키마 → MCP JSON Schema (object root 보장).
 * - 결과는 항상 type: "object"
 * - $schema, definitions 등 메타는 제거 (MCP 클라이언트 호환성)
 */
export function zodToMcpInputSchema(schema: z.ZodTypeAny): ToolInputSchema {
  const raw = zodToJsonSchema(schema, {
    target: "openApi3",
    $refStrategy: "none",
  }) as Record<string, unknown>;

  // openApi3 타깃은 $schema를 붙이지 않고 단순 object로 반환
  // 비-object 루트는 강제로 object로 wrap
  if (raw["type"] !== "object") {
    return {
      type: "object",
      properties: { value: raw },
    };
  }

  const result: ToolInputSchema = {
    type: "object",
    properties: (raw["properties"] as Record<string, unknown> | undefined) ?? {},
  };
  if (Array.isArray(raw["required"])) {
    result.required = raw["required"] as string[];
  }
  if (typeof raw["additionalProperties"] === "boolean") {
    result.additionalProperties = raw["additionalProperties"];
  }
  return result;
}
