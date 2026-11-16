import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_test_report_review_schema',
  schemaId: 'test_report_review',
  description: '시험성적서 검토 보고서 (실무 서식 · 건설기술 진흥법 제60조 · 업무지침 제8조)',
});

export const spec = tool.spec;
export const run = tool.run;
