// ─────────────────────────────────────────────────────────────────────────────
// export-quality-document.ts — 정본(.dclx — DocLang 아카이브)이나 이미 쓴 본문(Markdown)을 한글(HWPX) 파일로 저장한다.
//
// 정본이 먼저다 — generate_quality_document 가 저장한 .dclx 경로, .dclx 내용(base64), DocLang 글 가운데 하나를 받으면
// 그 정본에서 한글 파일을 만든다. 정본이 없으면 직접 쓴 본문·AI 가 쓴 본문(Markdown)을 받는다(작성 안내 줄은 뺀다).
// 경로로 받는 .dclx 는 이 도구의 저장 폴더 안의 파일만 읽는다(다른 파일을 읽어 보내지 않게). 한글 프로그램 없이 파일을 만든다.
// 파일은 이 컴퓨터의 저장 폴더에 새로 쓰며(덮어쓰지 않음), returnContent 를 켜면
// 저장하지 않고 파일 내용을 base64 로 돌려준다(이 컴퓨터 밖에서 부를 때).
// ─────────────────────────────────────────────────────────────────────────────

import { getSchema, listSchemaIds } from "../schemas/loader.js";
import { buildResponse, entityBasisWithStatus } from "../lib/response.js";
import { ERROR_CODES, QualityMcpError } from "../lib/errors.js";
import { GUIDE_MARK, documentTitle } from "../lib/document-body.js";
import { HWPX_MIME_TYPE, buildHwpx, buildHwpxFromDoclang, safeDocumentName, saveDocumentBytes, saveHwpx } from "../lib/hwpx-export.js";
import { DCLX_EXTENSION, unpackDclx } from "../lib/dclx.js";
import { fillOfficialForm, officialFormMap } from "../lib/official-form.js";
import { formValuesFromDoclang } from "../lib/doclang-values.js";
import { buildDocumentBody } from "../lib/document-body.js";
import { getDocumentsDir } from "../config/paths.js";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { sep } from "node:path";
import type { BasisRef, ToolSpec } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

// ───── 상수 ─────
const FIRST_HEADING = /^#\s+(.+)$/m;
const DEFAULT_TITLE = "품질 문서";
const SUPPORTED_MARKDOWN = "제목(#~####), 문단, 굵게(**), 목록(-, 1.), 체크 상자, 인용(>), 표, 구분선";
/** 받는 정본 파일의 최대 크기 */
const DCLX_MAX_BYTES = 32 * 1024 * 1024;

export const spec: ToolSpec = {
  name: "export_quality_document",
  description:
    "정본(.dclx — DocLang 아카이브)에서 한글(HWPX) 파일을 만들어 저장하고 경로를 돌려준다. 정본은 dclxPath(generate_quality_document 가 저장한 .dclx 경로) · dclxBase64(.dclx 내용) · doclang(DocLang 글) 가운데 하나로 준다. " +
    "정본이 없으면 이미 쓴 본문(markdown — 직접 쓴 것, AI 가 쓴 것)을 받는다. 한글 프로그램 없이 만든다. 작성 안내 줄은 넣지 않는다. 법정 서식 원본이 있는 문서의 정본은 그 서식의 칸 배치 그대로 채운 한글 파일로 만들고, 그 밖(Markdown 본문 포함)은 항목 구조로 만든다. " +
    `지원하는 Markdown: ${SUPPORTED_MARKDOWN}. returnContent 를 켜면 저장하지 않고 파일 내용(base64)을 돌려준다. [근거 제공용 · 내용 확인과 서명은 품질관리자·감리원·발주자]`,
  inputSchema: {
    type: "object",
    properties: {
      dclxPath: { type: "string", description: "정본 .dclx(DocLang 아카이브) 파일 경로 — generate_quality_document 가 돌려준 dclxPath. 이 도구의 저장 폴더 안의 파일만 받는다" },
      dclxBase64: { type: "string", description: "정본 .dclx(DocLang 아카이브) 파일 내용(base64) — 저장 폴더 밖의 정본이나 이 컴퓨터 밖에서 부를 때" },
      doclang: { type: "string", description: "정본 DocLang 문서(XML 글)" },
      markdown: { type: "string", description: "저장할 본문 (Markdown) — 정본이 없을 때" },
      docId: { type: "string", description: `문서 종류 id (선택 — 파일 이름과 제목에 쓴다. ${listSchemaIds().length}종 중 하나)` },
      title: { type: "string", description: "문서 제목 (선택 — 없으면 본문의 첫 제목 줄, 그다음 문서 종류의 제목)" },
      returnContent: { type: "boolean", description: "true 면 파일로 저장하지 않고 내용을 base64 로 돌려준다" },
    },
  },
  // 이 컴퓨터에 파일을 새로 쓴다(덮어쓰지 않음)
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};

