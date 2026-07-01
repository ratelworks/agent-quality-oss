// ─────────────────────────────────────────────────────────────────────────────
// chain_test_report_review — 시험성적서 검토 체인 (plan.md §7.4 Tool 18).
//
// 흐름: 기준 우선순위 매핑(map_quality_basis) → 관측값별 수치 판정(evaluate_observation,
//       코드 계산 — LLM 추측 아님) → 성적서 검토 양식 + verified 법령 근거.
// 성적서 PDF/이미지의 값 추출은 LLM(호스트) 몫 — 본 체인은 추출된 관측값을 받아 판정한다.
// ─────────────────────────────────────────────────────────────────────────────

import { run as mapQualityBasis } from "./map-quality-basis.js";
import { run as evaluateObservation } from "./evaluate-observation.js";
import { run as compileDocumentReferences } from "./compile-document-references.js";
import { buildResponse } from "./_response.js";
import { mergeBasis } from "./_compile-common.js";
import type { ToolSpec, BasisRef, ToolResponse } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

export const spec: ToolSpec = {
  name: "chain_test_report_review",
  description:
    "시험성적서 검토 체인 — 자재·시험항목과 성적서에서 추출한 관측값들을 받아, 적용 기준 우선순위 매핑 → 관측값별 수치 판정(코드 계산) → 성적서 검토 보고서 양식·법령 근거까지 한 번에 조립한다. 성적서의 값 추출(파싱)은 LLM이 먼저 수행할 것. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]",
  inputSchema: {
    type: "object",
    properties: {
      material: { type: "string", description: "자재 id 또는 이름 (예: material.ready_mixed_concrete)" },
      testItem: { type: "string", description: "시험항목 id (선택, 예: test.slump)" },
      observations: {
        type: "array",
        items: { type: "string" },
        description: "성적서에서 추출한 관측값 문장 배열 (예: ['슬럼프 180mm', '공기량 4.5%'])",
      },
    },
    required: ["observations"],
  },
};

export interface ChainTestReportArgs {
  material?: string;
  testItem?: string;
  observations: string[];
}

export function run(args: ChainTestReportArgs, graph: OntologyGraph): ToolResponse {
  const { material, testItem, observations } = args ?? ({} as ChainTestReportArgs);
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new Error("observations(배열)는 필수입니다.");
  }

  // 1. 기준 우선순위 매핑 (자재·시험항목 지정 시)
  const basisMap =
    material || testItem ? mapQualityBasis({ material, testItem }, graph) : null;

  // 2. 관측값별 수치 판정 (코드 계산)
  const verdicts = observations.map((obs) => {
    try {
      const r = evaluateObservation({ observation: obs, testId: testItem }, graph);
      const assessment = (r.result as { expertAssessment?: { legalVerdict?: string } })
        .expertAssessment;
      return {
        observation: obs,
        verdict: assessment?.legalVerdict ?? "UNDETERMINED",
        detail: r.result,
        basis: r.basis as BasisRef[],
      };
    } catch (e) {
      return {
        observation: obs,
        verdict: "ERROR" as const,
        detail: { error: e instanceof Error ? e.message : String(e) },
        basis: [] as BasisRef[],
      };
    }
  });

  const failCount = verdicts.filter((v) => v.verdict === "FAIL").length;
  const undeterminedCount = verdicts.filter((v) => v.verdict === "UNDETERMINED").length;

  // 3. 성적서 검토 문서 근거 패키지
  const reviewPkg = compileDocumentReferences({ docId: "test_report_review" }, graph);

  const result = {
    input: { material: material ?? null, testItem: testItem ?? null, observations },
    basisPriority: basisMap?.result ?? null,
    verdicts: verdicts.map((v) => ({ observation: v.observation, verdict: v.verdict, detail: v.detail })),
    summary: {
      total: verdicts.length,
      fail: failCount,
      undetermined: undeterminedCount,
      note:
        failCount > 0
          ? "FAIL 항목 존재 — 부적합 처리 흐름(chain_nonconformance_report) 검토 필요."
          : undeterminedCount > 0
            ? "UNDETERMINED 항목 존재 — 판정 수치 미확보(skeleton) 기준. 시방서·KCS 원문 확인 필요."
            : "관측값 전항 기준 내.",
    },
    reviewDocument: reviewPkg.result,
    usage:
      "verdicts 를 test_report_review 양식의 판정 표에 채우고, chain of custody(성적서 발급기관→현장) 확인란을 점검한다. 최종 적합 판정은 품질관리자·감리원.",
  };

  return buildResponse(
    "chain_test_report_review",
    graph.version,
    result,
    mergeBasis(
      (basisMap?.basis as BasisRef[] | undefined) ?? [],
      ...verdicts.map((v) => v.basis),
      reviewPkg.basis as BasisRef[],
    ),
    failCount > 0
      ? {
          required: true,
          reason: `FAIL ${failCount}건 — 자재 반입 거부·재시험·NCR 여부는 품질관리자·감리원이 판정합니다.`,
          a2ui: { type: "decision", options: ["반입 거부", "재시험 지시", "NCR 발행", "조건부 승인"] },
        }
      : {
          required: true,
          reason: "성적서 적합 판정·서명은 품질관리자·감리원의 권한입니다.",
        },
  );
}
