import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_test_request_schema',
  schemaId: 'test_request',
  description: '품질검사 대행 의뢰서 (실무 서식 · 건설기술 진흥법 제60조 · 시행규칙 제56조 — 법정 경로는 정보망 입력)',
});

export const spec = tool.spec;
export const run = tool.run;
