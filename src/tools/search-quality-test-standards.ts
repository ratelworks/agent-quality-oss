// ─────────────────────────────────────────────────────────────────────────────
// search-quality-test-standards.ts — 건설공사 품질시험기준(업무지침 별표 2)에서
// 시험종목·시험방법·시험빈도를 찾는다.
//
// 자료는 수록 원문의 표를 행으로 푼 것이다(knowledge/test-standards.ts). 구분(공종)·종별·
// 시험종목·KS 번호·검색어로 좁히고, 조건 없이 부르면 구분과 종별 목록을 준다.
// ─────────────────────────────────────────────────────────────────────────────

import { buildResponse } from "../lib/response.js";
import { cite } from "../knowledge/cite.js";
import { loadTestStandards, searchTestStandards } from "../knowledge/test-standards.js";
import type { BasisRef, ToolSpec } from "../lib/types.js";
import type { OntologyGraph } from "../ontology/graph.js";

// ───── 상수 ─────
const GUIDELINE = "건설공사 품질관리 업무지침";
const ANNEX_NODE = "standard.form.guideline_annex2";
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;
/** 결과를 읽는 법 — 원문 표를 행으로 풀면서 정한 규칙 */
const READING_NOTES = [
  "원문 표의 한 시험종목이 한 행이다. 세로로 합쳐진 칸(여러 시험종목에 걸친 종별·시험빈도·비고)은 걸쳐 있는 모든 행에 같은 글이 들어 있다.",
  "한 칸을 다시 나눈 칸은 ' > ' 로 이어 적었다 — 예: '지지력 > 말뚝 기초 > 정재하'.",
  "좁은 칸에서 줄이 바뀐 낱말을 이어 붙였으므로 띄어쓰기는 원문과 다를 수 있다. 글자를 그대로 옮겨야 하면 sourceLines 의 원문 줄을 get_quality_law_article(law: '품질관리 업무지침', annex: '별표 2') 로 확인한다.",
  "원문에서 삭제 표시(<삭 제>)만 남은 행과 빈 행은 싣지 않았다.",
];

export const spec: ToolSpec = {
  name: "search_quality_test_standards",
  description:
    "건설공사 품질시험기준(품질관리 업무지침 별표 2)에서 자재·공종별 시험종목·시험방법(KS 번호)·시험빈도·비고를 찾는다. " +
    "구분(section: 철근콘크리트공사·도로공사·방수공사 등)·종별(category: 자재 이름)·시험종목(item)·KS 번호(ksNumber)·검색어(query)로 좁힌다. " +
    "조건 없이 부르면 구분 17개와 구분별 종별 목록을 준다. 원문 표 전 항목을 행으로 푼 자료이며 고시 번호·시행일을 함께 준다. " +
    "[근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "검색어 — 띄어 쓴 낱말이 모두 들어 있는 행을 찾는다 (예: '레미콘 슬럼프', '철근 인장강도')" },
      section: { type: "string", description: "구분(공종) — 예: 토공사, 철근콘크리트공사, 철강구조물공사, 가설기자재, 도로공사, 아스팔트 포장, 조적공사, 방수공사, 도장공사" },
      category: { type: "string", description: "종별(자재·제품 이름) — 예: 굳지 아니한 콘크리트, 철근 콘크리트용 봉강, 강관 비계용 부재" },
      item: { type: "string", description: "시험종목 — 예: 슬럼프, 압축강도, 인장강도" },
      ksNumber: { type: "string", description: "KS 번호 — 예: KS F 2405" },
      limit: { type: "number", minimum: 1, maximum: MAX_LIMIT, description: `돌려줄 행 수 (기본 ${DEFAULT_LIMIT}, 최대 ${MAX_LIMIT})` },
    },
  },
};

export interface SearchTestStandardsArgs {
  query?: string;
  section?: string;
  category?: string;
  item?: string;
  ksNumber?: string;
  limit?: number;
}

export function run(args: SearchTestStandardsArgs, graph: OntologyGraph) {
  const { query, section, category, item, ksNumber, limit } = args ?? {};
  const standards = loadTestStandards();
  const filtered = [query, section, category, item, ksNumber].some((v) => typeof v === "string" && v.trim() !== "");

  const rules = [
    cite({ law: GUIDELINE, article: "8", quote: "건설공사 품질시험기준은 별표 2와 같다" }),
    cite({ law: GUIDELINE, article: "8", quote: "명시되지 아니한 공종이나 자재에 대해서는 시방서 등 설계도서에 제시된 시험종목ㆍ방법 및 빈도에 따른다" }),
    cite({ law: GUIDELINE, article: "8", quote: "시험빈도를 조정할 수 있다" }),
  ];
  const basis: BasisRef[] = [
    { type: "law_text", id: "quality_guideline:별표 2", priority: 1, sourceStatus: "verified", note: `${standards.source} — ${standards.edition}` },
    ...(graph.get(ANNEX_NODE) ? [{ type: "ontology", id: ANNEX_NODE, priority: 2 } as BasisRef] : []),
  ];
  const common = {
    source: standards.source,
    edition: standards.edition,
    /** 별표 끝의 주석 — 종별의 괄호 안 KS 규격(productStandards)의 뜻 */
    note: standards.note,
    rules,
    reading: READING_NOTES,
  };

  if (!filtered) {
    return buildResponse(
      "search_quality_test_standards",
      graph.version,
      {
        ...common,
        totalRows: standards.rows.length,
        sections: standards.sections,
        usage: "section·category·item·ksNumber·query 로 좁혀 다시 부른다. 예: { section: '철근콘크리트공사', category: '굳지 아니한 콘크리트' }",
      },
      basis,
    );
  }

  const found = searchTestStandards({
    ...(query !== undefined ? { query } : {}),
    ...(section !== undefined ? { section } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(item !== undefined ? { item } : {}),
    ...(ksNumber !== undefined ? { ksNumber } : {}),
    limit: limit ?? DEFAULT_LIMIT,
  });
  const none = found.total === 0;
  return buildResponse(
    "search_quality_test_standards",
    graph.version,
    {
      ...common,
      query: { query, section, category, item, ksNumber },
      total: found.total,
      returned: found.rows.length,
      rows: found.rows,
      ...(found.total > found.rows.length ? { more: `${found.total - found.rows.length}행이 더 있다 — 조건을 좁히거나 limit 을 늘린다(최대 ${MAX_LIMIT}).` } : {}),
      ...(none
        ? {
            notFound:
              "별표 2 에서 찾지 못했다. 낱말을 바꿔 보거나(예: 레미콘 → 굳지 아니한 콘크리트) 조건 없이 불러 구분·종별 목록을 본다. 별표 2 에 없는 공종·자재는 시방서 등 설계도서의 시험종목·방법·빈도를 따른다(업무지침 제8조).",
          }
        : {}),
      usage: "행의 시험방법·시험빈도는 최소 기준이다. 설계도서와 발주자가 조정한 빈도가 있으면 그것을 함께 확인한다(업무지침 제8조).",
    },
    basis,
  );
}
