// ─────────────────────────────────────────────────────────────────────────────
// compile_document_references — 19종 문서 공통 근거 패키지 조립 (제네릭).
//
// 개별 compile_*_references(콘크리트 타설·NCR 등 그래프 traversal 이 깊은 7종)와 달리,
// 어떤 문서든 docId 하나로 "작성에 필요한 근거 일습"을 반환한다:
//   양식 스키마 + verified 법령 근거(원문 발췌) + 관련 서식 locator + (선택) 공종 재료.
//
// 설계 결정: 문서 19종 × bespoke 도구 대신 제네릭 1종 — MCP 도구 폭증은 LLM 의
// 도구 선택 정확도를 떨어뜨린다 (자매 safety-oss 의 assemble_doc_context 패턴과 정합).
// ─────────────────────────────────────────────────────────────────────────────

import { getSchema, listSchemaIds } from "../schemas/loader.js";
import { buildResponse } from "./_response.js";
import { schemaLegalBasisRefs, schemaLegalBasisSummaries } from "./_compile-common.js";
import type { ToolSpec, BasisRef, ToolResponse } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

const DOC_IDS = listSchemaIds();

export const spec: ToolSpec = {
  name: "compile_document_references",
  description:
    "품질관리 문서 한 건의 작성 근거 패키지를 조립한다 — 양식 스키마 + 적용 법령·지침(검증된 원문 발췌 포함) + 관련 서식 다운로드 locator + (workType 지정 시) 공종별 시험·검측·리스크 재료. 문서별 전용 compile_* 도구가 없는 문서는 이 도구를 사용. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]",
  inputSchema: {
    type: "object",
    properties: {
      docId: {
        type: "string",
        enum: DOC_IDS,
        description: `문서 스키마 id (19종): ${DOC_IDS.join(", ")}`,
      },
      workType: {
        type: "string",
        description: "공종 id 또는 이름 (선택 — 지정 시 공종별 시험·검측·리스크 재료 포함)",
      },
    },
    required: ["docId"],
  },
};

export interface CompileDocumentArgs {
  docId: string;
  workType?: string;
}

interface WorkContextItem {
  id: string;
  name: string;
}

export function run(args: CompileDocumentArgs, graph: OntologyGraph): ToolResponse {
  const { docId, workType } = args ?? ({} as CompileDocumentArgs);
  if (!docId) throw new Error("docId는 필수입니다.");

  const schema = getSchema(docId);
  if (!schema) {
    return buildResponse(
      "compile_document_references",
      graph.version,
      { document: null, availableDocIds: DOC_IDS },
      [{ type: "schema_meta", id: "not_found", priority: 3, note: `미등록 문서: ${docId}` }],
      {
        required: true,
        reason: `"${docId}"는 등록된 문서 스키마가 아닙니다. availableDocIds 중 선택하십시오.`,
      },
    );
  }

  const legalBasis = schemaLegalBasisSummaries(graph, docId);
  const basisRefs: BasisRef[] = schemaLegalBasisRefs(graph, docId);

  // 관련 서식 locator — 법령 근거 노드가 form/annex 카테고리면 다운로드 링크 동반
  const relatedForms = legalBasis
    .filter((b) => b.category === "form" || b.category === "annex")
    .map((b) => {
      const e = graph.get(b.id);
      return {
        id: b.id,
        name: b.name,
        hwpDownloadUrl: (e?.meta?.["hwpDownloadUrl"] as string | undefined) ?? null,
        pdfDownloadUrl: (e?.meta?.["pdfDownloadUrl"] as string | undefined) ?? null,
      };
    });

  // (선택) 공종 재료 — 1-hop: 시험·검측·리스크
  let workContext: {
    workType: WorkContextItem;
    tests: WorkContextItem[];
    inspections: WorkContextItem[];
    risks: WorkContextItem[];
  } | null = null;
  if (workType) {
    const w =
      graph.get(workType) ??
      graph.all("WorkType").find((e) => e.name === workType || (e.aliases ?? []).includes(workType));
    if (w && w.type === "WorkType") {
      const n = graph.neighbors(w.id);
      const lite = (arr: { id: string; name: string }[] | undefined): WorkContextItem[] =>
        (arr ?? []).map((e) => ({ id: e.id, name: e.name }));
      const materials = n["usesMaterial"] ?? [];
      const tests: WorkContextItem[] = [];
      for (const m of materials) {
        for (const t of graph.neighbors(m.id)["requiresTest"] ?? []) {
          if (!tests.find((x) => x.id === t.id)) tests.push({ id: t.id, name: t.name });
        }
      }
      workContext = {
        workType: { id: w.id, name: w.name },
        tests,
        inspections: lite(n["hasInspectionCheckpoint"]),
        risks: lite(n["hasQualityRisk"]),
      };
      basisRefs.push({ type: "ontology", id: w.id, priority: 2 });
    }
  }

  const result = {
    document: {
      schemaId: schema.id,
      title: schema.title,
      reference: schema.reference ?? null,
      retention: schema.retention ?? null,
    },
    formSchema: { sections: schema.sections },
    legalBasis,
    relatedForms,
    workContext,
    usage:
      "이 패키지로 LLM이 문서 초안을 작성한다. 흐름: 본 패키지 → (브라우저 입력이 필요하면) render_quality_form → compose_writing_context → 작성 후 verify_quality_basis 로 인용 검수. 결재·서명은 품질관리자·감리원·발주자.",
  };

  return buildResponse(
    "compile_document_references",
    graph.version,
    result,
    basisRefs.length > 0
      ? basisRefs
      : [{ type: "schema_meta", id: docId, priority: 2, note: "문서 양식 스키마" }],
  );
}
