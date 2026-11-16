// ─────────────────────────────────────────────────────────────────────────────
// export-quality-document.ts — 이미 쓴 본문(Markdown)을 한글(HWPX) 파일로 저장한다.
//
// 직접 쓴 본문, AI 가 쓴 본문, generate_quality_document 가 만든 본문 모두 받는다.
// 작성 안내 줄은 빼고 저장한다. 한글 프로그램 없이 파일을 만든다.
// 파일은 이 컴퓨터의 저장 폴더에 새로 쓰며(덮어쓰지 않음), returnContent 를 켜면
// 저장하지 않고 파일 내용을 base64 로 돌려준다(이 컴퓨터 밖에서 부를 때).
// ─────────────────────────────────────────────────────────────────────────────

import { getSchema, listSchemaIds } from "../schemas/loader.js";
import { buildResponse, entityBasisWithStatus } from "../lib/response.js";
import { ERROR_CODES, QualityMcpError } from "../lib/errors.js";
import { GUIDE_MARK, documentTitle } from "../lib/document-body.js";
import { HWPX_MIME_TYPE, buildHwpx, safeDocumentName, saveHwpx } from "../lib/hwpx-export.js";
import type { BasisRef, ToolSpec } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

// ───── 상수 ─────
const FIRST_HEADING = /^#\s+(.+)$/m;
const DEFAULT_TITLE = "품질 문서";
const SUPPORTED_MARKDOWN = "제목(#~####), 문단, 굵게(**), 목록(-, 1.), 체크 상자, 인용(>), 표, 구분선";

export const spec: ToolSpec = {
  name: "export_quality_document",
  description:
    "이미 쓴 문서 본문(Markdown — 직접 쓴 것, AI 가 쓴 것, generate_quality_document 가 만든 것)을 한글(HWPX) 파일로 저장하고 경로를 돌려준다. " +
    "한글 프로그램 없이 만든다. 작성 안내 줄은 빼고 저장하며, 공식 서식의 칸 배치는 재현하지 않는다. " +
    `지원하는 Markdown: ${SUPPORTED_MARKDOWN}. returnContent 를 켜면 저장하지 않고 파일 내용(base64)을 돌려준다. [근거 제공용 · 내용 확인과 서명은 품질관리자·감리원·발주자]`,
  inputSchema: {
    type: "object",
    properties: {
      markdown: { type: "string", description: "저장할 본문 (Markdown)" },
      docId: { type: "string", description: `문서 종류 id (선택 — 파일 이름과 제목에 쓴다. ${listSchemaIds().length}종 중 하나)` },
      title: { type: "string", description: "문서 제목 (선택 — 없으면 본문의 첫 제목 줄, 그다음 문서 종류의 제목)" },
      returnContent: { type: "boolean", description: "true 면 파일로 저장하지 않고 내용을 base64 로 돌려준다" },
    },
    required: ["markdown"],
  },
  // 이 컴퓨터에 파일을 새로 쓴다(덮어쓰지 않음)
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};

export interface ExportDocumentArgs {
  markdown?: string;
  docId?: string;
  title?: string;
  returnContent?: boolean;
}

export function run(args: ExportDocumentArgs, graph: OntologyGraph) {
  const markdown = args?.markdown;
  if (typeof markdown !== "string" || markdown.trim() === "") {
    throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, "markdown(저장할 본문)은 필수입니다.");
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
