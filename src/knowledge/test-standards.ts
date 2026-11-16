// ─────────────────────────────────────────────────────────────────────────────
// test-standards.ts — 건설공사 품질시험기준(품질관리 업무지침 별표 2)을 행으로 푼다.
//
// 별표 2 는 표 17개에 종별·시험종목·시험방법·시험빈도·비고를 싣는다. 수록 원문(선 그림 표)을
// 읽어 시험종목 하나를 한 행으로 만든다 — 따로 옮겨 적은 자료를 두지 않으므로 원문 판이 바뀌면
// 이 자료도 함께 바뀐다.
//
//   - 세로로 합친 칸(여러 시험종목에 걸친 종별·시험빈도·비고)은 걸쳐 있는 모든 행이 그 글을 갖는다.
//   - 한 칸을 다시 나눈 칸(하위 열)은 " > " 로 이어 적는다 — 예: "지지력 > 말뚝기초 > 정재하".
//   - 원문에서 깨진 가운뎃점("?")은 가운뎃점으로 읽는다.
// ─────────────────────────────────────────────────────────────────────────────

import { editionLabel, findAnnex, findLaw, loadLaws } from "../ontology/laws.js";
import { parseBoxGrids } from "../lib/box-table.js";
import type { BoxGrid, GridCell } from "../lib/box-table.js";

