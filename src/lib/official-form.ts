// ─────────────────────────────────────────────────────────────────────────────
// official-form.ts — 법정 서식 원본(한글 HWPX)의 칸 배치를 그대로 두고 빈 칸에 입력값만 채운다.
//
// 서식 원본은 법제처 국가법령정보센터에서 받은 파일이다(src/schemas/official-forms/). 구형 HWP 서식은
// 한 번 HWPX 로 바꿔 넣었다(출처·변환 기록은 forms.json 의 source). 실행 중에는 바깥 꾸러미 없이
// 서식마다 정한 칸 지도(forms.json — 표 순번·행·열 → 입력 필드)대로 그 칸의 글자만 바꾼다.
//
// 칸 지도의 종류
//   cells       한 칸 — template 의 {필드} 자리에 값을 넣는다. 틀 글자("   년   월   일", "소속   성명   서명")는 template 에 그대로 둔다
//   paragraphs  표 밖·칸 안의 문단 — 문단 글자가 match 에 맞는 문단을 template 으로 바꾼다
//   checks      체크 상자 칸 — 고른 값의 "□" 를 "■" 로 (목록이면 여러 개, 서식에 없는 값은 "기타" 뒤에 적는다)
//   rows        입력 줄을 받는 빈 줄 — 위에서부터 채우고, 모자라면 줄을 늘린다(입력을 버리지 않는다)
//   namedRows   행 이름이 인쇄된 표(1. 펌프카 …) — 이름이 맞는 행에, 맞는 행이 없으면 "기타" 행에, 그것도 차 있으면 행을 늘린다
//
// 지키는 것: 입력하지 않은 칸·서명 칸은 비워 두거나 서식의 틀 글자를 그대로 둔다(값을 지어내지 않는다).
// 서식에 칸이 없는 입력값(문서번호 같은 실무 항목)은 notInForm 으로 알린다 — 정본(.dclx)에는 남아 있다.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import type { DraftField, NormalizedDraft } from "./draft.js";
import { listItems, scalarText, tableRows } from "./document-body.js";
import { type FormMap, type FormSource, type RowCell, officialFormMap, officialFormPath } from "./official-form-map.js";
import { unzip, zip } from "./zip.js";

// ───── 상수 ─────
const SECTION_RE = /^Contents\/section\d+\.xml$/u;
const MIMETYPE = "mimetype";
const CHECK_OFF = "□";
const CHECK_ON = "■";
/** 비어 있는 자리 — 손으로 적을 수 있게 틀 사이를 띄운다 */
const BLANK = "    ";
const LINESEG_RE = /<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/gu;
const PLACEHOLDER = /\{([^{}|]+)(?:\|([A-Za-z]+))?\}/gu;
const DATE_PARTS = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/u;
/** 행 이름 비교에서 지우는 것 — 앞 번호("1."), 띄어쓰기, 괄호 안 설명 */
const LABEL_NOISE = /^\s*\d+\s*[.)]\s*|\s+|\(.*?\)/gu;

export { officialFormDocIds, officialFormMap } from "./official-form-map.js";

export interface FilledForm {
  data: Buffer;
  /** 서식 이름 (예: 사업관리방식 지침 별지 제18호 서식) */
  form: string;
  source: FormSource;
  /** 서식에 칸이 없어 한글 파일에 넣지 못한 입력값 — "항목: 값" */
  notInForm: string[];
}

// ───── 값 ─────

interface Values {
  scalar: Map<string, string>;
  lists: Map<string, string[]>;
  rows: Map<string, Array<Record<string, string>>>;
  fields: Map<string, DraftField>;
}

function collectValues(draft: NormalizedDraft): Values {
  const scalar = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const rows = new Map<string, Array<Record<string, string>>>();
  const fields = new Map<string, DraftField>();
  for (const f of draft.fields) {
    fields.set(f.name, f);
    if (f.kind === "rows") rows.set(f.name, tableRows(f));
    else if (f.kind === "list") lists.set(f.name, listItems(f));
    else if (f.kind === "group") {
      const v = (typeof f.value === "object" && !Array.isArray(f.value) ? f.value : {}) as Record<string, string>;
      for (const [k, val] of Object.entries(v)) scalar.set(`${f.name}.${k}`, val ?? "");
    } else scalar.set(f.name, scalarText(f));
  }
  return { scalar, lists, rows, fields };
}

