// ─────────────────────────────────────────────────────────────────────────────
// citation-resolver.ts — 법령 인용이 수록 원문에 실제로 있는지 세 가지로 판정한다.
//
//   confirmed     수록한 법령에 그 조문·별표·서식이 있다
//   not_found     그 법령은 전 조문을 수록했는데 해당 조문이 없다(또는 삭제된 조문이다)
//   unverifiable  수록하지 않은 법령이거나 표기를 읽지 못해 확인할 수 없다
//
// "수록 자료에 없음"을 곧 "틀림"으로 보지 않는다 — 전 조문을 수록한 법령에서만 없음을 단정한다.
// 범위 인용은 양 끝만, 항·호는 대조하지 않으며 그 사실을 detailNote 로 알린다.
// ─────────────────────────────────────────────────────────────────────────────

import { editionLabel, findAnnex, findArticle, findLaw, loadLaws } from "../ontology/laws.js";
import type { LawBundle } from "../ontology/laws.js";

// ───── 상수 ─────
export type CitationOutcome = "confirmed" | "not_found" | "unverifiable";

export interface CitationResolution {
  outcome: CitationOutcome;
  /** 읽어 낸 법령의 정식 이름 (수록한 법령일 때) */
  law?: string;
  /** 읽어 낸 조문·별표·서식 — 예: "제45조의2", "별표 5", "별지 제42호" */
  ref?: string;
  /** 확인된 조문·별표의 제목 */
  title?: string;
  /** 대조한 판 — 예: "대통령령 제36404호 (시행 2026-06-09)" */
  edition?: string;
  /** 판정 사유 (confirmed 가 아닐 때) */
  reason?: string;
  /** 대조하지 않은 부분 — 범위의 중간 조문, 항·호 */
  detailNote?: string;
}

export interface InlineCitation extends CitationResolution {
  /** 문장에서 읽은 표기 */
  reference: string;
}

/** 인용 한 건 — 조문("제36조", "제37조의2", "§38"), 별표("별표 5"), 서식("별지 제42호서식") */
const CITATION_TOKEN =
  /제\s*(\d+)\s*조(?:\s*의\s*(\d+))?|§\s*(\d+)(?:\s*의\s*(\d+))?|(별표\s*\d+(?:\s*의\s*\d+)?)|(별지\s*제?\s*\d+(?:\s*의\s*\d+)?\s*호?(?:\s*서식)?)/g;
/** 항·호·목 표기 — 조문 단위로만 대조한다 */
const SUB_ITEM = /제?\s*\d+\s*(?:항|호)|[①-⑳]|[가-하]목/;
const RANGE_MARK = /부터|내지|[~∼～]/;
/** 괄호 안 부연(조문 제목 등) */
const PARENTHETICAL = /\([^()]*\)/g;
/** 인용 사이를 잇는 말 — 법령명이 아니다 */
const CONNECTOR_WORDS = new Set(["및", "또는", "부터", "까지", "내지", "와", "과", ",", "·", "ㆍ", "~", "∼", "～"]);
/** 법령처럼 보이는 낱말의 끝 */
const LAW_LIKE_END = /(법률|법|령|규칙|지침|고시|규정|조례|기준)$/;
/** 앞에 나온 법령을 가리키는 말 */
const SAME_LAW_WORDS = new Set(["같은", "동", "이", "위"]);
/** 한 낱말만으로는 어느 법령인지 정해지지 않는 이름 — 이 서버가 다루는 법령으로 읽되 앞 낱말을 살핀다 */
const GENERIC_NAMES = new Set(["법", "영", "시행령", "시행규칙", "규칙", "업무지침", "품질지침", "사업관리지침"]);
/** 법령명으로 읽어 볼 낱말 수의 상한 (가장 긴 수록 법령명이 6 낱말) */
const MAX_NAME_WORDS = 8;
const OUTCOME_RANK: Record<CitationOutcome, number> = { confirmed: 0, unverifiable: 1, not_found: 2 };
const NOTE_RANGE = "범위 인용은 양 끝 조문만 대조함(중간 조문은 대조하지 않음)";
const NOTE_SUB_ITEM = "항·호·목은 대조하지 않음(조문 단위로만 확인)";

const squash = (s: string): string => s.replace(/[\s「」『』·ㆍ]/g, "");

