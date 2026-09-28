import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_quality_inspection_report_schema',
  schemaId: 'quality_inspection_report',
  description: '품질관리 점검 결과 보고서 (업무지침 §10 적절성 확인 · 시행규칙 §52)',
});

export const spec = tool.spec;
export const run = tool.run;
