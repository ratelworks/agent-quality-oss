// ─────────────────────────────────────────────────────────────────────────────
// get-quality-law-article.ts — 법령·고시의 조문·별표·서식 원문을 돌려준다.
//
// 두 가지로 찾는다.
//   1) law + article(또는 annex) — 수록한 법령·고시의 어느 조문·별표·서식이든 원문 그대로
//   2) articleId — 온톨로지 노드(standard.law.* / standard.guideline.* 등). 노드의 요약·적용
//      범위·구속력에 수록 원문을 붙여 준다
// 원문은 src/ontology/laws 의 수록본(법제처 국가법령정보센터, 판본 표기 포함)이다.
// ─────────────────────────────────────────────────────────────────────────────

import { buildResponse, entityBasis } from "./_response.js";
import { ERROR_CODES, QualityMcpError } from "../lib/errors.js";
import { editionLabel, findAnnex, findArticle, findLaw, loadLaws } from "../ontology/laws.js";
import { ANNEX_FULL_MAX, annexOutline, excerptAnnex } from "../knowledge/annex-excerpt.js";
import type { LawBundle } from "../ontology/laws.js";
import type { BaseEntity } from "../ontology/schema.js";
import type { ToolSpec, BasisRef } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

export const spec: ToolSpec = {
  name: "get_quality_law_article",
  description:
    "법령·고시의 조문·별표·서식 원문을 돌려준다. 수록 범위: 건설기술 진흥법·시행령·시행규칙, 건설공사 품질관리 업무지침, " +
    "건설공사 사업관리방식 검토기준 및 업무수행지침의 전 조문과 별표·서식(판본 표기 포함). " +
    "law+article(예: law '건설기술 진흥법 시행령', article '89') 또는 law+annex(예: annex '별표 5') 로 찾거나, " +
    "온톨로지 조항 id(articleId)로 요약·적용 범위와 함께 받는다. " +
    `큰 별표(${ANNEX_FULL_MAX.toLocaleString("ko-KR")}자 넘음 — 업무지침 별표 2 품질시험기준·별표 4 등)는 통째로 주지 않는다: find 에 낱말(예: \"강관말뚝\", \"노상 평판재하\")을 주면 그 낱말이 든 항목(표의 종별 칸 전체)을 표 머리·절 제목과 함께 준다. find 없이 부르면 목차와 찾는 법을 준다. ` +
    "[근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]",
  inputSchema: {
    type: "object",
    properties: {
      articleId: { type: "string", description: "온톨로지 조항 id (예: standard.law.btia_55)" },
      law: {
        type: "string",
        description: "법령·고시 이름 (예: 건설기술 진흥법 시행령, 시행규칙, 품질관리 업무지침, 사업관리지침)",
      },
      article: { type: "string", description: "조문 번호 (예: 89, 제89조, 45의2)" },
      annex: { type: "string", description: "별표·서식 (예: 별표 5, 별지 제42호)" },
      find: { type: "string", description: "별표에서 찾을 낱말 — 그 낱말이 든 항목만 준다 (예: 강관말뚝, 노상 평판재하). 낱말을 모두 가진 항목이 없으면 가장 많이 가진 항목" },
    },
  },
};

export interface GetArticleArgs {
  articleId?: string;
  law?: string;
  article?: string;
  annex?: string;
  find?: string;
}

/** 노드가 가리키는 법령 조문의 수록 원문 (노드에 lawName·articleNo 가 있을 때) */
function bundledTextFor(entity: BaseEntity): { law: LawBundle; text: string } | null {
  const lawName = entity.meta?.["lawName"];
  const articleNo = entity.meta?.["articleNo"];
  if (typeof lawName !== "string" || typeof articleNo !== "string") return null;
  const law = findLaw(lawName);
  const article = law ? findArticle(law, articleNo) : null;
  return law && article ? { law, text: article.text } : null;
}

function lawBasis(law: LawBundle, ref: string): BasisRef[] {
  return [{ type: "law_text", id: `${law.id}:${ref}`, priority: 1, sourceStatus: "verified", note: `${law.name} ${ref} — ${editionLabel(law)}` }];
}

