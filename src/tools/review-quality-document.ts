// ─────────────────────────────────────────────────────────────────────────────
// review-quality-document.ts — 문서 본문과 입력값을 검토해 고칠 점을 알려 준다.
//
// 보는 것
//   1) 필수 항목 — 입력값에 비어 있는 필수 항목, 본문에 값 없이 남은 필수 항목
//   2) 형식 — 숫자·선택지·날짜(달력에 없는 날짜 포함), 양식에 없는 키
//   3) 인용한 조문 — 수록한 법령 원문에 있는지 (확인됨·없는 조문·확인 불가)
//   4) 남은 작성 안내 줄
// 내용이 맞는지는 보지 못한다. 통과해도 담당자 검토와 서명이 남아 있다.
// ─────────────────────────────────────────────────────────────────────────────

import { getSchema, listSchemaIds } from "../schemas/loader.js";
import { buildResponse, entityBasisWithStatus } from "../lib/response.js";
import { ERROR_CODES, QualityMcpError } from "../lib/errors.js";
import { GUIDE_MARK, buildDocumentBody, renderMarkdown } from "../lib/document-body.js";
import { isCalendarDate } from "../lib/draft.js";
import { scanCitations } from "../lib/citation-resolver.js";
import type { BasisRef, ToolSpec } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

// ───── 상수 ─────
const SEVERITY = { ERROR: "error", WARNING: "warning", INFO: "info" } as const;
type Severity = (typeof SEVERITY)[keyof typeof SEVERITY];
/** 본문에 적힌 날짜 — 2026-03-15, 2026.3.15, 2026/03/15 */
const DATE_IN_TEXT = /(?<!\d)(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)/g;
const REMAINING_WORK =
  "이 검토는 빠진 항목과 형식, 인용한 조문의 실존만 봅니다. 적은 내용이 사실과 맞는지는 보지 못합니다 — 담당자 검토와 서명이 남아 있습니다.";

interface Finding {
  severity: Severity;
  /** missing_required · format · unknown_key · empty_in_body · not_in_body · invalid_date · citation_not_found · citation_unverifiable · guide_left */
  code: string;
  where: string;
  message: string;
}

export const spec: ToolSpec = {
  name: "review_quality_document",
  description:
    "품질 문서의 본문·입력값을 검토해 고칠 점을 알려 준다 — 비어 있는 필수 항목, 숫자·선택지·날짜 형식(달력에 없는 날짜 포함), 양식에 없는 키, " +
    "본문에 인용한 조문이 수록한 법령 원문에 있는지(확인됨·없는 조문·확인 불가). formValues(입력값)나 markdown(직접 쓴 본문·AI 가 쓴 본문) 중 하나 이상을 준다. " +
    "내용이 사실과 맞는지는 보지 못한다 — 통과해도 담당자 검토와 서명이 남아 있다. [검토 보조 · 확인과 서명은 품질관리자·감리원·발주자]",
  inputSchema: {
    type: "object",
    properties: {
      docId: { type: "string", description: `문서 종류 id (${listSchemaIds().length}종 — 예: ncr, inspection_request)` },
      formValues: { type: "object", description: "입력값 (generate_quality_document 에 준 것과 같은 모양)", additionalProperties: true },
      markdown: { type: "string", description: "검토할 본문 (Markdown). 없으면 formValues 로 만든 본문을 검토한다" },
    },
    required: ["docId"],
  },
};

export interface ReviewDocumentArgs {
  docId?: string;
  formValues?: Record<string, unknown>;
  markdown?: string;
}

const squash = (s: string): string => s.replace(/\s+/g, "");

/** 본문의 "| 항목 | 내용 |" 줄을 읽어 항목 이름 → 내용 */
function pairRows(markdown: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || /^\|[\s:|-]+\|$/.test(trimmed)) continue;
    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim());
    if (cells.length === 2 && cells[0]) rows.set(squash(cells[0]), cells[1] ?? "");
  }
  return rows;
}

