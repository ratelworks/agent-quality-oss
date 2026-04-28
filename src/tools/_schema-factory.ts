/**
 * get_*_schema Tool 공통 팩토리.
 */

import { getSchema } from '../schemas/loader.js';
import { buildResponse } from './_response.js';
import type { BasisRef, ToolModule, ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

export interface SchemaToolDef {
  toolName: string;
  schemaId: string;
  description: string;
}

export function createSchemaTool(def: SchemaToolDef): ToolModule {
  const spec: ToolSpec = {
    name: def.toolName,
    description: `${def.description} 양식의 필수 필드·구조를 반환한다 (문서를 직접 생성하지 않음). [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]`,
    inputSchema: {
      type: 'object',
      properties: {
        sectionKey: {
          type: 'string',
          description: '특정 섹션만 반환 (선택, 예: header, actions, approval)',
        },
      },
    },
  };

  function run(args: { sectionKey?: string } | undefined, graph: OntologyGraph) {
    const schema = getSchema(def.schemaId);
    if (!schema) {
      throw new Error(`schema not found: ${def.schemaId}`);
    }
    const sectionKey = args?.sectionKey;
    const sections = sectionKey
      ? schema.sections.filter((s) => s.key === sectionKey)
      : schema.sections;

    const basisIds = (schema.basis ?? []).filter((id) => graph.get(id));
    const basis: BasisRef[] =
      basisIds.length > 0
        ? basisIds.map((id) => ({ type: 'ontology', id, priority: 1 }))
        : [{ type: 'schema_meta', id: def.schemaId, priority: 2, note: '문서 양식 스키마' }];

    return buildResponse(
      def.toolName,
      graph.version,
      {
        schemaId: schema.id,
        title: schema.title,
        reference: schema.reference ?? null,
        referenceStandard: schema.referenceStandard ?? null,
        retention: schema.retention ?? null,
        sections,
        usage: '이 스키마를 LLM이 받아 실제 문서를 작성. 본 서버는 구조·필드만 제공.',
      },
      basis,
    );
  }

  return { spec, run };
}
