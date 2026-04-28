import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_quality_test_plan_schema',
  schemaId: 'quality_test_plan',
  description: '품질시험계획서 (건설기술 진흥법 §55 + 시행령 §90 + 시행규칙 §53)',
});

export const spec = tool.spec;
export const run = tool.run;
