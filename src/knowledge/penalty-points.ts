// ─────────────────────────────────────────────────────────────────────────────
// penalty-points.ts — 건설기술 진흥법 시행령 별표 8(건설공사 등의 벌점관리기준) 제5호의 벌점 측정기준을
// 항목 하나하나로 읽어 낸다.
//
// 별표 8 은 4만 자가 넘는 표라 통째로 읽으면 항목 번호(가목·나목, 7)가)·7)나))를 잘못 짚기 쉽다.
// 표의 칸을 풀어 항목마다 "어느 목의 몇 번 몇 호, 몇 점"을 붙여 두고, 낱말로 찾을 수 있게 한다.
//   "균열 관리"  → 제5호 가목 2)가) 주요 구조부 … 균열관리를 하지 않은 경우 — 3점
//   "검토 확인 없이 시공" → 제5호 가목 7)가)·7)나)
// 수록 원문(src/ontology/laws)만 읽는다 — 항목 글·점수는 원문 그대로다.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLaw } from '../ontology/laws.js';

// ───── 상수 ─────
const DECREE_NAME = '건설기술 진흥법 시행령';
const ANNEX_TITLE_RE = /벌점관리기준/u;
const SECTION_START = '5. 벌점 측정기준';
const SECTION_END_RE = /\n\s*라\.\s*측정기관/u;
/** 목 머리 — "가. 건설사업자, 주택건설등록업자 및 건설기술인에 대한 벌점 측정기준" */
const PART_RE = /[┐─]\s+([가-하])\.\s+([^│┌┐└┘├┤┬┴┼─\n]+)$/u;
/** 번호 칸의 큰 항목 — "1)" */
const ITEM_NO_RE = /^\s*(\d+)\)\s*$/u;
/**
 * 내용 칸에서 작은 항목이 시작되는 자리 — "  가) ". 항목 표시는 칸 안에서 들여 쓴다.
 * 줄이 바뀌어 칸 첫머리에 온 글("…이라 한 / 다)을 설계도서…", "…해당한 / 다)")은 항목 표시가 아니다
 */
const SUB_RE = /^\s+([가-하])\)\s+/u;
/** 내용 칸에서 더 작은 항목이 시작되는 자리 — "  (1) " */
const SUBSUB_RE = /^\s+\((\d+)\)\s+/u;
const POINT_RE = /^\s*(\d+(?:\.\d+)?)\s*$/u;

export interface PenaltyItem {
  /** "제5호 가목 2)가)" */
  path: string;
  /** 목의 이름 — 누구에게 매기는 벌점인지 */
  part: string;
  /** 큰 항목 이름 — "콘크리트면의 균열 발생" */
  itemTitle: string;
  /** 부실 내용 (원문 그대로, 줄바꿈만 이음) */
  text: string;
  /** 벌점 */
  points: number;
}

let cache: PenaltyItem[] | null = null;

/** 표의 칸 글을 잇는다 — 줄 끝에서 끊긴 낱말은 붙이고, 그 밖에는 띄운다 */
function joinCell(parts: string[]): string {
  let out = '';
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if (!out) out = p;
    else if (/[가-힣]$/u.test(out) && /^[가-힣]/u.test(p) && !/[다음함]$/u.test(out)) out += p;
    else out += ` ${p}`;
  }
  return out.replace(/\s+/gu, ' ').trim();
}

