// ─────────────────────────────────────────────────────────────────────────────
// doclang-serializer.ts — 문서 본문을 DocLang 0.9 XML 로 적는다.
//
// DocLang(https://www.doclang.ai/)은 표의 머리칸·채워야 할 빈칸 같은 구조를 다른 프로그램과
// AI 에 그대로 전달하기 위한 문서 형식이다. Markdown 본문과 같은 내용을 담되, 빈칸은
// class="fillable" 로 표시한다. 규격의 낱말(요소 이름)은 이 파일에만 둔다.
//
// 0.9 는 <content> 밖의 연속 공백·줄바꿈을 한 칸으로 읽는다 — 여러 줄 값은 <content> 로 감싼다.
// ─────────────────────────────────────────────────────────────────────────────

import type { DocumentBody } from "./document-body.js";
import { groupPairs, isBlockField, listItems, rowTable, scalarText, textLines } from "./document-body.js";
import type { DraftField } from "./draft.js";

// ───── 상수 ─────
export const DOCLANG_VERSION = "0.9";
export const DOCLANG_NAMESPACE = "https://www.doclang.ai/ns/v0";
const TAG = {
  root: "doclang",
  content: "content",
  head: "head",
  title: "title",
  heading: "heading",
  text: "text",
  table: "table",
  caption: "caption",
  list: "list",
  listItem: "ldiv",
  custom: "custom",
  fieldRegion: "field_region",
  fieldItem: "field_item",
  key: "key",
  value: "value",
} as const;
/** 표 낱말(OTSL) — 열 머리칸·행 머리칸·값 칸·줄 끝 */
const OTSL = { columnHeader: "ched", rowHeader: "rhed", dataCell: "fcel", nextLine: "nl" } as const;
const CUSTOM = { docId: "doc_id", category: "document_category", officialForm: "official_form", required: "required_fields", filled: "required_filled" } as const;
const VALUE_CLASS_FILLABLE = "fillable";
const LIST_CLASS_UNORDERED = "unordered";
const PAIR_HEADER = ["항목", "내용"];
/** XML 1.0 에 쓸 수 없는 제어 문자는 지운다 */
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const LINE_BREAK = /\r?\n/;

function escapeXml(value: string): string {
  return value.replace(XML_FORBIDDEN, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function element(tag: string, body: string, attrs: Record<string, string | number> = {}): string {
  const attrText = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join("");
  return `<${tag}${attrText}>${body}</${tag}>`;
}

const empty = (tag: string): string => `<${tag}/>`;

/** 글자 — 줄바꿈이 든 값은 <content> 로 감싸 그대로 전한다 */
function raw(value: string): string {
  const trimmed = value.trim();
  return LINE_BREAK.test(trimmed) ? element(TAG.content, escapeXml(trimmed)) : escapeXml(trimmed);
}

function table(caption: string, header: string[], rows: string[][], rowHeader: boolean): string {
  const lines = [`<${TAG.table}>`, element(TAG.caption, raw(caption))];
  lines.push(header.map((h) => empty(OTSL.columnHeader) + raw(h)).join("") + empty(OTSL.nextLine));
  for (const row of rows) {
    lines.push(row.map((value, i) => empty(rowHeader && i === 0 ? OTSL.rowHeader : OTSL.dataCell) + raw(value)).join("") + empty(OTSL.nextLine));
  }
  lines.push(`</${TAG.table}>`);
  return lines.join("\n");
}

function fieldItems(field: DraftField): string[] {
  const item = (key: string, value: string): string =>
    element(TAG.fieldItem, element(TAG.key, raw(key)) + (value === "" ? element(TAG.value, "", { class: VALUE_CLASS_FILLABLE }) : element(TAG.value, raw(value))));
  if (field.kind === "rows") return [];
  if (field.kind === "group") return groupPairs(field).map((p) => item(p.label, p.value));
  if (field.kind === "list") return [item(field.label, listItems(field).join("\n"))];
  return [item(field.label, scalarText(field))];
}

/** 문서 본문을 DocLang 0.9 로 */
export function serializeToDoclang(body: DocumentBody, classification: string | null): string {
  const custom = element(
    TAG.custom,
    [
      element(CUSTOM.docId, escapeXml(body.docId)),
      classification ? element(CUSTOM.category, escapeXml(classification)) : "",
      body.officialForm ? element(CUSTOM.officialForm, escapeXml(body.officialForm)) : "",
      element(CUSTOM.required, String(body.requiredTotal)),
      element(CUSTOM.filled, String(body.requiredFilled)),
    ].join(""),
  );
  const out: string[] = [element(TAG.head, element(TAG.title, raw(body.title))), element(TAG.heading, custom + escapeXml(body.title), { level: 1 })];

  for (const section of body.sections) {
    out.push(element(TAG.heading, escapeXml(section.heading), { level: 2 }));
    if (section.statement) out.push(element(TAG.text, escapeXml(section.statement)));
    let pairs: string[][] = [];
    const flushPairs = (): void => {
      if (pairs.length === 0) return;
      out.push(table(section.title, PAIR_HEADER, pairs, true));
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
        out.push(table(field.label, header, lines, false));
      } else if (field.kind === "list") {
        out.push(element(TAG.heading, escapeXml(field.label), { level: 3 }));
        out.push(element(TAG.list, listItems(field).map((item) => empty(TAG.listItem) + raw(item)).join("\n"), { class: LIST_CLASS_UNORDERED }));
      } else {
        out.push(element(TAG.heading, escapeXml(field.label), { level: 3 }));
        for (const line of textLines(field)) out.push(element(TAG.text, escapeXml(line)));
      }
    }
    flushPairs();
  }

  const items = body.sections.flatMap((s) => s.fields.flatMap(fieldItems));
  if (items.length > 0) out.push(element(TAG.fieldRegion, `\n${items.join("\n")}\n`));
  return `<${TAG.root} xmlns="${DOCLANG_NAMESPACE}" version="${DOCLANG_VERSION}">\n${out.join("\n")}\n</${TAG.root}>\n`;
}
