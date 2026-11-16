import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_quality_test_plan_schema',
  schemaId: 'quality_test_plan',
  description: '품질시험계획서 (건설기술 진흥법 제55조 · 시행령 제89조제2항·별표 9·제90조 · 서식은 사업관리방식 지침 별지 제16호)',
});

export const spec = tool.spec;
export const run = tool.run;
