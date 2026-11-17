// ─────────────────────────────────────────────────────────────────────────────
// doclang-reader.ts — DocLang 문서(XML)를 읽어 결재·제출용 본문(Markdown)으로 옮긴다.
//
// 한글(HWPX) 파일은 이 본문에서 만든다 — 정본(.dclx)이 먼저고 한글 파일은 정본에서 내보낸다.
// 이 도구가 만든 DocLang(제목·문단·표·목록)을 그대로 옮기고, 다른 도구가 만든 DocLang 도
// 글자를 잃지 않게 읽는다(모르는 요소는 안의 글자를 문단으로). 내려받은 문서의 글은 그대로 옮길 뿐 실행하지 않는다.
//   건너뛰는 것  <head>(제목만 쓴다) · <custom>(문서 정보) · <field_region>(본문 표와 같은 값의 목록) · <location> · <page_break>
//   표(OTSL)     ched·rhed·fcel·ecel 은 새 칸, lcel·ucel·xcel(합친 칸)은 빈 칸, nl 은 줄 끝
// ─────────────────────────────────────────────────────────────────────────────

// ───── 상수 ─────
const MAX_HEADING_LEVEL = 6;
const SKIP = new Set(["custom", "field_region", "location", "page_break", "src"]);
const CELL_START = new Set(["ched", "rhed", "fcel", "ecel", "srow", "corn"]);
const CELL_MERGED = new Set(["lcel", "ucel", "xcel"]);
const ROW_END = "nl";
/** 머리칸 이름이 이것이면 항목·내용 표 — 표 제목 줄을 따로 두지 않는다 */
const PAIR_HEADER = ["항목", "내용"];
const ENTITY: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
/** 이보다 깊게 들어간 요소는 읽지 않는다 — 비정상 문서로 멈추지 않게 */
const MAX_DEPTH = 200;

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: Array<XmlNode | string>;
}

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, code: string) => {
    if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return ENTITY[code] ?? whole;
  });
}

const localName = (name: string): string => name.slice(name.indexOf(":") + 1);

/** XML 을 나무로 — DocLang 문서를 읽을 만큼만 (주석·처리 지시는 버린다) */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { tag: "#root", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(token)) {
    const top = stack[stack.length - 1] as XmlNode;
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[2] !== undefined) {
      if (stack.length > 1 && localName(m[2]) === top.tag) stack.pop();
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[localName(a[1] as string)] = decode(a[2] ?? a[3] ?? "");
      const node: XmlNode = { tag: localName(m[3]), attrs, children: [] };
      top.children.push(node);
      if (m[5] !== "/" && stack.length < MAX_DEPTH) stack.push(node);
    } else if (m[6] !== undefined) top.children.push(decode(m[6]));
  }
  return root;
}

/** 요소 안의 글자 — 건너뛸 요소는 빼고, <content> 안의 줄바꿈은 살린다 */
function textOf(node: XmlNode | string, keepLines = false): string {
  if (typeof node === "string") return keepLines ? node : node.replace(/\s+/g, " ");
  if (SKIP.has(node.tag)) return "";
  return node.children.map((c) => textOf(c, keepLines || node.tag === "content")).join("");
}

const tidy = (s: string): string => s.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
const cellText = (s: string): string => tidy(s).replace(/\|/g, "\\|").replace(/\n/g, "<br>");

