// ─────────────────────────────────────────────────────────────────────────────
// chain_daily_quality_briefing — 일일 품질 브리핑 체인 (plan.md §7.4 Tool 20).
//
// 흐름: 오늘/내일 작업 공종 목록 → 공종별 {리스크, 검측 포인트, 필요 시험, 필요 서류}
//       브리핑 카드 조립. 아침 회의·일일 품질 점검 준비용.
// ─────────────────────────────────────────────────────────────────────────────

import { run as resolveWorktype } from "./resolve-worktype.js";
import { buildResponse } from "./_response.js";
import { mergeBasis } from "./_compile-common.js";
import type { ToolSpec, BasisRef, ToolResponse } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

export const spec: ToolSpec = {
  name: "chain_daily_quality_briefing",
  description:
    "일일 품질 브리핑 체인 — 오늘/내일 작업 공종 목록(자연어 가능)을 받아 공종별 품질 리스크·검측 포인트·필요 시험·준비 서류를 브리핑 카드로 한 번에 조립한다. 아침 품질 회의·검측 일정 준비용. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]",
  inputSchema: {
    type: "object",
    properties: {
      workTypes: {
        type: "array",
        items: { type: "string" },
        description: "오늘/내일 작업 공종 배열 (예: ['기둥 콘크리트 타설', '철근 배근'])",
      },
    },
    required: ["workTypes"],
  },
};

export interface ChainBriefingArgs {
  workTypes: string[];
}

interface BriefingCard {
  input: string;
  workType: { id: string; name: string } | null;
  risks: { id: string; name: string; severity: string | null }[];
  inspections: { id: string; name: string; timing: string | null }[];
  tests: { id: string; name: string; frequency: string | null }[];
  requiredDocs: { id: string; name: string }[];
}

export function run(args: ChainBriefingArgs, graph: OntologyGraph): ToolResponse {
  const { workTypes } = args ?? ({} as ChainBriefingArgs);
  if (!Array.isArray(workTypes) || workTypes.length === 0) {
    throw new Error("workTypes(배열)는 필수입니다.");
  }

  const basisGroups: BasisRef[][] = [];
  const cards: BriefingCard[] = workTypes.map((input) => {
    const resolved = resolveWorktype({ input }, graph);
    const workId = resolved.result?.resolved?.id as string | undefined;
    if (!workId) {
      return { input, workType: null, risks: [], inspections: [], tests: [], requiredDocs: [] };
    }
    basisGroups.push(resolved.basis as BasisRef[]);
    const w = graph.get(workId);
    const n = graph.neighbors(workId);

    const risks = (n["hasQualityRisk"] ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      severity: (r.meta?.["severity"] as string | undefined) ?? null,
    }));
    const inspections = (n["hasInspectionCheckpoint"] ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      timing: (i.meta?.["timing"] as string | undefined) ?? null,
    }));

    const tests: BriefingCard["tests"] = [];
    const requiredDocs = new Map<string, { id: string; name: string }>();
    for (const m of n["usesMaterial"] ?? []) {
      const mn = graph.neighbors(m.id);
      for (const t of mn["requiresTest"] ?? []) {
        if (!tests.find((x) => x.id === t.id)) {
          tests.push({
            id: t.id,
            name: t.name,
            frequency: (t.meta?.["frequency"] as string | undefined) ?? null,
          });
        }
        for (const d of graph.neighbors(t.id)["requiresEvidence"] ?? []) {
          requiredDocs.set(d.id, { id: d.id, name: d.name });
        }
      }
      for (const d of mn["requiresDocument"] ?? []) {
        requiredDocs.set(d.id, { id: d.id, name: d.name });
      }
    }

    return {
      input,
      workType: w ? { id: w.id, name: w.name } : null,
      risks,
      inspections,
      tests,
      requiredDocs: [...requiredDocs.values()],
    };
  });

  const unresolved = cards.filter((c) => !c.workType).map((c) => c.input);

  const result = {
    input: { workTypes },
    briefing: cards,
    unresolvedWorkTypes: unresolved,
    usage:
      "공종 카드별로 ① risks 를 아침 회의에서 공유 ② inspections 의 timing 으로 검측 신청 시점 확인 (inspection_request 는 통상 24~48h 전) ③ tests·requiredDocs 로 오늘 챙길 시험·서류 준비. 시행은 현장 판단.",
  };

  return buildResponse(
    "chain_daily_quality_briefing",
    graph.version,
    result,
    mergeBasis(
      ...basisGroups,
      cards.flatMap((c) => [
        ...c.risks.map((r) => ({ type: "ontology", id: r.id, priority: 2 }) as BasisRef),
        ...c.inspections.map((i) => ({ type: "ontology", id: i.id, priority: 2 }) as BasisRef),
      ]),
    ),
    unresolved.length > 0
      ? {
          required: true,
          reason: `해석 실패 공종 ${unresolved.length}건: ${unresolved.join(", ")}`,
        }
      : undefined,
  );
}
