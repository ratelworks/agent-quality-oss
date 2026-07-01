#!/usr/bin/env tsx
/**
 * promote-taxonomy.ts — taxonomy staging → 런타임 그래프 승격.
 *
 * taxonomy(법제처 자동 sync 원본 보관소)의 verified 데이터(조문 원문·별표 본문·서식 다운로드 링크)를
 * 런타임 온톨로지(src/ontology/graph/nodes/standards/)에 반영한다.
 *
 *   1. ENRICH — 기존 런타임 노드에 verified 원문·링크 병합 (수기 큐레이션 name/aliases/scope 보존)
 *   2. CREATE(articles) — 품질지침 현행 조문(2025-311호) → guideline.art{N} 노드 생성
 *   3. CREATE(annexes) — 품질 직결 별표·별지 → annex.* / form.* 노드 생성
 *
 * 선별 원칙(올바름>양): 시공자 QC·감리 실무 직결만 승격. 대행업자 평가·공장인증 서식은
 * taxonomy staging 에만 보관. 승격 대상은 아래 명시적 매핑 테이블이 SSoT.
 *
 * 멱등 — 재실행 시 같은 결과. sync-quality-notice.ts / sync-annexes.ts 실행 후 돌린다.
 * 사용: tsx scripts/promote-taxonomy.ts
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const TAX_ARTICLES = join(ROOT, "src/taxonomy/graph/nodes/articles");
const TAX_ANNEXES = join(ROOT, "src/taxonomy/graph/nodes/annexes");
const RUNTIME_STANDARDS = join(ROOT, "src/ontology/graph/nodes/standards");

/** 런타임 노드 meta 에 담는 본문 상한 (그래프 메모리·응답 비대 방지) */
const BODY_MAX = 20_000;

// ─────────────────────────────────────────────────────────────────────────────
// 매핑 테이블 (SSoT)
// ─────────────────────────────────────────────────────────────────────────────

/** taxonomy 파일명 → 기존 런타임 노드 파일명 (ENRICH — verified 원문·링크 병합) */
const ENRICH_MAP: Record<string, string> = {
  // 건진법 조문 (원문 enrich)
  "articles/건진법-§55.jsonld": "law.btia_55.jsonld",
  "articles/건진법-§56.jsonld": "law.btia_56.jsonld",
  "articles/건진법-§57.jsonld": "law.btia_57.jsonld",
  "articles/건진법-§60.jsonld": "law.btia_60.jsonld",
  "articles/건진법시행령-§89.jsonld": "law.btia_decree_89.jsonld",
  "articles/건진법시행령-§90.jsonld": "law.btia_decree_90.jsonld",
  "articles/건진법시행령-§91.jsonld": "law.btia_decree_91.jsonld",
  "articles/건진법시행령-§93.jsonld": "law.btia_decree_93.jsonld",
  "articles/건진법시행규칙-§50.jsonld": "law.btia_rule_50.jsonld",
  "articles/건진법시행규칙-§51.jsonld": "law.btia_rule_51.jsonld",
  "articles/건진법시행규칙-§52.jsonld": "law.btia_rule_52.jsonld",
  "articles/건진법시행규칙-§53.jsonld": "law.btia_rule_53.jsonld",
  // 별표·서식 (본문·다운로드 링크 enrich)
  "annexes/품질지침-별표1.jsonld": "form.quality_plan_annex1.jsonld",
  "annexes/품질지침-별표2.jsonld": "form.guideline_annex2.jsonld",
  "annexes/건진법시행령-별표9.jsonld": "form.test_plan_template.jsonld",
  "annexes/건진법시행규칙-서식42.jsonld": "form.rule_no42_quality_inspection_register.jsonld",
  "annexes/건진법시행규칙-서식43.jsonld": "form.rule_no43_quality_inspection_summary.jsonld",
  "annexes/사업관리지침-별지37.jsonld": "form.cm_guideline_no37_material_source_approval.jsonld",
};

/** 품질지침 조문 → guideline.art{N} 생성 (art:품질지침:* 전부) */
const GUIDELINE_PREFIX = "품질지침-§";

