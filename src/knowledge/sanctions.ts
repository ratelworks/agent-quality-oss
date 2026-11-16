// ─────────────────────────────────────────────────────────────────────────────
// sanctions.ts — 건설기술 진흥법의 벌칙(제87조~제89조)·과태료(제91조)를 호 하나하나로 읽어 낸다.
//
// 벌점(시행령 별표 8)과 형벌·과태료는 따로 매겨진다. 벌점만 알려 주면 AI 비서가
// "벌금이 아니라 벌점입니다"처럼 형벌이 없는 것으로 답한다 — 같은 상황의 형벌·과태료 호를 함께 준다.
//   "품질시험 안 하면" → 제88조 제4호 — 2년 이하의 징역 또는 2천만원 이하의 벌금
//   "정보망 입력"      → 제91조 제3항 제12호의2 — 300만원 이하의 과태료
// 수록 원문(src/ontology/laws)만 읽는다 — 호의 글과 처벌 내용은 원문 그대로다(개정 표시만 뺀다).
// ─────────────────────────────────────────────────────────────────────────────

import { findLaw } from '../ontology/laws.js';

// ───── 상수 ─────
const ACT_NAME = '건설기술 진흥법';
/** 벌칙·과태료 조 */
const SANCTION_ARTICLES = [87, 88, 89, 91];
const PARAGRAPH_HEAD_RE = /^\s*([①-⑳])\s*/u;
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
/** 호 — "  4. " · "  1의2. " · "  12의2. " */
const ITEM_RE = /^\s+(\d+)(?:의(\d+))?\.\s+/u;
/** 목 — "    가. " (앞 호에 붙인다) */
const SUB_ITEM_RE = /^\s+[가-하]\.\s+/u;
/** 개정·신설 표시 — "<개정 2018.12.31>" */
const AMENDMENT_RE = /\s*<(?:개정|신설|전문개정|본조신설)[^>]*>/gu;
/** 삭제된 호 — "삭제<2018.12.31>" */
const DELETED_RE = /^삭제\s*(?:<[^>]*>)?\s*$/u;
/** 처벌 내용 — "2년 이하의 징역 또는 2천만원 이하의 벌금" · "300만원 이하의 과태료" */
const PUNISHMENT_RE = /(\d+년\s*이하의\s*(?:징역|금고)\s*또는\s*[\d,천만억원\s]+이하의\s*벌금|[\d,천만억원\s]+이하의\s*과태료)/u;

export interface SanctionItem {
  /** "제88조 제4호" · "제91조 제3항 제12호의2" · "제87조 제1항" */
  ref: string;
  /** 형벌 / 과태료 */
  kind: '형벌' | '과태료';
  /** "2년 이하의 징역 또는 2천만원 이하의 벌금" */
  punishment: string;
  /** 누가 무엇을 했을 때인지 (원문 그대로) */
  text: string;
}

let cache: SanctionItem[] | null = null;

const clean = (s: string): string => s.replace(AMENDMENT_RE, '').replace(/\s+/gu, ' ').trim();

/** 벌칙·과태료 호 전부 */
export function loadSanctionItems(): SanctionItem[] {
  if (cache) return cache;
  const act = findLaw(ACT_NAME);
  const out: SanctionItem[] = [];
  for (const no of SANCTION_ARTICLES) {
    const article = act?.articles.find((a) => a.number === no && !a.branch && !a.deleted);
    if (!article) continue;
    // 항으로 나눈다 — 항이 없으면 조 전체가 한 덩어리
    const blocks: { para: string; lines: string[] }[] = [];
    for (const raw of article.text.split('\n')) {
      const line = raw.replace(/^제\d+조(?:의\d+)?\([^)]*\)\s*/u, '');
      const head = line.match(PARAGRAPH_HEAD_RE);
      if (head) blocks.push({ para: `제${CIRCLED.indexOf(head[1] as string) + 1}항`, lines: [line.replace(PARAGRAPH_HEAD_RE, '')] });
      else if (blocks.length > 0) blocks[blocks.length - 1]?.lines.push(line);
      else if (line.trim()) blocks.push({ para: '', lines: [line] });
    }
    for (const block of blocks) {
      const lead: string[] = [];
      const items: { no: string; lines: string[] }[] = [];
      for (const line of block.lines) {
        const it = line.match(ITEM_RE);
        if (it) items.push({ no: `제${it[1]}호${it[2] ? `의${it[2]}` : ''}`, lines: [line.replace(ITEM_RE, '')] });
        else if (items.length > 0 && (SUB_ITEM_RE.test(line) || line.trim())) items[items.length - 1]?.lines.push(line);
        else lead.push(line);
      }
      const leadText = clean(lead.join(' '));
      const punishment = leadText.match(PUNISHMENT_RE)?.[1]?.replace(/\s+/gu, ' ').trim();
      if (!punishment) continue;
      const kind = punishment.endsWith('과태료') ? '과태료' : '형벌';
      const base = `제${no}조${block.para ? ` ${block.para}` : ''}`;
      if (items.length === 0) {
        // 항에 바로 적힌 벌칙 — "…한 건설엔지니어링사업자는 5년 이하의 징역 …에 처한다"
        out.push({ ref: base, kind, punishment, text: leadText });
      } else {
        for (const it of items) {
          const text = clean(it.lines.join(' '));
          if (DELETED_RE.test(it.lines.join(' ').trim())) continue;
          out.push({ ref: `${base} ${it.no}`, kind, punishment, text });
        }
      }
    }
  }
  cache = out;
  return out;
}

const compact = (s: string): string => s.replace(/\s+/gu, '');

/**
 * 낱말로 벌칙·과태료 호를 찾는다 — 낱말이 많이 든 호부터.
 * @param groups 찾을 낱말들 — 낱말마다 같은 말로 치는 말의 묶음. 띄어쓰기는 무시한다
 */
export function searchSanctionItems(groups: readonly (readonly string[])[], limit = 3): { item: SanctionItem; matched: string[] }[] {
  const keys = groups
    .map((g) => ({ label: g[0] ?? '', alts: [...new Set(g.map(compact).filter((t) => t.length >= 2))] }))
    .filter((k) => k.alts.length > 0);
  if (keys.length === 0) return [];
  const scored = loadSanctionItems()
    .map((item) => {
      const hay = compact(item.text);
      return { item, matched: keys.filter((k) => k.alts.some((a) => hay.includes(a))).map((k) => k.label) };
    })
    .filter((r) => r.matched.length > 0)
    .sort((a, b) => b.matched.length - a.matched.length);
  const best = scored[0]?.matched.length ?? 0;
  return scored.filter((r) => r.matched.length >= Math.max(1, best - 1)).slice(0, limit);
}

/** 호 참조로 찾는다 ("제88조 제4호") */
export function sanctionByRef(ref: string): SanctionItem | undefined {
  return loadSanctionItems().find((s) => s.ref === ref);
}
