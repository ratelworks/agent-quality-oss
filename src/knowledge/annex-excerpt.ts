// ─────────────────────────────────────────────────────────────────────────────
// annex-excerpt.ts — 큰 별표에서 낱말이 든 칸만 꺼낸다.
//
// 업무지침 별표 2(품질시험기준)는 39만 자가 넘는다. 통째로 주면 AI 비서가 한 번에 읽지 못해
// 파일로 넘어가고 답을 찾지 못한다(강관말뚝 반입·용접부 시험 빈도를 묻는 과제에서 실제로 일어났다).
// 상자 선으로 그린 표에서 왼쪽 끝에서 시작하는 가로선이 항목(종별)을 나누고, 안쪽 칸에서 시작하는 가로선은
// 같은 항목 안의 줄을 나눈다 — 낱말이 든 줄에서 위아래로 항목 경계까지 넓혀 그 항목 전체를 꺼낸다.
// 표의 칸 이름(머리 줄)과 그 표가 속한 절 제목을 함께 붙인다. 원문 글은 고치지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

// ───── 상수 ─────
/** 이보다 긴 별표는 낱말 없이 통째로 주지 않는다 */
export const ANNEX_FULL_MAX = 30_000;
/** 꺼낸 글의 최대 길이 — 넘으면 앞에서부터 이만큼만 주고 남은 수를 알린다 */
const EXCERPT_MAX = 20_000;
/** 낱말 없이 큰 별표를 부를 때 보여 줄 앞부분 */
const HEAD_CHARS = 2_000;
/** 목차로 보여 줄 절 제목의 최대 수 */
const TOC_MAX = 120;
/** 항목 경계 — 줄 첫머리(테두리 뒤 네 칸 안)에서 시작하는 가로선 */
const ENTRY_BOUNDARY_RE = /^.{0,4}[├┠┣┏┌┗└]/u;
/** 표가 시작하는 줄 */
const TABLE_TOP_RE = /^\s*[┏┌]/u;
/** 표가 끝나는 줄 */
const TABLE_BOTTOM_RE = /^\s*[┗└]/u;
/** 절 제목 아래 표를 찾을 때 제목에서 내려가 볼 줄 수 */
const TABLE_AFTER_HEADING_LINES = 3;
/** 절 제목이 맞았을 때 알려 줄 종별 이름의 최대 수 */
const KINDS_MAX = 80;
/** 표 안의 줄 */
const BOX_CHAR_RE = /[│┃├┤┠┨┼┏┓┗┛┌┐└┘━─]/u;
/** 절 제목으로 볼 줄 — 표 밖의 짧은 줄 */
const HEADING_MAX = 60;

const compact = (s: string): string => s.replace(/\s+/gu, '');

export interface AnnexExcerpt {
  find: string;
  /** 낱말이 든 항목 수 */
  matches: number;
  /** 낱말을 모두 가진 항목만 보였는지 (false 면 일부만 가진 항목) */
  allTermsMatched: boolean;
  /** sectionKinds — 절 제목에서 낱말을 찾았을 때 그 절 표에 든 종별 이름(하나를 find 로 다시 찾으면 그 칸 전체를 준다) */
  excerpts: Array<{ section: string | null; header: string | null; text: string; sectionKinds?: string[] }>;
  /** 길이 한도로 빼고 보이지 않은 항목 수 */
  omitted: number;
}

/** 절 제목 — 표 밖의 짧은 줄 */
function isHeading(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.length <= HEADING_MAX && !BOX_CHAR_RE.test(t);
}

/** 표 하나의 머리 줄과 종별 이름 — top 은 표가 시작하는 줄 */
function tableOutline(lines: string[], top: number): { header: string; kinds: string[] } {
  let headEnd = top + 1;
  while (headEnd < lines.length && !ENTRY_BOUNDARY_RE.test(lines[headEnd] ?? '')) headEnd += 1;
  const kinds: string[] = [];
  // 칸의 글 — 칸 안에 그어진 가로선 앞까지 ("(KS F 4602)     ├────" → "(KS F 4602)")
  const cellText = (cell: string): string => (cell.split(BOX_CHAR_RE)[0] ?? '').trim();
  for (let i = headEnd; i < lines.length && !TABLE_BOTTOM_RE.test(lines[i] ?? ''); i += 1) {
    if (!ENTRY_BOUNDARY_RE.test(lines[i] ?? '')) continue;
    // 항목 경계 다음 줄에서 글이 있는 첫 칸이 종별 이름 칸 ("┃  │강관말뚝 │화학성분 …" → 강관말뚝).
    // 이름이 여러 줄에 걸치면("포틀랜드 / 시멘트") 다음 경계까지 같은 칸의 글을 잇는다
    const firstCells = (lines[i + 1] ?? '').split(/[│┃]/u);
    const col = firstCells.findIndex((c) => cellText(c).length > 0);
    if (col < 0) continue;
    const parts: string[] = [];
    for (let j = i + 1; j < lines.length && !ENTRY_BOUNDARY_RE.test(lines[j] ?? '') && !TABLE_BOTTOM_RE.test(lines[j] ?? ''); j += 1) {
      const piece = cellText((lines[j] ?? '').split(/[│┃]/u)[col] ?? '');
      if (piece) parts.push(piece);
    }
    const name = parts.join(' ');
    if (name && !kinds.includes(name) && kinds.length < KINDS_MAX) kinds.push(name);
  }
  return { header: lines.slice(top, headEnd).join('\n'), kinds };
}

