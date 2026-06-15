import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_quality_plan_schema',
  schemaId: 'quality_plan',
  description: '품질관리 계획서 (건진법 §55 · 시행령 §89 · 시행규칙 §52 · 업무지침 §4)',
});

export const spec = tool.spec;
export const run = tool.run;
