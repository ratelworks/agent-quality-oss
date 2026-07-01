// ─────────────────────────────────────────────────────────────────────────────
// chain_quality_inspection — 검측 준비 원스톱 체인 (plan.md §7.4 Tool 16).
//
// 흐름(코드 오케스트레이션 — LLM 왕복 없이 한 번에):
//   resolve_worktype → get_work_quality_profile → 검측 체크포인트·판정기준
//   → inspection_checklist·inspection_request 근거 패키지 (verified 법령 포함)
// ─────────────────────────────────────────────────────────────────────────────

import { run as resolveWorktype } from "./resolve-worktype.js";
import { run as getWorkQualityProfile } from "./get-work-quality-profile.js";
import { run as compileDocumentReferences } from "./compile-document-references.js";
import { buildResponse } from "./_response.js";
import { mergeBasis } from "./_compile-common.js";
import type { ToolSpec, BasisRef, ToolResponse } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

export const spec: ToolSpec = {
  name: "chain_quality_inspection",
  description:
    "검측 준비 체인 — 공종 한 마디(자연어 가능)로 검측 체크포인트·판정기준·검측 체크리스트/신청서 양식·적용 법령(verified)을 한 번에 조립한다. 개별 도구를 순서대로 부를 필요 없이 검측 입회 준비 재료 일습을 반환. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]",
  inputSchema: {
    type: "object",
    properties: {
      workType: { type: "string", description: "공종 id 또는 자연어 표현 (예: '슬래브 타설')" },
    },
    required: ["workType"],
  },
};

export interface ChainInspectionArgs {
  workType: string;
}

export function run(args: ChainInspectionArgs, graph: OntologyGraph): ToolResponse {
  const { workType } = args ?? ({} as ChainInspectionArgs);
  if (!workType) throw new Error("workType은 필수입니다.");

  // 1. 공종 해석
  const resolved = resolveWorktype({ input: workType }, graph);
  const workId = resolved.result?.resolved?.id as string | undefined;
  if (!workId) {
    return buildResponse(
      "chain_quality_inspection",
      graph.version,
      { steps: { resolve: resolved.result }, package: null },
      resolved.basis as BasisRef[],
      {
        required: true,
        reason: `공종 해석 실패: "${workType}". 정확한 공종명으로 재시도하거나 search_quality_ontology로 후보를 확인하십시오.`,
      },
    );
  }

  // 2. 공종 품질 프로파일 (자재·시험·검측·리스크)
  const profile = getWorkQualityProfile({ workType: workId }, graph);

  // 3. 검측 문서 근거 패키지 (체크리스트 + 신청서)
  const checklistPkg = compileDocumentReferences(
    { docId: "inspection_checklist", workType: workId },
    graph,
  );
  const requestPkg = compileDocumentReferences({ docId: "inspection_request" }, graph);
  const requestResult = requestPkg.result as {
    document: unknown;
    formSchema?: unknown;
    legalBasis?: unknown;
  };

  const result = {
    input: { workType },
    resolvedWorkType: resolved.result.resolved,
    profile: profile.result,
    inspectionChecklist: checklistPkg.result,
    inspectionRequest: {
      document: requestResult.document,
      formSchema: requestResult.formSchema ?? null,
      legalBasis: requestResult.legalBasis ?? null,
    },
    usage:
      "검측 입회 준비 순서: ① profile.inspections 로 체크포인트 확인 ② inspectionChecklist 로 부재별 체크리스트 작성 ③ inspectionRequest 로 검측 신청서 제출(통상 24~48h 전). 판정·입회 확인은 감리원.",
  };

  return buildResponse(
    "chain_quality_inspection",
    graph.version,
    result,
    mergeBasis(
      resolved.basis as BasisRef[],
      profile.basis as BasisRef[],
      checklistPkg.basis as BasisRef[],
      requestPkg.basis as BasisRef[],
    ),
    {
      required: true,
      reason: "검측 결과 판정과 입회 확인은 감리원·발주자의 권한입니다.",
    },
  );
}
