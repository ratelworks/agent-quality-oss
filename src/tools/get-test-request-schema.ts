import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_test_request_schema',
  schemaId: 'test_request',
  description: '시험 의뢰서 (KOLAS 외부 시험 · 건진법 §57 전문기관 · §60 대행·확인)',
});

export const spec = tool.spec;
export const run = tool.run;
