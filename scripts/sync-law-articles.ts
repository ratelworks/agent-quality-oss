/**
 * 법제처 lawService.do 에서 건설기술 진흥법 / 시행령 / 시행규칙 / 품질관리 업무지침의
 * 핵심 조문을 fetch 하여 nodes/articles/*.jsonld 와 quality-laws/*.md 를 생성한다.
 *
 * agent-safety-oss-mcp 의 sync-annexes.ts 패턴 차용.
 *
 * 환경변수:
 *   LAW_OC=YOUR_LAW_OC  (법제처 OpenAPI 등록 ID)
 *
 * 사용:
 *   tsx scripts/sync-law-articles.ts
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const OC = process.env.LAW_OC || "YOUR_LAW_OC";
const ROOT = join(import.meta.dirname, "..");
const NODES_DIR = join(ROOT, "src/taxonomy/graph/nodes/articles");
const LAWS_DIR = join(ROOT, "src/taxonomy/quality-laws");

interface LawTarget {
  iriKey: string;        // art:건진법:55 의 "건진법"
  actId: string;         // act:건설기술진흥법
  mst: string;
  lawId: string;
  lawName: string;
  lawSlug: string;       // 건설기술진흥법 (md 파일명용)
  effectiveDate: string;
  articles: string[];    // ["55", "56", "57", "60"]
}

const TARGETS: LawTarget[] = [
  {
    iriKey: "건진법",
    actId: "act:건설기술진흥법",
    mst: "276921",
    lawId: "001807",
    lawName: "건설기술 진흥법",
    lawSlug: "건설기술진흥법",
    effectiveDate: "2025-10-01",
    articles: ["55", "56", "57", "60"],
  },
  {
    iriKey: "건진법시행령",
    actId: "act:건설기술진흥법시행령",
    mst: "283649",
    lawId: "002111",
    lawName: "건설기술 진흥법 시행령",
    lawSlug: "건설기술진흥법시행령",
    effectiveDate: "2026-02-27",
    articles: ["89", "90", "91", "92", "93"],
  },
  {
    iriKey: "건진법시행규칙",
    actId: "act:건설기술진흥법시행규칙",
    mst: "279455",
    lawId: "006175",
    lawName: "건설기술 진흥법 시행규칙",
    lawSlug: "건설기술진흥법시행규칙",
    effectiveDate: "2025-10-31",
    articles: ["50", "51", "52", "53"],
  },
];

/** XML CDATA·태그 파싱 helper */
function unwrapCdata(s: string | undefined): string {
  if (!s) return "";
  return s
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .trim();
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  return m ? unwrapCdata(m[1]) : "";
}

function extractAllTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(unwrapCdata(m[1]));
  }
  return out;
}

/** 조문단위 XML 블록을 파싱 → article body Markdown 생성 */
function parseArticle(xmlBlock: string): {
  articleNumber: string;
  title: string;
  effectiveDate: string;
  amendmentHistory: string[];
  body: string;
} {
  const articleNumber = extractTag(xmlBlock, "조문번호");
  const title = extractTag(xmlBlock, "조문제목");
  const effectiveDate = extractTag(xmlBlock, "조문시행일자");
  const headLine = extractTag(xmlBlock, "조문내용");

  // 항 단위 파싱
  const hangs: string[] = [];
  const hangRe = /<항>([\s\S]*?)<\/항>/g;
  let hm: RegExpExecArray | null;
  while ((hm = hangRe.exec(xmlBlock)) !== null) {
    const hangBlock = hm[1] ?? "";
    const hangContent = extractTag(hangBlock, "항내용");
    if (hangContent) hangs.push(hangContent);
  }

  // 개정 이력 추출 (본문의 <개정 YYYY.M.D> 패턴)
  const amendmentSet = new Set<string>();
  const amendRe = /<개정\s+([^>]+)>/g;
  let am: RegExpExecArray | null;
  const fullText = headLine + "\n" + hangs.join("\n");
  while ((am = amendRe.exec(fullText)) !== null) {
    const raw = am[1] ?? "";
    const dates = raw.split(",").map((d) => d.trim().replace(/\./g, "-"));
    for (const d of dates) amendmentSet.add(d);
  }

  // body Markdown
  const lines: string[] = [];
  lines.push(`**제${articleNumber}조 (${title})**`);
  lines.push("");
  lines.push(headLine);
  for (const hang of hangs) {
    lines.push("");
    lines.push(hang);
  }

  return {
    articleNumber,
    title,
    effectiveDate: effectiveDate
      ? `${effectiveDate.slice(0, 4)}-${effectiveDate.slice(4, 6)}-${effectiveDate.slice(6, 8)}`
      : "",
    amendmentHistory: Array.from(amendmentSet).sort(),
    body: lines.join("\n"),
  };
}