export interface ExportDocumentArgs {
  dclxPath?: string;
  dclxBase64?: string;
  doclang?: string;
  markdown?: string;
  docId?: string;
  title?: string;
  returnContent?: boolean;
}

/** 저장 폴더 안의 .dclx 만 읽는다 — 실제 경로로 확인해 바로가기로 밖의 파일을 읽지 않게 한다 */
function readDclxInDocuments(path: string): Buffer {
  if (!path.toLowerCase().endsWith(`.${DCLX_EXTENSION}`)) throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, `dclxPath 는 .${DCLX_EXTENSION} 파일이어야 합니다: ${path}`);
  if (!existsSync(path)) throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, `dclxPath 의 파일이 없습니다: ${path}`);
  const root = existsSync(getDocumentsDir()) ? realpathSync(getDocumentsDir()) : getDocumentsDir();
  const real = realpathSync(path);
  if (!real.startsWith(root + sep)) {
    throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, `dclxPath 는 이 도구의 저장 폴더(${root}) 안의 파일만 받습니다 — 다른 곳의 정본은 dclxBase64 로 주세요.`);
  }
  if (statSync(real).size > DCLX_MAX_BYTES) throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, "정본 파일이 너무 큽니다");
  return readFileSync(real);
}

/** 받은 입력에서 정본 DocLang 문서를 꺼낸다 (정본이 없으면 null) */
function doclangSource(args: ExportDocumentArgs): { xml: string; from: "dclxPath" | "dclxBase64" | "doclang" } | null {
  try {
    if (typeof args.dclxPath === "string" && args.dclxPath.trim()) return { xml: unpackDclx(readDclxInDocuments(args.dclxPath.trim())).documentXml, from: "dclxPath" };
    if (typeof args.dclxBase64 === "string" && args.dclxBase64.trim()) {
      const data = Buffer.from(args.dclxBase64.trim(), "base64");
      if (data.length > DCLX_MAX_BYTES) throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, "정본 파일이 너무 큽니다");
      return { xml: unpackDclx(data).documentXml, from: "dclxBase64" };
    }
  } catch (err) {
    if (err instanceof QualityMcpError) throw err;
    throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, (err as Error).message);
  }
  if (typeof args.doclang === "string" && args.doclang.trim()) return { xml: args.doclang, from: "doclang" };
  return null;
}

export function run(args: ExportDocumentArgs, graph: OntologyGraph) {
  const source = doclangSource(args ?? {});
  if (source) return runFromDoclang(args, source, graph);
  const markdown = args?.markdown;
  if (typeof markdown !== "string" || markdown.trim() === "") {
    throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, "정본(dclxPath · dclxBase64 · doclang) 또는 본문(markdown) 가운데 하나는 있어야 합니다.");
  }
  const schema = args.docId ? getSchema(args.docId) : null;
  if (args.docId && !schema) {
    throw new QualityMcpError(ERROR_CODES.SCHEMA_NOT_FOUND, `문서 종류를 찾을 수 없습니다: ${args.docId}. 사용할 수 있는 종류: ${listSchemaIds().join(" · ")}`);
  }
  const title = args.title?.trim() || FIRST_HEADING.exec(markdown)?.[1]?.trim() || (schema ? documentTitle(schema) : DEFAULT_TITLE);
  const guideLines = markdown.split("\n").filter((l) => l.includes(GUIDE_MARK)).length;

  const basisIds = (schema?.basis ?? []).filter((id) => graph.get(id));
  const basis: BasisRef[] =
    basisIds.length > 0
      ? entityBasisWithStatus(graph, basisIds, 1)
      : [{ type: "schema_meta", id: schema?.id ?? "export", priority: 2, note: "받은 본문을 그대로 옮김 — 내용은 검토하지 않음" }];

  const common = {
    title,
    format: "hwpx",
    mimeType: HWPX_MIME_TYPE,
    removedGuideLines: guideLines,
    note: "한글에서 열어 내용과 모양을 확인한 뒤 사용합니다. 받은 본문을 그대로 옮겼고 내용은 검토하지 않았습니다 — 검토는 review_quality_document.",
  };

  if (args.returnContent === true) {
    const data = buildHwpx(markdown, title);
    return buildResponse(
      "export_quality_document",
      graph.version,
      { ...common, fileName: `${safeDocumentName(schema?.id)}.hwpx`, bytes: data.length, contentBase64: data.toString("base64") },
      basis,
      undefined,
      [],
      graph,
    );
  }

  const file = saveHwpx(schema?.id, markdown, title);
  return buildResponse(
    "export_quality_document",
    graph.version,
    { ...common, hwpxPath: file.path, fileName: file.fileName, bytes: file.bytes },
    basis,
    undefined,
    [],
    graph,
  );
}

