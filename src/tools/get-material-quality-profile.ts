/**
 * Tool: get_material_quality_profile
 */

import { searchEntities } from '../ontology/resolver.js';
import { buildResponse, entityBasis } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

export const spec: ToolSpec = {
  name: 'get_material_quality_profile',
  description:
    '자재 하나의 시험·증빙·기준·관련 리스크·부적합을 반환한다. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      material: { type: 'string', description: '자재 id(material.*) 또는 자연어 표현' },
    },
    required: ['material'],
  },
};

export interface MaterialProfileArgs {
  material: string;
}

export function run(args: MaterialProfileArgs, graph: OntologyGraph) {
  const { material } = args ?? ({ material: '' } as MaterialProfileArgs);
  if (!material) throw new Error('material은 필수입니다.');

  let matId = material;
  if (!graph.get(material)) {
    const hits = searchEntities(graph, material, 'Material', 1);
    const first = hits[0];
    if (!first) {
      return buildResponse(
        'get_material_quality_profile',
        graph.version,
        { input: material, profile: null },
        [{ type: 'ontology_meta', id: 'no_match', priority: 3, note: '자재 해석 실패' }],
        { required: true, reason: `자재 해석 실패: ${material}` },
      );
    }
    matId = first.id;
  }

  const mat = graph.get(matId);
  if (!mat || mat.type !== 'Material') {
    return buildResponse(
      'get_material_quality_profile',
      graph.version,
      { input: material, profile: null },
      [{ type: 'ontology_meta', id: 'not_material', priority: 3 }],
      { required: true, reason: `id ${matId}는 Material이 아닙니다.` },
    );
  }

  const n1 = graph.neighbors(matId);
  const tests = (n1['requiresTest'] ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    method: (t.meta?.['method'] as string | undefined) ?? null,
    frequency: (t.meta?.['frequency'] as string | undefined) ?? null,
    typicalAcceptance: (t.meta?.['typicalAcceptance'] as string | undefined) ?? null,
  }));
  const documents = (n1['requiresDocument'] ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    mandatory: Boolean(d.meta?.['mandatory']),
  }));
  const standards = (n1['requiresStandard'] ?? []).map((s) => ({ id: s.id, name: s.name }));

  const incoming = graph
    .incoming(matId)
    .filter((x) => x.relation === 'usesMaterial')
    .map((x) => ({ id: x.from.id, name: x.from.name }));

  const ncrs = graph
    .incoming(matId)
    .filter((x) => x.relation === 'relatedMaterial' && x.from.type === 'Nonconformance')
    .map((x) => ({ id: x.from.id, name: x.from.name }));

  const result = {
    material: { id: mat.id, name: mat.name, category: (mat.meta?.['category'] as string | undefined) ?? null },
    tests,
    documents,
    standards,
    relatedWorks: incoming,
    possibleNonconformance: ncrs,
  };

  const basisIds = [
    mat.id,
    ...tests.map((t) => t.id),
    ...documents.map((d) => d.id),
    ...standards.map((s) => s.id),
    ...incoming.map((w) => w.id),
    ...ncrs.map((n) => n.id),
  ];

  return buildResponse('get_material_quality_profile', graph.version, result, entityBasis(basisIds, 1));
}
