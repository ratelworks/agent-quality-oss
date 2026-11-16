/**
 * sync-law-articles.ts — 수록한 법령 원문(src/ontology/laws)에서 품질관리 핵심 조문을 골라
 * taxonomy 조문 노드(src/taxonomy/graph/nodes/articles)를 만든다.
 *
 * 원문을 받는 일은 scripts/sync/sync-laws.ts 가 한다(전 조문·별표·서식). 이 스크립트는 그
 * 수록본에서 아래 TARGETS 의 조문만 노드로 옮긴다 — 항·호·목을 모두 싣는다.
 * 뒤이어 scripts/promote-taxonomy.ts 가 런타임 온톨로지 노드에 반영한다.
 *
 * 사용: tsx scripts/sync-law-articles.ts
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// ── 상수 ────────────────────────────────────────────────────────────
const ROOT = join(import.meta.dirname, "..");
const NODES_DIR = join(ROOT, "src/taxonomy/graph/nodes/articles");
const LAWS_DIR = join(ROOT, "src/ontology/laws");
const AMENDMENT_TAG = /<(?:개정|신설|전문개정|본조신설)\s+([^>]+)>/g;
const DATE = /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/g;

interface LawTarget {
  /** art:건진법:55 의 "건진법" */
  iriKey: string;
  actId: string;
  /** 수록본 id (src/ontology/laws/<id>.json) */
  bundleId: string;
  legislationType: "Act" | "Decree" | "Rule";
  articles: string[];
}

const TARGETS: LawTarget[] = [
  { iriKey: "건진법", actId: "act:건설기술진흥법", bundleId: "btia", legislationType: "Act", articles: ["55", "56", "57", "60"] },
  {
    iriKey: "건진법시행령",
    actId: "act:건설기술진흥법시행령",
    bundleId: "btia_decree",
    legislationType: "Decree",
    articles: ["89", "90", "91", "92", "93"],
  },
  {
    iriKey: "건진법시행규칙",
    actId: "act:건설기술진흥법시행규칙",
    bundleId: "btia_rule",
    legislationType: "Rule",
    articles: ["50", "51", "52", "53"],
  },
];

interface Bundle {
  name: string;
  promulgationNumber: string;
  effectiveDate: string;
  articles: Array<{ key: string; title: string; text: string }>;
}

/** 조문 전문 → 노드 본문. 항은 빈 줄로 나누고, 호·목(들여쓴 줄)은 앞 항에 붙인다. */
function bodyOf(title: string, key: string, text: string): string {
  const paragraphs: string[] = [];
  for (const line of text.split("\n")) {
    if (/^\s/.test(line) && paragraphs.length > 0) paragraphs[paragraphs.length - 1] += `\n${line}`;
    else paragraphs.push(line);
  }
  return [`**제${key.replace("의", "조의")}${key.includes("의") ? "" : "조"} (${title})**`, ...paragraphs].join("\n\n");
}

/** 본문의 개정·신설 표시에서 날짜를 모은다 (YYYY-MM-DD, 오름차순) */
function amendmentDates(text: string): string[] {
  const dates = new Set<string>();
  for (const tag of text.matchAll(AMENDMENT_TAG)) {
    for (const d of (tag[1] ?? "").matchAll(DATE)) {
      dates.add(`${d[1]}-${String(d[2]).padStart(2, "0")}-${String(d[3]).padStart(2, "0")}`);
    }
  }
  return [...dates].sort();
}

async function readPrevious(
  filePath: string,
): Promise<{ description?: string; _meta?: { fetchedAt?: string; verifiedAt?: string } } | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as { description?: string; _meta?: { fetchedAt?: string; verifiedAt?: string } };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  await mkdir(NODES_DIR, { recursive: true });
  for (const target of TARGETS) {
    const bundle = JSON.parse(await readFile(join(LAWS_DIR, `${target.bundleId}.json`), "utf8")) as Bundle;
    console.log(`\n=== ${bundle.name} — ${bundle.promulgationNumber} (시행 ${bundle.effectiveDate}) ===`);
    for (const no of target.articles) {
      const article = bundle.articles.find((a) => a.key === no);
      if (!article) throw new Error(`${bundle.name} 수록본에 제${no}조가 없습니다`);
      const body = bodyOf(article.title, article.key, article.text);
      const history = amendmentDates(article.text);
      const filePath = join(NODES_DIR, `${target.iriKey}-§${no}.jsonld`);
      // 본문이 그대로면 확인 날짜도 그대로 둔다 — 다시 돌려도 같은 결과가 나오게
      const previous = await readPrevious(filePath);
      const unchanged = previous?.description === body;
      const today = new Date().toISOString().slice(0, 10);
      const fetchedAt = (unchanged && previous?._meta?.fetchedAt) || today;
      const verifiedAt = (unchanged && previous?._meta?.verifiedAt) || today;
      const jsonld = {
        "@context": "../../context.jsonld",
        "@id": `art:${target.iriKey}:${article.key}`,
        "@type": ["Article", "Legislation"],
        articleNumber: article.key,
        title: article.title,
        partOf: target.actId,
        verificationStatus: "verified",
        legislationIdentifier: bundle.name,
        legislationDate: bundle.effectiveDate,
        legislationType: target.legislationType,
        legislationLegalForce: "InForce",
        jurisdiction: "KR",
        temporalCoverage: `${bundle.effectiveDate}/..`,
        description: body,
        amendmentHistory: history,
        latestAmendment: history[history.length - 1] ?? null,
        constructionRelevance: "high",
        userPersona: ["quality_manager", "supervisor", "site_manager"],
        userVisible: true,
        isAppendix: false,
        _meta: {
          publishedBy: "법제처 국가법령정보센터",
          sourceUrl: `https://www.law.go.kr/법령/${encodeURIComponent(bundle.name)}/제${article.key.replace("의", "조의")}${article.key.includes("의") ? "" : "조"}`,
          edition: bundle.promulgationNumber,
          fetchedAt,
          verifiedAt,
          licenseHint: "저작권법 §7 비보호 (자유 인용)",
          verifiedBy: "수록 원문(src/ontology/laws)에서 옮김",
          bodyLength: body.length,
        },
      };
      await writeFile(filePath, `${JSON.stringify(jsonld, null, 2)}\n`, "utf-8");
      console.log(`[article] 제${article.key}조 ${article.title} — ${body.length}자, 개정 ${history.length}회`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