function tableMarkdown(node: XmlNode): string[] {
  let caption = "";
  const rows: Array<{ cells: string[]; header: boolean }> = [];
  let cells: string[] = [];
  let header = false;
  let current: number | null = null;
  const endRow = (): void => {
    if (cells.length > 0) rows.push({ cells, header });
    cells = [];
    header = false;
    current = null;
  };
  for (const child of node.children) {
    if (typeof child !== "string" && child.tag === "caption") {
      caption = tidy(textOf(child, true));
      continue;
    }
    if (typeof child !== "string" && CELL_START.has(child.tag)) {
      cells.push("");
      current = cells.length - 1;
      if (child.tag === "ched") header = true;
      continue;
    }
    if (typeof child !== "string" && CELL_MERGED.has(child.tag)) {
      cells.push("");
      current = null;
      continue;
    }
    if (typeof child !== "string" && child.tag === ROW_END) {
      endRow();
      continue;
    }
    if (current !== null) cells[current] = (cells[current] ?? "") + textOf(child, true);
  }
  endRow();
  if (rows.length === 0) return caption ? [caption, ""] : [];
  const width = Math.max(...rows.map((r) => r.cells.length));
  const pad = (r: string[]): string[] => [...r, ...Array.from({ length: width - r.length }, () => "")];
  const [first, ...rest] = rows as [{ cells: string[]; header: boolean }, ...Array<{ cells: string[]; header: boolean }>];
  const head = pad(first.cells).map(cellText);
  const isPairTable = head.length === PAIR_HEADER.length && head.every((h, i) => h === PAIR_HEADER[i]);
  const out: string[] = [];
  if (caption && !isPairTable) out.push(`### ${caption}`, "");
  out.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`);
  for (const row of rest) out.push(`| ${pad(row.cells).map(cellText).join(" | ")} |`);
  out.push("");
  return out;
}

function listMarkdown(node: XmlNode): string[] {
  const ordered = /ordered/.test(node.attrs["class"] ?? "") && !/unordered/.test(node.attrs["class"] ?? "");
  const items: string[] = [];
  let current: string | null = null;
  for (const child of node.children) {
    if (typeof child !== "string" && child.tag === "ldiv") {
      if (current !== null) items.push(current);
      current = "";
      continue;
    }
    const text = textOf(child, true);
    if (current === null) {
      if (text.trim()) current = text;
    } else current += text;
  }
  if (current !== null) items.push(current);
  const lines = items.map((item) => tidy(item).replace(/\n/g, " ")).filter(Boolean);
  return [...lines.map((item, i) => (ordered ? `${i + 1}. ${item}` : `- ${item}`)), ""];
}

/** DocLang 문서의 제목 — <head><title>, 없으면 첫 제목(heading) */
function findTitle(root: XmlNode): string {
  const doc = root.children.find((c): c is XmlNode => typeof c !== "string" && c.tag === "doclang") ?? root;
  const head = doc.children.find((c): c is XmlNode => typeof c !== "string" && c.tag === "head");
  const title = head?.children.find((c): c is XmlNode => typeof c !== "string" && c.tag === "title");
  if (title) return tidy(textOf(title, true));
  const heading = doc.children.find((c): c is XmlNode => typeof c !== "string" && c.tag === "heading");
  return heading ? tidy(textOf(heading)) : "";
}

/** <custom><doc_id> — 이 도구가 만든 문서의 종류 id (없으면 null) */
function findDocId(node: XmlNode): string | null {
  for (const child of node.children) {
    if (typeof child === "string") continue;
    if (child.tag === "doc_id") return tidy(textOf(child)) || null;
    const inner = findDocId(child);
    if (inner) return inner;
  }
  return null;
}

/** DocLang 문서를 결재·제출용 Markdown 으로 — 작성 안내 줄은 원래 DocLang 에 없다 */
export function doclangToMarkdown(xml: string): { markdown: string; title: string; docId: string | null } {
  const root = parseXml(xml);
  const doc = root.children.find((c): c is XmlNode => typeof c !== "string" && c.tag === "doclang");
  if (!doc) throw new Error("DocLang 문서가 아닙니다(<doclang> 요소가 없습니다)");
  const out: string[] = [];
  const walk = (node: XmlNode): void => {
    for (const child of node.children) {
      if (typeof child === "string") {
        if (child.trim()) out.push(tidy(child), "");
        continue;
      }
      if (child.tag === "head" || SKIP.has(child.tag)) continue;
      if (child.tag === "heading") {
        const level = Math.min(Math.max(Number.parseInt(child.attrs["level"] ?? "1", 10) || 1, 1), MAX_HEADING_LEVEL);
        const text = tidy(textOf(child));
        if (text) out.push(`${"#".repeat(level)} ${text}`, "");
      } else if (child.tag === "table") out.push(...tableMarkdown(child));
      else if (child.tag === "list") out.push(...listMarkdown(child));
      else if (child.tag === "text" || child.tag === "content" || child.tag === "caption") {
        for (const line of tidy(textOf(child, true)).split("\n")) if (line) out.push(line, "");
      } else if (child.children.some((c) => typeof c !== "string" && ["heading", "table", "list", "text"].includes(c.tag))) walk(child);
      else {
        const text = tidy(textOf(child, true));
        if (text) out.push(text, "");
      }
    }
  };
  walk(doc);
  return { markdown: `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`, title: findTitle(root), docId: findDocId(doc) };
}
