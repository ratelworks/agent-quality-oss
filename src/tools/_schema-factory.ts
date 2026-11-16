// ─────────────────────────────────────────────────────────────────────────────
// _schema-factory.ts — get_*_schema 도구 공통 팩토리.
//
// 문서 양식 19종의 스키마 도구는 `export const { spec, run } = createSchemaTool({...})`
// 형태로 이 팩토리를 쓴다. 입력은 sectionKey(선택) 하나다.
// ─────────────────────────────────────────────────────────────────────────────

import { getSchema } from "../schemas/loader.js";
import { buildResponse } from "../lib/response.js";
import { QualityMcpError, ERROR_CODES } from "../lib/errors.js";
import type {
  BasisRef,
  ToolContext,
  ToolInputSchema,
  ToolResponse,
  ToolRun,
  ToolSpec,
} from "../lib/types.js";

export interface SchemaToolDef {
  toolName: string;
  schemaId: string;
  description: string;
}

const SCHEMA_INPUT: ToolInputSchema = {
  type: "object",
  properties: {
    sectionKey: {
      type: "string",
      description: "특정 섹션만 반환 (선택, 예: header, actions, approval)",
    },
  },
  additionalProperties: false,
};

interface SchemaInput {
  sectionKey?: string;
}

export interface SchemaToolResult {
  spec: ToolSpec;
  run: ToolRun;
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

  const spec: ToolSpec = { name: def.toolName, description, inputSchema: SCHEMA_INPUT };

  const run: ToolRun = (args: SchemaInput | undefined, graph) => runImpl(args ?? {}, { graph });

  return { spec, run };
}
