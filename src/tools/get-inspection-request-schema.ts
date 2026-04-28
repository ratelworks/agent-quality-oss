import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_inspection_request_schema',
  schemaId: 'inspection_request',
  description: '검측 신청서 (감리원 입회 검측 요청 양식, 통상 24~48h 전 제출)',
});

export const spec = tool.spec;
export const run = tool.run;
