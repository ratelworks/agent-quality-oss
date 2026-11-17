import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_monthly_test_report_schema',
  schemaId: 'monthly_test_report',
  description: '품질시험·검사실적 보고서 (사업관리방식 지침 별지 제18호 · 제60조제10항·제90조제15항 — 매월 제출)',
});

export const spec = tool.spec;
export const run = tool.run;
