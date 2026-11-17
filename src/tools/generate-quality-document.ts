// ─────────────────────────────────────────────────────────────────────────────
// generate-quality-document.ts — 문서 종류와 입력값으로 문서 본문을 만든다.
//
// 입력값을 양식 구조대로 옮길 뿐 문장을 짓지 않는다. 입력하지 않은 칸은 비워 두고 무엇을
// 적어야 하는지 작성 안내 줄로 알린다. 판정 수치도 만들지 않는다.
//   dclx     정본 — DocLang 아카이브(.dclx) 파일로 저장하고 경로를 돌려준다 (기본). 미리보기 Markdown 을 함께 준다
//   hwpx     정본(.dclx)을 저장하고 그 정본에서 한글 파일을 만든다
//   md       Markdown 본문만 (파일 없음)
//   doclang  DocLang 0.9 XML 글자만 (파일 없음)
// ─────────────────────────────────────────────────────────────────────────────

import { getSchema, listSchemaIds } from "../schemas/loader.js";
import { buildResponse, entityBasisWithStatus } from "../lib/response.js";
import { ERROR_CODES, QualityMcpError } from "../lib/errors.js";
import { buildDocumentBody, renderMarkdown } from "../lib/document-body.js";
import { DOCLANG_VERSION, serializeToDoclang } from "../lib/doclang-serializer.js";
import { saveDclx, saveHwpxFromDoclang } from "../lib/hwpx-export.js";
import { fillTestPlanFrequencies } from "../lib/test-plan-fill.js";
import type { BasisRef, ToolSpec } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

// ───── 상수 ─────
const FORMATS = ["dclx", "hwpx", "md", "doclang"] as const;
type Format = (typeof FORMATS)[number];
const REMAINING_WORK = "입력값을 옮긴 초안입니다. 담당자가 내용을 확인하고 서명해야 하며, 판정·승인은 품질관리자·감리원·발주자가 합니다.";

export const spec: ToolSpec = {
  name: "generate_quality_document",
  description:
    `품질 문서 ${listSchemaIds().length}종의 본문을 만든다 — 입력값(formValues)을 양식 구조대로 옮긴다. 문장을 짓지 않으며, 입력하지 않은 칸은 비워 두고 무엇을 적어야 하는지 알린다. ` +
    "형식: dclx(기본 — 정본인 DocLang 아카이브 .dclx 를 저장하고 경로와 미리보기 Markdown 을 돌려줌) · hwpx(정본 .dclx 를 저장하고 그 정본에서 한글 파일을 만듦) · md(Markdown 본문만) · doclang(DocLang 0.9 XML 글자만). 입력 형식에 고칠 점이 있으면 파일을 만들지 않고 problems 를 돌려준다. " +
    "사용자가 문서를 써 달라고 하면(\"써줘\" · \"만들어줘\" · \"정리해줘\") format: 'hwpx' 로 정본과 한글 파일까지 만든다 — 받은 값만으로 먼저 만들고 빠진 칸은 비워 둔 채 무엇이 빠졌는지 알린다. 빠진 값을 묻느라 파일 만들기를 미루지 않는다. 한글 파일은 나중에 export_quality_document 에 정본 경로(dclxPath)를 주어 만들 수도 있다. 본문만 보여 달라고 하면 md. " +
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
      format: { type: "string", enum: [...FORMATS], description: "출력 형식 — dclx(기본, 정본 파일) · hwpx(정본 + 한글 파일) · md · doclang" },
    },
    required: ["docId"],
  },
  // dclx·hwpx 형식은 이 컴퓨터에 파일을 새로 쓴다(덮어쓰지 않음)
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
  const format: Format = args.format ?? "dclx";
  const body = buildDocumentBody(schema, args.formValues);
  // 품질시험계획서의 시험 빈도는 원문 값 — 별표 2 에서 하나로 정해지면 채우고, 여럿이면 후보를 알린다
  const frequencyFill = schema.id === "quality_test_plan" ? fillTestPlanFrequencies(body) : null;
  const markdown = renderMarkdown(body);

  const missingRequired = body.draft.missingRequired.map((f) => `${f.sectionTitle} > ${f.label}`);
  const problems = body.draft.fields.flatMap((f) => f.problems.map((p) => `${f.sectionTitle} > ${f.label}: ${p}`));
  const common = {
    docId: schema.id,
    title: body.title,
    format,
    classification: schema.classification ?? null,
    officialForm: body.officialForm,
    /** 이 문서의 작성 기준(서식 작성요령·대상 요건) — 파일만 받는 경우에도 보이게 */
    guidance: body.guidance,
    requiredTotal: body.requiredTotal,
    requiredFilled: body.requiredFilled,
    missingRequired,
    problems,
    unknownKeys: body.draft.unknownKeys,
    remaining: REMAINING_WORK,
    ...(frequencyFill ? { frequencyFilled: frequencyFill.filled, frequencyCandidates: frequencyFill.candidates } : {}),
  };

  let output: Record<string, unknown>;
  if (format === "md") {
    output = { markdown };
  } else if (format === "doclang") {
    output = { doclang: serializeToDoclang(body, schema.classification ?? null), doclangVersion: DOCLANG_VERSION };
  } else if (problems.length > 0) {
    // 형식이 틀린 값은 칸에 그대로 찍힌다 — 고치기 전에는 파일을 만들지 않는다(쓸 수 없는 파일이 남는다)
    output = {
      dclxSaved: false,
      ...(format === "hwpx" ? { hwpxSaved: false } : {}),
      note: "입력에 고칠 점(problems)이 있어 파일을 만들지 않았습니다. problems 를 고친 뒤 다시 부르세요. 본문은 markdown 으로 미리 볼 수 있습니다.",
      markdown,
    };
  } else {
    // 정본은 DocLang — 한글 파일은 이 정본에서 만든다
    const documentXml = serializeToDoclang(body, schema.classification ?? null);
    const dclx = saveDclx(schema.id, documentXml);
    output = { dclxSaved: true, dclxPath: dclx.path, dclxFileName: dclx.fileName, dclxBytes: dclx.bytes, doclangVersion: DOCLANG_VERSION };
    if (format === "hwpx") {
      const hwpx = saveHwpxFromDoclang(schema.id, documentXml, body.title);
      output = {
        ...output,
        hwpxSaved: true,
        hwpxPath: hwpx.path,
        hwpxFileName: hwpx.fileName,
        hwpxBytes: hwpx.bytes,
        note: "정본(.dclx)을 저장하고 그 정본에서 한글 파일을 만들었습니다. 한글에서 열어 내용을 확인한 뒤 사용합니다. 작성 안내 줄은 파일에 넣지 않았습니다 — 빈칸과 확인할 점은 missingRequired·problems 를 봅니다.",
      };
    } else {
      output = {
        ...output,
        markdown,
        note: "정본(.dclx — DocLang 아카이브)을 저장했습니다. markdown 은 작성 안내 줄을 넣은 미리보기입니다. 한글 파일은 export_quality_document 에 dclxPath 를 주면 이 정본에서 만듭니다.",
      };
    }
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
