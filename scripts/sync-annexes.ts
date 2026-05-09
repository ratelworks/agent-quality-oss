#!/usr/bin/env tsx
/**
 * sync-annexes.ts
 *
 * 법제처 lawService.do 응답의 <별표단위> 추출 → annex 노드 본문 sync.
 * agent-safety-oss-mcp 의 sync-annexes.ts 패턴 차용.
 *
 * 1차 범위 (가장 중요한 데이터):
 *   - 건설기술 진흥법 시행규칙 (MST=279455) — 별지 제42호 품질검사실시대장(매일 작성·비치 의무),
 *     별지 제43호 품질검사성과총괄표 등 19종 법정문서 핵심 별지의 SSoT
 *
 * 환경변수:
 *   LAW_OC=YOUR_LAW_OC
 *
 * 사용:
 *   tsx scripts/sync-annexes.ts
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const OC = process.env.LAW_OC || "YOUR_LAW_OC";
const ROOT = join(import.meta.dirname, "..");
const ANNEXES = join(ROOT, "src/taxonomy/graph/nodes/annexes");

interface LawTarget {
  actKey: string;
  actNode: string;
  mst: string;
  lawName: string;
}

const LAWS: LawTarget[] = [
  {
    actKey: "건진법시행규칙",
    actNode: "act:건설기술진흥법시행규칙",
    mst: "279455",
    lawName: "건설기술 진흥법 시행규칙",
  },
  {
    actKey: "건진법시행령",
    actNode: "act:건설기술진흥법시행령",
    mst: "283649",
    lawName: "건설기술 진흥법 시행령",
  },
];

/**
 * master-index 기준 품질관리 핵심 별지 (critical/high) — _meta.priority 표기용
 * 시행규칙
 *   별지 제42호: 품질검사 실시대장 (§51, 매일 작성·비치)
 *   별지 제43호: 품질검사 성과 총괄표 (시행령 §93 위임)
 *   별표  6:    품질관리비의 산출 및 사용기준 (§53①)
 * 시행령 (실제 별표번호 — 가지번호 4-2 존재)
 *   별표  8: 건설공사 등의 벌점관리기준 (§87⑤) — 품질 부적합·부실시공 처분 SSoT
 *   별표  9: 품질시험계획의 내용 (§89② / §90) — 19종 품질시험계획서 schema 직접 근거
 *   별표 11: 과태료의 부과기준 (§121①)
 */
const CRITICAL_ANNEX: Record<string, string> = {
  "건진법시행규칙:서식42": "critical",
  "건진법시행규칙:서식43": "critical",
  "건진법시행규칙:별표6": "high",
  "건진법시행령:별표8": "critical",
  "건진법시행령:별표9": "critical",
  "건진법시행령:별표11": "high",
};

interface AnnexData {
  key: string;
  num: string;
  sub: string;
  kind: string;
  title: string;
  body: string;
  hwpUrl?: string;
  pdfUrl?: string;
}

function parseAnnexes(xml: string): AnnexData[] {
  const annexes: AnnexData[] = [];
  for (const m of xml.matchAll(/<별표단위[^>]*별표키="([^"]+)"[^>]*>([\s\S]*?)<\/별표단위>/g)) {
    const key = m[1] ?? "";
    const inner = m[2] ?? "";
    const get = (tag: string): string => {
      const r = inner.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`));
      return r && r[1] ? r[1].trim() : "";
    };
    const num = get("별표번호").replace(/^0+/, "") || "0";
    const sub = get("별표가지번호").replace(/^0+/, "") || "0";
    const kind = get("별표구분");
    const title = get("별표제목");

    const bodyParts: string[] = [];
    const innerBodyMatch = inner.match(/<별표내용>([\s\S]*?)<\/별표내용>/);
    if (innerBodyMatch && innerBodyMatch[1]) {
      const cdata = innerBodyMatch[1];
      for (const cm of cdata.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
        if (cm[1]) bodyParts.push(cm[1]);
      }
    }
    const body = bodyParts.join("\n").trim();
    const hwpLink = inner.match(/<별표서식파일링크>([^<]+)<\/별표서식파일링크>/);
    const pdfLink = inner.match(/<별표서식PDF파일링크>([^<]+)<\/별표서식PDF파일링크>/);

    annexes.push({
      key,
      num,
      sub: sub === "0" ? "" : sub,
      kind,
      title,
      body,
      hwpUrl: hwpLink && hwpLink[1] ? `https://www.law.go.kr${hwpLink[1]}` : undefined,
      pdfUrl: pdfLink && pdfLink[1] ? `https://www.law.go.kr${pdfLink[1]}` : undefined,
    });
  }
  return annexes;
}

