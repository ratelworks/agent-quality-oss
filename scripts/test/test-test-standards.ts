// ─────────────────────────────────────────────────────────────────────────────
// test-test-standards.ts — 건설공사 품질시험기준(업무지침 별표 2)을 행으로 푼 자료의 회귀 시험.
//
//   1) 풀이 점검 — 표 17개, 어긋난 경계 0, 쓰이지 않은 칸 0
//   2) 글자 보존 — 표 안의 글자가 하나도 빠지거나 겹치지 않고 칸에 들어갔는가
//   3) KS 번호 — 원문에 적힌 KS 번호가 모두 행에 있는가
//   4) 원문 대조 표본 — 원문을 눈으로 읽어 확인한 행 (세로로 합친 칸·하위 열 포함)
//   5) 찾기 — 구분·종별·시험종목·KS 번호·검색어·현장 용어
//   6) 도구 — search_quality_test_standards, 품질시험계획 재료의 공종별 행
// ─────────────────────────────────────────────────────────────────────────────

import { loadOntologySync } from "../../src/ontology/loader.js";
import { OntologyGraph } from "../../src/ontology/graph.js";
import { findAnnex, findLaw } from "../../src/ontology/laws.js";
import { parseBoxGrids } from "../../src/lib/box-table.js";
import { loadTestStandards, searchTestStandards } from "../../src/knowledge/test-standards.js";
import type { TestStandardRow } from "../../src/knowledge/test-standards.js";
import { callTool } from "../../src/tool-registry.js";

// ───── 상수 ─────
const GUIDELINE = "건설공사 품질관리 업무지침";
const EXPECTED_TABLES = 17;
const MIN_ROWS = 1900;
const KS_NUMBER = /KS\s?[A-Z]\s?(?:(?:ISO|IEC)\s?)?\d+(?:-\d+)*/g;
const EXPECTED_SECTIONS = [
  "1. 공통 > 가. 토공사 및 기초공사",
  "1. 공통 > 나. 철근콘크리트공사",
  "1. 공통 > 다. 철강구조물공사",
  "1. 공통 > 라. 가설기자재",
  "1. 공통 > 마. 기타",
  "2. 토목 > 가. 도로공사 > (1) 흙 및 혼합골재",
  "2. 토목 > 가. 도로공사 > (2) 아스팔트 포장",
  "2. 토목 > 가. 도로공사 > (3) 기타",
  "2. 토목 > 나. 수공구조물공사",
  "3. 건축 > 가. 조적공사",
  "3. 건축 > 나. 방수공사",
  "3. 건축 > 다. 단열·보온공사",
  "3. 건축 > 라. 유리공사",
  "3. 건축 > 마. 창호공사",
  "3. 건축 > 바. 마감공사(지붕·목공사 포함)",
  "3. 건축 > 사. 도장공사",
  "3. 건축 > 아. 기타",
];

const graph = new OntologyGraph(loadOntologySync());
let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) passed += 1;
  else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const squash = (s: string): string => s.replace(/\s+/g, "");
const isBoxChar = (ch: string): boolean => {
  const code = ch.codePointAt(0) ?? 0;
  return code >= 0x2500 && code <= 0x257f;
};

function annexText(): string {
  const law = findLaw(GUIDELINE);
  const annex = law ? findAnnex(law, "별표 2") : null;
  if (!annex) throw new Error("별표 2 가 수록본에 없음");
  return annex.text;
}

