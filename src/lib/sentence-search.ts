// ─────────────────────────────────────────────────────────────────────────────
// sentence-search.ts — 문장으로 글 묶음을 찾는다 (글자 두 개 단위 + BM25).
//
// 왜 글자 두 개 단위인가
//   현장 말은 조사·어미가 붙어 있다("슬럼프가", "떼도"). 낱말로 자르려면 형태소 분석기가 있어야 하는데,
//   글자 두 개 단위로 견주면 조사가 붙어도 겹치는 부분이 남는다. 외부 의존성 없이 같은 입력에 같은 결과가 나온다.
// 점수는 BM25 — 어느 글에나 나오는 글자 쌍은 가볍게, 드문 글자 쌍은 무겁게 센다.
// ─────────────────────────────────────────────────────────────────────────────

// ───── 상수 ─────
/** BM25 빈도 포화 */
const K1 = 1.2;
/** BM25 글 길이 보정 */
const B = 0.75;

export interface SearchDocument {
  id: string;
  /** 제목·이름 — 본문보다 무겁게 센다 */
  title: string;
  /** 본문 */
  body?: string;
  /** 덧붙이는 글(현장 표현 등) */
  extra?: string[];
}

export interface SearchHit {
  id: string;
  score: number;
}

/**
 * 글을 견줄 조각으로 자른다.
 * 한글은 글자 두 개 단위(띄어쓰기·기호를 넘는 쌍은 만들지 않는다), 영문·숫자는 낱말째로 둔다
 * — "fck" 와 "fcn" 처럼 앞 두 글자만 같은 약어가 서로 걸리지 않게.
 */
export function bigrams(text: string): string[] {
  const out: string[] = [];
  for (const run of text.toLowerCase().match(/[가-힣]+|[a-z0-9]+/g) ?? []) {
    if (/^[a-z0-9]/.test(run)) {
      if (run.length >= 2) out.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i += 1) out.push(run.slice(i, i + 2));
  }
  return out;
}

export class SentenceIndex {
  private readonly docs = new Map<string, Map<string, number>>();
  private readonly lengths = new Map<string, number>();
  private readonly docFreq = new Map<string, number>();
  private readonly avgLength: number;

  /**
   * @param titleRepeat 제목을 본문보다 몇 배 무겁게 셀지
   */
  constructor(documents: SearchDocument[], titleRepeat = 2) {
    let total = 0;
    for (const doc of documents) {
      const text = [...Array<string>(titleRepeat).fill(doc.title), doc.body ?? "", ...(doc.extra ?? [])].join("\n");
      const grams = bigrams(text);
      const counts = new Map<string, number>();
      for (const g of grams) counts.set(g, (counts.get(g) ?? 0) + 1);
      this.docs.set(doc.id, counts);
      this.lengths.set(doc.id, grams.length);
      total += grams.length;
      for (const g of counts.keys()) this.docFreq.set(g, (this.docFreq.get(g) ?? 0) + 1);
    }
    this.avgLength = this.docs.size > 0 ? total / this.docs.size : 0;
  }

  /**
   * 문장과 가까운 글을 점수 높은 순으로 — 점수가 0 인 글은 내지 않는다. 같은 점수면 id 순(항상 같은 결과).
   * @param ignore 문장에서 세지 않을 조각 (물음말·어미처럼 뜻을 가리지 못하는 것)
   */
  search(query: string, limit: number, ignore?: ReadonlySet<string>): SearchHit[] {
    const queryGrams = new Set(bigrams(query).filter((g) => !ignore?.has(g)));
    if (queryGrams.size === 0 || this.docs.size === 0) return [];
    const hits: SearchHit[] = [];
    for (const [id, counts] of this.docs) {
      const length = this.lengths.get(id) ?? 0;
      let score = 0;
      for (const g of queryGrams) {
        const tf = counts.get(g);
        if (!tf) continue;
        const df = this.docFreq.get(g) ?? 0;
        const idf = Math.log(1 + (this.docs.size - df + 0.5) / (df + 0.5));
        score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * length) / (this.avgLength || 1)));
      }
      if (score > 0) hits.push({ id, score });
    }
    hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return hits.slice(0, limit);
  }
}
