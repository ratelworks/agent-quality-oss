import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_itp_schema',
  schemaId: 'itp',
  description: 'ITP/검측시험계획 (Hold/Witness/Surveillance/Review/Execution point 체계 · 업무지침 §5 기반)',
});

export const spec = tool.spec;
export const run = tool.run;
