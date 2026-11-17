// ─────────────────────────────────────────────────────────────────────────────
// draft.ts — 문서 양식에 들어온 입력값을 양식 정의에 맞춰 정리한다.
//
// 입력값은 여러 길로 들어온다 — A2UI 화면의 데이터 모델(/draft), 내장 브라우저 폼,
// 도구를 직접 부르는 프로그램. 길마다 모양이 조금씩 다르다(선택형은 목록, 표는 여러 줄
// 글자 또는 객체 목록 등). 이 모듈이 그것을 한 가지 모양으로 맞추고, 비어 있는 필수
// 항목·형식에 맞지 않는 값·양식에 없는 키를 알려 준다. 작성 컨텍스트·문서 본문 생성·
// 검토가 모두 이 결과를 쓴다.
// ─────────────────────────────────────────────────────────────────────────────

import type { DocumentSchema, SchemaField } from "../schemas/loader.js";
import {
  enumLabel,
  enumValues,
  fieldKind,
  fieldLabel,
  subFieldLabel,
  type FieldKind,
} from "../schemas/fields.js";

// ───── 상수 ─────
/** 표를 여러 줄 글자로 적을 때 한 건 안에서 열을 나누는 문자 */
/** 목록 항목에 {…} 가 왔을 때의 안내 */
const LIST_ITEM_NOT_RECORD = '목록의 항목은 글자로 적어야 합니다 — 묶음 값({…})이 아니라 ["첫째 항목", "둘째 항목"] 처럼 적으세요';
/** 글자 칸에 {…} 가 왔을 때의 안내 */
const TEXT_NOT_RECORD = '글자로 적어야 하는 칸에 묶음 값({…})이 왔습니다 — 글자 하나로 적으세요 (예: "홍길동")';
export const COLUMN_SEPARATOR = "|";
/** 묶음 필드를 항목 구분 없이 한 줄 글자로 받았을 때 그 글자를 담는 키 */
export const FREE_TEXT_KEY = "";
const NUMERIC = /^-?\d+(\.\d+)?$/;
/** 날짜 — 2026-03-15 (구분은 - . / 를 받는다) */
const DATE_TEXT = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/;
/** 날짜와 시각 — 2026-03-15T09:30, 2026-03-15 09:30:00 */
const DATETIME_TEXT = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const DATE_EXAMPLE = "2026-03-15";
const DATETIME_EXAMPLE = "2026-03-15 09:30";

export type DraftValue = string | string[] | Record<string, string> | Array<Record<string, string>>;

export interface DraftField {
  sectionKey: string;
  sectionTitle: string;
  name: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  note: string | null;
  /** 묶음·표의 하위 항목 */
  columns: Array<{ key: string; label: string }>;
  /** 정리한 값 — 한 줄·여러 줄·숫자·날짜·선택은 글자, 목록은 글자 목록, 묶음은 항목별 글자, 표는 그 목록 */
  value: DraftValue;
  filled: boolean;
  /** 형식에 맞지 않는 점 (숫자 칸에 글자, 선택지에 없는 값 등) */
  problems: string[];
  /** 작성 안내로 덧붙일 말 — 원문에서 찾은 후보 등 (형식 문제가 아니라 파일 만들기를 막지 않는다) */
  hints?: string[];
}

export interface NormalizedDraft {
  docId: string;
  fields: DraftField[];
  missingRequired: DraftField[];
  /** 양식에 없는 입력 키 — 조용히 버리지 않고 알려 준다 */
  unknownKeys: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(toText).filter(Boolean).join(", ");
  return JSON.stringify(v);
}

