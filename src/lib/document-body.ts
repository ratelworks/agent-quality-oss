// ─────────────────────────────────────────────────────────────────────────────
// document-body.ts — 입력값을 양식 구조대로 옮겨 문서 본문(Markdown)을 만든다.
//
// 문장을 짓지 않는다. 입력한 값은 그 자리에 그대로 넣고, 입력하지 않은 칸은 비워 둔 채
// 무엇을 적어야 하는지 "작성 안내" 줄로 알린다. 작성 안내 줄은 결재·제출용 사본에서 빠진다.
// 법령·고시 서식을 따르는 문서도 기재 항목만 옮기며, 서식의 칸 배치는 재현하지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

import type { DocumentSchema } from "../schemas/loader.js";
import { enumLabel } from "../schemas/fields.js";
import { FREE_TEXT_KEY, normalizeDraft } from "./draft.js";
import type { DraftField, NormalizedDraft } from "./draft.js";

// ───── 상수 ─────
/** 작성 안내 줄의 머리 — 이 표시로 시작하는 인용 줄은 결재·제출용 사본에서 뺀다 */
export const GUIDE_MARK = "[작성 안내]";
const GUIDE_LINE = `> ${GUIDE_MARK} `;
/** 비어 있는 표에 두는 빈 줄 수 — 손으로 적을 자리 */
const EMPTY_TABLE_ROWS = 3;
const PAIR_HEADER = ["항목", "내용"];
const ROW_NUMBER_HEADER = "번호";
/** 첫 열이 이미 번호인 표 — 번호 열을 따로 붙이지 않는다 */
const NUMBER_COLUMN = /번호|순번/;
const CLOSING_GUIDE = "결재·제출 전에 담당자가 내용을 확인하고 서명합니다. 판정·승인은 품질관리자·감리원·발주자가 합니다.";

export interface BodySection {
  key: string;
  /** "1. 보고서 기본정보" */
  heading: string;
  title: string;
  origin: "legal" | "practice" | null;
  fields: DraftField[];
}

export interface DocumentBody {
  docId: string;
  /** 문서 제목 — 양식 제목에서 뒤의 괄호 설명을 뺀 것 */
  title: string;
  /** 따르는 법령·고시 서식 (있을 때) */
  officialForm: string | null;
  sections: BodySection[];
  draft: NormalizedDraft;
  /** 필수 항목 수와 그중 채운 수 */
  requiredTotal: number;
  requiredFilled: number;
}

/** "부적합 보고서(NCR) (실무 서식 — 법정 전용 서식 없음)" → "부적합 보고서(NCR)" */
export function documentTitle(schema: DocumentSchema): string {
  let title = schema.title.trim();
  for (;;) {
    const next = title.replace(/\s+\([^()]*\)$/, "");
    if (next === title) return title;
    title = next;
  }
}

/** 입력값을 정리해 본문의 뼈대를 만든다 */
export function buildDocumentBody(schema: DocumentSchema, formValues: unknown): DocumentBody {
  const draft = normalizeDraft(schema, formValues);
  const sections: BodySection[] = schema.sections.map((section, index) => ({
    key: section.key,
    heading: `${index + 1}. ${section.title}`,
    title: section.title,
    origin: section.origin ?? null,
    fields: draft.fields.filter((f) => f.sectionKey === section.key),
  }));
  const form = schema.officialForm;
  const required = draft.fields.filter((f) => f.required);
  return {
    docId: schema.id,
    title: documentTitle(schema),
    officialForm: form ? `${form.law} ${form.annex}${form.annex.startsWith("별지") ? "서식" : ""}(${form.title})` : null,
    sections,
    draft,
    requiredTotal: required.length,
    requiredFilled: required.filter((f) => f.filled).length,
  };
}

// ───── 값 꺼내기 (Markdown·DocLang 공용) ─────

/** 한 줄 값 — 선택형은 한글 이름으로 */
export function scalarText(field: DraftField): string {
  const v = field.value;
  if (typeof v !== "string") return "";
  return field.kind === "choice" && v ? enumLabel(v) : v;
}

