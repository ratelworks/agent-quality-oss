import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_inspection_request_schema',
  schemaId: 'inspection_request',
  description: '검측요청서 (사업관리방식 지침 별지 제36호 · 제86조제9항)',
});

export const spec = tool.spec;
export const run = tool.run;