export function run(args: GetArticleArgs, graph: OntologyGraph) {
  const { articleId, law: lawName, article, annex, find } = args ?? {};

  // 1) 법령 이름 + 조문·별표
  if (lawName) {
    const law = findLaw(lawName);
    if (!law) {
      throw new QualityMcpError(
        ERROR_CODES.NOT_FOUND,
        `수록하지 않은 법령·고시입니다: ${lawName}. 수록: ${loadLaws().map((l) => l.name).join(" · ")}`,
      );
    }
    if (!article && !annex) {
      throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, "article(조문 번호) 또는 annex(별표·서식)를 함께 주십시오.");
    }
    if (annex) {
      const found = findAnnex(law, annex);
      if (!found) {
        throw new QualityMcpError(
          ERROR_CODES.NOT_FOUND,
          `${law.name}에 없는 별표·서식입니다: ${annex}. 있는 것: ${law.annexes.map((x) => `${x.kind} ${x.key}`).join(", ") || "(없음)"}`,
        );
      }
      const ref = `${found.kind} ${found.key}`;
      return buildResponse(
        "get_quality_law_article",
        graph.version,
        {
          law: { id: law.id, name: law.name, edition: editionLabel(law), url: law.source.url },
          annex: annexView(found, find),
          sourceNote: `${law.source.provider} 원문 (${editionLabel(law)}). 개정 여부는 공식 링크에서 다시 확인하십시오.`,
        },
        lawBasis(law, ref),
        undefined,
        undefined,
        graph,
      );
    }
    const found = findArticle(law, article as string);
    if (!found) {
      const max = Math.max(...law.articles.map((a) => a.number));
      throw new QualityMcpError(ERROR_CODES.NOT_FOUND, `${law.name}에 없는 조문입니다: ${article} (제1조~제${max}조 수록)`);
    }
    const ref = `제${found.number}조${found.branch ? `의${found.branch}` : ""}`;
    return buildResponse(
      "get_quality_law_article",
      graph.version,
      {
        law: { id: law.id, name: law.name, edition: editionLabel(law), url: law.source.url },
        article: { no: found.key, ref, title: found.title, heading: found.heading, deleted: found.deleted, text: found.text },
        sourceNote: `${law.source.provider} 원문 (${editionLabel(law)}). 개정 여부는 공식 링크에서 다시 확인하십시오.`,
      },
      lawBasis(law, ref),
      undefined,
      undefined,
      graph,
    );
  }

  // 2) 온톨로지 조항 id
  if (!articleId) {
    throw new QualityMcpError(ERROR_CODES.INVALID_INPUT, "articleId 또는 law+article(annex) 중 하나는 필수입니다.");
  }
  const entity = graph.get(articleId);
  if (!entity || entity.type !== "Standard" || !entity.meta?.["category"]) {
    return buildResponse(
      "get_quality_law_article",
      graph.version,
      { article: null },
      [{ type: "ontology_meta", id: "not_found", priority: 3, note: `법령 조항 아님: ${articleId}` }],
      {
        required: true,
        reason: `${articleId}는 내장 법령/지침/서식 노드가 아닙니다. list_core_quality_laws로 목록을 보거나 law+article 로 찾으십시오.`,
      },
    );
  }

  const meta = entity.meta;
  const bundled = bundledTextFor(entity);
  const bodyText = bundled?.text ?? (meta["bodyText"] as string | undefined) ?? null;
  const sourceStatus = (meta["sourceStatus"] as string | undefined) ?? "indirect_source";
  const result = {
    article: {
      id: entity.id,
      name: entity.name,
      category: meta["category"] as string | undefined,
      lawName: (meta["lawName"] as string | undefined) ?? (meta["referenceDoc"] as string | undefined) ?? null,
      articleNo: (meta["articleNo"] as string | undefined) ?? (meta["section"] as string | undefined) ?? null,
      part: (meta["part"] as string | undefined) ?? null,
      scope: meta["scope"] as string | undefined,
      legalWeight: meta["legalWeight"] as string | undefined,
      basisType: meta["basisType"] as string | undefined,
      issuer: (meta["issuer"] as string | undefined) ?? null,
      effectiveFrom: bundled?.law.effectiveDate ?? (meta["effectiveFrom"] as string | undefined) ?? null,
      edition: bundled ? editionLabel(bundled.law) : null,
      url: (meta["url"] as string | undefined) ?? (meta["sourceUrl"] as string | undefined) ?? null,
      aliases: entity.aliases ?? [],
      sourceStatus,
      bodyText,
      ...(meta["bodyTruncated"] && !bundled ? { bodyTruncated: true } : {}),
      amendmentHistory: (meta["amendmentHistory"] as string[] | undefined) ?? null,
      latestAmendment: (meta["latestAmendment"] as string | undefined) ?? null,
    },
    sourceNote: bundled
      ? `법제처 국가법령정보센터 원문 (${editionLabel(bundled.law)}). 개정 여부는 공식 링크에서 다시 확인하십시오.`
      : bodyText
        ? `법제처 국가법령정보센터 원문 (${(meta["verifiedAt"] as string | undefined) ?? "확인일 미상"} 기준). 개정 여부는 공식 링크에서 다시 확인하십시오.`
        : "원문을 싣지 않은 항목입니다 — 국가법령정보센터(law.go.kr)에서 확인하십시오. 이 응답은 요약·식별자만 줍니다.",
  };

  return buildResponse("get_quality_law_article", graph.version, result, entityBasis([entity.id], 1));
}

