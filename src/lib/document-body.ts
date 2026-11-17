// ─────────────────────────────────────────────────────────────────────────────
// document-body.ts — 입력값을 양식 구조대로 옮겨 문서 본문(Markdown)을 만든다.
//
// 문장을 짓지 않는다. 입력한 값은 그 자리에 그대로 넣고, 입력하지 않은 칸은 비워 둔 채
// 무엇을 적어야 하는지 "작성 안내" 줄로 알린다. 작성 안내 줄은 결재·제출용 사본에서 빠진다.
// 법령·고시 서식을 따르는 문서도 본문(정본)은 기재 항목 구조다. 서식 원본이 있는 문서는 한글 파일을 만들 때
// 그 서식의 칸에 값을 채운다(official-form.ts).
// ─────────────────────────────────────────────────────────────────────────────

import type { DocumentSchema } from "../schemas/loader.js";
import { enumLabel } from "../schemas/fields.js";
import { FREE_TEXT_KEY, normalizeDraft } from "./draft.js";
import type { DraftField, NormalizedDraft } from "./draft.js";
import { officialFormMap } from "./official-form-map.js";

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
/** 양식 정의의 절 제목 끝에 붙은 "서식 밖" 표시 — 쓰는 사람에게 주는 안내라 제출 문서의 제목에는 넣지 않는다 */
const OUTSIDE_FORM_MARK = /\s*\(서식 밖 실무 항목\)\s*$/u;
const OUTSIDE_FORM_GUIDE = "이 절은 법정 서식에 없는 실무 항목입니다 — 제출하는 서식에는 칸이 없으니 내부 관리용으로 씁니다.";
const CLOSING_GUIDE = "결재·제출 전에 담당자가 내용을 확인하고 서명합니다. 판정·승인은 품질관리자·감리원·발주자가 합니다.";

export interface BodySection {
  key: string;
  /** "1. 보고서 기본정보" */
  heading: string;
  title: string;
  origin: "legal" | "practice" | null;
  /** 법정 서식에 없는 실무 항목의 절인가 (제목의 "서식 밖" 표시는 떼고 작성 안내로 알린다) */
  outsideForm: boolean;
  /** 서식에 인쇄된 문장 (확약 문구 등) — 그대로 넣는다 */
  statement: string | null;
  fields: DraftField[];
}

export interface DocumentBody {
  docId: string;
  /** 문서 제목 — 양식 제목에서 뒤의 괄호 설명을 뺀 것 */
  title: string;
  /** 따르는 법령·고시 서식 (있을 때) */
  officialForm: string | null;
  /** 이 문서의 작성 기준 — 서식 작성요령·대상 요건 등 (양식에 적혀 있을 때) */
  guidance: string | null;
  sections: BodySection[];
  draft: NormalizedDraft;
  /** 필수 항목 수와 그중 채운 수 */
  requiredTotal: number;
  requiredFilled: number;
  /** 입력이 아니라 원문에서 옮겨 채운 칸에 대한 안내 (있을 때) */
  autoFilled?: string[];
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

/** 숫자 칸 — 쉼표·단위를 빼고 읽는다. 숫자가 아니면 null */
function countOf(value: string | undefined): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)/.exec((value ?? "").replace(/,/g, ""));
  return m ? Number(m[1]) : null;
}

/** 횟수 칸 묶음 — 실시(또는 총검사)·합격·불합격의 키와, 묶음 이름("전월까지 " 등) */
interface CountGroup {
  label: string;
  executedWord: string;
  executed: string;
  passed: string;
  failed: string;
}

/** 문서마다 합격 + 불합격 ≤ 실시 를 볼 표와 칸 */
const COUNT_TABLES: Record<string, { field: string; groups: CountGroup[] }> = {
  quality_inspection_summary: { field: "items", groups: [{ label: "", executedWord: "실시", executed: "executed", passed: "passed", failed: "failed" }] },
  monthly_test_report: {
    field: "items",
    groups: [
      { label: "전월까지 ", executedWord: "실시", executed: "prevExecuted", passed: "prevPassed", failed: "prevFailed" },
      { label: "금월 ", executedWord: "실시", executed: "monthExecuted", passed: "monthPassed", failed: "monthFailed" },
      { label: "누계 ", executedWord: "실시", executed: "totalExecuted", passed: "totalPassed", failed: "totalFailed" },
    ],
  },
  ready_mixed_placement_check: { field: "tests", groups: [{ label: "", executedWord: "총검사", executed: "totalCount", passed: "passCount", failed: "failCount" }] },
  asphalt_placement_check: { field: "tests", groups: [{ label: "", executedWord: "총검사", executed: "totalCount", passed: "passCount", failed: "failCount" }] },
};

