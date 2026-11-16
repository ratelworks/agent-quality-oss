import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_quality_daily_log_schema',
  schemaId: 'quality_daily_log',
  description: '품질관리 일지 (실무 서식 — 법정 의무 아님)',
});

export const spec = tool.spec;
export const run = tool.run;