// ── 1·2. 풀이 점검과 글자 보존 ──────────────────────────────────────
function testParsing(): void {
  const standards = loadTestStandards();
  const d = standards.diagnostics;
  check(`표 ${EXPECTED_TABLES}개를 모두 풂`, d.tables === EXPECTED_TABLES, String(d.tables));
  check("너비가 어긋난 줄의 경계를 모두 이웃 줄에 맞춤", d.unsnapped === 0, String(d.unsnapped));
  check("글이 있는 칸이 모두 어느 행에 들어감", d.unusedCells === 0, String(d.unusedCells));
  check(`행 ${standards.rows.length}개 (${MIN_ROWS}개 이상)`, standards.rows.length >= MIN_ROWS);
  check("구분 17개의 이름과 순서", JSON.stringify(standards.sections.map((s) => s.section)) === JSON.stringify(EXPECTED_SECTIONS), standards.sections.map((s) => s.section).join(" / "));
  check("구분마다 행이 있음", standards.sections.every((s) => s.rows > 0));
  check("판(고시 번호·시행일)을 밝힘", /고시 제\d{4}-\d+호 \(시행 \d{4}-\d{2}-\d{2}\)/.test(standards.edition), standards.edition);
  check("별표 끝의 주석을 원문 그대로 실음", standards.note.startsWith("※") && standards.note.includes("제91조제1항"), standards.note);
  // 삭제 표시만 남은 행의 이름(종별·구분)만 빠져야 한다
  check("싣지 않은 글은 삭제된 행의 이름뿐", d.droppedTexts.every((t) => /^(콘크리트용 순환골재 \(KS F 2573\)|\d종)$/.test(t)), d.droppedTexts.join(" ‖ "));
  check("삭제 표시 행·빈 행을 싣지 않음", d.deletedRows > 0 && standards.rows.every((r) => !/<삭\s*제>/.test(`${r.item}${r.method}`)));
  check("모든 행에 종별과 시험종목이 있음", standards.rows.every((r) => r.category !== "" && r.item !== ""));
  check("깨진 가운뎃점(?)이 남지 않음", standards.rows.every((r) => !/\?/.test(`${r.category}${r.item}${r.method}${r.frequency}${r.remarks}`)));

  // 글자 보존 — 표의 글자(선·공백 제외)와 칸에 들어간 글자가 같아야 한다
  const text = annexText();
  const lines = text.split("\n");
  const grids = parseBoxGrids(text);
  let mismatched = 0;
  for (const grid of grids) {
    const inTable = [...squash(lines.slice(grid.firstLine, grid.firstLine + grid.lineCount).join(""))].filter((ch) => !isBoxChar(ch)).sort().join("");
    const inCells = [...squash(grid.cells.flatMap((c) => c.lines).join(""))].sort().join("");
    if (inTable !== inCells) mismatched += 1;
  }
  check("표 17개 모두 글자가 빠지거나 겹치지 않음", mismatched === 0, `${mismatched}개 표 불일치`);

  // 행의 원문 줄 번호 — 그 줄에 시험종목의 첫 글자가 실제로 있다
  const wrongLine = standards.rows.filter((r) => {
    const leaf = squash(r.item.split(" > ").at(-1) ?? "");
    const source = squash(lines.slice(r.sourceLines.from - 1, r.sourceLines.to).join("")).replace(/\?/g, "·");
    return leaf.length > 0 && !source.includes(leaf.slice(0, 2));
  });
  check("행의 원문 줄 번호가 그 시험종목을 가리킴", wrongLine.length === 0, wrongLine.slice(0, 4).map((r) => `${r.id}:${r.item}`).join(" / "));
}

// ── 3. KS 번호 ──────────────────────────────────────────────────────
function testKsNumbers(): void {
  const standards = loadTestStandards();
  const raw = new Set<string>();
  for (const line of annexText().split("\n")) for (const m of line.match(KS_NUMBER) ?? []) raw.add(squash(m));
  const rowsText = squash(standards.rows.map((r) => `${r.category} ${r.item} ${r.method} ${r.frequency} ${r.remarks}`).join(" "));
  const dropped = squash(standards.diagnostics.droppedTexts.join(" "));
  const missing = [...raw].filter((k) => !rowsText.includes(k) && !dropped.includes(k));
  check(`원문의 KS 번호 ${raw.size}종이 모두 행에 있음`, raw.size >= 400 && missing.length === 0, missing.slice(0, 8).join(","));
  const onlyDropped = [...raw].filter((k) => !rowsText.includes(k));
  check("삭제된 행에만 있던 KS 번호는 KS F 2573 하나", onlyDropped.join(",") === "KSF2573", onlyDropped.join(","));
  const withMethodKs = standards.rows.filter((r) => r.ksNumbers.length > 0).length;
  check("시험방법의 KS 번호를 행마다 뽑아 둠", withMethodKs > 1500 && standards.rows.some((r) => r.ksNumbers.includes("KS M ISO 2592")), String(withMethodKs));
  check("종별의 괄호 안 KS 규격을 따로 둠", standards.rows.some((r) => r.category.startsWith("철근콘크리트용봉강") && r.productStandards.join() === "KS D 3504"));
}

