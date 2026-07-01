/**
 * 행정규칙(admrul) sync — 품질관리 관련 국토부 고시의 조문·별표를 taxonomy staging 에 저장.
 *
 * 대상 (NOTICES):
 *   1. 건설공사 품질관리 업무지침 (2025-311호) — 품질관리 SSoT 고시
 *   2. 건설공사 사업관리방식 검토기준 및 업무수행지침 — 감리·검측·자재 서식(별지16~59 중 품질 직결)
 *
 * 출력:
 *   - quality-laws/{slug}.md (전문 — 조문 + 별표 목록)
 *   - nodes/articles/{iriKey}-§{N}.jsonld (targetArticles — 원문 포함, verified)
 *   - nodes/annexes/{iriKey}-{별표N|별지N}.jsonld (targetAnnexes — 본문 포함, verified)
 *
 * 환경변수: LAW_OC (법제처 open API OC)
 * 사용: LAW_OC=xxx tsx scripts/sync-quality-notice.ts
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const OC = process.env.LAW_OC || "YOUR_LAW_OC";
const ROOT = join(import.meta.dirname, "..");
const ARTICLES_DIR = join(ROOT, "src/taxonomy/graph/nodes/articles");
const ANNEXES_DIR = join(ROOT, "src/taxonomy/graph/nodes/annexes");
const LAWS_DIR = join(ROOT, "src/taxonomy/quality-laws");

/** 별표 본문 저장 상한 (초과 시 절단 + sourceUrl 안내). 대형 별표(별표2 502KB 등) 그래프 비대 방지. */
const ANNEX_BODY_MAX = 20_000;

interface NoticeTarget {
  iriKey: string;
  actId: string;
  admRulId: string;
  name: string;
  slug: string;
  effectiveDate: string;
  noticeNumber: string;
  /** 품질 직결 조문 (현행 조문 번호 기준 — 편별 리셋 없음 검증 완료 2026-07-02) */
  targetArticles: string[];
  /** 품질 직결 별표·별지 라벨 (예: "별표1", "별지13의2"). 비어 있으면 별표 노드 생성 안 함 */
  targetAnnexes: string[];
  /** master-index critical 표기 (라벨 → priority) */
  annexPriority?: Record<string, string>;
}

