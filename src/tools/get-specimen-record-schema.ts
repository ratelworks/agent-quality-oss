import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_specimen_record_schema',
  schemaId: 'specimen_record',
  description: '공시체 제작·관리 기록지 (KS F 2403/2405 · KCS 14 20 10 §3.3 기반)',
});

export const spec = tool.spec;
export const run = tool.run;
