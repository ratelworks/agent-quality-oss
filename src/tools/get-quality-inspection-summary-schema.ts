import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_quality_inspection_summary_schema',
  schemaId: 'quality_inspection_summary',
  description: '품질검사 성과 총괄표 (별지 제43호 · 시행규칙 서식 · 시행령 §93 보존)',
});

export const spec = tool.spec;
export const run = tool.run;