const NOTICES: NoticeTarget[] = [
  {
    iriKey: "품질지침",
    actId: "act:건설공사품질관리업무지침",
    admRulId: "2100000260210",
    name: "건설공사 품질관리 업무지침",
    slug: "건설공사품질관리업무지침",
    effectiveDate: "2025-06-12",
    noticeNumber: "국토교통부고시 제2025-311호",
    // 시공자 QC·감리 실무 직결 조문 (대행업자 평가 §17~30·공장인증 §46~54 제외)
    targetArticles: [
      "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16",
      "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41",
      "42", "43", "45", "45의2", "45의3",
    ],
    // 시공자·감리 실무 직결 별표·별지 (대행업자 평가·공장인증 서식 제외)
    targetAnnexes: [
      "별표1", // 품질관리계획서 작성기준 (§7)
      "별표2", // 건설공사 품질시험기준 (§8) — 온톨로지 시험종목의 원천
      "별표3", // 품질관리 적절성 확인기준 및 요령 (§10)
      "별표4", // 품질시험비 산출 단위량 기준 (§11)
      "별표5", // 품질관리규정 작성기준 (§13)
      "별표9", // 혼화재를 사용한 레미콘의 품질관리 (§38)
      "별지1", // 품질관리계획서 검토·승인서
      "별지2", // 품질관리 적절성 확인점검표
      "별지8", // 레미콘공장 사전(정기)점검표
      "별지9", // 아스콘공장 사전(정기)점검표
      "별지10", // 레미콘(아스콘) 공장 정기점검 결과 보고
      "별지11", // 레미콘 시공품질관리 점검표
      "별지12", // 아스콘 시공품질관리 점검표
      "별지13", // 불량자재폐기 확약서
      "별지13의2", // 철강 자재 점검표
    ],
    annexPriority: {
      별표1: "critical",
      별표2: "critical",
      별표3: "critical",
      별지2: "high",
      별지11: "high",
      별지12: "high",
    },
  },
  {
    iriKey: "사업관리지침",
    actId: "act:건설공사사업관리방식검토기준및업무수행지침",
    admRulId: "2100000256028",
    name: "건설공사 사업관리방식 검토기준 및 업무수행지침",
    slug: "건설공사사업관리방식검토기준및업무수행지침",
    effectiveDate: "2025-03-05",
    noticeNumber: "국토교통부고시 (현행)",
    targetArticles: [], // 조문은 방대(감리 전반) — 품질 서식만 1차 대상
    // 품질·검측·자재 직결 별지 (설계단계·기성·안전 서식 제외)
    targetAnnexes: [
      "별지16", // 품질시험계획
      "별지17", // 품질시험·검사성과 총괄표
      "별지18", // 품질시험·검사실적 보고서
      "별지19", // 검측대장
      "별지34", // 품질시험·검사대장
      "별지35", // 구조물별 콘크리트 타설현황
      "별지36", // 검측요청·결과 통보내용
      "별지37", // 자재 공급원 승인 요청·결과통보 내용 (master-index critical)
      "별지38", // 주요자재 검사 및 수불부
      "별지41", // 콘크리트 구조물 균열관리 현황
      "별지45", // 검측내용 실적종합
      "별지46", // 품질시험·검사실적 종합
      "별지47", // 주요자재 관리실적 종합
      "별지56", // 품질시험·검사대장 (감독자용)
      "별지59", // 주요자재검사부
    ],
    annexPriority: {
      별지37: "critical",
      별지19: "high",
      별지34: "high",
      별지36: "high",
    },
  },
];

interface NoticeArticle {
  number: string;
  title: string;
  body: string;
  /** 소속 편 (예: "제2편 건설공사 품질관리") — 편제 없는 고시는 "" */
  part: string;
}

/** 조문내용 list 를 추출하고 "제N조(제목) 본문" 패턴으로 파싱 (제N조의M 지원, 편 헤더 추적) */
function parseArticles(xml: string): NoticeArticle[] {
  const re = /<조문내용><!\[CDATA\[([\s\S]*?)\]\]><\/조문내용>/g;
  const out: NoticeArticle[] = [];
  let currentPart = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const text = (m[1] ?? "").trim();
    // 편 헤더 항목 (예: "제2편 건설공사 품질관리")
    const partHead = text.match(/^(제\d+편)\s+([^\n<]{1,40})/);
    if (partHead && partHead[1] && !text.includes("조(")) {
      currentPart = `${partHead[1]} ${(partHead[2] ?? "").trim()}`;
      continue;
    }
    const head = text.match(/^제(\d+)조(?:의(\d+))?\s*\(([^)]+)\)\s*([\s\S]*)$/);
    if (head && head[1] && head[3]) {
      const number = head[2] ? `${head[1]}의${head[2]}` : head[1];
      out.push({ number, title: head[3].trim(), body: text, part: currentPart });
    }
  }
  return out;
}

interface AnnexUnit {
  label: string; // "별표1" | "별지13의2"
  kind: string; // "별표" | "별지"
  num: string;
  sub: string;
  title: string;
  body: string;
  hwpUrl?: string;
  pdfUrl?: string;
}

