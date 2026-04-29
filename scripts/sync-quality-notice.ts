/**
 * 건설공사 품질관리 업무지침 (국토부 고시 2025-311) fetch.
 * 행정규칙 admrul API 사용. 본문 포맷이 법령과 달라 전용 파서.
 *
 * 출력:
 *   - quality-laws/건설공사품질관리업무지침.md (전문)
 *   - nodes/articles/품질지침-§{N}.jsonld (critical/high articles)
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const OC = process.env.LAW_OC || "YOUR_LAW_OC";
const ROOT = join(import.meta.dirname, "..");
const NODES_DIR = join(ROOT, "src/taxonomy/graph/nodes/articles");
const LAWS_DIR = join(ROOT, "src/taxonomy/quality-laws");

const NOTICE = {
  iriKey: "품질지침",
  actId: "act:건설공사품질관리업무지침",
  admRulId: "2100000260210",
  admRulCode: "48782",
  name: "건설공사 품질관리 업무지침",
  slug: "건설공사품질관리업무지침",
  effectiveDate: "2025-06-12",
  noticeNumber: "국토교통부고시 제2025-311호",
  /** master-index 의 critical/high articles */
  targetArticles: ["5", "6", "7", "8", "10"],
};

function unwrapCdata(s: string): string {
  return s.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim();
}

interface NoticeArticle {
  number: string;
  title: string;
  body: string;
}

/** 조문내용 list 를 추출하고 "제N조(제목) 본문" 패턴으로 파싱 */
function parseArticles(xml: string): NoticeArticle[] {
  const re = /<조문내용><!\[CDATA\[([\s\S]*?)\]\]><\/조문내용>/g;
  const out: NoticeArticle[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const text = m[1].trim();
    // "제N조(제목) ..." 패턴
    const head = text.match(/^제(\d+)조(?:의\d+)?\s*\(([^)]+)\)\s*([\s\S]*)$/);
    if (head) {
      out.push({
        number: head[1],
        title: head[2].trim(),
        body: text,
      });
    }
  }
  return out;
}

interface AnnexEntry {
  number: string;
  title: string;
  fileLink: string;
}

function parseAnnexes(xml: string): AnnexEntry[] {
  const re = /<별표(?:가지번호)?[\s\S]*?<별표번호[^>]*>([\s\S]*?)<\/별표번호>[\s\S]*?<별표제목><!\[CDATA\[([\s\S]*?)\]\]><\/별표제목>(?:[\s\S]*?<별표서식파일링크>([\s\S]*?)<\/별표서식파일링크>)?/g;
  const out: AnnexEntry[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push({
      number: m[1].trim(),
      title: m[2].trim(),
      fileLink: m[3]?.trim() || "",
    });
  }
  return out;
}

async function main(): Promise<void> {
  await mkdir(NODES_DIR, { recursive: true });
  await mkdir(LAWS_DIR, { recursive: true });

  const url = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=admrul&type=XML&ID=${NOTICE.admRulId}`;
  console.log(`[fetch] ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const xml = await res.text();
  console.log(`[fetched] ${xml.length} bytes`);

  const articles = parseArticles(xml);
  const annexes = parseAnnexes(xml);
  console.log(`[parsed] ${articles.length} articles, ${annexes.length} annexes`);

  // Markdown 전문
  const lines: string[] = [];
  lines.push(`# ${NOTICE.name}`);
  lines.push("");
  lines.push(`> 시행일: ${NOTICE.effectiveDate}`);
  lines.push(`> ${NOTICE.noticeNumber}`);
  lines.push(`> 출처: 법제처 국가법령정보센터 (admRulId=${NOTICE.admRulId})`);
  lines.push(`> 라이선스: 저작권법 §7 비보호 (자유 인용)`);
  lines.push(`> 본 파일은 자동 sync — 직접 편집 금지. \`tsx scripts/sync-quality-notice.ts\` 로 갱신.`);
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const a of articles) {
    lines.push(`## 제${a.number}조 (${a.title})`);
    lines.push("");
    lines.push(a.body);
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  if (annexes.length > 0) {
    lines.push("## 별표");
    lines.push("");
    for (const ann of annexes) {
      const linkPart = ann.fileLink ? ` (https://www.law.go.kr${ann.fileLink})` : "";
      lines.push(`- 별표 ${ann.number}: ${ann.title}${linkPart}`);
    }
  }
  const mdPath = join(LAWS_DIR, `${NOTICE.slug}.md`);
  await writeFile(mdPath, lines.join("\n"), "utf-8");
  console.log(`[md] ${mdPath}`);

  // critical articles → article 노드
  const articleMap = new Map(articles.map((a) => [a.number, a]));
  for (const num of NOTICE.targetArticles) {
    const a = articleMap.get(num);
    if (!a) {
      console.error(`[miss] 제${num}조 not parsed`);
      continue;
    }
    const articleIri = `art:${NOTICE.iriKey}:${num}`;
    const sourceUrl = `https://www.law.go.kr/행정규칙/${encodeURIComponent(NOTICE.name)}/(${NOTICE.admRulCode})/제${num}조`;
    const jsonld = {
      "@context": "../../context.jsonld",
      "@id": articleIri,
      "@type": ["Article", "Legislation"],
      articleNumber: num,
      title: a.title,
      partOf: NOTICE.actId,
      verificationStatus: "verified",
      legislationIdentifier: NOTICE.name,
      legislationDate: NOTICE.effectiveDate,
      legislationType: "OfficialNotice",
      legislationLegalForce: "InForce",
      jurisdiction: "KR",
      temporalCoverage: `${NOTICE.effectiveDate}/..`,
      description: `**제${num}조 (${a.title})**\n\n${a.body}`,
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
        verifiedBy: "법제처 admrul lawService.do (자동 sync)",
        admRulId: NOTICE.admRulId,
        admRulCode: NOTICE.admRulCode,
        noticeNumber: NOTICE.noticeNumber,
        bodyLength: a.body.length,
      },
    };
    const filePath = join(NODES_DIR, `${NOTICE.iriKey}-§${num}.jsonld`);
    await writeFile(filePath, JSON.stringify(jsonld, null, 2), "utf-8");
    console.log(`[article] ${filePath}`);
  }

  console.log("\n[done] sync-quality-notice.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
