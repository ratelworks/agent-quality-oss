// ─────────────────────────────────────────────────────────────────────────────
// render-quality-form.ts — 문서 양식을 A2UI 1.0 입력 폼(메시지 목록)으로 렌더.
//
// document-schemas.json 의 섹션·필드를 A2UI 기본 카탈로그 컴포넌트로 옮기고,
// 적용 근거·보존기간·참조 표준을 함께 돌려준다. 표시 이름은 한글 사전(field-labels.json),
// 입력 종류는 필드 type 에서 정한다(schemas/fields.ts).
//
//   한 줄·여러 줄·숫자   TextField (variant shortText·longText·number)
//   날짜·일시            DateTimeInput
//   선택                 ChoicePicker (선택지 값은 양식의 코드, 표시는 한글)
//   묶음(성명·직책 등)   항목마다 TextField — 데이터 모델 경로 /draft/<필드>/<항목>
//   목록·표              TextField longText — 한 줄에 한 건. 표의 열은 @metadata.extensions.columns
// ─────────────────────────────────────────────────────────────────────────────

import { getSchema, listSchemaIds } from "../schemas/loader.js";
import type { DocumentSchema, SchemaField } from "../schemas/loader.js";
import { enumLabel, enumValues, fieldKind, fieldLabel, subFieldLabel } from "../schemas/fields.js";
import { buildResponse, entityBasisWithStatus } from "../lib/response.js";
import { ERROR_CODES, QualityMcpError } from "../lib/errors.js";
import { COLUMN_SEPARATOR } from "../lib/draft.js";
import {
  A2UI_VERSION,
  DRAFT_BINDING,
  ROOT_ID,
  buttonComponent,
  createSurfaceMessage,
  draftPath,
  emptyValue,
  fieldComponent,
  textComponent,
  updateComponentsMessage,
} from "../lib/a2ui.js";
import type { A2UIComponent } from "../lib/a2ui.js";
import type { ToolSpec, BasisRef } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

// ───── 상수 ─────
/** 표를 여러 줄 글자로 적을 때의 열 구분 표시 */
const ROW_SEPARATOR = ` ${COLUMN_SEPARATOR} `;
const EVENT_SUBMIT = "submit_document";
const EVENT_SAVE = "save_draft";

export const spec: ToolSpec = {
  name: "render_quality_form",
  description:
    `문서 양식(itp·ncr 등 ${listSchemaIds().length}종)을 A2UI 1.0 입력 폼(메시지 목록)으로 렌더한다. ` +
    "필드 구조 + 적용 근거 + 보존기간 + 참조 표준을 함께 반환한다. " +
    "[근거 제공용 · 결재는 품질관리자·감리원·발주자]",
  inputSchema: {
    type: "object",
    properties: {
      docId: {
        type: "string",
        description: `문서 양식 id. ${listSchemaIds().length}종: ${listSchemaIds().join(" · ")}`,
      },
    },
    required: ["docId"],
  },
};

export interface RenderQualityFormArgs {
  docId?: string;
}

interface FormBuild {
  components: A2UIComponent[];
  /** 초기 데이터 모델의 draft 가지 */
  draft: Record<string, unknown>;
  /** 입력 컴포넌트 id → 데이터 모델 경로 */
  fieldPathMap: Record<string, string>;
  /** 필수 입력의 데이터 모델 경로 (묶음은 묶음 경로 — 항목이 하나라도 채워지면 된다) */
  requiredPaths: string[];
}

function addField(
  build: FormBuild,
  children: string[],
  docId: string,
  sectionKey: string,
  field: SchemaField,
): void {
  const kind = fieldKind(field);
  const label = fieldLabel(docId, field.name);
  const required = Boolean(field.required);
  const idBase = `f_${sectionKey}_${field.name}`;

  if (kind === "group") {
    // 묶음 — 이름 한 줄 + 항목마다 입력 칸. 양식은 묶음 단위로만 필수를 정하므로
    // 항목마다 필수 검사를 달지 않는다(항목이 하나라도 채워지면 채운 것으로 본다)
    const captionId = `${idBase}_label`;
    build.components.push(textComponent(captionId, required ? `${label} *` : label, "body"));
    children.push(captionId);
    const groupValue: Record<string, unknown> = {};
    for (const sub of field.fields ?? []) {
      const id = `${idBase}_${sub}`;
      const segments = [field.name, sub];
      build.components.push(
        fieldComponent({ id, path: segments, label: `${label} — ${subFieldLabel(sub)}`, inputKind: "shortText" }),
      );
      children.push(id);
      groupValue[sub] = "";
      build.fieldPathMap[id] = draftPath(segments);
    }
    build.draft[field.name] = groupValue;
    if (required) build.requiredPaths.push(draftPath([field.name]));
  } else {
    const columns =
      kind === "rows" ? (field.fields ?? []).map((key) => ({ key, label: subFieldLabel(key) })) : undefined;
    const segments = [field.name];
    build.components.push(
      fieldComponent({
        id: idBase,
        path: segments,
        label,
        inputKind: kind,
        required,
        ...(kind === "choice"
          ? { options: enumValues(field).map((value) => ({ value, label: enumLabel(value) })) }
          : {}),
        ...(columns ? { columns } : {}),
        ...(kind === "rows" || kind === "list" ? { placeholder: "한 줄에 한 건씩 적습니다" } : {}),
      }),
    );
    children.push(idBase);
    build.draft[field.name] = emptyValue(kind);
    build.fieldPathMap[idBase] = draftPath(segments);
    if (required) build.requiredPaths.push(draftPath(segments));
    if (columns) {
      const orderId = `${idBase}_columns`;
      build.components.push(
        textComponent(orderId, `한 줄에 한 건, 항목 순서: ${columns.map((c) => c.label).join(ROW_SEPARATOR)}`, "caption"),
      );
      children.push(orderId);
    }
  }

  if (field.note) {
    const hintId = `${idBase}_hint`;
    build.components.push(textComponent(hintId, field.note, "caption"));
    children.push(hintId);
  }
}

