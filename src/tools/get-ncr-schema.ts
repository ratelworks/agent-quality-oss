import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_ncr_schema',
  schemaId: 'ncr',
  description: '부적합 보고서(NCR, ISO 9001 §8.7 · 업무지침 §7 기반)',
});

export const spec = tool.spec;
export const run = tool.run;
