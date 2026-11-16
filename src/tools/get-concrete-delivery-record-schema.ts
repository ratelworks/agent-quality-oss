import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_concrete_delivery_record_schema',
  schemaId: 'concrete_delivery_record',
  description: '레미콘 차량별 입회시험 기록지 (실무 서식 · 업무지침 제38조 · KCS 14 20 10)',
});

export const spec = tool.spec;
export const run = tool.run;
