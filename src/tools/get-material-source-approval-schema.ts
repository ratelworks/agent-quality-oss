import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_material_source_approval_schema',
  schemaId: 'material_source_approval',
  description: '자재 공급원 승인 요청서 (사업관리방식 지침 별지 제37호 · 제87조 · 건설기술 진흥법 제57조제1항)',
});

export const spec = tool.spec;
export const run = tool.run;