/** 달력에 있는 날짜인가 */
export function isCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 날짜(·시각) 글자의 문제를 problems 에 쌓는다 — 형식이 다르거나 달력에 없는 날짜 */
function checkDate(text: string, withTime: boolean, problems: string[]): void {
  if (!text) return;
  const m = (withTime ? DATETIME_TEXT : DATE_TEXT).exec(text) ?? (withTime ? DATE_TEXT.exec(text) : null);
  if (!m) {
    problems.push(`${withTime ? "날짜·시각" : "날짜"} 형식이 아닙니다 — 예: ${withTime ? DATETIME_EXAMPLE : DATE_EXAMPLE}`);
    return;
  }
  if (!isCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]))) {
    problems.push("달력에 없는 날짜입니다");
    return;
  }
  if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] ?? "0") > 59)) problems.push("없는 시각입니다");
}

function lines(v: string): string[] {
  return v
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** 객체에서 하위 항목 값을 뽑는다 — 키는 항목 이름 또는 한글 표시 이름 */
function pickColumns(
  source: Record<string, unknown>,
  columns: Array<{ key: string; label: string }>,
  problems: string[],
  where: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  const known = new Set<string>();
  for (const col of columns) {
    known.add(col.key).add(col.label);
    const value = source[col.key] ?? source[col.label];
    // 하위 항목의 값도 글자다 — 묶음 값이 오면 본문에 JSON 이 찍히므로 문제로 알린다
    if (isRecord(value) || (Array.isArray(value) && value.some(isRecord))) problems.push(`${where}${col.label}: ${TEXT_NOT_RECORD}`);
    const text = toText(value);
    if (text) out[col.key] = text;
  }
  const extra = Object.keys(source).filter((k) => !known.has(k) && toText(source[k]));
  if (extra.length > 0) problems.push(`${where}양식에 없는 항목: ${extra.join(", ")}`);
  return out;
}

function normalizeValue(
  field: SchemaField,
  kind: FieldKind,
  columns: Array<{ key: string; label: string }>,
  raw: unknown,
  problems: string[],
): DraftValue {
  switch (kind) {
    case "number": {
      const text = toText(raw).replace(/,/g, "");
      if (text && !NUMERIC.test(text)) problems.push("숫자가 아닙니다");
      return text;
    }
    case "choice": {
      // A2UI 선택형은 값을 목록으로 준다 — 한 개만 고르는 칸이라 첫 값을 쓴다
      const picked = Array.isArray(raw) ? raw.map(toText).filter(Boolean) : [toText(raw)].filter(Boolean);
      if (picked.length > 1) problems.push("하나만 고르는 칸에 여러 값이 왔습니다");
      const text = picked[0] ?? "";
      if (!text) return "";
      const options = enumValues(field);
      const byLabel = options.find((o) => enumLabel(o) === text);
      const code = options.includes(text) ? text : (byLabel ?? text);
      if (!options.includes(code)) {
        problems.push(`선택지에 없는 값입니다. 가능한 값: ${options.map((o) => `${enumLabel(o)}(${o})`).join(", ")}`);
      }
      return code;
    }
    case "list": {
      if (Array.isArray(raw)) {
        // 목록의 항목은 글자다 — 묶음 값({…})을 그대로 찍으면 본문에 JSON 이 나온다
        if (raw.some(isRecord)) problems.push(LIST_ITEM_NOT_RECORD);
        return raw.map(toText).filter(Boolean);
      }
      if (isRecord(raw)) problems.push(LIST_ITEM_NOT_RECORD);
      return lines(toText(raw));
    }
    case "group": {
      if (isRecord(raw)) return pickColumns(raw, columns, problems, "");
      const text = toText(raw);
      return text ? { [FREE_TEXT_KEY]: text } : {};
    }
    case "rows": {
      const items: unknown[] = Array.isArray(raw) ? raw : lines(toText(raw));
      const rows: Array<Record<string, string>> = [];
      items.forEach((item, i) => {
        const where = `${i + 1}번째 줄 — `;
        if (isRecord(item)) {
          const row = pickColumns(item, columns, problems, where);
          if (Object.keys(row).length > 0) rows.push(row);
          return;
        }
        const cells = toText(item)
          .split(COLUMN_SEPARATOR)
          .map((c) => c.trim());
        if (cells.every((c) => c === "")) return;
        if (cells.length > columns.length) {
          problems.push(`${where}항목이 ${cells.length}개인데 이 표의 열은 ${columns.length}개입니다`);
        }
        const row: Record<string, string> = {};
        columns.forEach((col, c) => {
          const cell = cells[c];
          if (cell) row[col.key] = cell;
        });
        rows.push(row);
      });
      return rows;
    }
    case "date":
    case "datetime": {
      if (isRecord(raw)) problems.push(TEXT_NOT_RECORD);
      const text = toText(raw);
      checkDate(text, kind === "datetime", problems);
      // 브라우저의 날짜·시각 입력은 2026-11-16T09:30 모양으로 준다 — 문서에는 띄어 적는다
      return text.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/u, "$1 $2");
    }
    default: {
      if (isRecord(raw)) problems.push(TEXT_NOT_RECORD);
      return toText(raw);
    }
  }
}

