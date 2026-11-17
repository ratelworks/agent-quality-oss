// ─────────────────────────────────────────────────────────────────────────────
// doclang-values.ts — 정본(DocLang)에 적힌 값을 문서 양식의 입력값으로 되읽는다.
//
// 정본은 칸 이름(한글 표시 이름)과 값을 적는다 — 묶음·한 줄 값은 <field_item> 의 key/value,
// 표는 caption 이 표 이름인 <table>. 같은 양식으로 이름을 필드에 되짚으면 generate_quality_document
// 가 받은 입력과 같은 값을 얻는다. 법정 서식 모양의 한글 파일을 정본에서 만들 때 쓴다.
// ─────────────────────────────────────────────────────────────────────────────

import type { DocumentSchema } from "../schemas/loader.js";
import { doclangToBlocks, parseXml } from "./doclang-reader.js";
import { normalizeDraft } from "./draft.js";

// ───── 상수 ─────
/** 표의 첫 열이 양식 열이 아니면 붙는 번호 열 머리 */
const ROW_NUMBER_HEADERS = new Set(["번호", "No", "No."]);

interface Node {
  tag: string;
  attrs: Record<string, string>;
  children: Array<Node | string>;
}

function textOf(node: Node | string): string {
  if (typeof node === "string") return node;
  return node.children.map(textOf).join("");
}

function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  for (const c of node.children) if (typeof c !== "string") walk(c, visit);
}

const tidy = (s: string): string => s.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();

/** 정본의 값으로 입력값(formValues)을 만든다 — 양식에 없는 이름은 버린다 */
export function formValuesFromDoclang(schema: DocumentSchema, documentXml: string): Record<string, unknown> {
  const fields = normalizeDraft(schema, {}).fields;
  const values: Record<string, unknown> = {};

  // 한 줄·묶음·목록 값 — <field_item><key>이름</key><value>값</value></field_item>
  const byLabel = new Map<string, { name: string; sub: string | null; list: boolean }>();
  for (const f of fields) {
    if (f.kind === "rows") continue;
    if (f.kind === "group") for (const c of f.columns) byLabel.set(`${f.label} · ${c.label}`, { name: f.name, sub: c.key, list: false });
    byLabel.set(f.label, { name: f.name, sub: null, list: f.kind === "list" });
  }
  walk(parseXml(documentXml) as Node, (n) => {
    if (n.tag !== "field_item") return;
    const key = n.children.find((c): c is Node => typeof c !== "string" && c.tag === "key");
    const value = n.children.find((c): c is Node => typeof c !== "string" && c.tag === "value");
    if (!key || !value) return;
    const target = byLabel.get(tidy(textOf(key)));
    const text = tidy(textOf(value));
    if (!target || !text) return;
    if (target.sub) {
      const group = (values[target.name] ?? {}) as Record<string, string>;
      group[target.sub] = text;
      values[target.name] = group;
    } else values[target.name] = target.list ? text.split("\n").map((l) => l.trim()).filter(Boolean) : text;
  });

  // 표 — caption 이 표 필드 이름인 표
  const tables = doclangToBlocks(documentXml).blocks.filter((b): b is Extract<typeof b, { kind: "table" }> => b.kind === "table");
  for (const f of fields) {
    if (f.kind !== "rows") continue;
    const table = tables.find((t) => t.caption === f.label && !t.pair);
    if (!table || table.rows.length < 2) continue;
    const header = (table.rows[0] ?? []).map((h) => tidy(h));
    const keys = header.map((h, i) => (i === 0 && ROW_NUMBER_HEADERS.has(h) ? null : (f.columns.find((c) => c.label === h)?.key ?? null)));
    const rows = table.rows
      .slice(1)
      .map((cells) => {
        const row: Record<string, string> = {};
        cells.forEach((cell, i) => {
          const k = keys[i];
          const v = tidy(cell ?? "");
          if (k && v) row[k] = v;
        });
        return row;
      })
      .filter((row) => Object.keys(row).length > 0);
    if (rows.length > 0) values[f.name] = rows;
  }
  return values;
}
