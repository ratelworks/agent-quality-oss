// ─────────────────────────────────────────────────────────────────────────────
// ks-lookup.ts — e나라 표준인증(국가기술표준원)의 표준 목록 검색으로 KS 표준명을 확인한다.
//
// KS 본문은 유료라 이 저장소에 없다. 번호·표준명·개정확인일 같은 목록 정보만 대조한다.
// ─────────────────────────────────────────────────────────────────────────────

// ───── 상수 ─────
const SEARCH_URL = "https://standard.go.kr/KSCI/standardIntro/getStandardSearchList.do";
const USER_AGENT = "agent-quality-oss standards check";
const TIMEOUT_MS = 60_000;

export interface KsListing {
  /** 예: "KS F 2308" */
  number: string;
  name: string;
  /** 최종 개정·확인일 (YYYY-MM-DD) */
  confirmedOn: string;
  abolished: boolean;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const clean = (html: string): string =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();

/** 번호 비교용 — 공백을 빼고 대문자로 */
export const compactKsNumber = (number: string): string => number.replace(/\s+/g, "").toUpperCase();

/** 표준명 비교용 — 공백·가운뎃점·줄표 차이를 무시한다 */
export const normalizeKsName = (name: string): string => name.replace(/[\s·ㆍ―—–\-－]/g, "");

/** 번호 하나를 검색해 같은 번호의 목록 행을 돌려준다 (폐지된 옛 표준이 함께 나올 수 있다) */
export async function lookupKs(number: string): Promise<KsListing[]> {
  const body = new URLSearchParams({ s_ksNo: compactKsNumber(number), pageIndex: "1", pageUnit: "50" });
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`표준 목록 응답 ${res.status} — ${number}`);
  const html = await res.text();
  const start = html.indexOf("<tbody");
  const end = html.indexOf("</tbody", start);
  if (start < 0 || end < 0) return [];
  const rows: KsListing[] = [];
  for (const tr of html.slice(start, end).match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? []).map(clean);
    if (cells.length < 4) continue;
    const listed = cells[1] ?? "";
    const base = listed.replace(/-?\s*폐지.*$/, "").trim();
    if (compactKsNumber(base) !== compactKsNumber(number)) continue;
    rows.push({
      number: base,
      // 목록 화면은 KS 인증 대상 표준의 이름 앞에 표시 기호(㉿)를 붙인다 — 표준명이 아니다
      name: (cells[2] ?? "").replace(/\s*\(폐지\)\s*$/, "").replace(/㉿/g, "").trim(),
      confirmedOn: cells[3] ?? "",
      abolished: /폐지/.test(listed) || /\(폐지\)/.test(cells[2] ?? ""),
    });
  }
  return rows;
}