/**
 * 별표를 돌려줄 모양 — 낱말이 있으면 그 항목만, 없으면 작은 별표는 전문, 큰 별표는 목차.
 * 큰 별표(별표 2 는 39만 자)를 통째로 주면 AI 비서가 한 번에 읽지 못해 답을 찾지 못한다.
 */
function annexView(found: { kind: string; key: string; title: string; text: string }, find: string | undefined): Record<string, unknown> {
  const base = { kind: found.kind, no: found.key, title: found.title, length: found.text.length };
  if (find && find.trim()) {
    const ex = excerptAnnex(found.text, find.trim());
    return {
      ...base,
      find: ex.find,
      matches: ex.matches,
      allTermsMatched: ex.allTermsMatched,
      excerpts: ex.excerpts,
      ...(ex.omitted > 0 ? { omitted: ex.omitted } : {}),
      note:
        ex.matches === 0
          ? "이 별표에 그 낱말이 든 항목이 없습니다 — 낱말을 줄이거나 다른 말로 찾으세요(띄어쓰기는 무시합니다)."
          : `낱말이 든 항목 ${ex.matches}개입니다(표의 종별 칸 전체 · 머리 줄 · 절 제목). ${ex.allTermsMatched ? "" : "낱말을 모두 가진 항목이 없어 가장 많이 가진 항목을 보였습니다. "}${ex.omitted > 0 ? `길이 한도로 ${ex.omitted}개는 빼고 보였습니다 — 낱말을 더 좁히세요. ` : ""}${ex.excerpts.some((e) => e.sectionKinds) ? "절 제목에서 찾은 결과는 그 절 표의 종별 이름(sectionKinds)만 줍니다 — 하나를 find 로 다시 찾으면 그 칸 전체를 줍니다." : ""}`.trim(),
    };
  }
  if (found.text.length <= ANNEX_FULL_MAX) return { ...base, text: found.text };
  const outline = annexOutline(found.text);
  return {
    ...base,
    sections: outline.sections,
    head: outline.head,
    note: `이 별표는 ${found.text.length.toLocaleString("ko-KR")}자라 통째로 주지 않습니다 — find 에 찾을 낱말(공종·자재·시험 이름 등)을 넣어 다시 부르세요. 시험 빈도·방법은 search_quality_test_standards 로도 찾을 수 있습니다.`,
  };
}