function isFilled(value: DraftValue): boolean {
  if (typeof value === "string") return value !== "";
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value).length > 0;
}

/** 묶음 필드의 값을 평평한 키(`필드.항목`)로 보낸 입력을 모은다 */
function collectDotted(raw: Record<string, unknown>, name: string, used: Set<string>): Record<string, unknown> | null {
  const prefix = `${name}.`;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (!key.startsWith(prefix)) continue;
    out[key.slice(prefix.length)] = raw[key];
    used.add(key);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 입력값을 양식 정의에 맞춰 정리한다. 키는 필드 이름 또는 한글 표시 이름을 받는다. */
export function normalizeDraft(schema: DocumentSchema, input: unknown): NormalizedDraft {
  const raw = isRecord(input) ? input : {};
  const used = new Set<string>();
  const fields: DraftField[] = [];

  for (const section of schema.sections) {
    for (const field of section.fields) {
      const kind = fieldKind(field);
      const label = fieldLabel(schema.id, field.name);
      const columns =
        kind === "group" || kind === "rows"
          ? (field.fields ?? []).map((key) => ({ key, label: subFieldLabel(key) }))
          : [];
      let value: unknown;
      if (field.name in raw) {
        value = raw[field.name];
        used.add(field.name);
      } else if (label in raw) {
        value = raw[label];
        used.add(label);
      }
      if (kind === "group" && value === undefined) value = collectDotted(raw, field.name, used) ?? undefined;

      const problems: string[] = [];
      const normalized = normalizeValue(field, kind, columns, value, problems);
      fields.push({
        sectionKey: section.key,
        sectionTitle: section.title,
        name: field.name,
        label,
        kind,
        required: Boolean(field.required),
        note: field.note ?? null,
        columns,
        value: normalized,
        filled: isFilled(normalized),
        problems,
      });
    }
  }

  return {
    docId: schema.id,
    fields,
    missingRequired: fields.filter((f) => f.required && !f.filled),
    unknownKeys: Object.keys(raw).filter((k) => !used.has(k)),
  };
}

/** 값 하나를 사람이 읽는 한 줄 글자로 (선택형은 한글 이름) */
export function displayText(field: DraftField): string {
  const v = field.value;
  if (typeof v === "string") return field.kind === "choice" && v ? enumLabel(v) : v;
  if (Array.isArray(v)) {
    return v
      .map((item) => (typeof item === "string" ? item : rowText(item, field.columns)))
      .join(field.kind === "rows" ? " / " : ", ");
  }
  return rowText(v, field.columns);
}

function rowText(row: Record<string, string>, columns: Array<{ key: string; label: string }>): string {
  const parts = columns.filter((c) => row[c.key]).map((c) => `${c.label} ${row[c.key]}`);
  const free = row[FREE_TEXT_KEY];
  if (free) parts.unshift(free);
  return parts.join(" · ");
}
