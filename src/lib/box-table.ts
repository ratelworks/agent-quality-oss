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

// ─────────────────────────────────────────────────────────────────────────────
// 칸 단위 풀이 — 칸마다 가로 범위(왼쪽·오른쪽 경계)와 세로 범위(시작·끝 줄)를 함께 돌려준다.
// 세로로 합친 칸, 한 칸을 다시 나눈 칸(하위 열)이 섞인 큰 표를 행으로 다시 짤 때 쓴다.
//
// 법제처 원문의 표는 한글·기호를 두 칸, 영문·숫자를 한 칸으로 놓고 줄을 맞춘 것이다.
// 글이 칸보다 길거나 글자가 깨진 줄은 한두 칸 어긋나므로, 위·아래 정상 줄의 경계에 맞춘다.
// ─────────────────────────────────────────────────────────────────────────────

/** 어긋난 경계를 이웃 줄의 경계에 맞출 때 허용하는 거리(화면 칸) */
const SNAP_TOLERANCE = 2;

export interface GridCell {
  left: number;
  right: number;
  /** 칸이 시작하는 줄·끝나는 줄 (표 테두리 다음 줄이 0) */
  top: number;
  bottom: number;
  /** 줄마다의 글 (앞뒤 공백 제거, 빈 줄 포함) */
  lines: string[];
}

export interface BoxGrid {
  /** 앞 표가 끝난 뒤부터 이 표 전까지의 글 줄 */
  before: string[];
  /** 표의 첫 줄(위 테두리 다음 줄)이 본문 전체에서 몇 번째 줄인가 (0부터) */
  firstLine: number;
  /** 표 안의 줄 수 (위·아래 테두리 제외) */
  lineCount: number;
  cells: GridCell[];
  /** 줄마다 가로선이 그어진 구간 [왼쪽, 오른쪽] */
  rules: Array<Array<[number, number]>>;
  /** 너비가 어긋난 줄에서 이웃 줄의 경계에 맞추지 못한 경계 수 — 0 이어야 한다 */
  unsnapped: number;
}

interface Segment {
  left: number;
  right: number;
  raw: string;
}

/** 옛 두 바이트 글자 배치 — 영문·숫자만 한 칸, 나머지는 두 칸 */
function legacyWidth(ch: string): number {
  return (ch.codePointAt(0) ?? 0) < 0x80 ? 1 : 2;
}

function segmentsOf(line: string): { segments: Segment[]; width: number } {
  const segments: Segment[] = [];
  let pos = 0;
  let left = -1;
  let raw = "";
  for (const ch of line) {
    if (isBox(ch) && !HORIZONTALS.has(ch)) {
      if (left >= 0) segments.push({ left, right: pos, raw });
      left = pos;
      raw = "";
    } else if (left >= 0) {
      raw += ch;
    }
    pos += legacyWidth(ch);
  }
  return { segments, width: pos };
}

function mostCommon(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? 0;
  for (const [v, n] of counts) if (n > (counts.get(best) ?? 0)) best = v;
  return best;
}

function boundariesOf(segments: Segment[]): number[] {
  return [...new Set(segments.flatMap((s) => [s.left, s.right]))];
}

function gridOf(tableLines: string[], before: string[], firstLine: number): BoxGrid {
  const parsed = tableLines.map(segmentsOf);
  const mainWidth = mostCommon(parsed.map((p) => p.width));
  const aligned = parsed.map((p) => p.width === mainWidth);
  let unsnapped = 0;

  /** 너비가 어긋난 줄의 경계를 위·아래에서 가장 가까운 정상 줄의 경계에 맞춘다 */
  const snapperFor = (lineIndex: number): ((v: number) => number) => {
    if (aligned[lineIndex]) return (v) => v;
    const neighbours = new Set<number>();
    for (let i = lineIndex - 1; i >= 0; i -= 1) {
      if (!aligned[i]) continue;
      for (const v of boundariesOf(parsed[i]?.segments ?? [])) neighbours.add(v);
      break;
    }
    for (let i = lineIndex + 1; i < parsed.length; i += 1) {
      if (!aligned[i]) continue;
      for (const v of boundariesOf(parsed[i]?.segments ?? [])) neighbours.add(v);
      break;
    }
    return (v) => {
      if (neighbours.has(v)) return v;
      let best = -1;
      for (const c of neighbours) {
        if (Math.abs(c - v) > SNAP_TOLERANCE) continue;
        if (best < 0 || Math.abs(c - v) < Math.abs(best - v)) best = c;
      }
      if (best < 0) {
        unsnapped += 1;
        return v;
      }
      return best;
    };
  };

  const cells: GridCell[] = [];
  const rules: Array<Array<[number, number]>> = [];
  let open: GridCell[] = [];
  const closeOverlapping = (left: number, right: number): void => {
    open = open.filter((c) => !(c.left < right && c.right > left));
  };

  parsed.forEach((p, lineIndex) => {
    const snap = snapperFor(lineIndex);
    const lineRules: Array<[number, number]> = [];
    for (const s of p.segments) {
      const left = snap(s.left);
      const right = snap(s.right);
      if (right <= left) continue;
      const chars = [...s.raw];
      if (chars.length > 0 && chars.every((c) => HORIZONTALS.has(c))) {
        lineRules.push([left, right]);
        closeOverlapping(left, right);
        continue;
      }
      let cell = open.find((c) => c.left === left && c.right === right);
      if (!cell) {
        closeOverlapping(left, right);
        cell = { left, right, top: lineIndex, bottom: lineIndex, lines: [] };
        cells.push(cell);
        open.push(cell);
      }
      cell.bottom = lineIndex;
      cell.lines.push(s.raw.trim());
    }
    rules.push(lineRules);
  });

  return { before, firstLine, lineCount: tableLines.length, cells, rules, unsnapped };
}

/** 본문의 선 그림 표를 모두 칸 단위로 푼다 */
export function parseBoxGrids(text: string): BoxGrid[] {
  const lines = text.split("\n");
  const grids: BoxGrid[] = [];
  let before: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!TOP_LEFT.has(firstChar(line))) {
      if (line.trim() !== "") before.push(line.trim());
      i += 1;
      continue;
    }
    const body: string[] = [];
    i += 1;
    const firstLine = i;
    while (i < lines.length) {
      const cur = lines[i] ?? "";
      const head = firstChar(cur);
      if (!isBox(head)) break; // 표가 닫히지 않고 끝남
      i += 1;
      if (BOTTOM_LEFT.has(head)) break;
      body.push(cur);
    }
    grids.push(gridOf(body, before, firstLine));
    before = [];
  }
  return grids;
}