/** <별표단위> 파서 — sync-annexes.ts(법령용)와 동일 구조 (admrul 도 동일 스키마 확인 2026-07-02) */
function parseAnnexUnits(xml: string): AnnexUnit[] {
  const out: AnnexUnit[] = [];
  for (const m of xml.matchAll(/<별표단위[^>]*>([\s\S]*?)<\/별표단위>/g)) {
    const inner = m[1] ?? "";
    const get = (tag: string): string => {
      const r = inner.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`));
      return r && r[1] ? r[1].trim() : "";
    };
    const num = get("별표번호").replace(/^0+/, "") || "0";
    const subRaw = get("별표가지번호").replace(/^0+/, "");
    const kind = get("별표구분");
    const title = get("별표제목");

    const bodyParts: string[] = [];
    const bodyMatch = inner.match(/<별표내용>([\s\S]*?)<\/별표내용>/);
    if (bodyMatch && bodyMatch[1]) {
      for (const cm of bodyMatch[1].matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
        if (cm[1]) bodyParts.push(cm[1]);
      }
    }
    const hwpLink = inner.match(/<별표서식파일링크>([^<]+)<\/별표서식파일링크>/);
    const pdfLink = inner.match(/<별표서식PDF파일링크>([^<]+)<\/별표서식PDF파일링크>/);

    const label = subRaw ? `${kind}${num}의${subRaw}` : `${kind}${num}`;
    out.push({
      label,
      kind,
      num,
      sub: subRaw,
      title,
      body: bodyParts.join("\n").trim(),
      hwpUrl: hwpLink && hwpLink[1] ? `https://www.law.go.kr${hwpLink[1]}` : undefined,
      pdfUrl: pdfLink && pdfLink[1] ? `https://www.law.go.kr${pdfLink[1]}` : undefined,
    });
  }
  return out;
}

/** 별표 본문 절단 (상한 초과 시) */
function truncateBody(body: string, sourceUrl: string): { text: string; truncated: boolean } {
  if (body.length <= ANNEX_BODY_MAX) return { text: body, truncated: false };
  return {
    text:
      body.slice(0, ANNEX_BODY_MAX) +
      `\n\n… [이하 생략 — 전문 ${body.length.toLocaleString()}자. 원문: ${sourceUrl}]`,
    truncated: true,
  };
}