/** 조문 번호가 1번부터 빠짐없이 있는 법령 — 여기서만 "없는 조문"을 단정한다 */
let fullCoverage: Set<string> | null = null;
function isFullyBundled(law: LawBundle): boolean {
  if (!fullCoverage) {
    fullCoverage = new Set();
    for (const l of loadLaws()) {
      const numbers = new Set(l.articles.filter((a) => a.branch === 0).map((a) => a.number));
      if (numbers.size > 0 && numbers.size === Math.max(...numbers)) fullCoverage.add(l.id);
    }
  }
  return fullCoverage.has(law.id);
}

function articleLabel(number: string, branch?: string): string {
  return branch ? `제${number}조의${branch}` : `제${number}조`;
}

/** 수록한 법령 하나에서 조문·별표·서식을 찾는다 */
export function resolveInLaw(law: LawBundle, ref: string): CitationResolution {
  const edition = editionLabel(law);
  const compact = ref.replace(/\s+/g, "");
  if (/^별표|^별지/.test(compact)) {
    const kind = compact.startsWith("별표") ? "별표" : "별지";
    const m = /(\d+)(?:의(\d+))?/.exec(compact);
    const label = m ? (kind === "별표" ? `별표 ${m[1]}${m[2] ? `의${m[2]}` : ""}` : `별지 제${m[1]}호${m[2] ? `의${m[2]}` : ""}`) : ref;
    const annex = m ? findAnnex(law, `${kind} ${m[1]}${m[2] ? `의${m[2]}` : ""}`) : null;
    if (annex) return { outcome: "confirmed", law: law.name, ref: label, title: annex.title, edition };
    // 별표·서식은 법제처 원문의 목록 전체를 수록했다 — 목록에 없으면 없는 것으로 본다
    return {
      outcome: "not_found",
      law: law.name,
      ref: label,
      edition,
      reason: `${law.name}(${edition})의 별표·서식을 모두 수록했는데 '${label}' 이(가) 없음`,
    };
  }
  const m = /(\d+)(?:조?의(\d+))?/.exec(compact);
  if (!m || !m[1]) return { outcome: "unverifiable", law: law.name, reason: `'${ref}' 에서 조문 번호를 읽지 못함` };
  const label = articleLabel(m[1], m[2]);
  const article = findArticle(law, m[2] ? `${m[1]}의${m[2]}` : m[1]);
  if (article && !article.deleted) return { outcome: "confirmed", law: law.name, ref: label, title: article.title, edition };
  if (article?.deleted) {
    return { outcome: "not_found", law: law.name, ref: label, edition, reason: `${law.name} ${label} 는 삭제된 조문임 (${edition})` };
  }
  if (isFullyBundled(law)) {
    return {
      outcome: "not_found",
      law: law.name,
      ref: label,
      edition,
      reason: `${law.name}(${edition})는 전 조문을 수록했는데 '${label}' 가 없음 — 존재하지 않는 조문으로 판단`,
    };
  }
  return { outcome: "unverifiable", law: law.name, ref: label, reason: `${law.name} 는 일부만 수록해 '${label}' 의 실존 여부를 확인할 수 없음` };
}

interface NameReading {
  law: LawBundle | null;
  /** "시행령"·"법"처럼 한 낱말 이름을 이 서버가 다루는 법령으로 읽었는지 */
  generic?: string;
  /** 수록하지 않은 법령으로 보이는 이름 */
  foreign?: string;
  /** 읽지 못한 사유 (예: '같은 법'이 가리키는 법령을 모름) */
  unknown?: string;
  /** 법령명이 없어 앞 인용의 법령을 물려받아야 하는지 */
  inherit: boolean;
}

interface NameContext {
  law: LawBundle | null;
  foreign?: string;
}

/** 건설기술 진흥법과 그 하위 법령 — "같은 법 시행령"을 풀 때 쓴다 */
const FAMILY: Record<string, string> = { "": "btia", 시행령: "btia_decree", 영: "btia_decree", 시행규칙: "btia_rule", 규칙: "btia_rule" };
const FAMILY_IDS = new Set(Object.values(FAMILY));
/** 앞에 나온 법령을 가리키는 말 — "같은 법", "동법", "같은 법 시행령" */
const SAME_LAW = /(?:같은\s*법|동\s*법)(?:\s*(시행령|시행규칙))?$/;
/** 법률의 하위 법령을 가리키는 한 낱말 — 앞에 다른 법령을 말했으면 그 법령의 것으로 본다 */
const SUB_LAW_NAMES = new Set(["법", "영", "시행령", "시행규칙", "규칙"]);
const foreignBase = (name: string): string => name.replace(/\s*(시행령|시행규칙)$/, "");

