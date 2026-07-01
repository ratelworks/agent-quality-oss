// ─────────────────────────────────────────────────────────────────────────────
// chain_quality_test_plan — 품질시험계획 재료 체인 (plan.md §7.4 Tool 17).
//
// 흐름: 공종 목록 각각 resolve → 자재별 시험종목·방법·빈도 수집(별표2 체계)
//       → 품질시험계획서 양식 + verified 법령 근거 (시행령 §90·별표9).
// ─────────────────────────────────────────────────────────────────────────────

import { run as resolveWorktype } from "./resolve-worktype.js";
import { run as compileDocumentReferences } from "./compile-document-references.js";
import { buildResponse } from "./_response.js";
import { mergeBasis } from "./_compile-common.js";
import type { ToolSpec, BasisRef, ToolResponse } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

export const spec: ToolSpec = {
  name: "chain_quality_test_plan",
  description:
    "품질시험계획 재료 체인 — 공사의 공종 목록(자연어 가능)을 받아 공종×자재×시험종목·방법·빈도 매트릭스와 품질시험계획서 양식·적용 법령(verified: 시행령 §90·별표9, 업무지침 §8·별표2)을 한 번에 조립한다. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]",
  inputSchema: {
    type: "object",
    properties: {
      workTypes: {
        type: "array",
        items: { type: "string" },
        description: "공종 id 또는 자연어 표현 배열 (예: ['콘크리트 타설', '철근'])",
      },
    },
    required: ["workTypes"],
  },
};

export interface ChainTestPlanArgs {
  workTypes: string[];
}

interface TestRow {
  workType: string;
  workTypeId: string;
  material: string;
  materialId: string;
  test: string;
  testId: string;
  method: string | null;
  frequency: string | null;
  sourceStatus: string;
}

export function run(args: ChainTestPlanArgs, graph: OntologyGraph): ToolResponse {
  const { workTypes } = args ?? ({} as ChainTestPlanArgs);
  if (!Array.isArray(workTypes) || workTypes.length === 0) {
    throw new Error("workTypes(배열)는 필수입니다.");
  }

  const rows: TestRow[] = [];
  const unresolved: string[] = [];
  const basisGroups: BasisRef[][] = [];

  for (const input of workTypes) {
    const resolved = resolveWorktype({ input }, graph);
    const workId = resolved.result?.resolved?.id as string | undefined;
    if (!workId) {
      unresolved.push(input);
      continue;
    }
    basisGroups.push(resolved.basis as BasisRef[]);
    const w = graph.get(workId);
    if (!w) continue;
    for (const m of graph.neighbors(workId)["usesMaterial"] ?? []) {
      for (const t of graph.neighbors(m.id)["requiresTest"] ?? []) {
        const meta = t.meta ?? {};
        rows.push({
          workType: w.name,
          workTypeId: workId,
          material: m.name,
          materialId: m.id,
          test: t.name,
          testId: t.id,
          method: (meta["method"] as string | undefined) ?? null,
          frequency: (meta["frequency"] as string | undefined) ?? null,
          sourceStatus: (meta["sourceStatus"] as string | undefined) ?? "unknown",
        });
      }
    }
  }

  // 품질시험계획서 근거 패키지
  const planPkg = compileDocumentReferences({ docId: "quality_test_plan" }, graph);

  const result = {
    input: { workTypes },
    testMatrix: rows,
    matrixCount: rows.length,
    unresolvedWorkTypes: unresolved,
    testPlanDocument: planPkg.result,
    usage:
      "testMatrix(공종×자재×시험·방법·빈도)를 quality_test_plan 양식의 시험계획 표에 채운다. 시험 빈도·방법의 근거는 업무지침 별표2. 계획 승인은 발주자·감리원.",
  };

  return buildResponse(
    "chain_quality_test_plan",
    graph.version,
    result,
    mergeBasis(
      ...basisGroups,
      rows.map((r) => ({ type: "ontology", id: r.testId, priority: 2 }) as BasisRef),
      planPkg.basis as BasisRef[],
    ),
    unresolved.length > 0
      ? {
          required: true,
          reason: `해석 실패 공종 ${unresolved.length}건: ${unresolved.join(", ")} — 정확한 공종명으로 재시도 필요.`,
        }
      : undefined,
  );
}
