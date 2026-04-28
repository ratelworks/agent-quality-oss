import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_quality_inspection_register_schema',
  schemaId: 'quality_inspection_register',
  description: '품질검사 실시대장 (별지 제42호, 건설기술 진흥법 시행규칙 §51) — 시공자 매일 누적 작성',
});

export const spec = tool.spec;
export const run = tool.run;