// ── 4. 원문 대조 표본 ───────────────────────────────────────────────
interface Golden {
  category: string;
  item: string;
  method?: string;
  frequency?: string[];
  remarks?: string[];
  section?: string;
}

/** 원문 표를 읽어 확인한 행 — 글자는 공백을 빼고 견준다 */
const GOLDEN: Golden[] = [
  // 표 1 — 세로로 합친 시험빈도·비고
  { category: "성토용 흙", item: "함수비", method: "KS F 2306", frequency: ["토취장마다", "재질변화시마다"], section: "토공사 및 기초공사" },
  { category: "성토용 흙", item: "다짐", method: "KS F 2312", frequency: ["토취장마다", "재질변화시마다"] },
  { category: "성토용 흙", item: "유기물 함량", method: "KS F 2104", frequency: ["필요시"] },
  { category: "성토용 흙", item: "토질조사", method: "보링 등", frequency: ["필요시"] },
  { category: "성토용 흙", item: "투수", method: "KS F 2322", frequency: ["토취장마다"], remarks: ["흙댐, 용수로, 배수로용 일반성토 및 표토", "공종에 따라"] },
  { category: "성토용 흙", item: "3축압축", method: "KS F 2346", remarks: ["흙댐, 용수로"] },
  // 표 1 — 한 칸을 다시 나눈 칸
  { category: "터파기", item: "지지력 > 확대기초", method: "KS F 2444", frequency: ["필요시"] },
  { category: "터파기", item: "지지력 > 말뚝기초 > 정재하", method: "KS F 2445", frequency: ["전체 말뚝 수량의 1% 이상", "교량하부구조는 말뚝 250개당 1회"], remarks: ["동재하시험을 선택적으로 적용"] },
  { category: "터파기", item: "지지력 > 말뚝기초 > 동재하", method: "KS F 2591" },
  { category: "되메우기 및 구조물뒷채움", item: "현장밀도", method: "KS F 2311", frequency: ["독립구조물 : 개소별 3층마다", "관로매설물 : 3층마다, 100미터마다"] },
  // 표 2 — 굳지 아니한 콘크리트
  { category: "굳지 아니한 콘크리트", item: "온도", method: "온도계에 의함", frequency: ["120세제곱미터마다"], section: "철근콘크리트공사" },
  { category: "굳지 아니한 콘크리트", item: "슬럼프 또는 슬럼프플로", method: "KS F 2402 또는 KS F 2594", frequency: ["배합이 다를 때마다", "120세제곱미터 미만인 경우 : 1일 타설량마다", "120세제곱미터 이상인 경우 : 120세제곱미터마다"] },
  { category: "굳지 아니한 콘크리트", item: "공기량", method: "KS F 2421 또는 KS F 2409 또는 KS F 2449" },
  { category: "굳지 아니한 콘크리트", item: "염화물 함유량", method: "KS F 4009 부속서 A" },
  { category: "굳지 아니한 콘크리트", item: "단위수량", method: "KCS 14 20 10 한국콘크리트학회 제규격(KCI-RM101)", remarks: ["시방배합 단위수량 ± 20 kg/m³ 이내"] },
  { category: "철근콘크리트용봉강", item: "인장강도", method: "KS D 3504", frequency: ["제조회사별", "제품규격별 50톤마다"] },
  { category: "에폭시피복철근", item: "피복두께", method: "KS D 3629", remarks: ["철근은 KS D 3504의 이형철근에 따름"] },
  // 표 3 — 한 시험종목에 시험방법이 둘
  { category: "강재(용접부반입검사)", item: "용접부의 내부결함", method: "KS B 0845", frequency: ["맞이음부재 총연장의 5/100 또는 10이음에 대하여 1장"], section: "철강구조물공사" },
  { category: "강재(용접부반입검사)", item: "용접부의 내부결함", method: "KS B 0896", frequency: ["완전 용입부위의 20개소에 대하여 1개소"] },
  { category: "강재(용접부반입검사)", item: "표면결함검사", method: "육안검사", frequency: ["무작위 추출하여 10% 이상"] },
  { category: "강교용접", item: "필렛용접 > 균열(자분탐상법 또는 침투액탐상법)", method: "KS D 0213 KS B 0816", frequency: ["매용접길이 3미터당 300밀리미터"] },
  { category: "강교용접", item: "필렛용접 > 용접비이드의 외관 및 형상", method: "육안검사 등", frequency: ["주부재의 이음마다"] },
  // 표 4·5
  { category: "강재파이프서포트", item: "평누름에 의한 압축 하중", method: "KS F 8001 또는 산업안전보건법에 따른 안전인증기준", frequency: ["제품규격마다(3개)", "공급자마다"], section: "가설기자재" },
  { category: "조립형 비계 및 동바리 부재 > 수직재", item: "압축 하중", method: "KS F 8021 또는 산업안전보건법에 따른 안전인증기준", remarks: ["안전인증기준의 종별명칭은 시스템비계 또는 시스템동바리 임"] },
  { category: "석재", item: "밀도 및 흡수율", method: "KS F 2518", frequency: ["골재원마다", "재질 변화시마다"] },
  { category: "석재", item: "압축강도", method: "KS F 2519", frequency: ["골재원마다"] },
  { category: "수도용 고무", item: "내구성 시험", method: "KS M 6613", frequency: ["필요시"] },
  // 표 6~9
  { category: "입도조정기층", item: "밀도 및 흡수율", method: "KS F 2503", remarks: ["굵은 골재"], section: "흙 및 혼합골재" },
  { category: "컷백아스팔트", item: "인화점", method: "KS M ISO 2592", frequency: ["제조회사별", "제품규격마다"], section: "아스팔트 포장" },
  { category: "도로표지용도료", item: "1종 (상온형), 2종 (수용성), 3종 (가열형) > 불점착 건조성", method: "KS M 6080", frequency: ["제조회사별", "제품규격마다"] },
  { category: "축제성토공", item: "다짐", method: "KS F 2312", frequency: ["재질변화시마다"], remarks: ["급속함수량 측정기 사용불가"], section: "수공구조물공사" },
  // 표 10~17
  { category: "속빈콘크리트블록", item: "압축 강도", method: "KS F 4002", frequency: ["제품 10,000매당"], section: "조적공사" },
  { category: "치장콘크리트 블록", item: "투수성", method: "KS F 4038", frequency: ["제품 3,000매당"] },
  { category: "콘크리트용에폭시수지계 방수·방식재", item: "도막 > 부착강도", method: "KS F 4716", section: "방수공사" },
  { category: "경질폴리우레탄폼 단열재", item: "압축 강도", method: "KS M ISO 844", frequency: ["시공면적 1,000제곱미터마다", "1,000매마다"], section: "단열·보온공사" },
  { category: "복층유리", item: "겉모양 및 치수", method: "KS L 2003", frequency: ["제조회사별", "제품규격별"], section: "유리공사" },
  { category: "문세트", item: "연직 하중 강도", method: "KS F 2631", section: "창호공사" },
  { category: "창세트", item: "수밀성", method: "KS F 2293", frequency: ["제품규격별"] },
  { category: "섬유강화시멘트판", item: "슬래그석고판 > 투수성", method: "KS L 5114", section: "마감공사" },
  { category: "다채무늬도료", item: "도료 > 비휘발분(%)", method: "KS M ISO 3251", section: "도장공사" },
  { category: "방청도료", item: "1종 > 비휘발분", method: "KS M 6030", frequency: ["제조회사별", "제품규격별"], remarks: ["알키드 프라이머"] },
];