/** 양식 하나를 A2UI 컴포넌트 트리로 옮긴다 */
export function buildForm(schema: DocumentSchema): FormBuild {
  const build: FormBuild = { components: [], draft: {}, fieldPathMap: {}, requiredPaths: [] };
  const rootChildren: string[] = ["doc_title"];
  build.components.push({ id: ROOT_ID, component: "Column", children: rootChildren });
  build.components.push(textComponent("doc_title", schema.title, "h1"));
  const meta = [
    schema.reference ? `근거: ${schema.reference}` : "",
    schema.retention ? `보존: ${schema.retention}` : "",
  ].filter(Boolean);
  if (meta.length > 0) {
    build.components.push(textComponent("doc_meta", meta.join("\n"), "caption"));
    rootChildren.push("doc_meta");
  }

  for (const section of schema.sections) {
    const cardId = `card_${section.key}`;
    const columnId = `sec_${section.key}`;
    const titleId = `sec_${section.key}_title`;
    const sectionChildren: string[] = [titleId];
    build.components.push({ id: cardId, component: "Card", child: columnId });
    build.components.push({ id: columnId, component: "Column", children: sectionChildren });
    build.components.push(textComponent(titleId, section.title, "h2"));
    rootChildren.push(cardId);
    for (const field of section.fields) addField(build, sectionChildren, schema.id, section.key, field);
  }

  // 작성 완료·임시 저장 — 누르면 현재 입력값 묶음을 이벤트 문맥으로 내보낸다
  const context = { docId: schema.id, draft: DRAFT_BINDING };
  build.components.push(textComponent("btn_submit_text", "작성 완료", "body"));
  build.components.push(buttonComponent("btn_submit", "btn_submit_text", EVENT_SUBMIT, context, "primary"));
  build.components.push(textComponent("btn_save_text", "임시 저장", "body"));
  build.components.push(buttonComponent("btn_save", "btn_save_text", EVENT_SAVE, context));
  rootChildren.push("btn_submit", "btn_save");
  return build;
}

export function run(args: RenderQualityFormArgs, graph: OntologyGraph) {
  const docId = args?.docId;
  if (!docId) {
    throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, "docId는 필수입니다 (예: itp, ncr, inspection_request).");
  }
  const schema = getSchema(docId);
  if (!schema) {
    throw new QualityMcpError(
      ERROR_CODES.SCHEMA_NOT_FOUND,
      `문서 양식을 찾을 수 없습니다: ${docId}. ` +
        `사용 가능 양식(${listSchemaIds().length}종): ${listSchemaIds().join(" · ")}`,
    );
  }

  const build = buildForm(schema);
  const surfaceId = `quality_form_${schema.id}`;
  const messages = [
    createSurfaceMessage(surfaceId, build.draft),
    updateComponentsMessage(surfaceId, build.components),
  ];

  // 근거: schema.basis 중 그래프 실존 노드 우선, 없으면 schema_meta
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
    a2uiVersion: A2UI_VERSION,
    surfaceId,
    root: ROOT_ID,
    fieldCount: Object.keys(build.fieldPathMap).length,
    fieldPathMap: build.fieldPathMap,
    requiredPaths: build.requiredPaths,
    messages,
    usage:
      "이 A2UI 1.0 폼을 내장 브라우저 폼이나 A2UI 를 지원하는 화면 프로그램이 그린다. 입력값은 데이터 모델의 " +
      "/draft 아래에 모인다. 승인·서명은 품질관리자·감리원·발주자.",
  };

  return buildResponse(
    "render_quality_form",
    graph.version,
    result,
    basis,
    { required: false, reason: null },
    [{ tool: "compose_writing_context", reason: "입력값을 작성 컨텍스트로 변환" }],
    graph,
  );
}
