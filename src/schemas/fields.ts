// ─────────────────────────────────────────────────────────────────────────────
// fields.ts — 문서 양식 필드의 표시 이름과 입력 종류.
//
// 양식 정의(document-schemas.json)의 필드 이름은 영문 식별자다. 입력 폼과 문서 본문에
// 쓰는 한글 이름은 field-labels.json 에서 읽는다. 입력 종류(한 줄·여러 줄·날짜·선택·
// 묶음·목록·표)는 필드의 type 에서 정한다 — 폼·본문 생성·검토가 같은 판정을 쓴다.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { SchemaField } from "./loader.js";

// ───── 상수 ─────
const LABELS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "field-labels.json");
const ENUM_TYPE = /^enum<(.+)>$/;
/** 문자열 필드 가운데 여러 줄로 받는 것 — 이름에 이 낱말이 들면 긴 글이다 */
const LONG_TEXT_NAME =
  /note|remark|description|cause|action|plan|policy|control|procedure|conclusion|instruction|criteria|scope|impact|responsibilit|record$|chart/i;

export type FieldKind =
  | "shortText"
  | "longText"
  | "number"
  | "date"
  | "datetime"
  | "choice"
  /** 하위 항목을 가진 한 건(예: 작성자 = 성명·직책) */
  | "group"
  /** 여러 건의 문자열 */
  | "list"
  /** 하위 항목을 가진 여러 건(표) */
  | "rows";

interface LabelBundle {
  fields: Record<string, string>;
  byDoc: Record<string, Record<string, string>>;
  subFields: Record<string, string>;
  /** 문서마다 뜻이 다른 묶음 안 항목 이름 — 법정 서식의 칸 이름 (검측 체크리스트의 "검사 기준" 등) */
  byDocSubFields?: Record<string, Record<string, string>>;
  enums: Record<string, string>;
}

let cache: LabelBundle | null = null;
function labels(): LabelBundle {
  cache ??= JSON.parse(readFileSync(LABELS_PATH, "utf8")) as LabelBundle;
  return cache;
}

/** 필드의 한글 이름. 사전에 없으면 null — 호출 쪽이 식별자로 대신할지 정한다. */
export function findFieldLabel(docId: string, name: string): string | null {
  const b = labels();
  return b.byDoc[docId]?.[name] ?? b.fields[name] ?? null;
}

/** 묶음 필드 안 항목의 한글 이름. 문서를 주면 그 문서의 이름을 먼저 본다. 사전에 없으면 null. */
export function findSubFieldLabel(name: string, docId?: string): string | null {
  const b = labels();
  return (docId ? b.byDocSubFields?.[docId]?.[name] : undefined) ?? b.subFields[name] ?? null;
}

/** 선택지 값의 한글 이름. 사전에 없으면 null. */
export function findEnumLabel(value: string): string | null {
  return labels().enums[value] ?? null;
}

export function fieldLabel(docId: string, name: string): string {
  return findFieldLabel(docId, name) ?? name;
}
export function subFieldLabel(name: string, docId?: string): string {
  return findSubFieldLabel(name, docId) ?? name;
}
export function enumLabel(value: string): string {
  return findEnumLabel(value) ?? value;
}

/** enum<a,b,c> 형식의 선택지 값. 선택형이 아니면 빈 배열. */
export function enumValues(field: SchemaField): string[] {
  const inner = ENUM_TYPE.exec(field.type)?.[1];
  return inner
    ? inner
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    : [];
}

export function fieldKind(field: SchemaField): FieldKind {
  const t = field.type;
  if (ENUM_TYPE.test(t)) return "choice";
  if (t === "date") return "date";
  if (t === "datetime") return "datetime";
  if (t === "number") return "number";
  const hasSubFields = Array.isArray(field.fields) && field.fields.length > 0;
  if (t === "object") return hasSubFields ? "group" : "shortText";
  if (t === "array<object>") return hasSubFields ? "rows" : "list";
  if (t.startsWith("array<")) return "list";
  return LONG_TEXT_NAME.test(field.name) ? "longText" : "shortText";
}
