// ─────────────────────────────────────────────────────────────────────────────
// _schema-factory.ts — get_*_schema 도구 공통 팩토리.
//
// 본 팩토리는 두 인터페이스를 동시에 반환한다:
//   - definition : ToolDefinition (zod inputSchema, run(input, ctx))
//   - spec / run : Legacy ToolModule 분해 export 호환
//
// 9개 schema 도구는 `export const { spec, run } = createSchemaTool({...})`
// 형태로 그대로 사용. 신규 코드는 `definition` 사용 권장.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { getSchema } from "../schemas/loader.js";
import { buildResponse } from "../lib/response.js";
import { QualityMcpError, ERROR_CODES } from "../lib/errors.js";
import { zodToMcpInputSchema } from "../lib/json-schema.js";
import type {
  BasisRef,
  ToolDefinition,
  ToolContext,
  ToolResponse,
  ToolSpecLegacy,
  ToolRunLegacy,
} from "../lib/types.js";

export interface SchemaToolDef {
  toolName: string;
  schemaId: string;
  description: string;
}

const SCHEMA_INPUT = z.object({
  sectionKey: z
    .string()
    .optional()
    .describe("특정 섹션만 반환 (선택, 예: header, actions, approval)"),
});

type SchemaInput = z.infer<typeof SCHEMA_INPUT>;

export interface SchemaToolResult {
  /** 신규 ToolDefinition — tool-registry 가 참조 권장 */
  definition: ToolDefinition;
  /** Legacy: 기존 9개 schema 도구 파일이 분해 export 하는 spec */
  spec: ToolSpecLegacy;
  /** Legacy: 기존 9개 schema 도구 파일이 분해 export 하는 run */
  run: ToolRunLegacy;
}

export function createSchemaTool(def: SchemaToolDef): SchemaToolResult {
  function runImpl(input: SchemaInput, ctx: ToolContext): ToolResponse {
    const schema = getSchema(def.schemaId);
    if (!schema) {
      throw new QualityMcpError(
        ERROR_CODES.SCHEMA_NOT_FOUND,
        `schema not found: ${def.schemaId}`,
      );
    }
    const sectionKey = input.sectionKey;
    const sections = sectionKey
      ? schema.sections.filter((s) => s.key === sectionKey)
      : schema.sections;

    const basisIds = (schema.basis ?? []).filter((id) => ctx.graph.get(id));
    const basis: BasisRef[] =
      basisIds.length > 0
        ? basisIds.map((id) => ({ type: "ontology", id, priority: 1 }))
        : [
            {
              type: "schema_meta",
              id: def.schemaId,
              priority: 2,
              note: "문서 양식 스키마",
            },
          ];

    return buildResponse(
      def.toolName,
      ctx.graph.version,
      {
        schemaId: schema.id,
        title: schema.title,
        reference: schema.reference ?? null,
        referenceStandard: schema.referenceStandard ?? null,
        retention: schema.retention ?? null,
        sections,
        usage:
          "이 스키마를 LLM이 받아 실제 문서를 작성. 본 서버는 구조·필드만 제공.",
      },
      basis,
    );
  }

  const description = `${def.description} 양식의 필수 필드·구조를 반환한다 (문서를 직접 생성하지 않음). [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]`;

  const definition: ToolDefinition = {
    name: def.toolName,
    description,
    inputSchema: SCHEMA_INPUT,
    run: (input, ctx) => runImpl(SCHEMA_INPUT.parse(input), ctx),
  };

  const spec: ToolSpecLegacy = {
    name: def.toolName,
    description,
    inputSchema: zodToMcpInputSchema(SCHEMA_INPUT),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run: ToolRunLegacy = (args: any, graph) =>
    runImpl(SCHEMA_INPUT.parse(args ?? {}), { graph });

  return { definition, spec, run };
}
