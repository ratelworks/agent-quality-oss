import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_quality_inspection_register_schema',
  schemaId: 'quality_inspection_register',
  description: '품질검사 실시대장 (시행규칙 별지 제42호 · 제50조제1항) — 검사할 때마다 기록, 7일 이내 정보망 입력',
});

export const spec = tool.spec;
export const run = tool.run;