/** 별표 8 제5호의 벌점 항목 전부 */
export function loadPenaltyItems(): PenaltyItem[] {
  if (cache) return cache;
  const law = findLaw(DECREE_NAME);
  const annex = law?.annexes.find((a) => ANNEX_TITLE_RE.test(a.title ?? ''));
  const text = annex?.text ?? '';
  const start = text.indexOf(SECTION_START);
  if (start < 0) return (cache = []);
  const rest = text.slice(start);
  const end = rest.search(SECTION_END_RE);
  const body = end > 0 ? rest.slice(0, end) : rest;

  const items: PenaltyItem[] = [];
  let part = '';
  let partLabel = '';
  let itemNo = '';
  let itemTitleParts: string[] = [];
  let cur: { sub: string; subsub: string; parts: string[]; points: number | null } | null = null;
  let itemPoints: number | null = null;

  const flush = (): void => {
    if (cur && cur.points !== null) {
      const sub = `${cur.sub ? `${cur.sub})` : ''}${cur.subsub ? `(${cur.subsub})` : ''}`;
      items.push({
        path: `제5호 ${partLabel}목 ${itemNo})${sub}`,
        part,
        itemTitle: joinCell(itemTitleParts),
        text: joinCell(cur.parts),
        points: cur.points,
      });
    }
    cur = null;
  };
  const flushItemOnly = (): void => {
    // 작은 항목 없이 큰 항목에 바로 점수가 붙은 경우
    if (itemNo && itemPoints !== null && !items.some((i) => i.path === `제5호 ${partLabel}목 ${itemNo})`)) {
      items.push({ path: `제5호 ${partLabel}목 ${itemNo})`, part, itemTitle: joinCell(itemTitleParts), text: joinCell(itemTitleParts), points: itemPoints });
    }
  };

  for (const line of body.split('\n')) {
    const header = line.match(PART_RE);
    if (header) {
      flush();
      flushItemOnly();
      partLabel = header[1] as string;
      part = (header[2] as string).trim();
      itemNo = '';
      itemTitleParts = [];
      itemPoints = null;
      continue;
    }
    if (!line.includes('│')) continue;
    const cells = line.split('│');
    if (cells.length < 4) continue;
    const noCell = cells[1] ?? '';
    const content = cells[2] ?? '';
    const pointCell = cells[3] ?? '';
    if (/번호/u.test(noCell)) continue;
    const no = noCell.match(ITEM_NO_RE);
    if (no) {
      flush();
      flushItemOnly();
      itemNo = no[1] as string;
      itemTitleParts = [content];
      itemPoints = POINT_RE.test(pointCell) ? Number(pointCell.trim()) : null;
      continue;
    }
    if (!itemNo) continue;
    const sub = content.match(SUB_RE);
    const subsub = content.match(SUBSUB_RE);
    const pt = pointCell.match(POINT_RE);
    if (sub) {
      flush();
      cur = { sub: sub[1] as string, subsub: '', parts: [content.replace(SUB_RE, '')], points: pt ? Number(pt[1]) : null };
      continue;
    }
    if (subsub && cur) {
      // 작은 항목 아래의 더 작은 항목 — 앞 작은 항목에 점수가 없으면 그 머리로 쓴다
      const parentSub: string = cur.sub;
      const parentHead: string = cur.points === null ? joinCell(cur.parts) : '';
      flush();
      cur = { sub: parentSub, subsub: subsub[1] as string, parts: parentHead ? [`${parentHead} —`, content.replace(SUBSUB_RE, '')] : [content.replace(SUBSUB_RE, '')], points: pt ? Number(pt[1]) : null };
      continue;
    }
    if (cur) {
      cur.parts.push(content);
      if (pt && cur.points === null) cur.points = Number(pt[1]);
    } else if (content.trim()) {
      itemTitleParts.push(content);
      if (pt && itemPoints === null) itemPoints = Number(pt[1]);
    }
  }
  flush();
  flushItemOnly();
  cache = items;
  return items;
}

const compact = (s: string): string => s.replace(/\s+/gu, '');

/**
 * 낱말로 벌점 항목을 찾는다 — 낱말이 많이 들어 있는 항목부터.
 * @param groups 찾을 낱말들 — 낱말마다 같은 말로 치는 말의 묶음(["겸직", "각 호 외의 업무"]). 띄어쓰기는 무시한다
 */
