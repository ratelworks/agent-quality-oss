import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_quality_daily_log_schema',
  schemaId: 'quality_daily_log',
  description: '시방서(품질관리) 일지 (실무 표준 — 법정 의무 아님. 업무지침 §6·§10 활동 기록)',
});

export const spec = tool.spec;
export const run = tool.run;