/** 여러 줄로 적은 글의 줄들 */
export function textLines(field: DraftField): string[] {
  return scalarText(field)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** 묶음 필드를 (항목 이름, 값) 줄로 — 비어 있어도 항목마다 한 줄 */
export function groupPairs(field: DraftField): Array<{ label: string; value: string }> {
  const value = (typeof field.value === "object" && !Array.isArray(field.value) ? field.value : {}) as Record<string, string>;
  const free = value[FREE_TEXT_KEY];
  if (free) return [{ label: field.label, value: free }];
  if (field.columns.length === 0) return [{ label: field.label, value: "" }];
  return field.columns.map((col) => ({ label: `${field.label} · ${col.label}`, value: value[col.key] ?? "" }));
}

export function listItems(field: DraftField): string[] {
  return Array.isArray(field.value) ? field.value.filter((v): v is string => typeof v === "string") : [];
}

export function tableRows(field: DraftField): Array<Record<string, string>> {
  return Array.isArray(field.value) ? field.value.filter((v): v is Record<string, string> => typeof v === "object" && v !== null) : [];
}

/**
 * 표 필드의 머리 줄과 내용 줄 — 입력한 건마다 한 줄, 비어 있으면 손으로 적을 빈 줄.
 * 양식의 첫 열이 번호가 아니면 번호 열을 앞에 붙인다.
 */
export function rowTable(field: DraftField): { header: string[]; lines: string[][] } {
  const numbered = !NUMBER_COLUMN.test(field.columns[0]?.label ?? "");
  const header = [...(numbered ? [ROW_NUMBER_HEADER] : []), ...field.columns.map((c) => c.label)];
  const rows = tableRows(field);
  const lines =
    rows.length > 0
      ? rows.map((row, i) => [...(numbered ? [String(i + 1)] : []), ...field.columns.map((c) => row[c.key] ?? "")])
      : Array.from({ length: EMPTY_TABLE_ROWS }, () => header.map(() => ""));
  return { header, lines };
}

/** 본문에서 따로 한 덩이로 적는 필드인가 (그 밖에는 "항목 | 내용" 표의 한 줄) */
export function isBlockField(field: DraftField): boolean {
  if (field.kind === "rows") return true;
  if (!field.filled) return false;
  if (field.kind === "list") return true;
  return field.kind === "longText" && textLines(field).length > 1;
}

/** 빈칸·형식 문제를 알리는 안내 문장들 */
export function fieldGuides(field: DraftField): string[] {
  const guides: string[] = [];
  if (!field.filled) {
    const what = field.note ? ` ${field.note}` : "";
    guides.push(`${field.label}${field.required ? " (필수)" : ""} — 비어 있습니다.${what}`);
  }
  for (const problem of field.problems) guides.push(`${field.label} — 확인 필요: ${problem}`);
  return guides;
}

/** 문서 머리의 안내 문장들 */
export function headGuides(body: DocumentBody): string[] {
  const guides = ["입력한 값을 양식 구조대로 옮긴 초안입니다. 입력하지 않은 칸은 비워 두었고 값을 지어내지 않았습니다."];
  const missing = body.requiredTotal - body.requiredFilled;
  guides.push(missing > 0 ? `필수 항목 ${body.requiredTotal}개 중 ${missing}개가 비어 있습니다.` : `필수 항목 ${body.requiredTotal}개를 모두 채웠습니다.`);
  if (body.officialForm) {
    guides.push(`따르는 서식: ${body.officialForm}. 기재 항목만 옮겼고 서식의 칸 배치는 재현하지 않았습니다 — 제출용 서식 파일은 법제처 국가법령정보센터에서 받습니다.`);
  }
  if (body.draft.unknownKeys.length > 0) guides.push(`양식에 없는 입력 키는 본문에 넣지 않았습니다: ${body.draft.unknownKeys.join(", ")}`);
  guides.push(`${GUIDE_MARK} 로 시작하는 줄은 결재·제출용 파일(한글)에는 들어가지 않습니다.`);
  return guides;
}

export function closingGuide(): string {
  return CLOSING_GUIDE;
}

// ───── Markdown ─────

/** 표 칸에 넣을 글자 — 칸 구분 문자와 줄바꿈을 바꾼다 */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
}

function tableLines(header: string[], rows: string[][]): string[] {
  return [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)];
}

/** 본문 Markdown — 작성 안내 줄 포함 */
export function renderMarkdown(body: DocumentBody): string {
  const out: string[] = [`# ${body.title}`, ""];
  for (const guide of headGuides(body)) out.push(`${GUIDE_LINE}${guide}`);
  out.push("");

  for (const section of body.sections) {
    out.push(`## ${section.heading}`, "");
    let pairs: string[][] = [];
    const flushPairs = (): void => {
      if (pairs.length === 0) return;
      out.push(...tableLines(PAIR_HEADER, pairs), "");
      pairs = [];
    };
    for (const field of section.fields) {
      if (!isBlockField(field)) {
        if (field.kind === "group") for (const p of groupPairs(field)) pairs.push([p.label, p.value]);
        else if (field.kind === "list") pairs.push([field.label, listItems(field).join(", ")]);
        else pairs.push([field.label, scalarText(field)]);
        continue;
      }
      flushPairs();
      if (field.kind === "rows") {
        const { header, lines } = rowTable(field);
        out.push(`### ${field.label}`, "", ...tableLines(header, lines), "");
      } else if (field.kind === "list") {
        out.push(`**${field.label}**`, "", ...listItems(field).map((item) => `- ${item}`), "");
      } else {
        out.push(`**${field.label}**`, "");
        for (const line of textLines(field)) out.push(line, "");
      }
    }
    flushPairs();
    const guides = section.fields.flatMap(fieldGuides);
    if (guides.length > 0) {
      for (const guide of guides) out.push(`${GUIDE_LINE}${guide}`);
      out.push("");
    }
  }
  out.push(`${GUIDE_LINE}${CLOSING_GUIDE}`);
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** 결재·제출용 사본 — 작성 안내 줄을 뺀다. 직접 쓴 본문이나 AI 가 쓴 본문에도 쓸 수 있다. */
export function toApprovalCopy(markdown: string): string {
  const kept = markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(GUIDE_LINE.trimEnd()));
  return `${kept.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
