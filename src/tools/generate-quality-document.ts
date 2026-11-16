// ─────────────────────────────────────────────────────────────────────────────
// generate-quality-document.ts — 문서 종류와 입력값으로 문서 본문을 만든다.
//
// 입력값을 양식 구조대로 옮길 뿐 문장을 짓지 않는다. 입력하지 않은 칸은 비워 두고 무엇을
// 적어야 하는지 작성 안내 줄로 알린다. 판정 수치도 만들지 않는다.
//   md       Markdown 본문 (기본)
//   doclang  DocLang 0.9 XML
//   hwpx     한글 파일로 저장하고 경로를 돌려준다 (작성 안내 줄은 빼고 저장)
// ─────────────────────────────────────────────────────────────────────────────

import { getSchema, listSchemaIds } from "../schemas/loader.js";
import { buildResponse, entityBasisWithStatus } from "../lib/response.js";
import { ERROR_CODES, QualityMcpError } from "../lib/errors.js";
import { buildDocumentBody, renderMarkdown } from "../lib/document-body.js";
import { DOCLANG_VERSION, serializeToDoclang } from "../lib/doclang-serializer.js";
import { saveHwpx } from "../lib/hwpx-export.js";
import type { BasisRef, ToolSpec } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

// ───── 상수 ─────
const FORMATS = ["md", "doclang", "hwpx"] as const;
type Format = (typeof FORMATS)[number];
const REMAINING_WORK = "입력값을 옮긴 초안입니다. 담당자가 내용을 확인하고 서명해야 하며, 판정·승인은 품질관리자·감리원·발주자가 합니다.";

export const spec: ToolSpec = {
  name: "generate_quality_document",
  description:
    `품질 문서 ${listSchemaIds().length}종의 본문을 만든다 — 입력값(formValues)을 양식 구조대로 옮긴다. 문장을 짓지 않으며, 입력하지 않은 칸은 비워 두고 무엇을 적어야 하는지 알린다. ` +
    "형식: md(Markdown, 기본) · doclang(DocLang 0.9 XML) · hwpx(한글 파일로 저장하고 경로를 돌려줌 — 작성 안내 줄은 빼고 저장. 입력 형식에 고칠 점이 있으면 저장하지 않고 problems 를 돌려줌). " +
    "법령·고시 서식을 따르는 문서도 기재 항목만 옮기며 서식의 칸 배치는 재현하지 않는다. [초안 · 확인과 서명은 품질관리자·감리원·발주자]",
  inputSchema: {
    type: "object",
    properties: {
      docId: { type: "string", description: `문서 종류 id (render_quality_form 과 같은 ${listSchemaIds().length}종 — 예: ncr, inspection_request, quality_test_plan)` },
      formValues: {
        type: "object",
        description:
          "입력값. 키는 필드 이름(또는 한글 표시 이름). A2UI 폼의 데이터 모델 /draft 를 그대로 넘겨도 된다 — " +
          "묶음은 {항목: 값}, 목록은 배열 또는 여러 줄 글자, 표는 객체 배열 또는 한 줄에 한 건(' | ' 로 열 구분)",
        additionalProperties: true,
      },
      format: { type: "string", enum: [...FORMATS], description: "출력 형식 — md(기본) · doclang · hwpx" },
    },
    required: ["docId"],
  },
  // hwpx 형식은 이 컴퓨터에 파일을 새로 쓴다(덮어쓰지 않음)
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};

export interface GenerateDocumentArgs {
  docId?: string;
  formValues?: Record<string, unknown>;
  format?: Format;
}

export function run(args: GenerateDocumentArgs, graph: OntologyGraph) {
  const docId = args?.docId;
  if (!docId) throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, "docId 는 필수입니다 (예: ncr, inspection_request, quality_test_plan).");
  const schema = getSchema(docId);
  if (!schema) {
    throw new QualityMcpError(ERROR_CODES.SCHEMA_NOT_FOUND, `문서 종류를 찾을 수 없습니다: ${docId}. 사용할 수 있는 종류: ${listSchemaIds().join(" · ")}`);
  }
  const format: Format = args.format ?? "md";
  const body = buildDocumentBody(schema, args.formValues);
  const markdown = renderMarkdown(body);

  const missingRequired = body.draft.missingRequired.map((f) => `${f.sectionTitle} > ${f.label}`);
  const problems = body.draft.fields.flatMap((f) => f.problems.map((p) => `${f.sectionTitle} > ${f.label}: ${p}`));
  const common = {
    docId: schema.id,
    title: body.title,
    format,
    classification: schema.classification ?? null,
    officialForm: body.officialForm,
    requiredTotal: body.requiredTotal,
    requiredFilled: body.requiredFilled,
    missingRequired,
    problems,
    unknownKeys: body.draft.unknownKeys,
    remaining: REMAINING_WORK,
  };

  let output: Record<string, unknown>;
  if (format === "doclang") {
    output = { doclang: serializeToDoclang(body, schema.classification ?? null), doclangVersion: DOCLANG_VERSION };
  } else if (format === "hwpx" && problems.length > 0) {
    // 형식이 틀린 값은 칸에 그대로 찍힌다 — 고치기 전에는 파일을 만들지 않는다(쓸 수 없는 파일이 남는다)
    output = {
      hwpxSaved: false,
      note: "입력에 고칠 점(problems)이 있어 한글 파일을 만들지 않았습니다. problems 를 고친 뒤 다시 부르세요. 본문은 markdown 으로 미리 볼 수 있습니다.",
      markdown,
    };
  } else if (format === "hwpx") {
    const file = saveHwpx(schema.id, markdown, body.title);
    output = {
      hwpxSaved: true,
      hwpxPath: file.path,
      hwpxFileName: file.fileName,
      hwpxBytes: file.bytes,
      note: "한글에서 열어 내용을 확인한 뒤 사용합니다. 작성 안내 줄은 파일에 넣지 않았습니다 — 빈칸과 확인할 점은 missingRequired·problems 를 봅니다.",
    };
  } else {
    output = { markdown };
  }

  const basisIds = (schema.basis ?? []).filter((id) => graph.get(id));
  const basis: BasisRef[] =
    basisIds.length > 0 ? entityBasisWithStatus(graph, basisIds, 1) : [{ type: "schema_meta", id: schema.id, priority: 2, note: "문서 양식 정의" }];

  return buildResponse(
    "generate_quality_document",
    graph.version,
    {
      ...common,
      ...output,
      usage:
        missingRequired.length > 0 || problems.length > 0
          ? "빈 필수 항목과 확인할 점을 채운 뒤 다시 만든다. 그다음 review_quality_document 로 검토한다."
          : "review_quality_document 로 검토한 뒤 담당자가 확인·서명한다. 한글 파일은 format: 'hwpx' 또는 export_quality_document 로 받는다.",
    },
    basis,
    undefined,
    [
      { tool: "review_quality_document", reason: "필수 항목·날짜·인용 조문 검토" },
      { tool: "export_quality_document", reason: "본문을 한글 파일로 저장" },
    ],
    graph,
  );
}