/** 품질시험·검사실적 보고서(별지 제18호)의 누계 = 전월까지 + 금월 */
const MONTHLY_SUMS: Array<[string, string, string, string]> = [
  ["실시", "prevExecuted", "monthExecuted", "totalExecuted"],
  ["합격", "prevPassed", "monthPassed", "totalPassed"],
  ["불합격", "prevFailed", "monthFailed", "totalFailed"],
  ["재시험", "prevRetest", "monthRetest", "totalRetest"],
];

const rowsOf = (draft: NormalizedDraft, name: string): { field: DraftField; rows: Array<Record<string, string>> } | null => {
  const field = draft.fields.find((f) => f.name === name);
  if (!field || !Array.isArray(field.value)) return null;
  return { field, rows: field.value.filter((e): e is Record<string, string> => typeof e === "object" && e !== null) };
};

/**
 * 실적보고서의 누계가 비어 있으면 전월까지 + 금월로 채운다(계산 — 둘 다 적혀 있을 때만).
 * 채운 칸에 대한 안내를 돌려준다.
 */
function fillMonthlyTotals(docId: string, draft: NormalizedDraft): string[] {
  if (docId !== "monthly_test_report") return [];
  const table = rowsOf(draft, "items");
  if (!table) return [];
  let count = 0;
  for (const row of table.rows) {
    for (const [, prev, month, total] of MONTHLY_SUMS) {
      if ((row[total] ?? "").trim()) continue;
      const a = countOf(row[prev]);
      const b = countOf(row[month]);
      if (a === null || b === null) continue;
      row[total] = String(a + b);
      count += 1;
    }
  }
  return count > 0 ? [`누계 ${count}칸은 전월까지 횟수와 금월 횟수를 더해 채웠습니다.`] : [];
}

/**
 * 값끼리 맞지 않는 점을 찾는다 — 합격 + 불합격 > 실시(총검사), 실적보고서의 누계 ≠ 전월까지 + 금월.
 * 합격 + 불합격이 실시보다 작은 것은 결과가 아직 나오지 않은 시험일 수 있어 알리지 않는다.
 */
/** 검측요청서 — 공사 참여자 실명부가 표에도 붙임에도 없으면 알린다(사업관리방식 지침 제86조 — 건설사업관리기술인이 첨부를 확인) */
function checkParticipantRegister(docId: string, draft: NormalizedDraft): void {
  if (docId !== "inspection_request") return;
  const participants = draft.fields.find((f) => f.name === "participants");
  const attachments = draft.fields.find((f) => f.name === "attachments");
  if (!participants || participants.filled) return;
  const listed = Array.isArray(attachments?.value) && attachments.value.some((v) => typeof v === "string" && v.replace(/\s/g, "").includes("실명부"));
  if (listed) return;
  participants.checks = [
    ...(participants.checks ?? []),
    "공사 참여자 실명부가 표에도 붙임에도 없습니다 — 검측요청서에 첨부해야 합니다(사업관리방식 지침 제86조). 이 표를 채우거나, 따로 만든 실명부를 붙임에 적으세요.",
  ];
}

function addConsistencyChecks(docId: string, draft: NormalizedDraft): void {
  checkParticipantRegister(docId, draft);
  const spec = COUNT_TABLES[docId];
  if (!spec) return;
  const table = rowsOf(draft, spec.field);
  if (!table) return;
  const checks: string[] = [];
  table.rows.forEach((row, i) => {
    for (const g of spec.groups) {
      const executed = countOf(row[g.executed]);
      const passed = countOf(row[g.passed]);
      const failed = countOf(row[g.failed]);
      if (executed === null || passed === null || failed === null) continue;
      if (passed + failed > executed) {
        checks.push(`${i + 1}번 줄 — ${g.label}합격 ${passed} + 불합격 ${failed} = ${passed + failed} 이 ${g.label}${g.executedWord} ${executed} 보다 많습니다. 숫자를 확인하세요.`);
      }
    }
    if (docId === "monthly_test_report") {
      for (const [word, prev, month, total] of MONTHLY_SUMS) {
        const a = countOf(row[prev]);
        const b = countOf(row[month]);
        const t = countOf(row[total]);
        if (a === null || b === null || t === null || a + b === t) continue;
        checks.push(`${i + 1}번 줄 — 누계 ${word} ${t} 이 전월까지 ${a} + 금월 ${b} = ${a + b} 와 다릅니다. 숫자를 확인하세요.`);
      }
    }
  });
  if (checks.length > 0) table.field.checks = [...(table.field.checks ?? []), ...checks];
}