/** 신규 별표·별지 노드 생성 매핑: taxonomy 파일명 → { id(standard: 이하), category, 추가 alias } */
interface NewAnnexSpec {
  id: string;
  category: "annex" | "form";
  aliases?: string[];
}
const NEW_ANNEX_MAP: Record<string, NewAnnexSpec> = {
  // 품질지침 별표 (기준)
  "품질지침-별표3.jsonld": { id: "annex.guideline_t3", category: "annex", aliases: ["적절성 확인기준", "품질관리 적절성 확인요령"] },
  "품질지침-별표4.jsonld": { id: "annex.guideline_t4", category: "annex", aliases: ["품질시험비 산출", "품질관리비 산출 단위량"] },
  "품질지침-별표5.jsonld": { id: "annex.guideline_t5", category: "annex", aliases: ["품질관리규정 작성기준"] },
  "품질지침-별표9.jsonld": { id: "annex.guideline_t9", category: "annex", aliases: ["혼화재 레미콘 품질관리"] },
  // 품질지침 별지 (서식)
  "품질지침-별지1.jsonld": { id: "form.guideline_a1", category: "form", aliases: ["품질관리계획서 검토승인서"] },
  "품질지침-별지2.jsonld": { id: "form.guideline_a2", category: "form", aliases: ["적절성 확인점검표", "품질관리 적절성 점검표"] },
  "품질지침-별지8.jsonld": { id: "form.guideline_a8", category: "form", aliases: ["레미콘공장 점검표"] },
  "품질지침-별지9.jsonld": { id: "form.guideline_a9", category: "form", aliases: ["아스콘공장 점검표"] },
  "품질지침-별지10.jsonld": { id: "form.guideline_a10", category: "form", aliases: ["공장 정기점검 결과보고"] },
  "품질지침-별지11.jsonld": { id: "form.guideline_a11", category: "form", aliases: ["레미콘 시공품질관리 점검표"] },
  "품질지침-별지12.jsonld": { id: "form.guideline_a12", category: "form", aliases: ["아스콘 시공품질관리 점검표"] },
  "품질지침-별지13.jsonld": { id: "form.guideline_a13", category: "form", aliases: ["불량자재폐기 확약서"] },
  "품질지침-별지13의2.jsonld": { id: "form.guideline_a13_2", category: "form", aliases: ["철강 자재 점검표"] },
  // 사업관리지침 별지 (감리·검측·자재 서식)
  "사업관리지침-별지16.jsonld": { id: "form.cm_a16", category: "form", aliases: ["품질시험계획 (사업관리)"] },
  "사업관리지침-별지17.jsonld": { id: "form.cm_a17", category: "form", aliases: ["품질시험·검사성과 총괄표 (사업관리)"] },
  "사업관리지침-별지18.jsonld": { id: "form.cm_a18", category: "form", aliases: ["품질시험·검사실적 보고서"] },
  "사업관리지침-별지19.jsonld": { id: "form.cm_a19", category: "form", aliases: ["검측대장"] },
  "사업관리지침-별지34.jsonld": { id: "form.cm_a34", category: "form", aliases: ["품질시험·검사대장"] },
  "사업관리지침-별지35.jsonld": { id: "form.cm_a35", category: "form", aliases: ["콘크리트 타설현황", "구조물별 콘크리트 타설현황"] },
  "사업관리지침-별지36.jsonld": { id: "form.cm_a36", category: "form", aliases: ["검측요청서", "검측요청·결과 통보"] },
  "사업관리지침-별지38.jsonld": { id: "form.cm_a38", category: "form", aliases: ["주요자재 검사 및 수불부"] },
  "사업관리지침-별지41.jsonld": { id: "form.cm_a41", category: "form", aliases: ["콘크리트 균열관리 현황"] },
  "사업관리지침-별지45.jsonld": { id: "form.cm_a45", category: "form", aliases: ["검측내용 실적종합"] },
  "사업관리지침-별지46.jsonld": { id: "form.cm_a46", category: "form", aliases: ["품질시험·검사실적 종합"] },
  "사업관리지침-별지47.jsonld": { id: "form.cm_a47", category: "form", aliases: ["주요자재 관리실적 종합"] },
  "사업관리지침-별지56.jsonld": { id: "form.cm_a56", category: "form", aliases: ["품질시험·검사대장 (감독자)"] },
  "사업관리지침-별지59.jsonld": { id: "form.cm_a59", category: "form", aliases: ["주요자재검사부"] },
  // 건진법 시행규칙·시행령 별표 (품질 직결 기준)
  "건진법시행규칙-별표6.jsonld": { id: "annex.rule_t6", category: "annex", aliases: ["품질관리비", "품질관리비 산출 및 사용기준"] },
  "건진법시행령-별표8.jsonld": { id: "annex.decree_t8", category: "annex", aliases: ["벌점관리기준", "부실 벌점"] },
  "건진법시행령-별표11.jsonld": { id: "annex.decree_t11", category: "annex", aliases: ["과태료 부과기준"] },
};

