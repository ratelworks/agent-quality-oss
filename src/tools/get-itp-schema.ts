import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_itp_schema',
  schemaId: 'itp',
  description: '검사 및 시험 계획(ITP) (실무 서식 · 업무지침 별표 1 의 8.11 · 검사점 구분은 국제 관행)',
});

export const spec = tool.spec;
export const run = tool.run;
