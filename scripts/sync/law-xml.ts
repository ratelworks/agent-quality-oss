/**
 * law-xml.ts — 법제처 국가법령정보센터 OpenAPI 의 법령·행정규칙 XML 을 조문·별표 단위로 푼다.
 *
 * 조문은 항·호·목까지 모두 싣는다(각 호에 수치·대상이 들어 있는 조문이 많다).
 * 별표·별지 서식은 본문 글자를 그대로 싣되 줄 끝 공백과 연속 빈 줄만 줄인다.
 */

// ── 상수 ────────────────────────────────────────────────────────────
const INDENT_ITEM = "  ";
const INDENT_SUBITEM = "    ";
const DELETED = /^제\d+조(의\d+)?\s*삭제/;
const ADMRUL_ARTICLE = /^제(\d+)조(?:의(\d+))?\s*(?:\(([^)]*)\))?/;

export type LawKind = "act" | "decree" | "rule" | "notice";

export interface LawArticle {
  /** 조문 번호 표기 — "89", "45의2" */
  key: string;
  number: number;
  branch: number;
  title: string;
  /** 이 조문이 속한 편·장·절 */
  heading: string;
  /** 조문 전문 (항·호·목 포함, 한 줄에 한 단위) */
  text: string;
  deleted: boolean;
}

export interface LawAnnex {
  kind: "별표" | "별지";
  /** "5", "13의2" */
  key: string;
  number: number;
  branch: number;
  title: string;
  text: string;
}

export interface ParsedLaw {
  name: string;
  /** 공포(발령) 번호 — "대통령령 제36404호", "국토교통부고시 제2026-360호" */
  promulgationNumber: string;
  promulgationDate: string;
  effectiveDate: string;
  revisionType: string;
  articles: LawArticle[];
  annexes: LawAnnex[];
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "");
}

function tag(xml: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? stripCdata(m[1] ?? "").trim() : "";
}

function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1] ?? "");
  return out;
}

function isoDate(yyyymmdd: string): string {
  return /^\d{8}$/.test(yyyymmdd) ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}` : yyyymmdd;
}

/** 여러 줄 글자를 줄마다 다듬어 들여쓰기를 붙인다 */
function indented(text: string, indent: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `${indent}${l}`);
}

function articleKey(number: number, branch: number): string {
  return branch > 0 ? `${number}의${branch}` : String(number);
}

/**
 * 별표·서식 본문 — 줄 끝 공백을 지운다. 원문은 표의 줄마다 빈 줄이 끼어 오는데(줄의 절반 이상이
 * 빈 줄), 그런 본문은 빈 줄을 모두 지우고 그 밖의 본문은 연속 빈 줄만 하나로 줄인다.
 */
function annexText(raw: string): string {
  const lines = stripCdata(raw)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""));
  const blank = lines.filter((l) => l === "").length;
  if (blank * 3 >= lines.length) return lines.filter((l) => l !== "").join("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (line === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

function parseAnnexes(xml: string): LawAnnex[] {
  return blocks(xml, "별표단위").map((b) => {
    const number = Number(tag(b, "별표번호"));
    const branch = Number(tag(b, "별표가지번호") || "0");
    const sort = tag(b, "별표구분");
    const body = /<별표내용[^>]*>([\s\S]*?)<\/별표내용>/.exec(b)?.[1] ?? "";
    return {
      kind: sort === "별표" ? "별표" : "별지",
      key: articleKey(number, branch),
      number,
      branch,
      title: tag(b, "별표제목"),
      text: annexText(body),
    };
  });
}

/** 법률·시행령·시행규칙 (target=law) */
export function parseLawXml(xml: string): ParsedLaw {
  const info = /<기본정보>([\s\S]*?)<\/기본정보>/.exec(xml)?.[1] ?? "";
  const articles: LawArticle[] = [];
  let heading = "";
  for (const unit of blocks(xml, "조문단위")) {
    const head = tag(unit, "조문내용");
    if (tag(unit, "조문여부") !== "조문") {
      heading = head.replace(/\s+/g, " ").trim();
      continue;
    }
    const number = Number(tag(unit, "조문번호"));
    const branch = Number(tag(unit, "조문가지번호") || "0");
    const lines: string[] = indented(head, "");
    for (const para of blocks(unit, "항")) {
      const paraText = tag(para, "항내용");
      if (paraText) lines.push(...indented(paraText, ""));
      for (const item of blocks(para, "호")) {
        lines.push(...indented(tag(item, "호내용"), INDENT_ITEM));
        for (const sub of blocks(item, "목")) lines.push(...indented(tag(sub, "목내용"), INDENT_SUBITEM));
      }
    }
    const text = lines.join("\n");
    articles.push({
      key: articleKey(number, branch),
      number,
      branch,
      title: tag(unit, "조문제목"),
      heading,
      text,
      deleted: DELETED.test(text),
    });
  }
  const sort = /<법종구분[^>]*>([^<]*)<\/법종구분>/.exec(info)?.[1]?.trim() ?? "";
  return {
    name: tag(info, "법령명_한글"),
    promulgationNumber: `${sort} 제${Number(tag(info, "공포번호"))}호`,
    promulgationDate: isoDate(tag(info, "공포일자")),
    effectiveDate: isoDate(tag(info, "시행일자")),
    revisionType: tag(info, "제개정구분"),
    articles,
    annexes: parseAnnexes(xml),
  };
}

/** 고시·훈령 (target=admrul) — 조문이 글자 덩어리로 온다 */
export function parseAdmRulXml(xml: string): ParsedLaw {
  const info = /<행정규칙기본정보>([\s\S]*?)<\/행정규칙기본정보>/.exec(xml)?.[1] ?? "";
  const articles: LawArticle[] = [];
  let heading = "";
  const body = xml.split(/<부칙[\s>]/)[0] ?? xml;
  for (const raw of blocks(body, "조문내용")) {
    const text = stripCdata(raw)
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+$/, ""))
      .filter((l) => l.trim() !== "")
      .join("\n")
      .trim();
    const m = ADMRUL_ARTICLE.exec(text);
    if (!m) {
      heading = text.replace(/\s+/g, " ");
      continue;
    }
    const number = Number(m[1]);
    const branch = Number(m[2] ?? "0");
    articles.push({
      key: articleKey(number, branch),
      number,
      branch,
      title: (m[3] ?? "").trim(),
      heading,
      text,
      deleted: DELETED.test(text),
    });
  }
  return {
    name: tag(info, "행정규칙명"),
    promulgationNumber: `${tag(info, "소관부처명")}${tag(info, "행정규칙종류")} 제${tag(info, "발령번호")}호`,
    promulgationDate: isoDate(tag(info, "발령일자")),
    effectiveDate: isoDate(tag(info, "시행일자")),
    revisionType: tag(info, "제개정구분명"),
    articles,
    annexes: parseAnnexes(xml),
  };
}

/** 조문 번호가 1번부터 빠짐없이 이어지는지 본다 — 빠진 번호 목록을 돌려준다 */
export function missingArticleNumbers(articles: LawArticle[]): number[] {
  const present = new Set(articles.map((a) => a.number));
  const max = Math.max(0, ...present);
  const missing: number[] = [];
  for (let n = 1; n <= max; n += 1) if (!present.has(n)) missing.push(n);
  return missing;
}