/**
 * 인용 앞의 글자에서 법령명을 읽는다.
 * 끝에서부터 낱말을 늘려 가며 수록한 법령의 이름·다른 이름과 견준다(가장 긴 것을 고른다).
 *   - "같은 법"·"동법"은 앞 인용의 법령을 따른다.
 *   - "시행령"·"법" 같은 한 낱말 이름은 앞 낱말이나 앞 인용이 다른 법령이면 그 법령의 것으로 본다
 *     (예: "건설산업기본법 시행령" 은 수록한 시행령이 아니다).
 */
function readLawName(before: string, ctx: NameContext): NameReading {
  const words = before
    .replace(PARENTHETICAL, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[,.;:「『(]+|[,.;:」』)]+$/g, ""))
    .filter((w) => w !== "");
  // 끝에 붙은 항·호·연결어는 법령명이 아니다
  while (words.length > 0) {
    const last = words[words.length - 1] ?? "";
    if (CONNECTOR_WORDS.has(last) || new RegExp(`^(?:${SUB_ITEM.source})+$`).test(last)) words.pop();
    else break;
  }
  if (words.length === 0) return { law: null, inherit: true };

  const same = SAME_LAW.exec(words.slice(-3).join(" "));
  if (same) {
    const suffix = same[1] ?? "";
    if (ctx.foreign) return { law: null, foreign: `${foreignBase(ctx.foreign)}${suffix ? ` ${suffix}` : ""}`, inherit: false };
    if (ctx.law && FAMILY_IDS.has(ctx.law.id)) return { law: findLaw(FAMILY[suffix] ?? "btia"), inherit: false };
    return { law: null, unknown: "'같은 법'이 가리키는 법령을 알 수 없음", inherit: false };
  }

  for (let take = Math.min(MAX_NAME_WORDS, words.length); take >= 1; take -= 1) {
    const candidate = words.slice(-take).join(" ");
    const law = findLaw(candidate);
    if (!law) continue;
    if (take === 1 && GENERIC_NAMES.has(squash(candidate))) {
      const prev = words[words.length - 2];
      // 앞 낱말이 법령 이름처럼 끝나는데 수록한 법령이 아니면 그 법령의 하위 법령이다
      if (prev !== undefined && LAW_LIKE_END.test(prev) && !findLaw(prev)) {
        return { law: null, foreign: `${prev} ${candidate}`, inherit: false };
      }
      // 앞 인용이 다른 법령이었으면 "시행령"·"법"은 그 법령의 것으로 본다
      if (ctx.foreign && SUB_LAW_NAMES.has(squash(candidate))) {
        const base = foreignBase(ctx.foreign);
        return { law: null, foreign: candidate === "법" ? base : `${base} ${candidate}`, inherit: false };
      }
      return { law, generic: candidate, inherit: false };
    }
    return { law, inherit: false };
  }

  const last = words[words.length - 1] ?? "";
  if (LAW_LIKE_END.test(last)) {
    const prev = words[words.length - 2];
    const name = prev !== undefined && /(법|법률)$/.test(prev) ? `${prev} ${last}` : last;
    return { law: null, foreign: name, inherit: false };
  }
  return { law: null, inherit: true };
}

function tokenRef(t: RegExpMatchArray): string {
  const number = t[1] ?? t[3];
  const branch = t[2] ?? t[4];
  if (number) return articleLabel(number, branch);
  return (t[5] ?? t[6] ?? "").replace(/\s+/g, " ");
}

/**
 * 글에서 법령 인용을 모두 읽어 하나씩 판정한다.
 * 인용마다 바로 앞에 적힌 법령명을 따르고, 법령명 없이 이어 적은 인용은 앞 인용의 법령을 물려받는다.
 */
