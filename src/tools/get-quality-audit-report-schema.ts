import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_quality_audit_report_schema',
  schemaId: 'quality_audit_report',
  description: '품질감사 보고서 (ISO 9001 내부감사 절차 — 법정 의무 아님)',
});

export const spec = tool.spec;
export const run = tool.run;
