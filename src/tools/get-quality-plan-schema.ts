import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_quality_plan_schema',
  schemaId: 'quality_plan',
  description: '품질관리계획서 (건설기술 진흥법 제55조 · 시행령 제89조·제90조 · 업무지침 제7조·별표 1)',
});

export const spec = tool.spec;
export const run = tool.run;
