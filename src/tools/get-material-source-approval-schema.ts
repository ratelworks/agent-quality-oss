import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_material_source_approval_schema',
  schemaId: 'material_source_approval',
  description: '자재 공급원 승인 요청서 (건진법 §56 · 사업관리방식 지침 별지 제37호)',
});

export const spec = tool.spec;
export const run = tool.run;