function datePart(value: string, part: string): string {
  const m = DATE_PARTS.exec(value);
  if (!m) return part === "Y" || part === "date" ? value : "";
  const [, y, mo, d, hh, mm] = m;
  switch (part) {
    case "Y": return y as string;
    case "M": return String(Number(mo));
    case "D": return String(Number(d));
    case "time": return hh !== undefined ? `${hh.padStart(2, "0")}:${mm}` : "";
    case "date": return `${y}. ${Number(mo)}. ${Number(d)}.`;
    default: return value;
  }
}

/**
 * template 의 {이름} 자리를 값으로 — 모든 자리가 비면 null(칸을 건드리지 않는다).
 * lookup 은 이름 → 값. 비어 있는 자리는 공백으로 남겨 손으로 적을 수 있게 한다.
 */
function render(template: string, lookup: (name: string) => string, used?: Set<string>): string | null {
  // 자리가 없는 template 은 그대로 쓴다(조건이 맞을 때 더하는 표시)
  let any = !new RegExp(PLACEHOLDER.source, "u").test(template);
  const out = template.replace(PLACEHOLDER, (_m, name: string, part?: string) => {
    used?.add(name);
    const raw = lookup(name).trim();
    const value = raw && part ? datePart(raw, part) : raw;
    if (value) any = true;
    return value || BLANK;
  });
  return any ? out : null;
}

// ───── HWPX 본문 XML ─────

interface Range { start: number; end: number }
interface Cell extends Range { row: number; col: number; rowSpan: number; colSpan: number }

const escapeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 문서 순서대로 모든 표(중첩 포함)의 범위 */
function scanTables(xml: string): Range[] {
  const out: Range[] = [];
  const stack: number[] = [];
  for (const m of xml.matchAll(/<hp:tbl\b|<\/hp:tbl>/gu)) {
    if (m[0] === "</hp:tbl>") {
      const start = stack.pop();
      if (start === undefined) continue;
      const item = out.find((r) => r.start === start);
      if (item) item.end = (m.index ?? 0) + m[0].length;
    } else {
      stack.push(m.index ?? 0);
      out.push({ start: m.index ?? 0, end: -1 });
    }
  }
  return out.filter((r) => r.end > r.start);
}

/** 표의 직속 요소(tr 또는 tc)의 범위 — 중첩 표 안의 것은 뺀다 */
function directChildren(xml: string, table: Range, tag: "tr" | "tc"): Range[] {
  const out: Range[] = [];
  let depth = 0;
  let open = -1;
  const re = new RegExp(`<hp:tbl\\b|</hp:tbl>|<hp:${tag}\\b|</hp:${tag}>`, "gu");
  re.lastIndex = table.start;
  for (let m = re.exec(xml); m && m.index < table.end; m = re.exec(xml)) {
    const t = m[0];
    if (t.startsWith("<hp:tbl")) depth += 1;
    else if (t === "</hp:tbl>") depth -= 1;
    else if (depth === 1 && t.startsWith(`<hp:${tag}`)) open = m.index;
    else if (depth === 1 && t === `</hp:${tag}>` && open >= 0) {
      out.push({ start: open, end: m.index + t.length });
      open = -1;
    }
  }
  return out;
}

