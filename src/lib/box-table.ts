// ─────────────────────────────────────────────────────────────────────────────
// box-table.ts — 법령 별표·서식의 선 그림 표(┌─┬─┐ │ ├─┼─┤ └─┴─┘)를 행·칸으로 푼다.
//
// 법제처 원문은 표를 선 그리는 문자로 싣고, 칸이 좁으면 낱말 중간에서 줄을 바꾼다
// ("총공사비가 1,00" / "0억원 이상인"). 그대로는 문장을 찾을 수 없어 칸마다 줄을 이어 붙인다.
// 세로로 합친 칸(구분선이 그 칸만 비어 있는 칸)은 다음 줄까지 이어 붙인다.
// 굵은 선·가는 선이 섞인 표(┏━┓ ┃ ┠─╂─┨)도 같은 방식으로 읽는다.
// ─────────────────────────────────────────────────────────────────────────────

// ───── 상수 ─────
const BOX_FIRST = 0x2500;
const BOX_LAST = 0x257f;
const HORIZONTALS = new Set(["─", "━", "┄", "┅", "┈", "┉", "╌", "╍", "═"]);
const VERTICALS = new Set(["│", "┃", "┆", "┇", "┊", "┋", "╎", "╏", "║"]);
const TOP_LEFT = new Set(["┌", "┍", "┎", "┏", "╔"]);
const BOTTOM_LEFT = new Set(["└", "┕", "┖", "┗", "╚"]);

export interface BoxTable {
  /** 표 바로 위에 있던 글(제목·주석) */
  caption: string;
  rows: string[][];
}

interface Cell {
  /** 칸이 시작하는 화면 위치 (칸을 구분하는 열쇠) */
  start: number;
  text: string;
  /** 가로선만 있는 칸 — 그 칸의 행이 끝났다는 뜻 */
  rule: boolean;
}

function isBox(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code >= BOX_FIRST && code <= BOX_LAST;
}

/** 화면에서 차지하는 너비 — 한글·한자·전각 기호·선 그리는 문자는 두 칸 */
function width(ch: string): number {
  return (ch.codePointAt(0) ?? 0) >= 0x1100 ? 2 : 1;
}

function firstChar(line: string): string {
  return line.trimStart().charAt(0);
}

/** 한 줄을 칸으로 나눈다 — 세로선과 모서리·교차 문자가 칸의 경계다 */
function cellsOf(line: string): Cell[] {
  const cells: Cell[] = [];
  let pos = 0;
  let current = "";
  let start = -1;
  let opened = false;
  for (const ch of line) {
    const boundary = isBox(ch) && !HORIZONTALS.has(ch);
    if (boundary) {
      if (opened) {
        const onlyRule = current !== "" && [...current].every((c) => HORIZONTALS.has(c));
        cells.push({ start, text: onlyRule ? "" : current.trim(), rule: onlyRule });
      }
      opened = true;
      current = "";
      start = pos + width(ch);
    } else if (opened) {
      current += ch;
    }
    pos += width(ch);
  }
  return cells;
}

/** 본문에서 선 그림 표를 모두 찾아 행·칸으로 푼다 */
export function parseBoxTables(text: string): BoxTable[] {
  const lines = text.split("\n");
  const tables: BoxTable[] = [];
  let caption = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!TOP_LEFT.has(firstChar(line))) {
      if (line.trim() !== "" && !isBox(firstChar(line))) caption = line.trim();
      i += 1;
      continue;
    }
    const rows: string[][] = [];
    /** 아직 행으로 내보내지 않은 칸의 글 (칸 시작 위치 → 글) */
    let pending = new Map<number, string>();
    const emit = (keep: Set<number>): void => {
      const starts = [...pending.keys()].sort((a, b) => a - b);
      const row = starts.map((s) => pending.get(s) ?? "");
      if (row.some((c) => c !== "")) rows.push(row);
      const next = new Map<number, string>();
      // 세로로 합친 칸은 글을 들고 다음 행으로 넘어간다
      for (const s of keep) next.set(s, pending.get(s) ?? "");
      pending = next;
    };
    i += 1;
    while (i < lines.length) {
      const cur = lines[i] ?? "";
      const head = firstChar(cur);
      if (!isBox(head)) break; // 표가 닫히지 않고 끝남
      if (BOTTOM_LEFT.has(head)) {
        i += 1;
        break;
      }
      const cells = cellsOf(cur);
      if (cells.some((c) => c.rule)) {
        // 구분선 — 선이 그어진 칸은 행이 끝났고, 선이 없는 칸(세로 병합)은 이어진다
        for (const c of cells) if (!c.rule && c.text) pending.set(c.start, (pending.get(c.start) ?? "") + c.text);
        emit(new Set(cells.filter((c) => !c.rule).map((c) => c.start)));
      } else {
        for (const c of cells) pending.set(c.start, (pending.get(c.start) ?? "") + c.text);
      }
      i += 1;
    }
    emit(new Set());
    tables.push({ caption, rows });
    caption = "";
  }
  return tables;
}

/** 표의 모든 칸 글자 — 문장 찾기용 */
export function boxTableCells(text: string): string[] {
  return parseBoxTables(text).flatMap((t) => t.rows.flat().filter(Boolean));
}
