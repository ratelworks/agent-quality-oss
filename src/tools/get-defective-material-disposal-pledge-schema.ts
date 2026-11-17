import { createSchemaTool } from './_schema-factory.js';

const tool = createSchemaTool({
  toolName: 'get_defective_material_disposal_pledge_schema',
  schemaId: 'defective_material_disposal_pledge',
  description: '불량자재폐기 확약서 (업무지침 별지 제13호 · 제41조제2항 — 생산자에게 받아 준공까지 보관)',
});

export const spec = tool.spec;
export const run = tool.run;