async function syncNotice(notice: NoticeTarget): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const url = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=admrul&type=XML&ID=${notice.admRulId}`;
  console.log(`\n[fetch] ${notice.name}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} (${notice.name})`);
  const xml = await res.text();
  console.log(`  [fetched] ${xml.length.toLocaleString()} bytes`);

  const articles = parseArticles(xml);
  const annexes = parseAnnexUnits(xml);
  console.log(`  [parsed] ${articles.length} articles, ${annexes.length} annex units`);

  const sourceUrlBase = `https://www.law.go.kr/행정규칙/${encodeURIComponent(notice.name)}`;

  // ── 1. Markdown 전문 (조문 + 별표 목록) ──
  const lines: string[] = [];
  lines.push(`# ${notice.name}`);
  lines.push("");
  lines.push(`> 시행일: ${notice.effectiveDate}`);
  lines.push(`> ${notice.noticeNumber}`);
  lines.push(`> 출처: 법제처 국가법령정보센터 (admRulId=${notice.admRulId})`);
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
    lines.push("## 별표·별지");
    lines.push("");
    for (const ann of annexes) {
      const linkPart = ann.hwpUrl ? ` (${ann.hwpUrl})` : "";
      lines.push(`- ${ann.label}: ${ann.title}${linkPart}`);
    }
  }
  const mdPath = join(LAWS_DIR, `${notice.slug}.md`);
  await writeFile(mdPath, lines.join("\n"), "utf-8");
  console.log(`  [md] ${mdPath}`);

  // ── 2. 조문 노드 (targetArticles) ──
  const articleMap = new Map(articles.map((a) => [a.number, a]));
  let artCount = 0;
  for (const num of notice.targetArticles) {
    const a = articleMap.get(num);
    if (!a) {
      console.error(`  [miss] 제${num}조 not parsed`);
      continue;
    }
    const articleIri = `art:${notice.iriKey}:${num}`;
    const jsonld = {
      "@context": "../../context.jsonld",
      "@id": articleIri,
      "@type": ["Article", "Legislation"],
      articleNumber: num,
      title: a.title,
      partOf: notice.actId,
      verificationStatus: "verified",
      legislationIdentifier: notice.name,
      legislationDate: notice.effectiveDate,
      legislationType: "OfficialNotice",
      legislationLegalForce: "InForce",
      jurisdiction: "KR",
      temporalCoverage: `${notice.effectiveDate}/..`,
      description: a.body,
      ...(a.part && { partLabel: a.part }),
      constructionRelevance: "high",
      userPersona: ["quality_manager", "supervisor", "site_manager"],
      userVisible: true,
      isAppendix: false,
      _meta: {
        publishedBy: "법제처 국가법령정보센터 (자동 sync)",
        sourceUrl: `${sourceUrlBase}/제${num}조`,
        fetchedAt: today,
        licenseHint: "저작권법 §7 비보호 (자유 인용)",
        verifiedAt: today,
        verifiedBy: "법제처 admrul lawService.do (자동 sync)",
        admRulId: notice.admRulId,
        noticeNumber: notice.noticeNumber,
        bodyLength: a.body.length,
      },
    };
    const filePath = join(ARTICLES_DIR, `${notice.iriKey}-§${num}.jsonld`);
    await writeFile(filePath, JSON.stringify(jsonld, null, 2) + "\n", "utf-8");
    artCount++;
  }
  console.log(`  [articles] ${artCount}/${notice.targetArticles.length} 노드 저장`);

  // ── 3. 별표·별지 노드 (targetAnnexes) ──
  const annexMap = new Map(annexes.map((a) => [a.label, a]));
  let annCount = 0;
  for (const label of notice.targetAnnexes) {
    const a = annexMap.get(label);
    if (!a) {
      console.error(`  [miss] ${label} not parsed`);
      continue;
    }
    const iri = `annex:${notice.iriKey}:${label}`;
    const { text: bodyText, truncated } = truncateBody(a.body, sourceUrlBase);
    const priority = notice.annexPriority?.[label];
    const jsonld = {
      "@context": "../../context.jsonld",
      "@id": iri,
      "@type": ["Annex"],
      annexNumber: a.sub ? `${a.num}-${a.sub}` : a.num,
      annexKind: a.kind,
      title: a.title,
      partOf: notice.actId,
      verificationStatus: "verified",
      legislationIdentifier: notice.name,
      jurisdiction: "KR",
      constructionRelevance: priority ?? "medium",
      userVisible: true,
      isAppendix: true,
      description: bodyText || a.title,
      _meta: {
        publishedBy: "법제처 국가법령정보센터 (자동 sync)",
        sourceUrl: sourceUrlBase,
        fetchedAt: today,
        verifiedAt: today,
        verifiedBy: "법제처 admrul lawService.do <별표단위> 자동 sync",
        admRulId: notice.admRulId,
        noticeNumber: notice.noticeNumber,
        bodyLength: a.body.length,
        ...(truncated && { bodyTruncated: true }),
        ...(a.hwpUrl && { hwpDownloadUrl: a.hwpUrl }),
        ...(a.pdfUrl && { pdfDownloadUrl: a.pdfUrl }),
        ...(priority && { priority }),
        licenseHint:
          "본문(기준·작성기준)은 저작권법 §7 비보호 (자유 인용). 별지 서식 원본 재배포는 공공누리 4유형 — locator 만 보관.",
      },
    };
    const fname = `${notice.iriKey}-${label}.jsonld`;
    await writeFile(join(ANNEXES_DIR, fname), JSON.stringify(jsonld, null, 2) + "\n", "utf-8");
    annCount++;
  }
  console.log(`  [annexes] ${annCount}/${notice.targetAnnexes.length} 노드 저장`);
}

async function main(): Promise<void> {
  await mkdir(ARTICLES_DIR, { recursive: true });
  await mkdir(ANNEXES_DIR, { recursive: true });
  await mkdir(LAWS_DIR, { recursive: true });

  for (const notice of NOTICES) {
    await syncNotice(notice);
  }

  console.log("\n[done] sync-quality-notice.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