/** 발행 주체 표기 (iriKey → lawName) */
const NOTICE_NAMES: Record<string, string> = {
  품질지침: "건설공사 품질관리 업무지침",
  사업관리지침: "건설공사 사업관리방식 검토기준 및 업무수행지침",
  건진법시행규칙: "건설기술 진흥법 시행규칙",
  건진법시행령: "건설기술 진흥법 시행령",
};

// ─────────────────────────────────────────────────────────────────────────────

interface TaxonomyNode {
  "@id"?: string;
  title?: string;
  articleNumber?: string;
  annexNumber?: string;
  annexKind?: string;
  description?: string;
  verificationStatus?: string;
  legislationIdentifier?: string;
  amendmentHistory?: string[];
  latestAmendment?: string;
  legislationDate?: string;
  /** 소속 편 (예: "제2편 건설공사 품질관리") */
  partLabel?: string;
  _meta?: Record<string, unknown>;
}

function truncate(body: string, sourceUrl: string): { text: string; truncated: boolean } {
  if (body.length <= BODY_MAX) return { text: body, truncated: false };
  return {
    text: body.slice(0, BODY_MAX) + `\n\n… [이하 생략 — 전문 ${body.length.toLocaleString()}자. 원문: ${sourceUrl}]`,
    truncated: true,
  };
}

/** taxonomy 노드에서 verified 병합 필드 추출 */
function verifiedMetaFrom(tax: TaxonomyNode): Record<string, unknown> {
  const taxMeta = tax._meta ?? {};
  const sourceUrl = (taxMeta["sourceUrl"] as string) ?? "";
  const body = tax.description ?? "";
  const { text, truncated } = truncate(body, sourceUrl);
  return {
    sourceStatus: "verified",
    bodyText: text,
    bodyLength: body.length,
    ...(truncated && { bodyTruncated: true }),
    sourceUrl,
    fetchedAt: taxMeta["fetchedAt"],
    verifiedAt: taxMeta["verifiedAt"],
    verifiedBy: taxMeta["verifiedBy"],
    ...(taxMeta["hwpDownloadUrl"] ? { hwpDownloadUrl: taxMeta["hwpDownloadUrl"] } : {}),
    ...(taxMeta["pdfDownloadUrl"] ? { pdfDownloadUrl: taxMeta["pdfDownloadUrl"] } : {}),
    ...(tax.amendmentHistory ? { amendmentHistory: tax.amendmentHistory } : {}),
    ...(tax.latestAmendment ? { latestAmendment: tax.latestAmendment } : {}),
    ...(tax.legislationDate ? { effectiveFrom: tax.legislationDate } : {}),
  };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
}

