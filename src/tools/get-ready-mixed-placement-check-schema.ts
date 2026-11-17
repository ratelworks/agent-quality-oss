import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_ready_mixed_placement_check_schema',
  schemaId: 'ready_mixed_placement_check',
  description: '레미콘 시공품질관리 점검표 (업무지침 별지 제11호 · 제38조제4항 — 반입부터 시공완료까지 기록·비치)',
});

export const spec = tool.spec;
export const run = tool.run;
