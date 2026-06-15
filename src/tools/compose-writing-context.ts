// ─────────────────────────────────────────────────────────────────────────────
// compose-writing-context.ts — 양식 입력값을 LLM 작성 컨텍스트(Markdown)로 합성.
//
// agent-safety-oss 의 submit/generate 흐름에 대응하지만, quality 본질("작성은 LLM")에
// 맞춰 본문을 직접 생성하지 않는다. 대신 입력값 + 스키마 구조 + 적용 근거를 하나의
// Markdown 컨텍스트로 묶어, 사용자가 LLM 에게 그대로 넘겨 초안을 받게 한다.
// 필수 항목 누락도 함께 검출한다.
// ─────────────────────────────────────────────────────────────────────────────

import { getSchema } from "../schemas/loader.js";
import { buildResponse, entityBasisWithStatus } from "../lib/response.js";
import type { ToolSpec, BasisRef } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

export const spec: ToolSpec = {
  name: "compose_writing_context",
  description:
    "양식 입력값 + 스키마 구조 + 적용 근거를 합쳐 LLM 작성 컨텍스트(Markdown)로 만든다. " +
    "필수 항목 누락을 검출한다. 본문은 LLM이 작성, 승인·서명은 품질관리자·감리원·발주자. " +
    "[근거 제공용 · 문서를 직접 생성하지 않음]",
  inputSchema: {
    type: "object",
    properties: {
      docId: {
        type: "string",
        description: "문서 양식 id (render_quality_form 과 동일한 9종)",
      },
      formValues: {
        type: "object",
        description: "필드명 → 값 매핑 (사용자 입력)",
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
    throw new Error("docId는 필수입니다 (예: itp, ncr, inspection_request).");
  }
  const schema = getSchema(docId);
  if (!schema) {
    throw new Error(`문서 양식을 찾을 수 없습니다: ${docId}`);
  }
  const values = args?.formValues ?? {};

  const lines: string[] = [];
  lines.push(`# ${schema.title} — 작성 컨텍스트`, "");
  if (schema.reference) lines.push(`**참조**: ${schema.reference}`, "");
  if (schema.referenceStandard) lines.push(`**참조 표준**: ${schema.referenceStandard}`, "");
  if (schema.retention) lines.push(`**보존기간**: ${schema.retention}`, "");
  lines.push("", "## 입력값", "");

  const missingRequired: string[] = [];
  let filled = 0;
  let totalRequired = 0;
  for (const section of schema.sections) {
    lines.push(`### ${section.title}`);
    for (const field of section.fields) {
      const v = values[field.name];
      const has = v !== undefined && v !== null && String(v).trim() !== "";
      if (field.required) {
        totalRequired++;
        if (!has) missingRequired.push(`${section.title} > ${field.name}`);
      }
      if (has) filled++;
      lines.push(
        `- **${field.name}**${field.required ? " *(필수)*" : ""}: ${has ? String(v) : "_(미입력)_"}`,
      );
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

  const result = {
    docId: schema.id,
    title: schema.title,
    markdown,
    filledCount: filled,
    totalRequired,
    missingRequired,
    complete: missingRequired.length === 0,
    usage: "이 Markdown을 LLM에 전달해 본문 초안을 작성. 결재는 사람.",
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
      a2ui: { type: "decision", options: ["LLM 작성 요청", "필수 항목 보강", "근거 추가 확인"] },
    },
    undefined,
    graph,
  );
}
