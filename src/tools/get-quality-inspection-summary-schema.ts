import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_quality_inspection_summary_schema',
  schemaId: 'quality_inspection_summary',
  description: '품질검사 성과 총괄표 (시행규칙 별지 제43호 · 시행령 제93조 — 검사 신청 때 발주자에게 제출, 시설물 존속기간 보존)',
});

export const spec = tool.spec;
export const run = tool.run;