async function main(): Promise<void> {
  await mkdir(ANNEXES, { recursive: true });

  // 기존 annex IRI 인덱스
  const existingAnnexes = new Map<string, string>();
  for (const f of await readdir(ANNEXES).catch(() => [])) {
    if (!f.endsWith(".jsonld")) continue;
    const path = join(ANNEXES, f);
    const node = JSON.parse(await readFile(path, "utf-8")) as { "@id"?: string };
    if (node["@id"]) existingAnnexes.set(node["@id"], path);
  }
  console.log(`[index] 기존 annex 노드: ${existingAnnexes.size}\n`);

  let synced = 0;
  let created = 0;
  const summary: string[] = [];

  for (const law of LAWS) {
    const url = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=law&MST=${law.mst}&type=XML`;
    console.log(`[fetch] ${law.actKey} (MST=${law.mst})`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  [error] HTTP ${res.status}`);
      continue;
    }
    const xml = await res.text();
    const annexes = parseAnnexes(xml);
    console.log(`  [parsed] ${annexes.length} 별표/별지 추출\n`);

    for (const a of annexes) {
      const numLabel = a.sub ? `${a.kind}${a.num}의${a.sub}` : `${a.kind}${a.num}`;
      const iri = `annex:${law.actKey}:${numLabel}`;
      const fname = `${law.actKey}-${numLabel}.jsonld`;
      const path = existingAnnexes.get(iri) ?? join(ANNEXES, fname);

      const priorityKey = `${law.actKey}:${numLabel}`;
      const priority = CRITICAL_ANNEX[priorityKey];

      const obj: Record<string, unknown> = {
        "@context": "../../context.jsonld",
        "@id": iri,
        "@type": ["Annex"],
        annexNumber: a.sub ? `${a.num}-${a.sub}` : a.num,
        annexKind: a.kind,
        title: a.title,
        partOf: law.actNode,
        verificationStatus: "verified",
        legislationIdentifier: law.lawName,
        jurisdiction: "KR",
        constructionRelevance: priority ?? "medium",
        userVisible: true,
        isAppendix: true,
        description: a.body || a.title,
        _meta: {
          publishedBy: "법제처 국가법령정보센터 (자동 sync)",
          sourceUrl: `https://www.law.go.kr/법령/${encodeURIComponent(law.actKey)}/${a.kind}/${a.num}`,
          fetchedAt: new Date().toISOString().slice(0, 10),
          verifiedAt: new Date().toISOString().slice(0, 10),
          verifiedBy: "법제처 lawService.do <별표단위> 자동 sync",
          annexKey: a.key,
          lawServiceMST: law.mst,
          ...(a.hwpUrl && { hwpDownloadUrl: a.hwpUrl }),
          ...(a.pdfUrl && { pdfDownloadUrl: a.pdfUrl }),
          ...(priority && { priority }),
          licenseHint: "저작권법 §7 비보호 (자유 인용). 별지 서식 원본 재배포는 공공누리 4유형 — locator만 보관.",
        },
      };

      await writeFile(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
      if (existingAnnexes.has(iri)) synced++;
      else created++;
      existingAnnexes.set(iri, path);

      if (priority) {
        summary.push(`  [${priority}] ${numLabel}: ${a.title}`);
      }
    }
  }

  console.log(`✅ ${synced} sync + ${created} 신규 생성 (총 ${synced + created})\n`);
  if (summary.length > 0) {
    console.log("=== 품질 핵심 별지 (master-index critical/high) ===");
    summary.forEach((s) => console.log(s));
  }
  console.log("\n[done] sync-annexes.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
