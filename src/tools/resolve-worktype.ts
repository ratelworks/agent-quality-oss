/**
 * Tool: resolve_worktype
 */

import { resolveWorkType } from '../ontology/resolver.js';
import { buildResponse, entityBasis } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

export const spec: ToolSpec = {
  name: 'resolve_worktype',
  description:
    '사용자의 자연어 공종 표현(예: "슬래브 타설")을 표준 공종 id로 해석한다. 실패 시 humanCheckpoint로 반환. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string', description: '자연어 공종 표현' },
    },
    required: ['input'],
  },
};

export interface ResolveArgs {
  input: string;
}

export function run(args: ResolveArgs, graph: OntologyGraph) {
  const { input } = args ?? ({ input: '' } as ResolveArgs);
  if (!input || typeof input !== 'string') {
    throw new Error('input은 필수 문자열입니다.');
  }

  const hit = resolveWorkType(graph, input);
  if (!hit) {
    return buildResponse(
      'resolve_worktype',
      graph.version,
      { input, resolved: null },
      [{ type: 'ontology_meta', id: 'no_match', priority: 3, note: '공종 해석 실패' }],
      {
        required: true,
        reason: `"${input}"를 표준 공종 id로 해석 실패. 온톨로지 확장 또는 LLM fallback 필요.`,
      },
    );
  }

  const work = graph.get(hit.id);
  const neighbors = graph.neighbors(hit.id);
  const relatedMaterials = (neighbors['usesMaterial'] ?? []).map((m) => ({ id: m.id, name: m.name }));

  const relatedTests = new Map<string, { id: string; name: string }>();
  for (const m of neighbors['usesMaterial'] ?? []) {
    for (const t of graph.neighbors(m.id)['requiresTest'] ?? []) {
      relatedTests.set(t.id, { id: t.id, name: t.name });
    }
  }

  const result = {
    input,
    resolved: {
      id: hit.id,
      name: hit.name,
      type: hit.type,
      confidence: Number(hit.score.toFixed(3)),
      matchedBy: hit.matchedBy,
      parent: (work?.meta?.['parent'] as string | undefined) ?? null,
    },
    relatedMaterials,
    relatedTests: [...relatedTests.values()],
  };

  const basis = entityBasis(
    [hit.id, ...relatedMaterials.map((m) => m.id), ...relatedTests.keys()],
    1,
  );

  return buildResponse('resolve_worktype', graph.version, result, basis);
}