// ───── 상수 ─────
const GUIDELINE = "건설공사 품질관리 업무지침";
const ANNEX = "별표 2";
const HEADERS = ["종별", "시험종목", "시험방법", "시험빈도", "비고"] as const;
const COL = { CATEGORY: 0, ITEM: 1, METHOD: 2, FREQUENCY: 3, REMARKS: 4 } as const;
/** 머리 행(제목 줄 + 구분선) 다음부터가 본문 */
const BODY_FIRST_LINE = 2;
const PATH_JOIN = " > ";
/** KS 번호 — "KS F 2306", "KS M ISO 2505-1", "KS K ISO 10319" */
const KS_NUMBER = /KS\s?([A-Z])\s?((?:ISO|IEC)\s?)?(\d+(?:-\d+)*)/g;
const HANGUL_RUN = /[가-힣]+/g;
/** 숫자 바로 뒤에 붙여 쓰는 단위 — 줄이 숫자에서 끝나고 다음 줄이 단위로 시작하면 붙인다 */
const UNIT_AFTER_NUMBER = /^(?:개|톤|매|회|일|장|본|층|종|급|호|차|배|롤|통|조|주|년|월|분|초|시간|미터|제곱미터|세제곱미터|밀리미터|센티미터|킬로|퍼센트|아르|이음|로트)/;
/** 앞말에 붙여 쓰는 부호(닫는 괄호·쉼표 등)와 뒷말에 붙여 쓰는 부호(여는 괄호 등) */
const ATTACH_TO_PREVIOUS = /^[)\],.%℃:;~∼]/;
const ATTACH_TO_NEXT = /[(\[·~∼-]$/;
/** 낱말로 보는 최소 길이 — 이보다 긴 앞말은 사전에 없어도 온전한 낱말로 본다 */
const WHOLE_WORD_MIN = 3;
/** 혼자서 한 낱말인 말 — 줄바꿈 앞뒤가 이 말이면 띄어 쓴다 */
const STANDALONE_WORDS = new Set(["또는", "및", "혹은", "등", "각", "중", "시", "후", "전", "약", "총", "매"]);
/** 줄 처음과 줄 끝 양쪽에서 모두 보인 말을 낱말로 치는 최소 길이 */
const EDGE_WORD_MIN = 2;
const DELETED_MARK = /^<삭제>$/;
const MAJOR_HEADING = /^(\d+)\.\s*(.+)$/;
const SUB_HEADING = /^([가-하])\.\s*(.+)$/;
const PART_HEADING = /^\((\d+)\)\s*(.+)$/;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;
/** 현장에서 쓰는 말 → 별표 2 의 표기 (검색어에만 쓴다) */
const FIELD_TERMS: Record<string, string[]> = {
  레미콘: ["레미콘", "굳지아니한콘크리트", "굳은콘크리트"],
  콘크리트: ["콘크리트"],
  들밀도: ["현장밀도"],
  현장밀도: ["현장밀도"],
  아스콘: ["아스팔트"],
  흄관: ["원심력철근콘크리트관"],
  동바리: ["동바리", "파이프서포트"],
  서포트: ["파이프서포트"],
  비계: ["비계"],
  공시체: ["압축강도"],
  스티로폼: ["발포폴리스티렌"],
  우레탄폼: ["폴리우레탄폼"],
  pvc관: ["폴리염화비닐관"],
  pe관: ["폴리에틸렌관"],
};

export interface TestStandardRow {
  /** 표 번호와 행 번호 — "t02-r015" */
  id: string;
  /** 별표 2 안에서 몇 번째 표인가 (1부터) */
  table: number;
  /** 구분 — "1. 공통 > 나. 철근콘크리트공사" */
  section: string;
  /** 종별 */
  category: string;
  /** 시험종목 */
  item: string;
  /** 시험방법 */
  method: string;
  /** 시험빈도 */
  frequency: string;
  /** 비고 */
  remarks: string;
  /** 시험방법에 적힌 KS 번호 */
  ksNumbers: string[];
  /** 종별에 괄호로 적힌 KS 번호 (뜻은 TestStandards.note) */
  productStandards: string[];
  /** 별표 2 원문에서 이 시험종목이 적힌 줄 (1부터) — 원문과 견줄 때 쓴다 */
  sourceLines: { from: number; to: number };
}

export interface TestStandardSection {
  table: number;
  section: string;
  rows: number;
  categories: string[];
}

export interface TestStandards {
  /** "건설공사 품질관리 업무지침 별표 2 — 건설공사 품질시험기준" */
  source: string;
  edition: string;
  /** 별표 끝의 주석 (원문 그대로) */
  note: string;
  sections: TestStandardSection[];
  rows: TestStandardRow[];
  /** 풀이 점검값 — 시험이 본다 */
  diagnostics: {
    tables: number;
    /** 이웃 줄의 경계에 맞추지 못한 경계 */
    unsnapped: number;
    /** 어느 행에도 들어가지 않은, 글이 있는 칸 */
    unusedCells: number;
    /** 원문에서 삭제 표시(<삭 제>)만 남은 행 — 싣지 않는다 */
    deletedRows: number;
    /** 시험종목·시험방법이 모두 빈 행 — 싣지 않는다 */
    blankRows: number;
    /** 싣지 않은 행에만 걸려 있어 어느 행에도 남지 않은 글 (삭제 표시 제외) — 0 이어야 한다 */
    droppedTexts: string[];
  };
}

export interface TestStandardQuery {
  /** 자유 검색어 — 띄어 쓴 낱말이 모두 들어 있는 행 */
  query?: string;
  /** 구분(공종) — "철근콘크리트", "도로공사", "방수" */
  section?: string;
  /** 종별 — "레디믹스트 콘크리트", "철근" */
  category?: string;
  /** 시험종목 — "슬럼프", "압축강도" */
  item?: string;
  /** KS 번호 — "KS F 2405" */
  ksNumber?: string;
  limit?: number;
}

const squash = (s: string): string => s.replace(/\s+/g, "").toLowerCase();
const isHangul = (ch: string | undefined): boolean => ch !== undefined && ch >= "가" && ch <= "힣";

/** 원문에서 깨진 가운뎃점을 되살린다 — 줄 머리의 "?" 와 한글 사이의 "?" */
function restoreMiddleDot(line: string): string {
  return line.replace(/^\?\s*/, "·").replace(/(?<=[가-힣])\?(?=[가-힣])/g, "·");
}

/**
 * 낱말 사전 — 원문에서 줄바꿈에 잘리지 않은 것이 확실한 한글 낱말.
 * 조문(한 문단이 한 줄)의 낱말 전부와, 표 칸에서 줄의 처음·끝에 걸리지 않은 낱말이다.
 */
function buildVocabulary(grids: BoxGrid[]): Set<string> {
  const words = new Set<string>();
  // 줄바꿈에 걸린 말 — 줄 처음에서도, 줄 끝에서도 보였으면 잘린 조각이 아니라 낱말이다
  const atLineStart = new Set<string>();
  const atLineEnd = new Set<string>();
  for (const law of loadLaws()) {
    for (const article of law.articles) for (const run of article.text.match(HANGUL_RUN) ?? []) words.add(run);
  }
  for (const grid of grids) {
    for (const cell of grid.cells) {
      const lines = cell.lines.filter((l) => l !== "");
      lines.forEach((line, index) => {
        const runs = [...line.matchAll(HANGUL_RUN)];
        for (const run of runs) {
          const start = run.index ?? 0;
          const cutAtStart = index > 0 && start === 0;
          const cutAtEnd = index < lines.length - 1 && start + run[0].length === line.length;
          if (!cutAtStart && !cutAtEnd) words.add(run[0]);
          else if (cutAtStart && !cutAtEnd) atLineStart.add(run[0]);
          else if (cutAtEnd && !cutAtStart) atLineEnd.add(run[0]);
        }
      });
    }
  }
  for (const word of atLineStart) if (word.length >= EDGE_WORD_MIN && atLineEnd.has(word)) words.add(word);
  return words;
}

/**
 * 칸의 여러 줄을 한 글로 잇는다 — 좁은 칸에서 낱말 중간에 줄이 바뀐 곳은 붙이고, 낱말 사이면 띈다.
 * 원문에는 어디가 낱말 사이였는지 남아 있지 않아, 원문의 다른 곳에 온전히 나오는 낱말로 가린다.
 *   - 앞뒤를 붙인 말이 사전에 있으면 붙인다 ("이" + "상" → "이상")
 *   - 앞말이나 뒷말이 "및"·"또는" 처럼 혼자 쓰는 말이면 띈다
 *   - 한 글자만 떨어진 것은 잘린 조각으로 보고 붙인다 ("일" + "반성토")
 *   - 뒷말이 사전에 있고 앞말도 온전한 낱말이면 띄고, 그 밖에는 붙인다
 */
function joinLines(lines: string[], vocabulary: Set<string>): string {
  let out = "";
  for (const raw of lines) {
    const text = restoreMiddleDot(raw);
    if (text === "") continue;
    if (out === "") {
      out = text;
      continue;
    }
    const last = out.at(-1);
    const first = text[0];
    let attach = false;
    if (text.startsWith("·") || text.startsWith("※")) attach = false;
    else if (ATTACH_TO_PREVIOUS.test(text) || ATTACH_TO_NEXT.test(out)) attach = true;
    else if (isHangul(last) && isHangul(first)) {
      const left = /[가-힣]+$/.exec(out)?.[0] ?? "";
      const right = /^[가-힣]+/.exec(text)?.[0] ?? "";
      if (vocabulary.has(left + right)) attach = true;
      else if (STANDALONE_WORDS.has(left) || STANDALONE_WORDS.has(right)) attach = false;
      // 한 글자만 떨어진 것은 낱말이 잘린 조각이다 ("경질" 의 "질", "방청제용" 의 "용")
      else if (left.length === 1 || right.length === 1) attach = true;
      else attach = !(vocabulary.has(right) && (vocabulary.has(left) || left.length >= WHOLE_WORD_MIN));
    } else if (last !== undefined && /\d/.test(last) && isHangul(first)) attach = UNIT_AFTER_NUMBER.test(text);
    out += attach ? text : ` ${text}`;
  }
  return out.replace(/\s+/g, " ").trim();
}

function ksNumbersIn(text: string): string[] {
  const found = [...text.matchAll(KS_NUMBER)].map((m) => `KS ${m[1]} ${m[2] ? `${m[2].trim()} ` : ""}${m[3]}`);
  return [...new Set(found)];
}

/** "공 통" 처럼 글자를 띄어 쓴 제목을 붙인다 */
function tidyHeading(text: string): string {
  const restored = restoreMiddleDot(text.trim());
  if (/^(?:[가-힣]\s+)+[가-힣]$/.test(restored)) return restored.replace(/\s+/g, "");
  return restored.replace(/\s+/g, " ").replace(/·\s+/g, "·");
}

interface SectionState {
  major: string;
  sub: string;
  part: string;
}

function applyHeadings(state: SectionState, lines: string[]): void {
  for (const line of lines) {
    const major = MAJOR_HEADING.exec(line);
    const sub = SUB_HEADING.exec(line);
    const part = PART_HEADING.exec(line);
    if (part) state.part = `(${part[1]}) ${tidyHeading(part[2] ?? "")}`;
    else if (sub) {
      state.sub = `${sub[1]}. ${tidyHeading(sub[2] ?? "")}`;
      state.part = "";
    } else if (major) {
      state.major = `${major[1]}. ${tidyHeading(major[2] ?? "")}`;
      state.sub = "";
      state.part = "";
    }
  }
}

interface Column {
  left: number;
  right: number;
}

interface GridRows {
  rows: TestStandardRow[];
  unusedCells: number;
  deletedRows: number;
  blankRows: number;
  droppedTexts: string[];
}

function rowsOfGrid(grid: BoxGrid, table: number, section: string, vocabulary: Set<string>): GridRows {
  const textCache = new Map<GridCell, string>();
  const cellText = (cell: GridCell): string => {
    let text = textCache.get(cell);
    if (text === undefined) {
      text = joinLines(cell.lines, vocabulary);
      textCache.set(cell, text);
    }
    return text;
  };
  const header = grid.cells.filter((c) => c.top === 0).sort((a, b) => a.left - b.left);
  const titles = header.map((c) => cellText(c).replace(/\s+/g, ""));
  if (titles.join("|") !== HEADERS.join("|")) {
    throw new Error(`${ANNEX} 의 ${table}번째 표 머리가 다릅니다: ${titles.join(" | ")}`);
  }
  const columns: Column[] = header.map((c) => ({ left: c.left, right: c.right }));
  const columnOf = (cell: GridCell): number => {
    const mid = (cell.left + cell.right) / 2;
    const index = columns.findIndex((col) => mid >= col.left && mid < col.right);
    return index < 0 ? columns.length - 1 : index;
  };
  const body = grid.cells.filter((c) => c.top >= BODY_FIRST_LINE);
  const byColumn: GridCell[][] = columns.map(() => []);
  for (const cell of body) byColumn[columnOf(cell)]?.push(cell);
  for (const list of byColumn) list.sort((a, b) => a.left - b.left || a.top - b.top);

  const itemLeft = columns[COL.ITEM]?.left ?? 0;
  const methodRight = columns[COL.METHOD]?.right ?? 0;
  const activeAt = (column: number, line: number): GridCell[] => (byColumn[column] ?? []).filter((c) => c.top <= line && line <= c.bottom);

  interface Draft {
    cells: GridCell[][];
  }
  const drafts = new Map<string, Draft>();
  const cellIds = new Map<GridCell, number>();
  body.forEach((c, i) => cellIds.set(c, i));
  for (let line = BODY_FIRST_LINE; line < grid.lineCount; line += 1) {
    // 시험종목·시험방법 칸에 가로선이 지나는 줄은 행의 경계다
    const ruled = (grid.rules[line] ?? []).some(([l, r]) => l < methodRight && r > itemLeft);
    if (ruled) continue;
    const items = activeAt(COL.ITEM, line);
    const methods = activeAt(COL.METHOD, line);
    if (items.length === 0 || methods.length === 0) continue;
    const key = [...items, ...methods].map((c) => cellIds.get(c)).join(",");
    let draft = drafts.get(key);
    if (!draft) {
      draft = { cells: columns.map(() => []) };
      drafts.set(key, draft);
    }
    columns.forEach((_, column) => {
      const target = draft.cells[column];
      if (!target) return;
      for (const cell of activeAt(column, line)) if (!target.includes(cell)) target.push(cell);
    });
  }

  const used = new Set<GridCell>();
  const kept = new Set<GridCell>();
  const rows: TestStandardRow[] = [];
  let deletedRows = 0;
  let blankRows = 0;
  const isDeleted = (text: string): boolean => DELETED_MARK.test(text.replace(/\s+/g, ""));
  for (const draft of drafts.values()) {
    const textOf = (column: number, joiner: string): string => {
      const parts = (draft.cells[column] ?? []).map(cellText).filter((t) => t !== "");
      return parts.join(joiner);
    };
    for (const list of draft.cells) for (const cell of list) used.add(cell);
    const category = textOf(COL.CATEGORY, PATH_JOIN);
    const item = textOf(COL.ITEM, PATH_JOIN);
    const method = textOf(COL.METHOD, " / ");
    const frequency = textOf(COL.FREQUENCY, " / ");
    const remarks = textOf(COL.REMARKS, " / ");
    // 시험종목 칸의 맨 오른쪽(가장 잘게 나눈) 칸이 그 행의 시험종목이다
    const leaf = cellText((draft.cells[COL.ITEM] ?? []).at(-1) as GridCell);
    if (isDeleted(leaf) || isDeleted(method)) {
      deletedRows += 1;
      continue;
    }
    if (leaf === "" && method === "") {
      blankRows += 1;
      continue;
    }
    for (const list of draft.cells) for (const cell of list) kept.add(cell);
    const leafCell = (draft.cells[COL.ITEM] ?? []).at(-1) as GridCell;
    rows.push({
      id: `t${String(table).padStart(2, "0")}-r${String(rows.length + 1).padStart(3, "0")}`,
      table,
      section,
      category,
      item,
      method,
      frequency,
      remarks,
      ksNumbers: ksNumbersIn(method),
      productStandards: ksNumbersIn((category.match(/\([^()]*\)/g) ?? []).join(" ")),
      sourceLines: { from: grid.firstLine + leafCell.top + 1, to: grid.firstLine + leafCell.bottom + 1 },
    });
  }
  const unusedCells = body.filter((c) => !used.has(c) && cellText(c) !== "").length;
  const droppedTexts = body.filter((c) => used.has(c) && !kept.has(c) && cellText(c) !== "" && !isDeleted(cellText(c))).map(cellText);
  return { rows, unusedCells, deletedRows, blankRows, droppedTexts };
}

let cache: TestStandards | null = null;

/** 별표 2 전 항목 (처음 부를 때 한 번 푼다) */
export function loadTestStandards(): TestStandards {
  if (cache) return cache;
  const law = findLaw(GUIDELINE);
  const annex = law ? findAnnex(law, ANNEX) : null;
  if (!law || !annex) throw new Error(`${GUIDELINE} ${ANNEX} 가 수록본에 없습니다`);

  const grids = parseBoxGrids(annex.text);
  const vocabulary = buildVocabulary(grids);
  const state: SectionState = { major: "", sub: "", part: "" };
  const rows: TestStandardRow[] = [];
  const sections: TestStandardSection[] = [];
  let unusedCells = 0;
  let deletedRows = 0;
  let blankRows = 0;
  const droppedTexts: string[] = [];
  grids.forEach((grid, index) => {
    applyHeadings(state, grid.before);
    const section = [state.major, state.sub, state.part].filter(Boolean).join(PATH_JOIN);
    const result = rowsOfGrid(grid, index + 1, section, vocabulary);
    unusedCells += result.unusedCells;
    deletedRows += result.deletedRows;
    blankRows += result.blankRows;
    droppedTexts.push(...result.droppedTexts);
    rows.push(...result.rows);
    sections.push({ table: index + 1, section, rows: result.rows.length, categories: [...new Set(result.rows.map((r) => r.category).filter(Boolean))] });
  });

  const lastLines = annex.text.split("\n").map((l) => l.trim()).filter(Boolean);
  const note = [...lastLines].reverse().find((l) => l.startsWith("※")) ?? "";
  cache = {
    source: `${law.name} ${ANNEX} — ${annex.title}`,
    edition: editionLabel(law),
    note,
    sections,
    rows,
    diagnostics: {
      tables: grids.length,
      unsnapped: grids.reduce((n, g) => n + g.unsnapped, 0),
      unusedCells,
      deletedRows,
      blankRows,
      droppedTexts,
    },
  };
  return cache;
}

/**
 * 공종·종별·시험종목·KS 번호·검색어로 행을 찾는다.
 * 검색어는 띄어 쓴 낱말이 모두 들어 있는 행이며, 종별·시험종목·시험방법·빈도·비고에서 찾은 행을 먼저,
 * 구분(공종) 이름까지 봐야 맞는 행을 그 뒤에 둔다.
 */
export function searchTestStandards(q: TestStandardQuery): { total: number; rows: TestStandardRow[] } {
  const { rows } = loadTestStandards();
  const words = (q.query ?? "")
    .split(/\s+/)
    .map(squash)
    .filter(Boolean)
    .map((w) => FIELD_TERMS[w] ?? [w]);
  const section = squash(q.section ?? "");
  const category = squash(q.category ?? "");
  const item = squash(q.item ?? "");
  const ks = squash(q.ksNumber ?? "");
  const strict: TestStandardRow[] = [];
  const loose: TestStandardRow[] = [];
  for (const r of rows) {
    if (section && !squash(r.section).includes(section)) continue;
    if (category && !squash(r.category).includes(category)) continue;
    if (item && !squash(r.item).includes(item)) continue;
    if (ks && !squash(`${r.method} ${r.category} ${r.remarks}`).includes(ks)) continue;
    if (words.length === 0) {
      strict.push(r);
      continue;
    }
    const own = squash(`${r.category} ${r.item} ${r.method} ${r.frequency} ${r.remarks}`);
    if (words.every((alts) => alts.some((w) => own.includes(w)))) {
      strict.push(r);
      continue;
    }
    const withSection = own + squash(r.section);
    if (words.every((alts) => alts.some((w) => withSection.includes(w)))) loose.push(r);
  }
  const matched = [...strict, ...loose];
  const limit = Math.min(Math.max(1, Math.trunc(q.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
  return { total: matched.length, rows: matched.slice(0, limit) };
}
