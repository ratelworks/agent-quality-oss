// ─────────────────────────────────────────────────────────────────────────────
// render-quality-form.ts — 문서 양식(19종)을 A2UI 입력 폼(JSONL)으로 렌더.
//
// agent-safety-oss 의 render_a2ui_form 과 통일한 A2UI 메시지 구조를 quality 도메인에
// 적용한다. document-schemas.json 의 sections/fields 를 A2UI 컴포넌트 트리로 변환하고,
// 적용 근거(basis)·보존기간·참조 표준을 함께 반환한다.
// 지원 양식 종수·목록은 document-schemas.json 을 SSoT 로 listSchemaIds() 가 동적 산정한다.
//
// 본질: 본 도구는 "양식 구조"만 제공한다. 문서 본문 작성은 LLM, 결재는 사람.
// (compose_writing_context 로 입력값을 작성 컨텍스트화)
// ─────────────────────────────────────────────────────────────────────────────

import { getSchema, listSchemaIds } from "../schemas/loader.js";
import { buildResponse, entityBasisWithStatus } from "../lib/response.js";
import type { ToolSpec, BasisRef, A2UIComponent, A2UIMessage } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";
import type { SchemaField } from "../schemas/loader.js";

// 파일 최상단 상수 — A2UI surface 카탈로그 식별자
const CATALOG_ID = "a2ui-basic";
const ROOT_ID = "form_root";

export const spec: ToolSpec = {
  name: "render_quality_form",
  description:
    `문서 양식(itp·ncr 등 ${listSchemaIds().length}종)을 A2UI 입력 폼(JSONL 메시지)으로 렌더한다. ` +
    "필드 구조 + 적용 근거 + 보존기간 + 참조 표준을 함께 반환한다. 문서를 직접 생성하지 않는다. " +
    "[근거 제공용 · 작성은 LLM · 결재는 품질관리자·감리원·발주자]",
  inputSchema: {
    type: "object",
    properties: {
      docId: {
        type: "string",
        description:
          `문서 양식 id. ${listSchemaIds().length}종: ${listSchemaIds().join(" · ")}`,
      },
    },
    required: ["docId"],
  },
};

export interface RenderQualityFormArgs {
  docId?: string;
}

// field.type → A2UI fieldType (+ enum options)
function resolveFieldType(field: SchemaField): { fieldType: string; options?: string[] } {
  const t = field.type;
  const enumMatch = /^enum<(.+)>$/.exec(t);
  if (enumMatch) {
    const inner = enumMatch[1] ?? "";
    return { fieldType: "select", options: inner.split(",").map((s) => s.trim()).filter(Boolean) };
  }
  if (t === "date") return { fieldType: "date" };
  if (t === "number") return { fieldType: "number" };
  if (t === "object") return { fieldType: "longText" };
  // string: 키 패턴 보조 추론
  const key = field.name.toLowerCase();
  if (/date|일자|일시/.test(key)) return { fieldType: "date" };
  if (/note|비고|내용|사유|cause|조치|action|description|remark/.test(key)) {
    return { fieldType: "longText" };
  }
  return { fieldType: "text" };
}

export function run(args: RenderQualityFormArgs, graph: OntologyGraph) {
  const docId = args?.docId;
  if (!docId) {
    throw new Error("docId는 필수입니다 (예: itp, ncr, inspection_request).");
  }
  const schema = getSchema(docId);
  if (!schema) {
    throw new Error(
      `문서 양식을 찾을 수 없습니다: ${docId}. ` +
        `사용 가능 양식(${listSchemaIds().length}종): ${listSchemaIds().join(" · ")}`,
    );
  }

  // ── A2UI 컴포넌트 트리 ──
  const components: A2UIComponent[] = [];
  const rootChildren: string[] = [];
  components.push({ id: ROOT_ID, component: "Column", children: rootChildren });

  let fieldCount = 0;
  for (const section of schema.sections) {
    const secId = `sec_${section.key}`;
    const secChildren: string[] = [];
    components.push({
      id: secId,
      component: "Card",
      title: section.title,
      children: secChildren,
    });
    rootChildren.push(secId);

    for (const field of section.fields) {
      const fid = `f_${section.key}_${field.name}`;
      const { fieldType, options } = resolveFieldType(field);
      const comp: A2UIComponent = {
        id: fid,
        component: "TextField",
        label: field.name,
        fieldType,
        required: Boolean(field.required),
      };
      if (options) comp["options"] = options;
      if (field.note) comp["hint"] = field.note;
      if (field.fields && field.fields.length > 0) comp["subFields"] = field.fields;
      components.push(comp);
      secChildren.push(fid);
      fieldCount++;
    }
  }

  const surfaceId = `quality_form_${schema.id}`;
  const messages: A2UIMessage[] = [
    { createSurface: { surfaceId, catalogId: CATALOG_ID } },
    { updateComponents: { surfaceId, root: ROOT_ID, components } },
  ];

  // ── 근거: schema.basis 중 그래프 실존 노드 우선, 없으면 schema_meta ──
  const basisIds = (schema.basis ?? []).filter((id) => graph.get(id));
  const basis: BasisRef[] =
    basisIds.length > 0
      ? entityBasisWithStatus(graph, basisIds, 1)
      : [{ type: "schema_meta", id: schema.id, priority: 2, note: "문서 양식 스키마" }];

  const result = {
    docId: schema.id,
    title: schema.title,
    reference: schema.reference ?? null,
    referenceStandard: schema.referenceStandard ?? null,
    retention: schema.retention ?? null,
    surfaceId,
    root: ROOT_ID,
    fieldCount,
    messages,
    usage:
      "이 A2UI 폼을 viewer 또는 A2UI 호환 클라이언트가 렌더한다. 입력값은 compose_writing_context 로 " +
      "작성 컨텍스트화한다. 본문 작성은 LLM, 승인·서명은 품질관리자·감리원·발주자.",
  };

  return buildResponse(
    "render_quality_form",
    graph.version,
    result,
    basis,
    { required: false, reason: null },
    [{ tool: "compose_writing_context", reason: "입력값을 LLM 작성 컨텍스트로 변환" }],
    graph,
  );
}
