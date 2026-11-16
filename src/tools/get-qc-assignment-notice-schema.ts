import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_qc_assignment_notice_schema',
  schemaId: 'qc_assignment_notice',
  description: '품질관리 건설기술인 배치 내역서 (실무 서식 — 법정 전용 서식 없음 · 배치기준은 시행규칙 별표 5)',
});

export const spec = tool.spec;
export const run = tool.run;
