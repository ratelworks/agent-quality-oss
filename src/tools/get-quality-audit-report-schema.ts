import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_quality_audit_report_schema',
  schemaId: 'quality_audit_report',
  description: '내부심사(품질감사) 보고서 (실무 서식 · 품질관리계획 대상 공사는 업무지침 별표 1 의 9.3 에 따라 년 1회 이상)',
});

export const spec = tool.spec;
export const run = tool.run;