function testGolden(): void {
  const { rows } = loadTestStandards();
  for (const g of GOLDEN) {
    const candidates = rows.filter(
      (r) =>
        squash(r.category).includes(squash(g.category)) &&
        squash(r.item) === squash(g.item) &&
        (g.method === undefined || squash(r.method) === squash(g.method)) &&
        (g.section === undefined || squash(r.section).includes(squash(g.section))),
    );
    const row = candidates[0];
    const label = `[${g.category}] ${g.item}${g.method ? ` — ${g.method}` : ""}`;
    if (!row) {
      const near = rows.filter((r) => squash(r.category).includes(squash(g.category))).slice(0, 3).map((r) => `${r.item} | ${r.method}`).join(" ‖ ");
      check(`표본 ${label}`, false, `행 없음 (가까운 행: ${near})`);
      continue;
    }
    const frequencyOk = (g.frequency ?? []).every((f) => squash(row.frequency).includes(squash(f)));
    const remarksOk = (g.remarks ?? []).every((f) => squash(row.remarks).includes(squash(f)));
    check(`표본 ${label}`, frequencyOk && remarksOk, `빈도: ${row.frequency} / 비고: ${row.remarks}`);
  }
  // 같은 시험종목이 종별마다 따로 있다 — 옆 종별의 값이 섞이지 않는다
  const brick = rows.filter((r) => r.section.includes("조적공사") && squash(r.item) === "압축강도");
  const frequencyOf = (name: string): string => brick.find((r) => r.category.startsWith(name))?.frequency ?? "";
  check("조적: 콘크리트벽돌 100,000매당 · 점토벽돌 50,000매당 · 속빈콘크리트블록 10,000매당", frequencyOf("콘크리트벽돌").includes("100,000매당") && frequencyOf("점토벽돌").includes("50,000매당") && frequencyOf("속빈콘크리트블록").includes("10,000매당"), brick.map((r) => `${r.category}:${r.frequency}`).join(" / "));
}