/** 낱말이 든 항목(표의 종별 칸 또는 표 밖 문단)을 꺼낸다 */
export function excerptAnnex(text: string, find: string): AnnexExcerpt {
  const lines = text.split('\n');
  const terms = find.split(/\s+/u).map(compact).filter((t) => t.length > 0);
  // 항목 단위로 나눈다: [시작 줄, 끝 줄]
  const blocks: Array<[number, number]> = [];
  let start = 0;
  for (let i = 1; i <= lines.length; i += 1) {
    if (i === lines.length || ENTRY_BOUNDARY_RE.test(lines[i] ?? '') || (isHeading(lines[i] ?? '') && !isHeading(lines[i - 1] ?? ''))) {
      blocks.push([start, i - 1]);
      start = i;
    }
  }
  const scored = blocks
    .map(([a, b]) => {
      const body = compact(lines.slice(a, b + 1).join(''));
      return { a, b, n: terms.filter((t) => body.includes(t)).length };
    })
    .filter((x) => x.n > 0);
  const all = scored.filter((x) => x.n === terms.length);
  const chosen = all.length > 0 ? all : scored.sort((x, y) => y.n - x.n || x.a - y.a).filter((x) => x.n === (scored[0]?.n ?? 0));
  chosen.sort((x, y) => x.a - y.a);

  const excerpts: AnnexExcerpt['excerpts'] = [];
  let used = 0;
  let omitted = 0;
  for (const { a, b } of chosen) {
    const own = lines.slice(a, b + 1);
    if (own.every((l) => !l.trim() || isHeading(l))) {
      // 절 제목에서 찾았다 — 그 절 자신이 출처다. 절의 표 전체는 크므로 칸 이름과 종별 이름만 알린다
      const headings = own.filter((l) => l.trim()).map((l) => l.trim());
      const section = headings.find((h) => terms.some((t) => compact(h).includes(t))) ?? headings[headings.length - 1] ?? null;
      let nextTop = -1;
      for (let i = b + 1; i < lines.length && i <= b + TABLE_AFTER_HEADING_LINES; i += 1) {
        if (TABLE_TOP_RE.test(lines[i] ?? '')) { nextTop = i; break; }
      }
      const outline = nextTop >= 0 ? tableOutline(lines, nextTop) : null;
      const cost = headings.join('\n').length + (outline ? outline.header.length + outline.kinds.join(', ').length : 0);
      if (used + cost > EXCERPT_MAX && excerpts.length > 0) { omitted += 1; continue; }
      used += cost;
      excerpts.push({ section, header: outline?.header ?? null, text: headings.join('\n'), ...(outline ? { sectionKinds: outline.kinds } : {}) });
      continue;
    }
    // 이 항목이 속한 표의 머리 줄(┏ 부터 첫 가로선 전까지)과 그 표 앞의 절 제목
    let top = -1;
    for (let i = a; i >= 0; i -= 1) {
      if (TABLE_TOP_RE.test(lines[i] ?? '')) { top = i; break; }
    }
    let header: string | null = null;
    if (top >= 0 && top < a) {
      let end = top + 1;
      while (end < lines.length && end < a && !ENTRY_BOUNDARY_RE.test(lines[end] ?? '')) end += 1;
      header = lines.slice(top, end).join('\n');
    }
    let section: string | null = null;
    for (let i = (top >= 0 ? top : a) - 1; i >= 0; i -= 1) {
      if (isHeading(lines[i] ?? '')) { section = (lines[i] ?? '').trim(); break; }
    }
    const body = lines.slice(a, b + 2 <= lines.length ? b + 2 : b + 1).join('\n');
    const cost = body.length + (header?.length ?? 0);
    if (used + cost > EXCERPT_MAX && excerpts.length > 0) { omitted += 1; continue; }
    used += cost;
    excerpts.push({ section, header: header === body ? null : header, text: body });
  }
  return { find, matches: chosen.length, allTermsMatched: all.length > 0, excerpts, omitted };
}

/** 낱말 없이 큰 별표를 부를 때 — 절 제목 목차와 앞부분 */
export function annexOutline(text: string): { length: number; sections: string[]; head: string } {
  const sections = text.split('\n').filter(isHeading).map((l) => l.trim()).slice(0, TOC_MAX);
  return { length: text.length, sections, head: text.slice(0, HEAD_CHARS) };
}
