import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_corrective_action_request_schema',
  schemaId: 'corrective_action_request',
  description: '시정조치 요구서(CAR) (실무 서식 — 법정 전용 서식 없음 · 업무지침 별표 1 의 10.1 · KS Q ISO 9001 10.2)',
});

export const spec = tool.spec;
export const run = tool.run;
