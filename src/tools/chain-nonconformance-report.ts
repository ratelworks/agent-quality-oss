// ─────────────────────────────────────────────────────────────────────────────
// chain_nonconformance_report — 부적합 처리 체인 (plan.md §7.4 Tool 19).
//
// 흐름: (관측값 있으면) 수치 판정 → 공종/시험 기반 NCR 후보·조치·증빙 조립
//       (compile_ncr_references) → NCR 양식 + verified 법령 근거 (§39·§41).
// ─────────────────────────────────────────────────────────────────────────────

import { run as resolveWorktype } from "./resolve-worktype.js";
import { run as evaluateObservation } from "./evaluate-observation.js";
import { run as compileNcrReferences } from "./compile-ncr-references.js";
import { buildResponse } from "./_response.js";
import { mergeBasis, schemaLegalBasisSummaries } from "./_compile-common.js";
import type { ToolSpec, BasisRef, ToolResponse } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

export const spec: ToolSpec = {
  name: "chain_nonconformance_report",
  description:
    "부적합 처리 체인 — 부적합 상황(관측값·공종·시험 중 아는 것)을 받아 수치 판정(있으면) → NCR 후보·원인·즉시/시정 조치·필요 증빙 → NCR 양식·법령 근거(verified: 업무지침 §39·§41)까지 한 번에 조립한다. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]",
  inputSchema: {
    type: "object",
    properties: {
      workType: { type: "string", description: "공종 id 또는 자연어 (선택)" },
      testId: { type: "string", description: "시험 id (선택, 예: test.slump)" },
      ncrId: { type: "string", description: "NCR id를 이미 알면 직접 지정 (선택)" },
      observation: { type: "string", description: "관측값 문장 (선택, 예: '슬럼프 205mm')" },
    },
  },
};

export interface ChainNcrArgs {
  workType?: string;
  testId?: string;
  ncrId?: string;
  observation?: string;
}

export function run(args: ChainNcrArgs, graph: OntologyGraph): ToolResponse {
  const { workType, testId, ncrId, observation } = args ?? {};
  if (!workType && !testId && !ncrId && !observation) {
    throw new Error("workType · testId · ncrId · observation 중 하나는 필수입니다.");
  }

  const basisGroups: BasisRef[][] = [];

  // 1. 공종 해석 (자연어 허용)
  let workId: string | undefined;
  if (workType) {
    const resolved = resolveWorktype({ input: workType }, graph);
    workId = resolved.result?.resolved?.id as string | undefined;
    if (workId) basisGroups.push(resolved.basis as BasisRef[]);
  }

  // 2. 관측값 수치 판정 (있으면 — FAIL 여부로 부적합 실체 확인)
  let verdict: Record<string, unknown> | null = null;
  if (observation) {
    try {
      const r = evaluateObservation({ observation, testId }, graph);
      verdict = r.result as Record<string, unknown>;
      basisGroups.push(r.basis as BasisRef[]);
    } catch {
      verdict = { error: "판정 실패 — observation 형식 확인 필요" };
    }
  }

  // 3. NCR 재료 패키지 (후보·조치·증빙 + 양식)
  const ncrPkg = compileNcrReferences({ ncrId, workType: workId, testId }, graph);
  basisGroups.push(ncrPkg.basis as BasisRef[]);

  // 4. verified 법령 근거 요약 (업무지침 §39·§41 등 — LLM이 바로 인용)
  const legalBasis = schemaLegalBasisSummaries(graph, "ncr");

  const result = {
    input: { workType: workType ?? null, testId: testId ?? null, ncrId: ncrId ?? null, observation: observation ?? null },
    verdict,
    ncrPackage: ncrPkg.result,
    legalBasis,
    usage:
      "흐름: ① verdict 로 부적합 실체 확인 ② ncrPackage.ncrs 에서 해당 부적합 선택 — 원인 후보·즉시/시정 조치·필요 증빙 확보 ③ 양식(formSchema)에 채워 NCR 초안 작성 ④ verify_quality_basis 로 인용 검수. 발행·결재는 품질관리자·감리원.",
  };

  return buildResponse(
    "chain_nonconformance_report",
    graph.version,
    result,
    mergeBasis(...basisGroups, legalBasis.map((b) => ({ type: "legal", id: b.id, priority: 1 }) as BasisRef)),
    {
      required: true,
      reason: "NCR 발행·시정조치 지시·종결 판정은 품질관리자·감리원·발주자의 권한입니다.",
      a2ui: { type: "decision", options: ["NCR 발행", "재시험 지시", "감리 보고", "초안 수정"] },
    },
  );
}