/** 칸 자신의 주소·병합 — 칸 안 중첩 표의 칸이 아니라 마지막에 나오는 자기 것 */
function cellInfo(xml: string, r: Range): Cell {
  const seg = xml.slice(r.start, r.end);
  const addr = [...seg.matchAll(/<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"\/>/gu)].pop();
  const span = [...seg.matchAll(/<hp:cellSpan colSpan="(\d+)" rowSpan="(\d+)"\/>/gu)].pop();
  return {
    ...r,
    col: Number(addr?.[1] ?? -1),
    row: Number(addr?.[2] ?? -1),
    colSpan: Number(span?.[1] ?? 1),
    rowSpan: Number(span?.[2] ?? 1),
  };
}

function cellsOf(xml: string, table: Range): Cell[] {
  return directChildren(xml, table, "tc").map((r) => cellInfo(xml, r));
}

/** 요소 글자 (줄바꿈은 \n) */
function visibleText(seg: string): string {
  let out = "";
  for (const m of seg.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>|<hp:t\/>/gu)) {
    out += (m[1] ?? "").replace(/<hp:lineBreak\/>/gu, "\n").replace(/<[^>]+>/gu, "");
  }
  return out.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** 글자를 줄바꿈 표시가 있는 <hp:t> 내용으로 */
function textRun(text: string): string {
  return text.split("\n").map(escapeXml).join("<hp:lineBreak/>");
}

/** 문단 하나의 글자를 바꾼다 — 문단 모양과 첫 글자 모양은 그대로, 줄 배치 정보는 지운다(한글이 다시 맞춘다) */
function rewriteParagraph(p: string, text: string): string {
  const open = /^<hp:p\b[^>]*>/u.exec(p)?.[0];
  if (!open) return p;
  const charPr = /<hp:run charPrIDRef="(\d+)"/u.exec(p)?.[1] ?? "0";
  const body = text === "" ? `<hp:run charPrIDRef="${charPr}"/>` : `<hp:run charPrIDRef="${charPr}"><hp:t>${textRun(text)}</hp:t></hp:run>`;
  return `${open}${body}</hp:p>`;
}

/** 칸의 글자를 바꾼다 — 첫 문단의 모양으로 한 문단만 남긴다. 칸 안에 표가 있으면 바꾸지 않는다 */
function rewriteCell(cell: string, text: string): string {
  const open = cell.search(/<hp:subList\b/u);
  const close = cell.lastIndexOf("</hp:subList>");
  if (open < 0 || close < 0) return cell;
  const inner = cell.slice(cell.indexOf(">", open) + 1, close);
  if (inner.includes("<hp:tbl")) return cell;
  const firstP = /<hp:p\b[\s\S]*?<\/hp:p>/u.exec(inner)?.[0];
  if (!firstP) return cell;
  return cell.slice(0, cell.indexOf(">", open) + 1) + rewriteParagraph(firstP, text) + cell.slice(close);
}

/** 칸 안의 "라벨□" 를 "라벨■" 로 — 글자 모양 조각은 그대로 둔다. extra 가 있으면 ■ 뒤에 붙인다 */
function tickInCell(cell: string, label: string, extra = ""): { xml: string; ok: boolean } {
  // 글자 조각마다 셀 XML 안의 시작 위치를 기억해 보이는 글자 자리 → XML 자리로 바꾼다
  const map: number[] = [];
  let text = "";
  for (const m of cell.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/gu)) {
    // 글자 조각(문단·글자 모양이 바뀌는 자리) 사이는 띄어 읽는다 — "시험성적서□" 다음 문단의 "납품실적□" 가 붙어 읽히지 않게
    if (text) {
      map.push(-1);
      text += " ";
    }
    const base = (m.index ?? 0) + "<hp:t>".length;
    const inner = m[1] ?? "";
    for (const piece of inner.matchAll(/[^<]+|<[^>]+>/gu)) {
      if (piece[0].startsWith("<")) continue;
      for (let i = 0; i < piece[0].length; i += 1) {
        map.push(base + (piece.index ?? 0) + i);
        text += piece[0][i];
      }
    }
  }
  const esc = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const m = new RegExp(`(^|[\\s,·])${esc}\\s*${CHECK_OFF}`, "u").exec(text);
  if (!m) return { xml: cell, ok: false };
  const at = map[m.index + m[0].length - 1];
  if (at === undefined || cell[at] !== CHECK_OFF) return { xml: cell, ok: false };
  return { xml: cell.slice(0, at) + CHECK_ON + escapeXml(extra) + cell.slice(at + 1), ok: true };
}

const normLabel = (s: string): string => s.replace(LABEL_NOISE, "").toLowerCase();

// ───── 행 늘리기 ─────

/**
 * table 번째 표의 afterRow 행 뒤에 [afterRow-step+1 .. afterRow] 행 묶음을 본뜬 빈 행 step 개를 넣는다.
 * 뒤의 칸은 행 주소를 밀고, 위에서 걸쳐 내려오는 칸과 묶음 밖으로 걸치는 칸은 행 수를 늘린다.
 */
function insertRows(xml: string, tableIndex: number, afterRow: number, step: number): string {
  const table = scanTables(xml)[tableIndex];
  if (!table) return xml;
  const trs = directChildren(xml, table, "tr");
  const first = afterRow - step + 1;
  if (first < 0 || afterRow >= trs.length) return xml;
  const shiftCell = (c: string, delta: number): string =>
    c.replace(/(<hp:cellAddr colAddr="\d+" rowAddr=")(\d+)("\/>)(?![\s\S]*<hp:cellAddr)/u, (_m, a: string, r: string, b: string) => `${a}${Number(r) + delta}${b}`);
  // 늘릴 행 묶음의 높이 — 한 행짜리 칸의 높이를 행마다 더한다
  const rowHeight = (tr: Range): number => {
    const one = directChildren(xml, table, "tc")
      .filter((c) => c.start >= tr.start && c.end <= tr.end)
      .map((c) => ({ info: cellInfo(xml, c), seg: xml.slice(c.start, c.end) }))
      .find((c) => c.info.rowSpan === 1);
    return Number(/<hp:cellSz width="\d+" height="(\d+)"\/>(?![\s\S]*<hp:cellSz)/u.exec(one?.seg ?? "")?.[1] ?? 0);
  };
  const blockHeight = trs.slice(first, afterRow + 1).reduce((sum, tr) => sum + rowHeight(tr), 0);
  // 걸친 칸은 행 수와 함께 칸 높이도 늘린다(늘린 행까지 덮도록)
  const growCell = (c: string, delta: number): string =>
    c
      .replace(/(<hp:cellSpan colSpan="\d+" rowSpan=")(\d+)("\/>)(?![\s\S]*<hp:cellSpan)/u, (_m, a: string, r: string, b: string) => `${a}${Number(r) + delta}${b}`)
      .replace(/(<hp:cellSz width="\d+" height=")(\d+)("\/>)(?![\s\S]*<hp:cellSz)/u, (_m, a: string, h: string, b: string) => `${a}${Number(h) + blockHeight}${b}`);

  let addedHeight = 0;
  const pieces: string[] = [];
  let cursor = table.start;
  const clones: string[] = [];
  trs.forEach((tr, index) => {
    pieces.push(xml.slice(cursor, tr.start));
    cursor = tr.end;
    const cells = directChildren(xml, { start: table.start, end: table.end }, "tc").filter((c) => c.start >= tr.start && c.end <= tr.end).map((c) => cellInfo(xml, c));
    let trXml = xml.slice(tr.start, tr.end);
    // 칸마다 바꿀 내용을 뒤에서부터 적용(앞 칸의 위치가 밀리지 않게)
    const rel = cells.map((c) => ({ ...c, start: c.start - tr.start, end: c.end - tr.start }));
    for (const c of [...rel].reverse()) {
      let seg = trXml.slice(c.start, c.end);
      const last = c.row + c.rowSpan - 1;
      if (index > afterRow) seg = shiftCell(seg, step);
      else if ((c.row < first && last >= first) || (c.row >= first && c.row <= afterRow && last > afterRow)) seg = growCell(seg, step);
      trXml = trXml.slice(0, c.start) + seg + trXml.slice(c.end);
    }
    pieces.push(trXml);
    if (index >= first && index <= afterRow) {
      // 묶음 안에서 시작하고 묶음 안에서 끝나는 칸만 빈 칸으로 본뜬다
      let clone = xml.slice(tr.start, tr.end);
      for (const c of [...rel].reverse()) {
        const last = c.row + c.rowSpan - 1;
        const seg = clone.slice(c.start, c.end);
        const keep = c.row >= first && last <= afterRow;
        clone = clone.slice(0, c.start) + (keep ? shiftCell(rewriteCell(seg, ""), step) : "") + clone.slice(c.end);
      }
      addedHeight += rowHeight(tr);
      clones.push(clone);
    }
    if (index === afterRow) pieces.push(...clones);
  });
  pieces.push(xml.slice(cursor, table.end));
  let tableXml = pieces.join("");
  tableXml = tableXml.replace(/^(<hp:tbl\b[^>]*rowCnt=")(\d+)(")/u, (_m, a: string, n: string, b: string) => `${a}${Number(n) + step}${b}`);
  tableXml = tableXml.replace(/(<hp:sz width="\d+" widthRelTo="\w+" height=")(\d+)(")/u, (_m, a: string, n: string, b: string) => `${a}${Number(n) + addedHeight}${b}`);
  return xml.slice(0, table.start) + tableXml + xml.slice(table.end);
}

/** 칸 높이를 바꾼다(칸 자신의 cellSz — 칸 안 중첩 표의 것이 아님) */
function setCellHeight(cell: string, edit: (h: number) => number): string {
  return cell.replace(/(<hp:cellSz width="\d+" height=")(\d+)("\/>)(?![\s\S]*<hp:cellSz)/u, (_m, a: string, h: string, b: string) => `${a}${Math.max(0, edit(Number(h)))}${b}`);
}

/**
 * 크게 비워 둔 한 행을 같은 높이 안에서 n 행으로 나눈다 — 손으로 여러 줄 적도록 만든 칸(실명부 등)에 입력 줄을 하나씩 넣기 위해.
 * 그 행에서 시작해 그 행에서 끝나는 칸은 높이를 1/n 로, 그 행을 덮는 큰 칸은 줄인 만큼 덜어 낸 뒤 행을 늘린다(늘린 만큼 다시 커진다).
 */
function divideRow(xml: string, tableIndex: number, row: number, n: number): string {
  const table = scanTables(xml)[tableIndex];
  if (!table || n < 2) return xml;
  const cells = cellsOf(xml, table);
  const own = cells.filter((c) => c.row === row && c.rowSpan === 1);
  const height = Number(/<hp:cellSz width="\d+" height="(\d+)"\/>(?![\s\S]*<hp:cellSz)/u.exec(own[0] ? xml.slice(own[0].start, own[0].end) : "")?.[1] ?? 0);
  if (height <= 0) return xml;
  const part = Math.floor(height / n);
  const cut = height - part;
  let out = xml;
  // 뒤의 칸부터 바꿔 앞 칸의 자리가 밀리지 않게 한다
  for (const c of [...cells].sort((a, b) => b.start - a.start)) {
    const covers = c.row <= row && row <= c.row + c.rowSpan - 1;
    if (!covers) continue;
    const seg = out.slice(c.start, c.end);
    out = out.slice(0, c.start) + setCellHeight(seg, (h) => (c.rowSpan === 1 ? part : h - cut)) + out.slice(c.end);
  }
  const t = scanTables(out)[tableIndex] as Range;
  const tableXml = out.slice(t.start, t.end).replace(/(<hp:sz width="\d+" widthRelTo="\w+" height=")(\d+)(")/u, (_m, a: string, h: string, b: string) => `${a}${Number(h) - cut}${b}`);
  out = out.slice(0, t.start) + tableXml + out.slice(t.end);
  for (let i = 0; i < n - 1; i += 1) out = insertRows(out, tableIndex, row + i, 1);
  return out;
}

/**
 * 서식의 빈 줄 수에 맞춰 "쪽에서 나누지 않음"으로 된 표도, 줄을 채우거나 늘리면 다음 쪽으로 이어지게 칸 단위로 나눈다
 * (글이 길어 행이 높아지거나 행을 늘리면 한 쪽을 넘을 수 있다). 머리 줄 반복 설정은 서식 그대로다.
 */
function allowPageSplit(xml: string, tableIndex: number): string {
  const t = scanTables(xml)[tableIndex];
  if (!t) return xml;
  const head = /^<hp:tbl\b[^>]*>/u.exec(xml.slice(t.start, t.end))?.[0] ?? "";
  const next = head.replace(/pageBreak="NONE"/u, 'pageBreak="CELL"');
  return next === head ? xml : xml.slice(0, t.start) + next + xml.slice(t.start + head.length);
}

// ───── 칸 바꾸기 ─────

function setCell(xml: string, tableIndex: number, row: number, col: number, edit: (cell: string) => string): { xml: string; found: boolean } {
  const table = scanTables(xml)[tableIndex];
  if (!table) return { xml, found: false };
  const cell = cellsOf(xml, table).find((c) => c.row === row && c.col === col);
  if (!cell) return { xml, found: false };
  const before = xml.slice(cell.start, cell.end);
  return { xml: xml.slice(0, cell.start) + edit(before) + xml.slice(cell.end), found: true };
}

/** 잎 문단(표를 품지 않은 문단)들의 범위 */
function leafParagraphs(xml: string): Range[] {
  const out: Range[] = [];
  const stack: number[] = [];
  for (const m of xml.matchAll(/<hp:p\b|<\/hp:p>/gu)) {
    if (m[0] === "</hp:p>") {
      const start = stack.pop();
      if (start === undefined) continue;
      const end = (m.index ?? 0) + m[0].length;
      if (!xml.slice(start, end).includes("<hp:tbl")) out.push({ start, end });
    } else stack.push(m.index ?? 0);
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 입력 한 줄을 칸에 — 넣지 못한 값(판정이 없어 합격·불합격 칸을 못 고른 결과 등)은 이름을 돌려준다 */
function fillRowCells(xml: string, tableIndex: number, baseRow: number, cells: RowCell[], row: Record<string, string>): { xml: string; leftover: string[] } {
  let out = xml;
  const placed = new Set<string>();
  for (const spec of cells) {
    if (spec.when) {
      placed.add(spec.when.key);
      if (!spec.when.in.includes((row[spec.when.key] ?? "").trim())) continue;
    }
    const keys = new Set<string>();
    const text = render(spec.template, (n) => row[n] ?? "", keys);
    if (text === null) continue;
    for (const k of keys) placed.add(k);
    out = setCell(out, tableIndex, baseRow + (spec.offset ?? 0), spec.col, (c) => rewriteCell(c, text)).xml;
  }
  const leftover = Object.entries(row)
    .filter(([k, v]) => (v ?? "").trim() !== "" && !placed.has(k))
    .map(([k, v]) => `${k}=${v}`);
  return { xml: out, leftover };
}

/** 서식 본문 XML 하나에 값을 채운다 */
function fillSection(xml: string, map: FormMap, values: Values, used: Set<string>, notes: string[]): string {
  let out = xml;
  const lookup = (name: string): string => values.scalar.get(name) ?? (values.lists.get(name) ?? []).join(", ");
  /** 넣지 못한 값 "열이름=값" 을 그 표의 한글 열 이름으로 */
  const labelled = (field: string, items: string[]): string =>
    items
      .map((item) => {
        const [k, ...rest] = item.split("=");
        const label = values.fields.get(field)?.columns.find((c) => c.key === k)?.label ?? k;
        return `${label} ${rest.join("=")}`;
      })
      .join(", ");

  const applies = (when: { key: string; in: string[] } | undefined): boolean => {
    if (!when) return true;
    used.add(when.key);
    return when.in.includes(lookup(when.key).trim());
  };

  for (const spec of map.cells ?? []) {
    if (!applies(spec.when)) continue;
    const text = render(spec.template, lookup, used);
    if (text === null) continue;
    out = setCell(out, spec.table, spec.row, spec.col, (c) => rewriteCell(c, text)).xml;
  }

  for (const spec of map.paragraphs ?? []) {
    if (!applies(spec.when)) continue;
    const re = new RegExp(spec.match, "u");
    const hits = leafParagraphs(out).filter((r) => re.test(visibleText(out.slice(r.start, r.end)).trim()));
    const hit = hits[spec.nth ?? 0];
    const text = render(spec.template, lookup, used);
    if (!hit || text === null) continue;
    out = out.slice(0, hit.start) + rewriteParagraph(out.slice(hit.start, hit.end), text) + out.slice(hit.end);
  }

  for (const spec of map.checks ?? []) {
    used.add(spec.field);
    const picked = values.lists.get(spec.field) ?? [values.scalar.get(spec.field) ?? ""].filter(Boolean);
    const others: string[] = [];
    for (const label of picked) {
      const r = setCell(out, spec.table, spec.row, spec.col, (c) => {
        const t = tickInCell(c, label);
        if (!t.ok) others.push(label);
        return t.xml;
      });
      out = r.xml;
    }
    if (others.length > 0) {
      if (spec.other) {
        out = setCell(out, spec.table, spec.row, spec.col, (c) => {
          const t = tickInCell(c, spec.other as string, `(${others.join(", ")})`);
          if (!t.ok) notes.push(`${values.fields.get(spec.field)?.label ?? spec.field}: ${others.join(", ")}`);
          return t.xml;
        }).xml;
      } else notes.push(`${values.fields.get(spec.field)?.label ?? spec.field}: ${others.join(", ")}`);
    }
  }

  for (const spec of map.rows ?? []) {
    used.add(spec.field);
    const rows = values.rows.get(spec.field) ?? [];
    const step = spec.step ?? 1;
    let lastRow = spec.lastRow;
    if (spec.divide && rows.length > 0 && spec.firstRow === spec.lastRow) {
      out = divideRow(out, spec.table, spec.firstRow, spec.divide);
      lastRow = spec.firstRow + spec.divide - 1;
    }
    const capacity = Math.floor((lastRow - spec.firstRow + 1) / step);
    const extra = Math.max(0, rows.length - capacity);
    // 맨 아래 줄의 굵은 테두리가 표 끝에 남도록, 빈 줄이 둘 이상이면 끝에서 두 번째 묶음을 본떠 그 뒤에 넣는다
    const afterRow = capacity >= 2 ? lastRow - step : lastRow;
    if (rows.length > 0) out = allowPageSplit(out, spec.table);
    for (let i = 0; i < extra; i += 1) out = insertRows(out, spec.table, afterRow, step);
    rows.forEach((row, i) => {
      const r = fillRowCells(out, spec.table, spec.firstRow + i * step, spec.cells, row);
      out = r.xml;
      if (r.leftover.length > 0) notes.push(`${values.fields.get(spec.field)?.label ?? spec.field} ${i + 1}번 줄: ${labelled(spec.field, r.leftover)}`);
    });
  }

  // 같은 표에 행 이름 묶음이 여럿이면(장비·원재료·시험) 아래 묶음부터 채운다 — 아래에서 행을 늘려도 위 묶음의 행 주소는 그대로다
  const named = [...(map.namedRows ?? [])].sort((a, b) => a.table - b.table || b.firstRow - a.firstRow);
  for (const spec of named) {
    used.add(spec.field);
    const rows = values.rows.get(spec.field) ?? [];
    let grown = 0;
    for (const row of rows) {
      const key = (row[spec.key] ?? "").trim();
      if (!key) continue;
      const table = scanTables(out)[spec.table];
      if (!table) break;
      const cells = cellsOf(out, table);
      const labelCell = (r: number): Cell | undefined => cells.find((c) => c.row === r && c.col === spec.labelCol);
      const groupOf = (r: number): string => {
        if (spec.groupCol === undefined) return "";
        const g = cells.find((c) => c.col === spec.groupCol && c.row <= r && r <= c.row + c.rowSpan - 1);
        return g ? normLabel(visibleText(out.slice(g.start, g.end))) : "";
      };
      const wantGroup = spec.groupKey ? normLabel(row[spec.groupKey] ?? "") : "";
      // 이 묶음에서 앞선 입력으로 행을 늘렸으면 그만큼 범위를 넓힌다
      const lastRow = spec.lastRow + grown;
      const candidates: number[] = [];
      for (let r = spec.firstRow; r <= lastRow; r += 1) {
        if (!labelCell(r)) continue;
        if (wantGroup && groupOf(r) && !groupOf(r).includes(wantGroup) && !wantGroup.includes(groupOf(r))) continue;
        candidates.push(r);
      }
      const labelOf = (r: number): string => normLabel(visibleText(out.slice((labelCell(r) as Cell).start, (labelCell(r) as Cell).end)));
      const want = normLabel(key);
      const isEmptyRow = (r: number): boolean =>
        spec.cells.every((c) => {
          const cell = cells.find((x) => x.row === r && x.col === c.col);
          return !cell || visibleText(out.slice(cell.start, cell.end)).trim() === "";
        });
      let target = candidates.find((r) => {
        const l = labelOf(r);
        return (!spec.other || l !== normLabel(spec.other)) && l !== "" && (l === want || l.includes(want) || want.includes(l)) && isEmptyRow(r);
      });
      let relabel = false;
      if (target === undefined) {
        const other = spec.other ? normLabel(spec.other) : null;
        const otherRows = other ? candidates.filter((r) => labelOf(r) === other || labelOf(r).startsWith(other)) : [];
        const freeOther = otherRows.find((r) => isEmptyRow(r));
        if (freeOther !== undefined) {
          target = freeOther;
          relabel = true;
        } else if (otherRows.length > 0) {
          const after = otherRows[otherRows.length - 1] as number;
          out = allowPageSplit(insertRows(out, spec.table, after, 1), spec.table);
          grown += 1;
          target = after + 1;
          relabel = true;
        } else {
          // 넣을 행이 없으면 그 줄의 값을 모두 알린다(이름만 알리면 나머지 값을 잃는다)
          const whole = Object.entries(row)
            .filter(([, v]) => (v ?? "").trim() !== "")
            .map(([k, v]) => `${k}=${v}`);
          notes.push(`${values.fields.get(spec.field)?.label ?? spec.field}: ${labelled(spec.field, whole)}`);
          continue;
        }
      }
      if (relabel) {
        // "4. 기타" 행에 넣으면 행 이름을 "4. 기타(입력 이름)" 으로 — 무엇을 적은 행인지 남긴다
        out = setCell(out, spec.table, target, spec.labelCol, (c) => {
          const original = visibleText(c).trim();
          const prefix = original && spec.other && normLabel(original).startsWith(normLabel(spec.other)) ? `${original.replace(/\s+$/u, "")}(` : "";
          return rewriteCell(c, prefix ? `${prefix}${key})` : key);
        }).xml;
      }
      const filled = fillRowCells(out, spec.table, target, spec.cells, { ...row, [spec.key]: "", ...(spec.groupKey ? { [spec.groupKey]: "" } : {}) });
      out = filled.xml;
      if (filled.leftover.length > 0) notes.push(`${values.fields.get(spec.field)?.label ?? spec.field} ${key}: ${labelled(spec.field, filled.leftover)}`);
    }
  }
  return out;
}

/** 서식에 칸이 없는 입력값 */
function unplacedValues(values: Values, used: Set<string>): string[] {
  const out: string[] = [];
  for (const [name, field] of values.fields) {
    if (!field.filled) continue;
    if (field.kind === "group") {
      const v = (field.value ?? {}) as Record<string, string>;
      for (const col of field.columns) {
        const key = `${name}.${col.key}`;
        if ((v[col.key] ?? "").trim() && !used.has(key)) out.push(`${field.label} · ${col.label}: ${v[col.key]}`);
      }
    } else if (!used.has(name)) {
      const shown = field.kind === "rows" ? `${tableRows(field).length}건` : field.kind === "list" ? listItems(field).join(", ") : scalarText(field);
      out.push(`${field.label}: ${shown}`);
    }
  }
  return out;
}

/**
 * 법정 서식 원본에 입력값을 채운 한글(HWPX) 파일을 만든다. 이 문서 종류에 서식 원본이 없으면 null.
 * 원본의 다른 항목(글꼴·그림·설정)은 바이트 그대로 옮기고 본문 XML 만 바꾼다.
 */
export function fillOfficialForm(docId: string, draft: NormalizedDraft): FilledForm | null {
  const map = officialFormMap(docId);
  if (!map) return null;
  const entries = unzip(readFileSync(officialFormPath(map)));
  const values = collectValues(draft);
  const used = new Set<string>();
  const notes: string[] = [];
  const out: Array<{ name: string; data: Buffer; store?: boolean }> = [];
  for (const [name, data] of entries) {
    if (SECTION_RE.test(name)) {
      // 줄 배치 정보(linesegarray)는 한글이 문서를 열 때 다시 계산하는 캐시다 — 칸 글자와 행을 바꿨으므로 모두 지운다(낡은 캐시로 그리지 않게)
      const filled = fillSection(data.toString("utf8"), map, values, used, notes).replace(LINESEG_RE, "");
      out.push({ name, data: Buffer.from(filled, "utf8") });
    } else out.push({ name, data, ...(name === MIMETYPE ? { store: true } : {}) });
  }
  // 한글 파일은 mimetype 이 맨 앞(압축하지 않음)이어야 한다
  out.sort((a, b) => (a.name === MIMETYPE ? -1 : b.name === MIMETYPE ? 1 : 0));
  return { data: zip(out), form: `${map.source.law} ${map.source.form}`, source: map.source, notInForm: [...notes.map((n) => `서식 칸에 맞는 자리가 없음 — ${n}`), ...unplacedValues(values, used)] };
}
