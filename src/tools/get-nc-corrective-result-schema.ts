import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_nc_corrective_result_schema',
  schemaId: 'nc_corrective_result',
  description: '부적합 조치결과 확인서 (실무 서식 — 법정 전용 서식 없음 · 업무지침 별표 1 의 8.12·10.1)',
});

export const spec = tool.spec;
export const run = tool.run;
