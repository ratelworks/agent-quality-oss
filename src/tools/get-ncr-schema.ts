import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_ncr_schema',
  schemaId: 'ncr',
  description: '부적합 보고서(NCR) (실무 서식 — 법정 전용 서식 없음 · 업무지침 별표 1 의 8.12 · KS Q ISO 9001 8.7)',
});

export const spec = tool.spec;
export const run = tool.run;