// ── 5. 찾기 ─────────────────────────────────────────────────────────
function testSearch(): void {
  const ids = (q: Parameters<typeof searchTestStandards>[0]): TestStandardRow[] => searchTestStandards(q).rows;
  const slump = ids({ query: "레미콘 슬럼프" });
  check("현장 용어: '레미콘 슬럼프' → 굳지 아니한 콘크리트의 슬럼프", slump.length === 1 && slump[0]?.method.includes("KS F 2402") === true);
  const density = ids({ query: "들밀도", section: "토공사" });
  check("현장 용어: '들밀도' → 현장밀도 (KS F 2311)", density[0]?.item === "현장밀도" && density[0]?.method === "KS F 2311", JSON.stringify(density[0]));
  check("구분으로 좁힘", ids({ section: "유리공사", limit: 200 }).every((r) => r.section.includes("유리공사")) && searchTestStandards({ section: "유리공사" }).total > 30);
  check("종별 + 시험종목", ids({ category: "문세트", item: "연직" })[0]?.method === "KS F 2631");
  const byKs = searchTestStandards({ ksNumber: "KS L 9016", limit: 200 });
  check("KS 번호로 찾음 (띄어쓰기 무시)", byKs.total >= 5 && byKs.rows.every((r) => r.method.includes("KS L 9016")) && searchTestStandards({ ksNumber: "ksl9016" }).total === byKs.total);
  const rebar = ids({ query: "철근 인장강도", limit: 5 });
  check("검색어는 종별·시험종목에서 찾은 행을 먼저 둠", rebar[0]?.category.includes("철근콘크리트용봉강") === true, rebar.map((r) => r.category).join(" / "));
  check("limit 을 지킴", ids({ section: "도장공사", limit: 7 }).length === 7 && searchTestStandards({ section: "도장공사", limit: 7 }).total > 100);
  check("없는 것은 0건", searchTestStandards({ query: "양자컴퓨터" }).total === 0);
}

