import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_inspection_checklist_schema',
  schemaId: 'inspection_checklist',
  description: '검측 체크리스트 (사업관리방식 지침 별지 제36호 제3쪽 · 제86조)',
});

export const spec = tool.spec;
export const run = tool.run;
