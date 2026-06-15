import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_corrective_action_request_schema',
  schemaId: 'corrective_action_request',
  description: '시정조치 요구서 CAR (ISO 9001 §8.7 + 업무지침 §7 — NCR 후속, 법정 서식 아님)',
});

export const spec = tool.spec;
export const run = tool.run;