export function run(args: ReviewDocumentArgs, graph: OntologyGraph) {
  const docId = args?.docId;
  if (!docId) throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, "docId 는 필수입니다 (예: ncr, inspection_request).");
  const schema = getSchema(docId);
  if (!schema) {
    throw new QualityMcpError(ERROR_CODES.SCHEMA_NOT_FOUND, `문서 종류를 찾을 수 없습니다: ${docId}. 사용할 수 있는 종류: ${listSchemaIds().join(" · ")}`);
  }
  const hasValues = args.formValues !== undefined && Object.keys(args.formValues).length > 0;
  const givenBody = typeof args.markdown === "string" && args.markdown.trim() !== "" ? args.markdown : null;
  if (!hasValues && !givenBody) {
    throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, "formValues(입력값)나 markdown(본문) 중 하나는 주어야 합니다.");
  }

  const body = buildDocumentBody(schema, args.formValues);
  const markdown = givenBody ?? renderMarkdown(body);
  const findings: Finding[] = [];
  const add = (severity: Severity, code: string, where: string, message: string): void => {
    findings.push({ severity, code, where, message });
  };

  // 1·2) 입력값 — 필수 항목과 형식
  if (hasValues) {
    for (const f of body.draft.missingRequired) add(SEVERITY.ERROR, "missing_required", `${f.sectionTitle} > ${f.label}`, `필수 항목이 비어 있습니다.${f.note ? ` ${f.note}` : ""}`);
    for (const f of body.draft.fields) for (const p of f.problems) add(SEVERITY.ERROR, "format", `${f.sectionTitle} > ${f.label}`, p);
    if (body.draft.unknownKeys.length > 0) {
      add(SEVERITY.WARNING, "unknown_key", "입력값", `양식에 없는 키라 본문에 들어가지 않습니다: ${body.draft.unknownKeys.join(", ")}`);
    }
  }

  // 1) 본문 — 직접 쓴 본문이면 필수 항목이 들어 있는지 본다
  if (givenBody) {
    const rows = pairRows(givenBody);
    const text = squash(givenBody);
    for (const f of body.draft.fields.filter((x) => x.required)) {
      if (hasValues && !f.filled) continue; // 위에서 이미 알렸다
      const where = `${f.sectionTitle} > ${f.label}`;
      const key = squash(f.label);
      const own = [...rows.entries()].filter(([k]) => k === key || k.startsWith(`${key}·`));
      if (own.length > 0) {
        if (own.every(([, v]) => v === "")) add(SEVERITY.ERROR, "empty_in_body", where, "본문에 항목은 있는데 내용이 비어 있습니다.");
      } else if (!text.includes(key)) {
        add(SEVERITY.WARNING, "not_in_body", where, "필수 항목인데 본문에서 이 항목 이름을 찾지 못했습니다 — 다른 이름으로 적었다면 그대로 두어도 됩니다.");
      }
    }
  }

  // 2) 본문의 날짜 — 입력값 검사에서 이미 알린 날짜는 다시 알리지 않는다
  const seenDates = new Set<string>(
    hasValues ? body.draft.fields.filter((f) => (f.kind === "date" || f.kind === "datetime") && f.problems.length > 0 && typeof f.value === "string").map((f) => String(f.value).slice(0, 10)) : [],
  );
  for (const m of markdown.matchAll(DATE_IN_TEXT)) {
    if (seenDates.has(m[0])) continue;
    seenDates.add(m[0]);
    if (!isCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]))) add(SEVERITY.ERROR, "invalid_date", m[0], "달력에 없는 날짜입니다.");
  }

  // 3) 인용한 조문
  const citations = scanCitations(markdown);
  for (const c of citations) {
    if (c.outcome === "not_found") add(SEVERITY.ERROR, "citation_not_found", c.reference, c.reason ?? "수록 원문에 없는 조문입니다.");
    else if (c.outcome === "unverifiable") add(SEVERITY.INFO, "citation_unverifiable", c.reference, `${c.reason ?? "확인하지 못했습니다."} (틀렸다는 뜻이 아님)`);
  }

  // 4) 남은 작성 안내
  const guideLines = markdown.split("\n").filter((l) => l.includes(GUIDE_MARK)).length;
  if (givenBody && guideLines > 0) {
    add(SEVERITY.INFO, "guide_left", "본문", `작성 안내 줄 ${guideLines}개가 남아 있습니다 — 한글 파일로 저장할 때는 빠집니다.`);
  }

  const count = (s: Severity): number => findings.filter((f) => f.severity === s).length;
  const errors = count(SEVERITY.ERROR);
  const verdict = errors > 0 ? "needs_revision" : "ready_for_human_review";

  const basisIds = (schema.basis ?? []).filter((id) => graph.get(id));
  const basis: BasisRef[] =
    basisIds.length > 0 ? entityBasisWithStatus(graph, basisIds, 1) : [{ type: "schema_meta", id: schema.id, priority: 2, note: "문서 양식 정의" }];

  return buildResponse(
    "review_quality_document",
    graph.version,
    {
      docId: schema.id,
      title: body.title,
      reviewed: givenBody ? (hasValues ? "입력값과 받은 본문" : "받은 본문") : "입력값과 그것으로 만든 본문",
      /** needs_revision = 고칠 점이 있음 / ready_for_human_review = 자동 검토에서 걸린 것이 없음(사람 검토는 남음) */
      verdict,
      summary: { errors, warnings: count(SEVERITY.WARNING), infos: count(SEVERITY.INFO) },
      findings,
      citations: citations.map((c) => ({ reference: c.reference, outcome: c.outcome, ...(c.title ? { title: c.title } : {}), ...(c.edition ? { edition: c.edition } : {}), ...(c.detailNote ? { detailNote: c.detailNote } : {}) })),
      requiredTotal: body.requiredTotal,
      ...(hasValues ? { requiredFilled: body.requiredFilled } : {}),
      remaining: REMAINING_WORK,
      usage:
        errors > 0
          ? "error 로 표시한 점을 고친 뒤 다시 검토한다."
          : "자동 검토에서 걸린 것이 없다. 담당자가 내용을 확인하고 서명한다. 한글 파일은 export_quality_document 로 저장한다.",
    },
    basis,
    { required: true, reason: errors > 0 ? `고칠 점 ${errors}건 — 수정 후 다시 검토.` : "자동 검토 통과 — 담당자 검토와 서명이 남아 있음." },
    errors > 0 ? undefined : [{ tool: "export_quality_document", reason: "본문을 한글 파일로 저장" }],
    graph,
  );
}