export function scanCitations(text: string): InlineCitation[] {
  const out: InlineCitation[] = [];
  let current: LawBundle | null = null;
  let currentForeign: string | undefined;
  let currentUnknown: string | undefined;
  let cursor = 0;
  let pendingRange = false;

  for (const t of text.matchAll(CITATION_TOKEN)) {
    const start = t.index ?? 0;
    const between = text.slice(cursor, start);
    const rangeBefore = RANGE_MARK.test(between.replace(PARENTHETICAL, " "));
    const reading = readLawName(between, { law: current, ...(currentForeign ? { foreign: currentForeign } : {}) });
    if (!reading.inherit) {
      current = reading.law;
      currentForeign = reading.foreign;
      currentUnknown = reading.unknown;
    }
    cursor = start + t[0].length;
    const ref = tokenRef(t);
    // 인용 바로 뒤에 붙은 항·호
    const after = text.slice(cursor, cursor + 12);
    const hasSubItem = new RegExp(`^\\s*(?:${SUB_ITEM.source})`).test(after);

    let resolved: CitationResolution;
    if (current) resolved = resolveInLaw(current, ref);
    else if (currentForeign) {
      resolved = { outcome: "unverifiable", ref, reason: `'${currentForeign}' 은(는) 수록하지 않은 법령 — 이 도구의 자료로는 확인할 수 없음 (법제처 원문 확인 필요)` };
    } else {
      resolved = { outcome: "unverifiable", ref, reason: currentUnknown ?? "어느 법령의 조문인지 적혀 있지 않음" };
    }

    const notes: string[] = [];
    if (reading.generic && reading.law) notes.push(`'${reading.generic}' 을(를) ${reading.law.name}(으)로 읽음`);
    if (rangeBefore && pendingRange) notes.push(NOTE_RANGE);
    if (hasSubItem) notes.push(NOTE_SUB_ITEM);
    if (rangeBefore && pendingRange && out.length > 0) {
      const prev = out[out.length - 1];
      if (prev && !(prev.detailNote ?? "").includes(NOTE_RANGE)) prev.detailNote = [prev.detailNote, NOTE_RANGE].filter(Boolean).join(" / ");
    }
    const lawName = current?.name ?? currentForeign ?? "";
    out.push({ reference: `${lawName} ${ref}`.trim(), ...resolved, ...(notes.length > 0 ? { detailNote: notes.join(" / ") } : {}) });
    pendingRange = true;
  }
  return out;
}

/**
 * "건설기술 진흥법 시행령 제89조" 같은 인용 한 줄을 읽어 판정한다.
 * 표기 전체를 법령명·조문·별표로 빠짐없이 읽었을 때만 confirmed 를 낸다. 인용이 여러 개면 가장 나쁜 결과를 낸다.
 */
export function resolveReference(reference: string): CitationResolution {
  const text = reference.trim();
  const found = scanCitations(text);
  if (found.length === 0) return { outcome: "unverifiable", reason: `'${reference}' 에서 법령명과 조문 번호를 읽지 못함` };

  let worst = found[0] as InlineCitation;
  for (const f of found) if (OUTCOME_RANK[f.outcome] > OUTCOME_RANK[worst.outcome]) worst = f;
  const notes = [...new Set(found.flatMap((f) => (f.detailNote ? f.detailNote.split(" / ") : [])))];

  // 마지막 인용 뒤에 읽지 못한 글자가 남으면(그 조문의 제목·항호·조사는 제외) 확인됨으로 하지 않는다
  const lastToken = [...text.matchAll(CITATION_TOKEN)].pop();
  const tail = lastToken ? text.slice((lastToken.index ?? 0) + lastToken[0].length) : "";
  const tailRest = tail
    .replace(PARENTHETICAL, " ")
    .replace(new RegExp(SUB_ITEM.source, "g"), " ")
    .replace(/서식|까지|[,.·ㆍ\s]/g, "")
    .trim();
  const lastTitle = found[found.length - 1]?.title ?? "";
  const tailIsTitle = tailRest !== "" && lastTitle !== "" && squash(lastTitle).includes(squash(tailRest));
  if (new RegExp(SUB_ITEM.source).test(tail) && !notes.includes(NOTE_SUB_ITEM)) notes.push(NOTE_SUB_ITEM);

  const { reference: _ignored, ...resolution } = worst;
  void _ignored;
  if (tailRest !== "" && !tailIsTitle && worst.outcome === "confirmed") {
    return { outcome: "unverifiable", reason: `'${reference}' 의 '${tailRest}' 부분을 읽지 못함` };
  }
  return { ...resolution, ...(notes.length > 0 ? { detailNote: notes.join(" / ") } : {}) };
}

/** 법령의 종류 — 강한 표현("반드시·법적으로")의 근거가 되는지 볼 때 쓴다 */
export function isStatute(lawName: string | undefined): boolean {
  if (!lawName) return false;
  const law = findLaw(lawName);
  return law !== null && (law.kind === "act" || law.kind === "decree" || law.kind === "rule");
}
