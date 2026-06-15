import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_nc_corrective_result_schema',
  schemaId: 'nc_corrective_result',
  description: '부적합 조치결과 확인서 (건설공사 품질관리 업무지침 §7 · 별지 제6호)',
});

export const spec = tool.spec;
export const run = tool.run;
