import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_quality_inspection_report_schema',
  schemaId: 'quality_inspection_report',
  description: '자체 품질점검 결과 보고서 (실무 서식 · 시행령 제91조제3항제5호 — 발주청 등의 적절성 확인과 다름)',
});

export const spec = tool.spec;
export const run = tool.run;