/** 한 조문 fetch → article jsonld 작성 */
async function fetchArticle(target: LawTarget, joNo: string): Promise<{
  jsonld: object;
  bodyMd: string;
  parsed: ReturnType<typeof parseArticle>;
}> {
  const joPadded = joNo.padStart(4, "0");
  const url = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=law&type=XML&MST=${target.mst}&JO=${joPadded}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed ${target.iriKey} §${joNo}: ${res.status}`);
  const xml = await res.text();

  const blockMatch = xml.match(/<조문단위[^>]*>([\s\S]*?)<\/조문단위>/);
  if (!blockMatch) throw new Error(`조문단위 not found ${target.iriKey} §${joNo}`);
  const block = blockMatch[0];
  const parsed = parseArticle(block);

  const articleIri = `art:${target.iriKey}:${parsed.articleNumber}`;
  const sourceUrl = `https://www.law.go.kr/법령/${encodeURIComponent(target.lawName)}/제${parsed.articleNumber}조`;

  const jsonld = {
    "@context": "../../context.jsonld",
    "@id": articleIri,
    "@type": ["Article", "Legislation"],
    articleNumber: parsed.articleNumber,
    title: parsed.title,
    partOf: target.actId,
    verificationStatus: "verified",
    legislationIdentifier: target.lawName,
    legislationDate: parsed.effectiveDate || target.effectiveDate,
    legislationType: target.actId.endsWith("시행령")
      ? "Decree"
      : target.actId.endsWith("시행규칙")
      ? "Rule"
      : "Act",
    legislationLegalForce: "InForce",
    jurisdiction: "KR",
    temporalCoverage: `${parsed.effectiveDate || target.effectiveDate}/..`,
    description: parsed.body,
    amendmentHistory: parsed.amendmentHistory,
    latestAmendment: parsed.amendmentHistory[parsed.amendmentHistory.length - 1] || null,
    constructionRelevance: "high",
    userPersona: ["quality_manager", "supervisor", "site_manager"],
    userVisible: true,
    isAppendix: false,
    _meta: {
      publishedBy: "법제처 국가법령정보센터 (자동 sync)",
      sourceUrl,
      fetchedAt: new Date().toISOString().slice(0, 10),
      licenseHint: "저작권법 §7 비보호 (자유 인용)",
      verifiedAt: new Date().toISOString().slice(0, 10),
      verifiedBy: "법제처 lawService.do (자동 sync)",
      lawServiceMST: target.mst,
      lawServiceLawId: target.lawId,
      lawServiceJO: joPadded,
      bodyLength: parsed.body.length,
    },
  };

  return { jsonld, bodyMd: parsed.body, parsed };
}

/** quality-laws/{slug}.md 생성 */
async function writeLawMd(target: LawTarget, articles: { parsed: ReturnType<typeof parseArticle> }[]): Promise<void> {
  const lines: string[] = [];
  lines.push(`# ${target.lawName}`);
  lines.push("");
  lines.push(`> 시행일: ${target.effectiveDate}`);
  lines.push(`> 출처: 법제처 국가법령정보센터 (MST=${target.mst}, lawId=${target.lawId})`);
  lines.push(`> 라이선스: 저작권법 §7 비보호 (자유 인용)`);
  lines.push(`> 본 파일은 자동 sync — 직접 편집 금지. \`tsx scripts/sync-law-articles.ts\` 로 갱신.`);
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const a of articles) {
    lines.push(a.parsed.body);
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  const mdPath = join(LAWS_DIR, `${target.lawSlug}.md`);
  await writeFile(mdPath, lines.join("\n"), "utf-8");
  console.log(`[md] ${mdPath}`);
}

async function main(): Promise<void> {
  await mkdir(NODES_DIR, { recursive: true });
  await mkdir(LAWS_DIR, { recursive: true });

  for (const target of TARGETS) {
    console.log(`\n=== ${target.lawName} ===`);
    const articleResults: { parsed: ReturnType<typeof parseArticle> }[] = [];
    for (const joNo of target.articles) {
      try {
        const { jsonld, parsed } = await fetchArticle(target, joNo);
        const filePath = join(NODES_DIR, `${target.iriKey}-§${joNo}.jsonld`);
        await writeFile(filePath, JSON.stringify(jsonld, null, 2), "utf-8");
        console.log(`[article] ${filePath}`);
        articleResults.push({ parsed });
        await new Promise((r) => setTimeout(r, 250)); // rate limit
      } catch (e) {
        console.error(`[error] ${target.iriKey} §${joNo}: ${(e as Error).message}`);
      }
    }
    if (articleResults.length > 0) {
      await writeLawMd(target, articleResults);
    }
  }
  console.log("\n[done] sync-law-articles.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
