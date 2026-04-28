import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_qc_assignment_notice_schema',
  schemaId: 'qc_assignment_notice',
  description: '품질관리자 배치 신고서 (건설기술 진흥법 §55 + 시행규칙 §50)',
});

export const spec = tool.spec;
export const run = tool.run;
