// ─────────────────────────────────────────────────────────────────────────────
// _compile-common.ts — compile_*_references 계열 공용 헬퍼.
//
// 핵심: 문서 스키마의 legalBasis(basis[] id)를 도구 응답의 basis[]에 포함시킨다.
// Phase B(2026-07-02)에서 법령·지침 노드가 verified 원문을 갖게 되었으므로,
// 이 포함이 응답 신뢰도(verified any/ratio)를 실질적으로 견인한다.
// ─────────────────────────────────────────────────────────────────────────────

import { getSchema } from "../schemas/loader.js";
import type { BasisRef } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

/** 법령 근거 요약 (도구 result 에 실어 LLM 이 바로 인용할 수 있는 형태) */
export interface LegalBasisSummary {
  id: string;
  name: string;
  category: string | null;
  articleNo: string | null;
  legalWeight: string | null;
  sourceStatus: string;
  /** verified 원문 발췌 (앞 400자) — 전체 원문은 get_quality_law_article 로 조회 */
  bodyExcerpt: string | null;
  sourceUrl: string | null;
}

/** 노드 category → 표준 BasisType 매핑 (BASIS_TYPES 화이트리스트 준수) */
function basisTypeOf(graph: OntologyGraph, id: string): string {
  const category = (graph.get(id)?.meta?.["category"] as string | undefined) ?? "";
  if (category === "law" || category === "regulation" || category === "rule") return "law";
  if (category === "guideline" || category === "annex") return "guideline";
  if (category === "form") return "form_locator";
  if (category === "kcs") return "kcs_section";
  if (category === "kds") return "kds_section";
  if (category === "ks") return "ks_standard";
  return "ontology";
}

/**
 * 문서 스키마의 basis id 들을 그래프에서 검증하며 BasisRef 로 변환.
 * 그래프에 없는 id 는 제외 (dangling 방지 — form-conformance 게이트가 실재를 강제).
 */
export function schemaLegalBasisRefs(
  graph: OntologyGraph,
  schemaId: string,
): BasisRef[] {
  const schema = getSchema(schemaId);
  return (schema?.basis ?? [])
    .filter((id) => graph.get(id))
    .map((id) => ({ type: basisTypeOf(graph, id), id, priority: 1 }));
}

/** 여러 도구 응답의 basis 를 id 기준 dedup 병합 (체인 도구용 — 우선순위 낮은 값 유지) */
/** 검측 지점을 응답에 싣는 모양 — 이름만이 아니라 확인 기준(표준시방서와 대조한 내용)을 함께 준다 */
export interface CheckpointView {
  id: string;
  name: string;
  stage: string | null;
  /** 무엇을 확인하는가 — 없으면 이 검측 지점의 확인 기준이 아직 수록되지 않은 것이다 */
  checkItems: string | null;
  /** 확인 기준의 근거 조항 */
  reference: string | null;
  /** 대조한 기준과 판 (예: "KCS 14 20 10 2024-12-30 판") */
  checkedAgainst: string | null;
}

export function checkpointView(c: { id: string; name: string; meta?: Record<string, unknown> }): CheckpointView {
  const meta = c.meta ?? {};
  const raw = meta["verifiedAgainst"];
  const anchors = (Array.isArray(raw) ? raw : [raw]).filter(
    (a): a is { standard: string; edition: string } =>
      typeof a === "object" && a !== null && typeof (a as { standard?: unknown }).standard === "string" && typeof (a as { edition?: unknown }).edition === "string",
  );
  return {
    id: c.id,
    name: c.name,
    stage: typeof meta["stage"] === "string" ? meta["stage"] : null,
    checkItems: typeof meta["rule"] === "string" ? meta["rule"] : null,
    reference: typeof meta["reference"] === "string" ? meta["reference"] : null,
    checkedAgainst: anchors.length > 0 ? anchors.map((a) => `${a.standard} ${a.edition} 판`).join(" · ") : null,
  };
}

export function mergeBasis(...groups: BasisRef[][]): BasisRef[] {
  const seen = new Map<string, BasisRef>();
  for (const group of groups) {
    for (const ref of group) {
      const prev = seen.get(ref.id);
      if (!prev || (ref.priority ?? 9) < (prev.priority ?? 9)) seen.set(ref.id, ref);
    }
  }
  return [...seen.values()];
}

/** 문서 스키마의 basis 노드들을 LLM 인용용 요약으로 변환 */
export function schemaLegalBasisSummaries(
  graph: OntologyGraph,
  schemaId: string,
): LegalBasisSummary[] {
  const schema = getSchema(schemaId);
  const out: LegalBasisSummary[] = [];
  for (const id of schema?.basis ?? []) {
    const e = graph.get(id);
    if (!e) continue;
    const meta = e.meta ?? {};
    const body = meta["bodyText"] as string | undefined;
    out.push({
      id,
      name: e.name,
      category: (meta["category"] as string | undefined) ?? null,
      articleNo: (meta["articleNo"] as string | undefined) ?? null,
      legalWeight: (meta["legalWeight"] as string | undefined) ?? null,
      sourceStatus: (meta["sourceStatus"] as string | undefined) ?? "unknown",
      bodyExcerpt: body ? body.slice(0, 400) + (body.length > 400 ? " …" : "") : null,
      sourceUrl:
        (meta["sourceUrl"] as string | undefined) ??
        (meta["url"] as string | undefined) ??
        null,
    });
  }
  return out;
}