export function searchPenaltyItems(groups: readonly (readonly string[])[], limit = 5): { item: PenaltyItem; matched: string[] }[] {
  const keys = groups
    .map((g) => ({ label: g[0] ?? '', alts: [...new Set(g.map(compact).filter((t) => t.length >= 2))] }))
    .filter((k) => k.alts.length > 0);
  if (keys.length === 0) return [];
  const scored = loadPenaltyItems()
    .map((item) => {
      const hay = compact(`${item.itemTitle} ${item.text}`);
      const matched = keys.filter((k) => k.alts.some((a) => hay.includes(a))).map((k) => k.label);
      return { item, matched };
    })
    .filter((r) => r.matched.length > 0)
    // 맞은 낱말 수 → 점수가 큰 항목(같은 일의 무거운 경우) 순
    .sort((a, b) => b.matched.length - a.matched.length || b.item.points - a.item.points);
  const best = scored[0]?.matched.length ?? 0;
  // 가장 많이 맞은 수보다 둘 이상 적게 맞은 항목은 버린다(낱말 하나만 우연히 겹친 항목)
  return scored.filter((r) => r.matched.length >= Math.max(1, best - 1)).slice(0, limit);
}

// ───── 상황과 벌점 잇기 (ontology/penalty-links.json) ─────
interface PenaltyLinks {
  topics: Record<string, { label: string; paths: string[] }>;
  workTypes: Record<string, string[]>;
  tools: Record<string, string[]>;
  documents: Record<string, string[]>;
}
const LINKS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ontology', 'penalty-links.json');
let linksCache: PenaltyLinks | null = null;

/** 상황 → 벌점 항목 연결 자료 */
export function loadPenaltyLinks(): PenaltyLinks {
  if (linksCache) return linksCache;
  const data = JSON.parse(readFileSync(LINKS_PATH, 'utf8')) as Partial<PenaltyLinks>;
  linksCache = { topics: data.topics ?? {}, workTypes: data.workTypes ?? {}, tools: data.tools ?? {}, documents: data.documents ?? {} };
  return linksCache;
}

export interface RelatedPenalty {
  law: string;
  ref: string;
  points: number;
  /** 누구에게 매기는 벌점인지 (별표 8 제5호의 목 이름) */
  appliesTo: string;
  /** 이 항목이 걸리는 상황 */
  situation: string;
  item: string;
  text: string;
}

/**
 * 도구·일·문서에 걸린 벌점 항목. 항목의 글과 점수는 수록 원문에서 읽는다.
 * @param keys "tool:compile_inspection_references" · "work:concrete_placement" · "document:inspection_request" · "topic:inspection"
 */
export function relatedPenalties(keys: readonly string[]): RelatedPenalty[] {
  const links = loadPenaltyLinks();
  const topics = new Set<string>();
  for (const key of keys) {
    const [kind, raw] = key.split(':', 2) as [string, string];
    const id = (raw ?? '').replace(/^work[.:]/u, '');
    const found =
      kind === 'tool' ? links.tools[id] : kind === 'work' ? links.workTypes[id] : kind === 'document' ? links.documents[id] : kind === 'topic' ? [id] : undefined;
    for (const t of found ?? []) topics.add(t);
  }
  const items = new Map(loadPenaltyItems().map((i) => [i.path, i]));
  const out: RelatedPenalty[] = [];
  const seen = new Set<string>();
  for (const t of topics) {
    const topic = links.topics[t];
    if (!topic) continue;
    for (const p of topic.paths) {
      const item = items.get(p);
      if (!item || seen.has(p)) continue;
      seen.add(p);
      out.push({ law: DECREE_NAME, ref: `별표 8 ${item.path}`, points: item.points, appliesTo: item.part, situation: topic.label, item: item.itemTitle, text: item.text });
    }
  }
  return out;
}

/** 벌점이 쌓이는 방식 — 반기벌점과 합산벌점(별표 8 제3호) */
export const PENALTY_SCORING_NOTE =
  '벌점은 업체와 건설기술인등에 각각 매긴다(별표 8 제5호). 반기에 받은 벌점 합계에서 경감점수를 뺀 것이 반기벌점이고, 합산벌점은 최근 2년간의 반기벌점 합계를 2로 나눈 값이다(별표 8 제3호). 합산벌점에 따라 입찰 참가자격 사전심사에서 감점된다(별표 8 제4호). 어느 항목을 매길지는 측정기관(발주청·인허가기관 등)이 정한다.';