/** 입력값을 정리해 본문의 뼈대를 만든다 */
export function buildDocumentBody(schema: DocumentSchema, formValues: unknown): DocumentBody {
  const draft = normalizeDraft(schema, formValues);
  const filledNotes = fillMonthlyTotals(schema.id, draft);
  addConsistencyChecks(schema.id, draft);
  // 법정 서식이 장 번호를 정한 문서(품질시험계획 별표 9 의 1~4호 등)는 제목의 번호를 그대로 쓴다 — 번호를 또 붙이면 "1. 1. 개요"가 되고, 서식 밖 절이 앞에 있으면 번호가 밀린다
  const officialNumbering = schema.sections.some((section) => /^\d+\.\s/.test(section.title));
  const sections: BodySection[] = schema.sections.map((section, index) => {
    const outsideForm = OUTSIDE_FORM_MARK.test(section.title);
    const title = section.title.replace(OUTSIDE_FORM_MARK, "");
    return {
    key: section.key,
    heading: officialNumbering ? title : `${index + 1}. ${title}`,
    title,
    outsideForm,
    statement: section.statement ?? null,
    origin: section.origin ?? null,
    fields: draft.fields.filter((f) => f.sectionKey === section.key),
    };
  });
  const form = schema.officialForm;
  const required = draft.fields.filter((f) => f.required);
  return {
    docId: schema.id,
    title: documentTitle(schema),
    officialForm: form ? `${form.law} ${form.annex}${form.annex.startsWith("별지") ? "서식" : ""}(${form.title})` : null,
    guidance: schema.guidance ?? null,
    sections,
    draft,
    requiredTotal: required.length,
    requiredFilled: required.filter((f) => f.filled).length,
    ...(filledNotes.length > 0 ? { autoFilled: filledNotes } : {}),
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
  for (const check of field.checks ?? []) guides.push(`${field.label} — 확인 필요: ${check}`);
  for (const hint of field.hints ?? []) guides.push(`${field.label} — ${hint}`);
  return guides;
}

/** 문서 머리의 안내 문장들 */
export function headGuides(body: DocumentBody): string[] {
  const guides = [
    body.autoFilled && body.autoFilled.length > 0
      ? "입력한 값을 양식 구조대로 옮긴 초안입니다. 입력하지 않은 칸은 비워 두었고 값을 지어내지 않았습니다 — 아래 칸만 원문에서 옮기거나 입력값으로 계산해 채웠습니다."
      : "입력한 값을 양식 구조대로 옮긴 초안입니다. 입력하지 않은 칸은 비워 두었고 값을 지어내지 않았습니다.",
    ...(body.autoFilled ?? []),
  ];
  const missing = body.requiredTotal - body.requiredFilled;
  guides.push(missing > 0 ? `필수 항목 ${body.requiredTotal}개 중 ${missing}개가 비어 있습니다.` : `필수 항목 ${body.requiredTotal}개를 모두 채웠습니다.`);
  if (body.officialForm) {
    guides.push(
      officialFormMap(body.docId)
        ? `따르는 서식: ${body.officialForm}. 이 본문은 기재 항목 구조이고, 한글 파일(hwpx)은 이 서식 원본의 칸에 값을 채워 만듭니다.`
        : `따르는 서식: ${body.officialForm}. 기재 항목만 옮겼고 서식의 칸 배치는 재현하지 않았습니다 — 제출용 서식 파일은 법제처 국가법령정보센터에서 받습니다.`,
    );
  }
  if (body.guidance) guides.push(`작성 기준: ${body.guidance}`);
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

/** 서식의 날인 칸 — "현장대리인 (인 또는 서명)" 칸을 비워 둔다(출력해서 날인·서명) */
export function sealRow(field: DraftField): [string, string] {
  return [`${field.label} ${field.seal}`, ""];
}

/** 본문 Markdown — 작성 안내 줄 포함 */
export function renderMarkdown(body: DocumentBody): string {
  const out: string[] = [`# ${body.title}`, ""];
  for (const guide of headGuides(body)) out.push(`${GUIDE_LINE}${guide}`);
  out.push("");

  for (const section of body.sections) {
    out.push(`## ${section.heading}`, "");
    if (section.outsideForm) out.push(`${GUIDE_LINE}${OUTSIDE_FORM_GUIDE}`, "");
    if (section.statement) out.push(section.statement, "");
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
        if (field.seal) pairs.push(sealRow(field));
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
