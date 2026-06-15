import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_inspection_checklist_schema',
  schemaId: 'inspection_checklist',
  description: '검측 체크리스트 (건설공사 품질관리 업무지침 · 감리계약 · 부재별 작성)',
});

export const spec = tool.spec;
export const run = tool.run;