async function writeJson(path: string, obj: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

/** "(제7조제1항 관련)" → "7" | "45의2" 추출 */
function extractArticleRef(title: string): string | null {
  const m = title.match(/제(\d+)조(?:의(\d+))?/);
  if (!m || !m[1]) return null;
  return m[2] ? `${m[1]}의${m[2]}` : m[1];
}

/** 조문 번호 → id 조각 ("45의2" → "45_2") */
function artSlug(num: string): string {
  return num.replace("의", "_");
}

async function main(): Promise<void> {
  let enriched = 0;
  let createdArticles = 0;
  let createdAnnexes = 0;
  const warnings: string[] = [];

  // ── 1. ENRICH ──
  for (const [taxRel, runtimeFile] of Object.entries(ENRICH_MAP)) {
    const taxPath = join(ROOT, "src/taxonomy/graph/nodes", taxRel);
    const runtimePath = join(RUNTIME_STANDARDS, runtimeFile);
    let tax: TaxonomyNode;
    let runtime: Record<string, unknown>;
    try {
      tax = (await readJson(taxPath)) as TaxonomyNode;
    } catch {
      warnings.push(`[enrich-skip] taxonomy 없음: ${taxRel}`);
      continue;
    }
    try {
      runtime = await readJson(runtimePath);
    } catch {
      warnings.push(`[enrich-skip] 런타임 노드 없음: ${runtimeFile}`);
      continue;
    }
    const meta = (runtime["_meta"] as Record<string, unknown>) ?? {};
    runtime["_meta"] = { ...meta, ...verifiedMetaFrom(tax) };
    await writeJson(runtimePath, runtime);
    enriched++;
  }

  // ── 2. CREATE 품질지침 조문 (guideline.art{N}) ──
  const artFiles = (await readdir(TAX_ARTICLES)).filter(
    (f) => f.startsWith(GUIDELINE_PREFIX) && f.endsWith(".jsonld"),
  );
  // 승격된 조문 id 집합 (별표 derivedFrom 연결 검증용)
  const guidelineArtIds = new Set<string>();
  for (const f of artFiles.sort()) {
    const tax = (await readJson(join(TAX_ARTICLES, f))) as TaxonomyNode;
    const num = tax.articleNumber ?? "";
    if (!num) {
      warnings.push(`[art-skip] articleNumber 없음: ${f}`);
      continue;
    }
    const id = `guideline.art${artSlug(num)}`;
    guidelineArtIds.add(`standard.${id}`);
    const node = {
      "@context": "../../context.jsonld",
      "@id": `standard:${id}`,
      "@type": "Standard",
      name: `업무지침 §${num} (${tax.title ?? ""})`,
      aliases: [`업무지침 제${num}조`, `품질관리 업무지침 §${num}`, tax.title ?? ""].filter(Boolean),
      _meta: {
        category: "guideline",
        lawName: NOTICE_NAMES["품질지침"],
        articleNo: num,
        ...(tax.partLabel && { part: tax.partLabel }),
        scope: tax.title ?? "",
        legalWeight: "administrative_rule",
        basisType: "guideline",
        issuer: "국토교통부 고시",
        noticeNumber: (tax._meta?.["noticeNumber"] as string) ?? "국토교통부고시 제2025-311호",
        ...verifiedMetaFrom(tax),
      },
    };
    await writeJson(join(RUNTIME_STANDARDS, `${id}.jsonld`), node);
    createdArticles++;
  }

  // ── 3. CREATE 별표·별지 ──
  for (const [taxFile, spec] of Object.entries(NEW_ANNEX_MAP)) {
    const taxPath = join(TAX_ANNEXES, taxFile);
    let tax: TaxonomyNode;
    try {
      tax = (await readJson(taxPath)) as TaxonomyNode;
    } catch {
      warnings.push(`[annex-skip] taxonomy 없음: ${taxFile}`);
      continue;
    }
    const iriKey = taxFile.split("-")[0] ?? "";
    const label = taxFile.replace(`${iriKey}-`, "").replace(".jsonld", "");
    const lawName = NOTICE_NAMES[iriKey] ?? iriKey;
    const title = tax.title ?? label;

    // 별표 제목의 "(제N조 관련)" → 품질지침 조문 노드 연결 (승격된 조문만 — dangling 방지)
    const relations: Record<string, string[]> = {};
    if (iriKey === "품질지침") {
      const refNum = extractArticleRef(title);
      if (refNum && guidelineArtIds.has(`standard.guideline.art${artSlug(refNum)}`)) {
        relations["derivedFrom"] = [`standard:guideline.art${artSlug(refNum)}`];
      }
    }

    const node = {
      "@context": "../../context.jsonld",
      "@id": `standard:${spec.id}`,
      "@type": "Standard",
      name: `${lawName === NOTICE_NAMES["품질지침"] ? "업무지침" : lawName === NOTICE_NAMES["사업관리지침"] ? "사업관리지침" : lawName} ${label} — ${title}`,
      aliases: [label, title, ...(spec.aliases ?? [])],
      ...(Object.keys(relations).length > 0 ? relations : {}),
      _meta: {
        category: spec.category,
        basisType: spec.category === "form" ? "standard_form" : "annex",
        lawName,
        referenceDoc: lawName,
        section: label,
        issuer: "국토교통부",
        legalWeight: iriKey.startsWith("건진법") ? "mandatory" : "administrative_rule",
        license: "Korea Open Government License Type 4",
        ...verifiedMetaFrom(tax),
      },
    };
    await writeJson(join(RUNTIME_STANDARDS, `${spec.id}.jsonld`), node);
    createdAnnexes++;
  }

  console.log(`✅ enrich ${enriched} · 조문 생성 ${createdArticles} · 별표/서식 생성 ${createdAnnexes}`);
  if (warnings.length > 0) {
    console.log("\n⚠ 경고:");
    warnings.forEach((w) => console.log("  " + w));
  }
  console.log("\n[done] promote-taxonomy.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