/** 정본(DocLang)에서 한글 파일을 만든다 */
function runFromDoclang(args: ExportDocumentArgs, source: { xml: string; from: string }, graph: OntologyGraph) {
  let built: { data: Buffer; title: string; docId: string | null };
  try {
    built = buildHwpxFromDoclang(source.xml, args.title);
  } catch (err) {
    throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, (err as Error).message);
  }
  const docId = args.docId ?? built.docId ?? undefined;
  const schema = docId ? getSchema(docId) : null;
  if (args.docId && !schema) {
    throw new QualityMcpError(ERROR_CODES.SCHEMA_NOT_FOUND, `문서 종류를 찾을 수 없습니다: ${args.docId}. 사용할 수 있는 종류: ${listSchemaIds().join(" · ")}`);
  }
  // 법정 서식 원본이 있는 문서는 정본의 값을 되읽어 그 서식의 칸에 채운다
  let form: ReturnType<typeof fillOfficialForm> = null;
  if (schema && officialFormMap(schema.id)) {
    form = fillOfficialForm(schema.id, buildDocumentBody(schema, formValuesFromDoclang(schema, source.xml)).draft);
    if (form) built = { ...built, data: form.data };
  }
  const basisIds = (schema?.basis ?? []).filter((id) => graph.get(id));
  const basis: BasisRef[] =
    basisIds.length > 0
      ? entityBasisWithStatus(graph, basisIds, 1)
      : [{ type: "schema_meta", id: schema?.id ?? "export", priority: 2, note: "받은 정본을 그대로 옮김 — 내용은 검토하지 않음" }];
  const common = {
    title: built.title,
    format: "hwpx",
    mimeType: HWPX_MIME_TYPE,
    from: source.from,
    hwpxLayout: form ? "official_form" : "item_structure",
    ...(form ? { hwpxForm: form.form, hwpxFormSource: form.source.url, notInForm: form.notInForm } : {}),
    note: form
      ? `정본(DocLang)의 값을 법정 서식(${form.form}) 원본의 칸에 채운 한글 파일입니다. 입력하지 않은 칸과 서명 칸은 비어 있습니다. 서식에 칸이 없는 값(notInForm)은 정본에만 있습니다. 한글에서 열어 확인한 뒤 사용합니다 — 검토는 review_quality_document.`
      : "정본(DocLang)에서 만든 한글 파일입니다. 한글에서 열어 내용과 모양을 확인한 뒤 사용합니다. 받은 정본을 그대로 옮겼고 내용은 검토하지 않았습니다 — 검토는 review_quality_document.",
  };
  const name = schema?.id ?? (docId && /^[a-z][a-z0-9_]*$/.test(docId) ? docId : undefined);
  if (args.returnContent === true) {
    return buildResponse(
      "export_quality_document",
      graph.version,
      { ...common, fileName: `${safeDocumentName(name)}.hwpx`, bytes: built.data.length, contentBase64: built.data.toString("base64") },
      basis,
      undefined,
      [],
      graph,
    );
  }
  const file = saveDocumentBytes(name, "hwpx", built.data);
  return buildResponse("export_quality_document", graph.version, { ...common, hwpxPath: file.path, fileName: file.fileName, bytes: file.bytes }, basis, undefined, [], graph);
}