// ── 6. 도구 ─────────────────────────────────────────────────────────
async function testTools(): Promise<void> {
  type Listing = { totalRows: number; sections: Array<{ section: string; rows: number; categories: string[] }>; edition: string; note: string; rules: Array<{ text: string }> };
  const listing = (await callTool("search_quality_test_standards", {}, { graph })).result as Listing;
  check("도구: 조건 없이 부르면 구분 17개와 종별 목록", listing.sections.length === EXPECTED_TABLES && listing.totalRows >= MIN_ROWS && listing.sections[1]?.categories.some((c) => c.startsWith("굳지 아니한 콘크리트")) === true);
  check("도구: 업무지침 제8조 원문을 함께 줌", listing.rules.some((r) => r.text.includes("별표 2와 같다")) && listing.rules.some((r) => r.text.includes("설계도서")));

  type Found = { total: number; returned: number; rows: TestStandardRow[]; notFound?: string; more?: string; edition: string };
  const response = await callTool("search_quality_test_standards", { category: "굳지 아니한 콘크리트" }, { graph });
  const found = response.result as Found;
  check("도구: 종별로 찾은 행에 시험방법·빈도·원문 줄", found.total === found.rows.length && found.rows.some((r) => r.item === "염화물 함유량" && r.method === "KS F 4009 부속서 A" && r.sourceLines.from > 0));
  check("도구: 근거에 판을 밝힘", response.basis.some((b) => String(b.note ?? "").includes("별표 2") && String(b.note ?? "").includes("고시 제")));
  const capped = (await callTool("search_quality_test_standards", { section: "철근콘크리트공사", limit: 10 }, { graph })).result as Found;
  check("도구: 더 있으면 알림", capped.returned === 10 && capped.total > 200 && typeof capped.more === "string");
  const none = (await callTool("search_quality_test_standards", { query: "양자컴퓨터" }, { graph })).result as Found;
  check("도구: 못 찾으면 설계도서를 따른다는 규정을 안내", none.total === 0 && (none.notFound ?? "").includes("설계도서"));
  let rejected = false;
  try {
    await callTool("search_quality_test_standards", { limit: 0 }, { graph });
  } catch {
    rejected = true;
  }
  check("도구: limit 범위 밖은 거절", rejected);
  const asText = (await callTool("search_quality_test_standards", { item: "슬럼프", limit: "3" }, { graph })).result as Found;
  check("도구: 숫자를 문자열로 보내도 받음", asText.returned <= 3 && asText.total >= 1);

  type Plan = { testStandardsByWorkType: Array<{ workType: string; section: string; total: number; rows: Array<{ item: string; method: string; frequency: string }>; more?: string }>; testStandard: { edition: string } };
  const plan = (await callTool("compile_quality_test_plan_references", { workTypes: ["work.concrete_placement", "work.earthwork"] }, { graph })).result as Plan;
  const concrete = plan.testStandardsByWorkType.find((w) => w.workType === "work.concrete_placement");
  check("품질시험계획: 콘크리트 타설 공종에 별표 2 의 슬럼프·압축강도 행", concrete?.rows.some((r) => r.item.startsWith("슬럼프") && r.method.includes("KS F 2402")) === true && concrete.rows.some((r) => squash(r.item).includes("압축강도")), JSON.stringify(concrete?.rows.map((r) => r.item)));
  const earth = plan.testStandardsByWorkType.find((w) => w.workType === "work.earthwork");
  check("품질시험계획: 행이 많은 공종은 일부만 싣고 이어 받는 법을 알림", earth !== undefined && earth.total > earth.rows.length && (earth.more ?? "").includes("search_quality_test_standards"));
  check("품질시험계획: 별표 2 의 판을 밝힘", /고시 제/.test(plan.testStandard.edition));

  // 공종 노드가 가리키는 구분·종별이 실제로 있다
  const broken: string[] = [];
  for (const entity of graph.entities.values()) {
    if (entity.type !== "WorkType") continue;
    const link = entity.meta?.["testStandard"] as { section?: string; categories?: string[] } | undefined;
    if (!link?.section) {
      broken.push(`${entity.id}: 연결 없음`);
      continue;
    }
    const inSection = searchTestStandards({ section: link.section, limit: 200 });
    if (inSection.total === 0) broken.push(`${entity.id}: 구분 '${link.section}' 없음`);
    for (const category of link.categories ?? []) {
      if (searchTestStandards({ section: link.section, category }).total === 0) broken.push(`${entity.id}: 종별 '${category}' 없음`);
    }
  }
  check("공종 19종이 모두 별표 2 의 구분·종별에 이어짐", broken.length === 0, broken.join(" / "));
}

async function main(): Promise<void> {
  testParsing();
  testKsNumbers();
  testGolden();
  testSearch();
  await testTools();
  console.log(`[test-standards] ${passed} 통과 / ${failed} 실패`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
