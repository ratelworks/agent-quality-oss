import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_test_report_review_schema',
  schemaId: 'test_report_review',
  description: '시험성적서 검토 보고서 (chain of custody 포함 · 건진법 §60 · 업무지침 §8 기반)',
});

export const spec = tool.spec;
export const run = tool.run;
