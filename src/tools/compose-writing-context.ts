// ─────────────────────────────────────────────────────────────────────────────
// compose-writing-context.ts — 양식 입력값을 작성 컨텍스트(Markdown)로 묶는다.
//
// 입력값 + 양식 구조 + 적용 근거를 한 Markdown 으로 묶어, AI 비서가 그 범위 안에서
// 초안을 쓰게 한다. 비어 있는 필수 항목·형식에 맞지 않는 값·양식에 없는 키도 알려 준다.
// 입력값 정리는 lib/draft.ts 가 한다(폼·본문 생성·검토와 같은 기준).
// ─────────────────────────────────────────────────────────────────────────────

import { getSchema, listSchemaIds } from "../schemas/loader.js";
import { buildResponse, entityBasisWithStatus } from "../lib/response.js";
import { ERROR_CODES, QualityMcpError } from "../lib/errors.js";
import { displayText, normalizeDraft } from "../lib/draft.js";
import type { ToolSpec, BasisRef } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

export const spec: ToolSpec = {
  name: "compose_writing_context",
  description:
    "양식 입력값 + 양식 구조 + 적용 근거를 합쳐 작성 컨텍스트(Markdown)로 만든다. " +
    "비어 있는 필수 항목과 형식에 맞지 않는 값을 알려 준다. 승인·서명은 품질관리자·감리원·발주자. " +
    "[근거 제공용]",
  inputSchema: {
    type: "object",
    properties: {
      docId: {
        type: "string",
        description: `문서 양식 id (render_quality_form 과 같은 ${listSchemaIds().length}종)`,
      },
      formValues: {
        type: "object",
        description:
          "입력값. 키는 필드 이름(또는 한글 표시 이름). A2UI 폼의 데이터 모델 /draft 를 그대로 넘겨도 된다 — " +
          "묶음은 {항목: 값}, 목록은 배열 또는 여러 줄 글자, 표는 객체 배열 또는 한 줄에 한 건(' | ' 로 열 구분)",
        additionalProperties: true,
      },
    },
    required: ["docId"],
  },
};

export interface ComposeWritingContextArgs {
  docId?: string;
  formValues?: Record<string, unknown>;
}

export function run(args: ComposeWritingContextArgs, graph: OntologyGraph) {
  const docId = args?.docId;
  if (!docId) {
    throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, "docId는 필수입니다 (예: itp, ncr, inspection_request).");
  }
  const schema = getSchema(docId);
  if (!schema) {
    throw new QualityMcpError(
      ERROR_CODES.SCHEMA_NOT_FOUND,
      `문서 양식을 찾을 수 없습니다: ${docId}. 사용 가능 양식: ${listSchemaIds().join(" · ")}`,
    );
  }
  const draft = normalizeDraft(schema, args?.formValues);

  const lines: string[] = [];
  lines.push(`# ${schema.title} — 작성 컨텍스트`, "");
  if (schema.reference) lines.push(`**참조**: ${schema.reference}`, "");
  if (schema.referenceStandard) lines.push(`**참조 표준**: ${schema.referenceStandard}`, "");
  if (schema.retention) lines.push(`**보존기간**: ${schema.retention}`, "");
  lines.push("", "## 입력값", "");

  for (const section of schema.sections) {
    lines.push(`### ${section.title}`);
    for (const field of draft.fields.filter((f) => f.sectionKey === section.key)) {
      const mark = field.required ? " *(필수)*" : "";
      lines.push(`- **${field.label}**${mark}: ${field.filled ? displayText(field) : "_(미입력)_"}`);
      for (const problem of field.problems) lines.push(`  - 확인 필요: ${problem}`);
    }
    lines.push("");
  }

  // 적용 근거 (그래프 실존 노드만)
  const basisIds = (schema.basis ?? []).filter((id) => graph.get(id));
  if (basisIds.length > 0) {
    lines.push("## 적용 근거", "");
    for (const id of basisIds) {
      const e = graph.get(id);
      lines.push(`- ${e?.name ?? id} (\`${id}\`)`);
    }
    lines.push("");
  }

  lines.push(
    "## 작성 지침",
    "",
    `위 입력값과 근거를 바탕으로 **${schema.title}** 본문을 작성하십시오.`,
    "- 미입력 필수 항목이 있으면 작성 전 보강하십시오.",
    "- 근거 없는 법적·기술적 단정은 피하고, 표시된 참조 표준 범위에서 서술하십시오.",
    "- 최종 판정·승인·서명은 품질관리자·감리원·발주자의 책임입니다.",
  );

  const markdown = lines.join("\n");
  const basis: BasisRef[] =
    basisIds.length > 0
      ? entityBasisWithStatus(graph, basisIds, 1)
      : [{ type: "schema_meta", id: schema.id, priority: 2, note: "문서 양식 스키마" }];

  const missingRequired = draft.missingRequired.map((f) => `${f.sectionTitle} > ${f.label}`);
  const problems = draft.fields.flatMap((f) => f.problems.map((p) => `${f.sectionTitle} > ${f.label}: ${p}`));
  const result = {
    docId: schema.id,
    title: schema.title,
    markdown,
    filledCount: draft.fields.filter((f) => f.filled).length,
    totalRequired: draft.fields.filter((f) => f.required).length,
    missingRequired,
    problems,
    unknownKeys: draft.unknownKeys,
    complete: missingRequired.length === 0 && problems.length === 0,
    usage: "이 Markdown 을 AI 비서에 전달해 본문 초안을 작성. 결재는 사람.",
  };

  return buildResponse(
    "compose_writing_context",
    graph.version,
    result,
    basis,
    {
      required: true,
      reason:
        missingRequired.length > 0
          ? `필수 항목 ${missingRequired.length}건 미입력 — 보강 후 작성 권장.`
          : "법정 품질기록물 작성 컨텍스트 — 본문 작성 후 품질관리자·감리원 결재 필요.",
      a2ui: { type: "decision", options: ["작성 요청", "필수 항목 보강", "근거 추가 확인"] },
    },
    undefined,
    graph,
  );
}
