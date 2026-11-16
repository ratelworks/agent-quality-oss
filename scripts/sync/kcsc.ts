// ─────────────────────────────────────────────────────────────────────────────
// kcsc.ts — 국가건설기준센터(KCSC)의 공개 조회 주소에서 기준의 판(개정일)과 본문을 받는다.
//
// 국가건설기준(KCS·KDS) 본문은 이 저장소에 싣지 않는다. 노드에는 판·조항·짧은 인용 구절만 두고,
// 이 모듈로 공식 본문을 받아 그 구절이 실제로 있는지 대조한다(check-standards.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ───── 상수 ─────
const KCSC_API = "https://kcsc.re.kr/api/api/v1";
const USER_AGENT = "agent-quality-oss standards check";
const TIMEOUT_MS = 90_000;
/** 본문의 그림·수식 자리 — 글자가 아니라 대조에서 뺀다 */
const FIGURE_MARK = "\u0000";

export interface KcscEdition {
  /** 기준 코드 — 예: "KCS 14 20 10" */
  code: string;
  name: string;
  /** 개정일 (YYYY-MM-DD) — 판을 가리킨다 */
  revisedOn: string;
  docInfoSeq: number;
  current: boolean;
}

export interface KcscClause {
  order: number;
  /** 조항 제목 — 예: "3.5.3.2 압축강도에 의한 콘크리트의 품질 검사" */
  group: string;
  text: string;
  abolished: boolean;
}

interface InfoRow {
  doc_info_seq: number;
  kcsc_cd: string;
  doc_nm: string;
  rvsn_ymd: string;
  last_yn: string;
  use_yn: string;
}
interface ContentRow {
  cont_order: number | string;
  group_title: string | null;
  cont_label: string | null;
  table_content: string | null;
  full_content: string | null;
  cont_abolish_yn: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

/** 본문 HTML 을 글자로 편다. 표는 칸을 " | " 로, 줄을 줄바꿈으로 나눈다. */
export function htmlToText(html: string | null): string {
  if (!html) return "";
  const text = html
    .replace(/<img[^>]*>/gi, FIGURE_MARK)
    .replace(/<\/tr\s*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, " | ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** 대조용 — 공백·표 구분·그림 자리를 빼고 견준다 */
export function normalizeStandardText(text: string): string {
  return text.replace(new RegExp(`[\\s|${FIGURE_MARK}]`, "g"), "");
}

async function getJson<T>(url: string, cacheFile: string | null): Promise<T> {
  if (cacheFile && existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf8")) as T;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`KCSC 응답 ${res.status} — ${url}`);
  const body = await res.text();
  const parsed = JSON.parse(body) as T;
  if (cacheFile) writeFileSync(cacheFile, body);
  return parsed;
}

const cachePath = (dir: string | undefined, name: string): string | null => {
  if (!dir) return null;
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
};

/** 기준 코드의 판 목록 (오래된 것부터) */
export async function fetchEditions(code: string, cacheDir?: string): Promise<KcscEdition[]> {
  const url = `${KCSC_API}/tn_document_infos/by-kcsc_cd?kcsc_cd=${encodeURIComponent(code)}`;
  const data = await getJson<{ result?: InfoRow[] }>(url, cachePath(cacheDir, `info_${code.replace(/\s+/g, "_")}.json`));
  return (data.result ?? [])
    .filter((r) => r.use_yn !== "N")
    .map((r) => ({
      code: r.kcsc_cd,
      name: r.doc_nm,
      revisedOn: r.rvsn_ymd,
      docInfoSeq: r.doc_info_seq,
      current: r.last_yn === "Y",
    }))
    .sort((a, b) => a.revisedOn.localeCompare(b.revisedOn));
}

/** 한 판의 본문 (조항 순서대로) */
export async function fetchClauses(docInfoSeq: number, cacheDir?: string): Promise<KcscClause[]> {
  const url = `${KCSC_API}/tn-document-contents?doc_info_seq=${docInfoSeq}`;
  const data = await getJson<{ result?: ContentRow[] }>(url, cachePath(cacheDir, `content_${docInfoSeq}.json`));
  return (data.result ?? [])
    .map((r) => ({
      order: Number(r.cont_order),
      group: r.group_title ?? "",
      text: htmlToText(r.full_content) || `${r.cont_label ?? ""} ${r.table_content ?? ""}`.trim(),
      abolished: r.cont_abolish_yn === "Y",
    }))
    .sort((a, b) => a.order - b.order);
}
