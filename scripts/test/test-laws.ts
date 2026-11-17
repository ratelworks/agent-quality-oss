#!/usr/bin/env tsx
/**
 * test-laws.ts — 수록한 법령·고시 원문과, 그 원문에 기대는 자료의 회귀 시험 (네트워크 없음)
 *
 *   1. 수록본: 다섯 법령·고시가 있고 조문 번호가 1번부터 빠짐없이 이어진다(가지 조문 포함)
 *   2. 원문 닻: 호·목에만 있는 수치와 별표·서식의 항목이 수록본에 있다
 *   3. 온톨로지 노드의 본문이 수록 원문과 같다(조문은 전문, 잘라 실은 별표·서식은 실은 부분까지)
 *   4. 찾기 함수와 조문 조회 도구
 *   5. 선 그림 표 풀기
 *
 * 수록본이 현행판인지는 네트워크가 필요해 여기서 보지 않는다 — `npm run check:law-editions`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { callTool } from "../../src/tool-registry.js";
import { loadOntologySync } from "../../src/ontology/loader.js";
import { OntologyGraph } from "../../src/ontology/graph.js";
import { findAnnex, findArticle, findLaw, loadLaws, normalizeLawText, searchLaws } from "../../src/ontology/laws.js";
import { boxTableCells, parseBoxTables } from "../../src/lib/box-table.js";
import { QualityMcpError } from "../../src/lib/errors.js";
import { loadPenaltyItems, loadPenaltyLinks, penaltyWho } from "../../src/knowledge/penalty-points.js";
import { loadSanctionItems, sanctionByRef } from "../../src/knowledge/sanctions.js";
import { loadDutyLinks } from "../../src/knowledge/cm-duties.js";
import { matchPlanRow } from "../../src/lib/test-plan-fill.js";
import { loadTestStandards } from "../../src/knowledge/test-standards.js";
import { judgePlanTarget } from "../../src/knowledge/plan-rules.js";

// ── 상수 ────────────────────────────────────────────────────────────
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STANDARDS_DIR = resolve(ROOT, "src/ontology/graph/nodes/standards");
const EXPECTED_LAW_IDS = ["btia", "btia_decree", "btia_rule", "cm_guideline", "quality_guideline"];
const TRUNCATION_MARK = "… [이하 생략";
/** 노드 한 건이 여러 원문을 묶은 경우 — 원문 위치를 직접 적는다 */
const NODE_ANNEX_OVERRIDES: Record<string, { law: string; annex: string }> = {
  "form.test_plan_template": { law: "건설기술 진흥법 시행령", annex: "별표 9" },
};

const graph = new OntologyGraph(loadOntologySync());

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`없음: ${what}`);
  return value;
}

// ── 1. 수록본 ───────────────────────────────────────────────────────
function testBundles(): void {
  const laws = loadLaws();
  check("다섯 법령·고시가 수록됨", laws.map((l) => l.id).join(",") === EXPECTED_LAW_IDS.join(","), laws.map((l) => l.id).join(","));
  for (const law of laws) {
    const numbers = new Set(law.articles.map((a) => a.number));
    const max = Math.max(...numbers);
    const missing: number[] = [];
    for (let n = 1; n <= max; n += 1) if (!numbers.has(n)) missing.push(n);
    check(`${law.name}: 제1조~제${max}조가 빠짐없이 있음(조문 ${law.articles.length}개)`, missing.length === 0 && max > 0, `빠진 번호 ${missing.join(",")}`);
    const keys = law.articles.map((a) => a.key);
    check(`${law.name}: 조문 번호가 겹치지 않음`, new Set(keys).size === keys.length);
    check(`${law.name}: 판본 표기가 있음`, /제[\d-]+호/.test(law.promulgationNumber) && /^\d{4}-\d{2}-\d{2}$/.test(law.effectiveDate), `${law.promulgationNumber} ${law.effectiveDate}`);
    const empty = law.articles.filter((a) => a.text.trim().length < 5).map((a) => a.key);
    check(`${law.name}: 본문이 빈 조문 없음`, empty.length === 0, empty.join(","));
  }
  check("가지 조문이 수록됨(업무지침 제45조의2)", !!findArticle(must(findLaw("품질관리 업무지침"), "업무지침"), "제45조의2"));
}

// ── 2. 원문 닻 ──────────────────────────────────────────────────────
function testAnchors(): void {
  const decree = must(findLaw("건설기술 진흥법 시행령"), "시행령");
  const rule = must(findLaw("건설기술 진흥법 시행규칙"), "시행규칙");
  const act = must(findLaw("건설기술 진흥법"), "법");
  const a89 = must(findArticle(decree, "89"), "영 제89조").text;
  for (const phrase of ["500억원 이상인 건설공사", "연면적이 3만제곱미터 이상", "총공사비가 5억원 이상인 토목공사", "연면적이 660제곱미터 이상인 건축물의 건축공사", "총공사비가 2억원 이상인 전문공사"]) {
    check(`영 제89조 각 호: ${phrase}`, a89.includes(phrase));
  }
  check("법 제55조 제3항: 7일 이내 정보망 입력", normalizeLawText(must(findArticle(act, "55"), "법 제55조").text).includes("7일이내"));
  check("법 제60조 제1항: 국립ㆍ공립 시험기관 또는 건설엔지니어링사업자", must(findArticle(act, "60"), "법 제60조").text.includes("국립ㆍ공립 시험기관 또는 건설엔지니어링사업자"));
  const t9 = must(findAnnex(decree, "별표 9"), "영 별표 9").text;
  for (const phrase of ["시험 계획물량", "시험 횟수", "시험실 배치 평면도", "품질관리 업무 수행기간"]) check(`영 별표 9: ${phrase}`, t9.includes(phrase));
  // 서식의 열 이름은 좁은 칸에서 줄이 나뉘어 있어, 표를 칸으로 푼 뒤 본다
  const f42 = boxTableCells(must(findAnnex(rule, "별지 제42호"), "규칙 별지 제42호").text).map(normalizeLawText);
  for (const column of ["일련번호", "연월일", "시험ㆍ검사구분", "품질검사대상재료", "건설자재ㆍ부재를공급받은공장", "시험ㆍ검사장소", "시험ㆍ검사종목", "시험기준", "시험결과", "시험결과판정", "품질관리기술인", "건설사업관리기술인확인", "비고"]) {
    check(`규칙 별지 제42호 열: ${column}`, f42.includes(column));
  }
  const f43 = boxTableCells(must(findAnnex(rule, "별지 제43호"), "규칙 별지 제43호").text).map(normalizeLawText);
  for (const column of ["공종", "시험ㆍ검사종류(재료)", "계획", "실시", "합격", "불합격", "재시험", "비고"]) {
    check(`규칙 별지 제43호 열: ${column}`, f43.includes(column));
  }
}

// ── 3. 온톨로지 노드 ↔ 수록 원문 ────────────────────────────────────
function testNodesMatchBundle(): void {
  let articles = 0;
  let annexes = 0;
  const problems: string[] = [];
  for (const file of readdirSync(STANDARDS_DIR).filter((f) => f.endsWith(".jsonld"))) {
    const node = JSON.parse(readFileSync(resolve(STANDARDS_DIR, file), "utf8")) as { "@id": string; _meta?: Record<string, unknown> };
    const meta = node._meta ?? {};
    const body = meta["bodyText"];
    if (typeof body !== "string") continue;
    const id = node["@id"].replace(/^standard:/, "");
    const lawName = typeof meta["lawName"] === "string" ? meta["lawName"] : typeof meta["referenceDoc"] === "string" ? meta["referenceDoc"] : "";
    const override = NODE_ANNEX_OVERRIDES[id];
    const law = findLaw(override?.law ?? lawName);
    if (!law) {
      problems.push(`${id}: 수록하지 않은 법령 ${lawName}`);
      continue;
    }
    if (typeof meta["articleNo"] === "string") {
      const article = findArticle(law, meta["articleNo"]);
      // 노드 본문 첫 줄은 굵은 제목 줄이라 뺀다
      const nodeText = normalizeLawText(body.replace(/^\*\*[^\n]*\*\*\n/, ""));
      if (!article) problems.push(`${id}: 수록본에 없는 조문 ${meta["articleNo"]}`);
      else if (nodeText !== normalizeLawText(article.text)) problems.push(`${id}: 조문 본문이 수록 원문과 다름`);
      articles += 1;
      continue;
    }
    const section = override?.annex ?? (typeof meta["section"] === "string" ? meta["section"] : "");
    const annex = findAnnex(law, section.replace(/(별표|별지)(\d)/, "$1 $2"));
    if (!annex) {
      problems.push(`${id}: 수록본에 없는 별표·서식 ${section}`);
      continue;
    }
    const shown = normalizeLawText(body.split(TRUNCATION_MARK)[0] ?? "");
    if (!normalizeLawText(annex.text).includes(shown)) problems.push(`${id}: 별표·서식 본문이 수록 원문과 다름`);
    annexes += 1;
  }
  console.log(`[laws] 노드 대조 — 조문 ${articles}개 · 별표·서식 ${annexes}개`);
  check("온톨로지 노드 본문이 모두 수록 원문과 같음", problems.length === 0, problems.slice(0, 6).join(" / "));
  check("대조한 노드가 비어 있지 않음", articles >= 40 && annexes >= 30, `${articles}/${annexes}`);
  // 조문 노드에 각 호가 실려 있어야 한다 — 이전에는 항만 싣고 호를 버렸다
  const decree89 = graph.get("standard.law.btia_decree_89");
  check("영 제89조 노드 본문에 각 호의 수치가 있음", String(decree89?.meta?.["bodyText"] ?? "").includes("총공사비가 2억원 이상인 전문공사"));
}

// ── 4. 찾기와 조회 도구 ─────────────────────────────────────────────
async function testLookup(): Promise<void> {
  check("다른 이름으로 법령 찾기", findLaw("건진법 시행령")?.id === "btia_decree" && findLaw("「건설기술 진흥법 시행규칙」")?.id === "btia_rule" && findLaw("사업관리지침")?.id === "cm_guideline");
  check("수록하지 않은 법령은 null", findLaw("산업안전보건법") === null);
  const rule = must(findLaw("시행규칙"), "시행규칙");
  check("서식 가지 번호 찾기", findAnnex(must(findLaw("업무지침"), "업무지침"), "별지 제13호의2")?.title.includes("철강") === true);
  check("없는 조문은 null", findArticle(rule, "999") === null);
  check("낱말 찾기", searchLaws("품질검사 실시대장").some((h) => h.lawId === "btia_rule"));

  // 낱말로 조문 찾기 — 어느 조문인지 모르는 질문에서 비서가 조문에 닿는 길
  const topOf = async (query: string): Promise<string> => {
    const r = await callTool("search_quality_law_text", { query, limit: 3 }, { graph });
    const first = (r.result as { items: Array<{ law: string; ref: string }> }).items[0];
    return first ? `${first.law} ${first.ref}` : "(없음)";
  };
  check("낱말 검색: 즉시 반품 → 업무지침 제41조", (await topOf("즉시 반품")) === "건설공사 품질관리 업무지침 제41조");
  check("낱말 검색: 사전점검 레미콘 → 업무지침 제33조", (await topOf("사전점검 레미콘")) === "건설공사 품질관리 업무지침 제33조");
  // 조문에는 "겸직"이라는 말이 없다("각 호 외의 업무") — 현장 표현으로 찾는다
  check("낱말 검색: 겸직 → 시행령 제91조", (await topOf("겸직")) === "건설기술 진흥법 시행령 제91조");
  const byPhrase = await callTool("search_quality_law_text", { query: "겸직" }, { graph });
  const phraseHit = (byPhrase.result as { items: Array<{ matchedTerms: string[]; matchedByFieldPhrase: string[]; matchedAsLawWord?: Array<{ term: string; lawWord: string }>; lookup: { law: string; article?: string } }> }).items[0];
  // "겸직"은 조문 본문에 없다 — 현장 표현이나 조문이 쓰는 말("각 호 외의 업무")로 찾았다고 따로 알리고, 본문에서 찾은 낱말로 적지 않는다
  check(
    "낱말 검색: 본문에 없는 현장 말로 찾았음을 따로 알린다",
    phraseHit !== undefined &&
      !phraseHit.matchedTerms.includes("겸직") &&
      (phraseHit.matchedByFieldPhrase.includes("겸직") || phraseHit.matchedAsLawWord?.some((x) => x.term === "겸직" && x.lawWord === "각 호 외의 업무") === true) &&
      phraseHit.lookup.article === "제91조",
  );
  // 같은 조에 같은 일을 정한 항이 여럿이면 모두 보인다 — 사업관리지침 제56조 제5항("입회ㆍ확인")만 보고
  // 제11항 제5호("계속적인 입회 확인하에 시행")를 놓치면 "상시 입회 규정은 없다"는 틀린 답이 된다
  type ParaHit = { ref: string; law: string; paragraph?: string; snippet: string; alsoParagraphs?: Array<{ paragraph: string; snippet: string }> };
  const pour = (await callTool("search_quality_law_text", { query: "레미콘 타설 감리 입회" }, { graph })).result as { items: ParaHit[] };
  const art56 = pour.items.find((h) => h.ref === "제56조" && h.law.includes("사업관리방식"));
  const shown56 = art56 ? [{ paragraph: art56.paragraph ?? "", snippet: art56.snippet }, ...(art56.alsoParagraphs ?? [])] : [];
  check(
    "낱말 검색: 같은 조에서 똑같이 맞는 다른 항도 함께 준다(제56조 제11항 제5호 계속적인 입회)",
    shown56.some((p) => p.paragraph === "제11항 제5호" && p.snippet.includes("계속적인 입회")),
    JSON.stringify(shown56.map((p) => p.paragraph)),
  );
  // 긴 항(420자 넘음)은 앞에서 자르지 않고 머리글과 맞는 호를 보인다 — 제11항 제5호는 항의 뒤쪽에 있다
  const cont = (await callTool("search_quality_law_text", { query: "타설 계속 입회" }, { graph })).result as { items: ParaHit[] };
  const cont56 = cont.items.find((h) => h.ref === "제56조" && h.law.includes("사업관리방식"));
  check(
    "낱말 검색: 긴 항은 맞는 호를 보인다(제11항 제5호)",
    cont56?.paragraph === "제11항 제5호" && cont56.snippet.includes("계속적인 입회") && cont56.snippet.startsWith("⑪"),
    `${cont56?.paragraph} ${cont56?.snippet.slice(0, 80)}`,
  );
  const nothing = await callTool("search_quality_law_text", { query: "양자컴퓨터" }, { graph });
  check("낱말 검색: 없는 낱말은 0건이고 없다고 알린다", (nothing.result as { count: number; note: string }).count === 0 && (nothing.result as { note: string }).note.includes("없습니다"));
  const viaGuideline = await callTool("search_quality_management_guideline", { query: "겸직" }, { graph });
  check("지침 검색: 조항 요약에 없으면 조문 본문 결과를 함께 준다", (viaGuideline.result as { lawTextHits: Array<{ ref: string }> }).lawTextHits.some((h) => h.ref === "제91조"));

  const byLaw = await callTool("get_quality_law_article", { law: "건설기술 진흥법 시행령", article: "제89조" }, { graph });
  const r1 = byLaw.result as { law: { edition: string }; article: { text: string; title: string } };
  check("도구: 법령+조문으로 원문", r1.article.title === "품질관리계획 등의 수립대상 공사" && r1.article.text.includes("660제곱미터") && /제\d+호/.test(r1.law.edition));
  const byAnnex = await callTool("get_quality_law_article", { law: "시행규칙", annex: "별표 5" }, { graph });
  check("도구: 법령+별표로 원문", (byAnnex.result as { annex: { title: string } }).annex.title.includes("배치기준"));
  // 큰 별표(업무지침 별표 2 는 39만 자) — 통째로 주면 AI 비서가 읽지 못한다. 목차를 주고, 낱말을 주면 그 항목만
  type AnnexOut = { annex: { length: number; text?: string; sections?: string[]; note?: string; matches?: number; excerpts?: Array<{ section: string | null; header: string | null; text: string }> } };
  const bigAnnex = (await callTool("get_quality_law_article", { law: "품질관리 업무지침", annex: "별표 2" }, { graph })).result as AnnexOut;
  check(
    "도구: 큰 별표는 통째로 주지 않고 목차·찾는 법을 준다",
    bigAnnex.annex.length > 300_000 && bigAnnex.annex.text === undefined && (bigAnnex.annex.sections ?? []).includes("가. 토공사 및 기초공사") && (bigAnnex.annex.note ?? "").includes("find") && JSON.stringify(bigAnnex).length < 40_000,
    `${JSON.stringify(bigAnnex).length}자`,
  );
  const pile = (await callTool("get_quality_law_article", { law: "품질관리 업무지침", annex: "별표 2", find: "강관말뚝" }, { graph })).result as AnnexOut;
  const pileText = (pile.annex.excerpts ?? []).map((e) => `${e.header ?? ""}\n${e.text}`).join("\n");
  check(
    "도구: 큰 별표에서 낱말이 든 항목 전체를 표 머리와 함께(강관말뚝 — 200개마다·10이음당 1회)",
    pile.annex.matches === 1 && pileText.includes("200개마다") && pileText.includes("10이음당 1회") && pileText.includes("시험빈도") && pile.annex.excerpts?.[0]?.section === "가. 토공사 및 기초공사",
    JSON.stringify(pile.annex).slice(0, 200),
  );
  const pileDyn = (await callTool("get_quality_law_article", { law: "품질관리 업무지침", annex: "별표 2", find: "정재하 동재하" }, { graph })).result as AnnexOut;
  check("도구: 큰 별표 낱말 찾기 — 비고 칸까지(정재하 행의 '동재하시험을 선택적으로 적용')", (pileDyn.annex.excerpts ?? []).some((e) => e.text.includes("선택적으로")));
  // 절 제목에서 찾으면 그 절이 출처이고(앞 절로 잘못 붙지 않음) 그 절 표의 종별 이름을 준다
  const rcSection = (await callTool("get_quality_law_article", { law: "품질관리 업무지침", annex: "별표 2", find: "철근콘크리트공사" }, { graph })).result as { annex: { excerpts?: Array<{ section: string | null; sectionKinds?: string[] }> } };
  const rcFirst = rcSection.annex.excerpts?.[0];
  check(
    "도구: 큰 별표에서 절 제목으로 찾으면 그 절과 종별 이름(철근콘크리트공사 → 포틀랜드 시멘트 …)",
    rcFirst?.section === "나. 철근콘크리트공사" && (rcFirst.sectionKinds ?? []).includes("포틀랜드 시멘트 (KS L 5201)"),
    JSON.stringify(rcFirst).slice(0, 200),
  );
  const smallAnnex = (await callTool("get_quality_law_article", { law: "시행규칙", annex: "별표 5" }, { graph })).result as AnnexOut;
  check("도구: 작은 별표는 전문 그대로", typeof smallAnnex.annex.text === "string" && smallAnnex.annex.text.length === smallAnnex.annex.length);
  // 공종 — 앞 도구가 돌려준 id 를 그대로 넘겨도, 현장 말("아스콘 표층 포설")로 넣어도 알아본다
  type ResolveOut = { resolved: { id: string } | null };
  const byWorkId = (await callTool("resolve_worktype", { input: "work.road_pavement" }, { graph })).result as ResolveOut;
  const byFieldWord = (await callTool("resolve_worktype", { input: "아스콘 표층 포설" }, { graph })).result as ResolveOut;
  check("공종: id 와 현장 말(아스콘 표층 포설)을 모두 알아본다", byWorkId.resolved?.id === "work.road_pavement" && byFieldWord.resolved?.id === "work.road_pavement");
  const chainById = (await callTool("chain_quality_inspection", { workType: "work.road_pavement" }, { graph })).result as { resolvedWorkType?: { id: string } };
  check("공종: 검측 연결 도구가 공종 id 를 받는다", chainById.resolvedWorkType?.id === "work.road_pavement");
  // 하나도 알아보지 못해도 오류로 끝나지 않고 고를 수 있는 공종을 알린다(근거가 비어 내부 오류가 나던 일)
  const unknownBrief = (await callTool("chain_daily_quality_briefing", { workTypes: ["양자역학"] }, { graph })).result as { unresolvedWorkTypes: string[]; availableWorkTypes?: Array<{ id: string }> };
  // 불합격 뒤의 처리 — 레미콘 슬럼프·공기량·염화물 등은 즉시 반품(업무지침 제41조제1항), 확약서, 재시공 원칙을 원문으로 함께 준다
  type RejOut = { expertAssessment: { legalVerdict: string; ifRejected: null | { appliesIf: string; ref: string; item: { text: string }; ifAlreadyPlaced: { text: string }; relatedSanctions: Array<{ ref: string }>; documents?: Array<{ docId: string }> } } };
  const failSlump = ((await callTool("evaluate_observation", { observation: "슬럼프 230mm, 호칭 슬럼프 150mm" }, { graph })).result as RejOut).expertAssessment;
  check(
    "판정: 레미콘 슬럼프 불합격이면 즉시 반품(제41조제1항제1호)·재시공 원칙·자재 벌칙을 함께 준다",
    failSlump.legalVerdict === "FAIL" && failSlump.ifRejected?.ref.endsWith("제41조제1항제1호") === true && failSlump.ifRejected.item.text.includes("슬럼프") && failSlump.ifRejected.ifAlreadyPlaced.text.includes("재시공") && failSlump.ifRejected.relatedSanctions.some((x) => x.ref === "제88조 제6호"),
  );
  // 제41조의 반품 조건은 "해당 공사 시방기준" — 표준시방서 대체 기준으로 판정했으면 공사시방서로도 벗어났을 때만 적용한다고 단다
  const failAir = ((await callTool("evaluate_observation", { observation: "공기량 8%" }, { graph })).result as RejOut).expertAssessment;
  check("판정: 대체 기준(표준시방서)으로 낸 불합격의 반품 처리는 공사시방서 기준 확인을 조건으로 단다", failAir.legalVerdict === "FAIL" && (failAir.ifRejected?.appliesIf ?? "").includes("공사시방서"));
  const passSlump = ((await callTool("evaluate_observation", { observation: "슬럼프 160mm, 호칭 슬럼프 150mm" }, { graph })).result as RejOut).expertAssessment;
  check("판정: 합격이면 반품 처리를 붙이지 않는다", passSlump.legalVerdict === "PASS" && passSlump.ifRejected === null);
  // 법정 문서 점검(도구 직접 호출)에서 드러난 결함
  type PlanOut = { planTarget: { qualityPlan: string; testPlan: string; missingInputs: string[] } };
  const civil380 = ((await callTool("compile_quality_test_plan_references", { workKind: "civil", totalContractValue: 38_000_000_000, cmSupervised: true }, { graph })).result as PlanOut).planTarget;
  check("수립 대상: 토목공사는 다중이용 건축물 여부를 묻지 않고 판정한다(380억·감독 권한대행 → 품질시험계획)", civil380.qualityPlan === "not_applies" && civil380.testPlan === "applies" && !civil380.missingInputs.some((m) => m.includes("다중이용")));
  type GenOut = { markdown: string; frequencyFilled?: Array<{ testItem: string; frequency: string }>; frequencyCandidates?: Array<{ testItem: string; candidates: Array<{ frequency: string }> }> };
  const genMd = async (docId: string, formValues: Record<string, unknown>): Promise<GenOut> => (await callTool("generate_quality_document", { docId, format: "md", formValues }, { graph })).result as GenOut;
  const testPlanDoc = await genMd("quality_test_plan", { projectName: "OO천", testItems: [{ workType: "철근콘크리트공사", testItem: "철근 SD400 D16", plannedQuantity: "300톤" }, { workType: "철근콘크리트공사", testItem: "레미콘 25-24-120", plannedQuantity: "2,400㎥" }] });
  const qualityPlanDoc = await genMd("quality_plan", { projectName: "OO" });
  const headings = [testPlanDoc, qualityPlanDoc].flatMap((d) => d.markdown.split("\n").filter((l) => l.startsWith("## ")));
  check("문서 제목: 서식이 정한 장 번호에 번호를 또 붙이지 않는다", headings.length > 0 && !headings.some((h) => /^## \d+\. \d+\./.test(h)) && headings.includes("## 1. 일반사항"));
  check(
    "시험계획서: 별표 2 빈도가 하나로 정해지는 줄(철근)은 빈도 칸을 출처와 함께 채우고, 여럿인 줄(레미콘)은 후보를 준다",
    (testPlanDoc.frequencyFilled ?? []).some((f) => f.testItem.startsWith("철근") && f.frequency.includes("50톤")) &&
      testPlanDoc.markdown.includes("50톤마다 (업무지침 별표 2)") &&
      (testPlanDoc.frequencyCandidates ?? []).some((c) => c.testItem.startsWith("레미콘") && c.candidates.some((x) => x.frequency.includes("120세제곱미터"))),
  );
  // 시험 빈도 채움 — 현장 표현(자재 + 시험종목)으로도 그 행을 찾고, 별표 2 전 행에서 원문과 다른 빈도를 채우는 일이 없다
  const tidyFreq = (s: string): string => s.replace(/\s+/g, " ").trim();
  const oneFrequency = (work: string, item: string): string | null => {
    const m = matchPlanRow(work, item);
    const f = [...new Set(m.rows.map((r) => tidyFreq(r.frequency)).filter(Boolean))];
    return f.length === 1 ? (f[0] as string) : null;
  };
  const fieldCases: Array<[string, string, string]> = [
    ["철근콘크리트공", "레미콘 슬럼프", "슬럼프"],
    ["철근콘크리트공사", "콘크리트 압축강도", "압축 강도"],
    ["철근콘크리트공사", "공기량", "공기량"],
    ["토공", "노상 현장밀도", "현장밀도"],
    ["관로공", "되메우기 현장밀도", "현장밀도"],
    ["철근콘크리트공", "철근 인장강도(KS D 3504)", "인장강도"],
  ];
  const fieldMisses = fieldCases.filter(([w, t, item]) => {
    const m = matchPlanRow(w, t);
    return oneFrequency(w, t) === null || !m.rows.every((r) => r.item.includes(item));
  });
  check("시험계획서 빈도: 현장 표현(레미콘 슬럼프·콘크리트 압축강도·노상 현장밀도 등)으로 별표 2 의 그 행을 찾는다", fieldMisses.length === 0, fieldMisses.map((c) => c[1]).join(", "));
  {
    // 적은 KS 번호와 시험방법이 맞지 않으면(슬럼프에 압축강도 시험방법 KS F 2405) 다른 행의 빈도를 채우지 않는다
    const mismatch = matchPlanRow("", "레미콘 슬럼프 (KS F 2405)");
    const plan = await genMd("quality_test_plan", { testItems: [{ workType: "철근콘크리트공", testItem: "레미콘 슬럼프 (KS F 2405)" }, { workType: "철근콘크리트공", testItem: "레미콘 슬럼프 (KS F 2402)" }] });
    const planRows = plan.markdown.split("\n").filter((l) => /^\| [12] \|/.test(l));
    check(
      "시험계획서 빈도: 적은 KS 번호와 시험방법이 맞는 행이 없으면 칸을 비우고 확인을 구한다(맞으면 채운다)",
      mismatch.ksMismatch === "KS F 2405" && !(planRows[0] ?? "").includes("업무지침 별표 2") && (planRows[1] ?? "").includes("업무지침 별표 2") && plan.markdown.includes("KS F 2405 와 시험방법이 맞는 행"),
      planRows.join(" / "),
    );
  }
  check(
    "시험계획서 빈도: 여러 자재·단계에 걸치는 말(염화물·아스콘 온도)과 공종 없는 '아스콘 온도'는 채우지 않는다",
    oneFrequency("철근콘크리트공사", "염화물") === null && oneFrequency("아스팔트포장공", "아스콘 온도") === null && oneFrequency("", "아스콘 온도") === null,
  );
  {
    const stdRows = loadTestStandards().rows;
    let wrongFills = 0;
    let fills = 0;
    for (const r of stdRows) {
      const work = (r.section.split(">").pop() ?? "").replace(/^[^.)]*[.)]\s*/, "").trim();
      const cat = r.category.replace(/\([^)]*\)/g, " ").trim();
      for (const [w, t] of [[work, `${cat} ${r.item}`], [work, r.item], ["", `${cat} ${r.item}`]] as const) {
        const f = oneFrequency(w, t);
        if (f === null) continue;
        fills += 1;
        if (f !== tidyFreq(r.frequency)) wrongFills += 1;
      }
    }
    check("시험계획서 빈도: 별표 2 전 행을 종별·시험종목으로 넣어 원문과 다른 빈도를 채우는 일이 없다", fills > stdRows.length * 2 && wrongFills === 0, `채움 ${fills} · 틀린 채움 ${wrongFills}`);
  }
  // 문서 점검(작성 에이전트 재점검)에서 드러난 표기·숫자 결함
  const summaryItems = [{ workType: "철근콘크리트공", testKind: "슬럼프", planned: 20, executed: 9, passed: 9, failed: 1, retest: 0 }, { workType: "관로공", testKind: "현장밀도", planned: 36, executed: 12, passed: 11, failed: 0, retest: 0 }];
  const summaryDoc = await genMd("quality_inspection_summary", { projectName: "산술", items: summaryItems });
  const summaryReview = (await callTool("review_quality_document", { docId: "quality_inspection_summary", formValues: { projectName: "산술", items: summaryItems } }, { graph })).result as { findings: Array<{ code: string; message: string }> };
  const inconsistent = summaryReview.findings.filter((f) => f.code === "inconsistent");
  check(
    "성과 총괄표: 합격 + 불합격이 실시보다 많으면 알린다(결과 대기일 수 있는 '적은' 경우는 알리지 않는다)",
    summaryDoc.markdown.includes("합격 9 + 불합격 1 = 10 이 실시 9 보다 많습니다") && inconsistent.length === 1 && (inconsistent[0]?.message.startsWith("1번 줄") ?? false),
  );
  const registerPreview = await genMd("quality_inspection_register", { projectName: "x" });
  check(
    "서식 밖 실무 항목: 절 제목에서 떼고(제출 파일에 찍히지 않게) 미리보기 작성 안내로만 알린다",
    registerPreview.markdown.includes("## 2. 대장 관리\n") && !registerPreview.markdown.split("\n").some((l) => l.startsWith("## ") && l.includes("서식 밖")) && registerPreview.markdown.includes("법정 서식에 없는 실무 항목"),
  );
  const checklistHead = (await genMd("inspection_checklist", { items: [{ checkItem: "피복두께", criterion: "40mm 이상", verdict: "합격" }] })).markdown.split("\n").find((l) => l.startsWith("|") && l.includes("검사항목")) ?? "";
  check("검측 체크리스트: 열 이름이 별지 제36호(검사항목 · 검사 기준(시방서 또는 도면 등) · 합격·불합격)", checklistHead.includes("| 검사항목 |") && checklistHead.includes("검사 기준(시방서 또는 도면 등)") && checklistHead.includes("합격·불합격"));
  const registerHead2 = (await genMd("quality_inspection_register", { projectName: "x", entries: [{ seq: 1, criterion: "150±25mm" }] })).markdown.split("\n").find((l) => l.startsWith("| 일련번호")) ?? "";
  check("실시대장: 같은 키의 열 이름은 그대로 '시험 기준'(문서마다 따로 정한 이름이 다른 문서로 새지 않는다)", registerHead2.includes("| 시험 기준 |"));
  const deliveryRow = (await genMd("concrete_delivery_record", { strengthGrade: "25-24-150" })).markdown.split("\n").find((l) => l.includes("25-24-150")) ?? "";
  check("레미콘 기록지: '25-24-150' 은 규격 칸(업무지침 제38조제3항제3호 '규격 및 용적')", deliveryRow.startsWith("| 규격 |"));
  // 열이 많은 표(실시대장 15열 등)는 한글 파일을 가로 용지로 — 세로 A4 에서는 글자 단위로 줄이 바뀐다
  {
    const { markdownToHwpx } = await import("../../src/lib/hwpx-writer.js");
    const { unzip } = await import("../../src/lib/zip.js");
    const sectionOf = (docId: string, md: string): string => {
      return unzip(markdownToHwpx(md, { title: docId })).get("Contents/section0.xml")?.toString("utf8") ?? "";
    };
    const wide = sectionOf("register", (await genMd("quality_inspection_register", { projectName: "x" })).markdown);
    // 정본(DocLang)의 글은 Markdown 서식으로 다시 읽지 않는다 — "10*20*30" 이 기울임으로 읽혀 "102030" 이 되던 것.
    // 실제 경로(buildHwpxFromDoclang)로 본다 — 본문 칸·여러 줄 글·표 제목·제목·목록 모두
    {
      const { buildHwpxFromDoclang } = await import("../../src/lib/hwpx-export.js");
      const hwpxTexts = (xml: string): string[] =>
        [...(unzip(buildHwpxFromDoclang(xml).data).get("Contents/section0.xml")?.toString("utf8") ?? "").matchAll(/<hp:t>([^<]*)<\/hp:t>/g)].map((m) => (m[1] ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
      const tricky = ["10*20*30", "**굵게**", "x `code` y", "[링크](u)", "a\\|b", "~~취소~~", "<br>"];
      const lines = ["- 목록같은 줄", "# 제목같은 줄", "1. 번호같은 줄", "> 인용같은 줄", "| 표같은 줄 |", "---"];
      const dl = (await callTool("generate_quality_document", { docId: "defective_material_disposal_pledge", format: "doclang", formValues: { materialAndSpec: tricky.join(" ~ "), returnCause: lines.join("\n"), confirmers: tricky.map((role) => ({ role })) } }, { graph })).result as { doclang: string };
      const texts = hwpxTexts(dl.doclang);
      const foreign = hwpxTexts('<doclang xmlns="https://www.doclang.ai/ns/v0" version="0.9"><heading level="1">제목 a*b*c</heading><table><caption>규격 10*20*30</caption><ched/>가<ched/>나<nl/><fcel/>1*2*3<fcel/>[x](y)<nl/></table><list class="unordered"><ldiv/>**목록** 값</list></doclang>');
      const changed = [...tricky, ...lines].filter((v) => !texts.includes(v)).concat(["제목 a*b*c", "규격 10*20*30", "1*2*3", "[x](y)", "- **목록** 값"].filter((v) => !foreign.includes(v)));
      check("한글 파일: 정본의 값에 있는 서식 기호(* ` [ ] ~ < | 와 줄 첫머리 # - 1. > | ---)를 글자 그대로 옮긴다", changed.length === 0 && texts.includes(tricky.join(" ~ ")), changed.join(" , "));
    }
    const narrow = sectionOf("ncr", (await genMd("ncr", {})).markdown);
    check(
      "한글 파일: 10열 이상 표가 있으면 가로 용지(landscape NARROWLY, 표 너비 = 용지 높이 − 여백), 없으면 세로",
      wide.includes(`landscape="NARROWLY"`) && wide.includes(`<hp:sz width="72848"`) && narrow.includes(`landscape="WIDELY"`) && !narrow.includes(`landscape="NARROWLY"`),
    );
  }
  // 서식별 작성 기준(작성요령·대상 요건)이 문서 생성 결과에도 나온다 — 근거 패키지 도구에만 있던 것
  {
    const approvalDoc = (await callTool("generate_quality_document", { docId: "material_source_approval", format: "md", formValues: { projectName: "가" } }, { graph })).result as GenOut & { guidance: string | null };
    check(
      "문서 생성: 작성 기준(레미콘 1천㎥ 이상이면 공급원 승인 전 공장 사전점검 — 업무지침 제33조제1항)을 미리보기와 응답에 준다",
      approvalDoc.markdown.includes("작성 기준:") && approvalDoc.markdown.includes("사전점검") && (approvalDoc.guidance ?? "").includes("제33조제1항"),
    );
  }
  // 서식의 날인 칸은 비운 채 본문에 둔다 · 검측요청서의 공사 참여자 실명부(별지 제36호 제2쪽)
  {
    const summarySeal = (await genMd("quality_inspection_summary", { preparedBy: { name: "서지안" } })).markdown;
    check("날인 칸: 총괄표 '작성자 (서명 또는 인)' 칸을 비운 채 둔다", summarySeal.includes("| 작성자 (서명 또는 인) |  |"));
    const noRegister = (await genMd("inspection_request", { attachments: ["시공자의 검측 체크리스트"] })).markdown;
    const attached = (await genMd("inspection_request", { attachments: ["공사 참여자(기능공 포함) 실명부"] })).markdown;
    const inTable = (await genMd("inspection_request", { participants: [{ workDate: "2026-11-14", name: "김철근", position: "철근공" }] })).markdown;
    const warn = "실명부가 표에도 붙임에도 없습니다";
    check(
      "검측요청서: 실명부 표(작업일·작업위치 및 공종·…·서명)가 있고, 표에도 붙임에도 없을 때만 알린다(제86조)",
      noRegister.includes("| 번호 | 작업일 | 작업위치 및 공종 | 소속 | 직위 | 성명 | 생년월일(성별) | 공사한 내용 | 서명 |") && noRegister.includes(warn) && !attached.includes(warn) && !inTable.includes(warn),
    );
  }
  // 더한 법정 서식 4종 — 레미콘·아스콘 시공품질관리 점검표(별지 제11·12호), 실적보고서(별지 제18호), 불량자재폐기 확약서(별지 제13호)
  {
    const monthly = await genMd("monthly_test_report", {
      projectName: "가", reportMonth: "2026-11",
      items: [
        { workType: "철근콘크리트공", testKind: "슬럼프", planned: 20, prevExecuted: 6, prevPassed: 6, prevFailed: 0, prevRetest: 0, monthExecuted: 3, monthPassed: 2, monthFailed: 1, monthRetest: 1 },
        { workType: "관로공", testKind: "현장밀도", planned: 36, prevExecuted: 8, prevPassed: 8, prevFailed: 0, monthExecuted: 4, monthPassed: 4, monthFailed: 0, totalExecuted: 13 },
      ],
    });
    const row1 = monthly.markdown.split("\n").find((l) => l.startsWith("| 1 |")) ?? "";
    check(
      "실적보고서: 비운 누계는 전월까지 + 금월로 채우고, 적은 누계가 합과 다르면 알린다",
      row1.endsWith("| 9 | 8 | 1 | 1 |") && monthly.markdown.includes("누계 실시 13 이 전월까지 8 + 금월 4 = 12 와 다릅니다") && monthly.markdown.includes("더해 채웠습니다"),
      row1,
    );
    const mixed = await genMd("ready_mixed_placement_check", { projectName: "가", tests: [{ testKind: "슬럼프시험", specCriterion: "150±25mm", totalCount: 5, passCount: 5, failCount: 1 }] });
    check("레미콘 점검표: 합격 + 불합격이 총검사보다 많으면 알린다", mixed.markdown.includes("합격 5 + 불합격 1 = 6 이 총검사 5 보다 많습니다"));
    const pledge = (await callTool("generate_quality_document", { docId: "defective_material_disposal_pledge", format: "doclang", formValues: { truckNo: "12가3456" } }, { graph })).result as { doclang: string };
    check("확약서: 확약 문장이 결재·제출용 본문(DocLang)에 들어간다", pledge.doclang.includes("상기와 같이 반품 지시된 불량자재는 폐기처리 할 것을 확약합니다."));
    const slumpDocs = (failSlump.ifRejected?.documents ?? []).map((d) => d.docId).join(",");
    check(
      "판정: 레미콘 불합격 뒤의 처리에 이어서 쓸 문서(확약서 + 레미콘 점검표)를 docId 로 준다",
      slumpDocs === "defective_material_disposal_pledge,ready_mixed_placement_check",
      slumpDocs,
    );
  }
  const approval = JSON.stringify((await callTool("get_material_source_approval_schema", {}, { graph })).result);
  check("공급원 승인 요청서: 첨부 안내에 시험성과 대비표(사업관리방식 지침 제87조제7항)", approval.includes("시험성과 대비표") && approval.includes("제87조제7항"));
  const register = await genMd("quality_inspection_register", { projectName: "OO", entries: [{ seq: 1, inspectionDate: "2026-11-10", material: "골재", qcEngineerName: "최유진" }] });
  const registerHead = register.markdown.split("\n").find((l) => l.startsWith("| 일련번호")) ?? "";
  check("실시대장: 품질관리기술인·건설사업관리기술인 확인 칸을 성명·서명으로 나눈다(별지 제42호 15열)", registerHead.split("|").length - 2 === 15 && registerHead.includes("품질관리기술인 서명"));
  const rebarSheet = ((await callTool("evaluate_observation", { observation: "철근 SD400 D22 항복강도 412MPa 인장강도 548MPa" }, { graph })).result as { expertAssessment: { legalVerdict: string; observedValue: number | null } }).expertAssessment;
  check("판정: 기준을 찾지 못하면 여러 수의 평균을 측정값으로 내보내지 않는다", rebarSheet.legalVerdict === "UNDETERMINED" && rebarSheet.observedValue === null);
  check("일일 브리핑: 알 수 없는 공종만 주면 고를 수 있는 공종 목록을 준다", unknownBrief.unresolvedWorkTypes.includes("양자역학") && (unknownBrief.availableWorkTypes ?? []).some((w) => w.id === "work.road_pavement"));
  const byId = await callTool("get_quality_law_article", { articleId: "standard.law.btia_decree_89" }, { graph });
  const r3 = byId.result as { article: { bodyText: string; edition: string; scope: string } };
  check("도구: 노드 id 로 요약과 수록 원문", r3.article.bodyText.includes("500억원") && !!r3.article.scope && /시행/.test(r3.article.edition));
  for (const [name, input] of [
    ["수록하지 않은 법령", { law: "산업안전보건법", article: "1" }],
    ["없는 조문", { law: "시행령", article: "999" }],
    ["없는 별표", { law: "건설기술 진흥법", annex: "별표 1" }],
    ["입력 없음", {}],
  ] as const) {
    let code = "";
    try {
      await callTool("get_quality_law_article", input, { graph });
    } catch (err) {
      code = err instanceof QualityMcpError ? err.code : "다른 오류";
    }
    check(`도구: ${name}은 오류로 알림`, code === "NOT_FOUND" || code === "INVALID_INPUT", code);
  }
}

// ── 5. 선 그림 표 ───────────────────────────────────────────────────
function testBoxTable(): void {
  const rule = must(findLaw("시행규칙"), "시행규칙");
  const tables = parseBoxTables(must(findAnnex(rule, "별표 5"), "규칙 별표 5").text);
  const rows = tables[0]?.rows ?? [];
  check("별표 5: 머리 행과 등급 4행", rows.length === 5 && rows[0]?.join("|") === "대상공사구분|공사규모|시험ㆍ검사장비|시험실규모|건설기술인", String(rows.length));
  const special = normalizeLawText(rows[1]?.join("|") ?? "");
  check("별표 5 특급: 줄이 나뉜 수치를 이어 붙임(1,000억원)", special.includes("총공사비가1,000억원이상인건설공사또는연면적5만㎡이상인다중이용건축물"));
  check("별표 5 특급: 건설기술인 3명 구성", special.includes("품질관리경력3년이상인특급기술인1명이상") && special.includes("중급기술인이상인사람1명이상") && special.includes("초급기술인이상인사람1명이상"));
  check("별표 5 중급: 100억원·5,000㎡·시험실 18㎡", normalizeLawText(rows[3]?.join("|") ?? "").includes("총공사비가100억원이상인건설공사또는연면적5,000㎡이상") && rows[3]?.[3] === "18㎡이상");
}

// ── 6. 실무에서 자주 묻는 것 — 벌점 항목·긴 조문의 항·계획 대상·레미콘 규격 ─────────
async function testPracticeAnswers(): Promise<void> {
  // 벌점 항목: 별표 8 제5호 표의 점수 칸 수와 읽어 낸 항목 수가 같아야 한다(빠진 항목이 없다)
  const decree = must(findLaw("시행령"), "시행령");
  const annex8 = decree.annexes.find((a) => /벌점관리기준/u.test(a.title ?? ""));
  const table = (annex8?.text ?? "").slice((annex8?.text ?? "").indexOf("5. 벌점 측정기준"));
  const body = table.slice(0, Math.max(0, table.search(/\n\s*라\.\s*측정기관/u)));
  const pointCells = body.split("\n").filter((l) => { const c = l.split("│"); return c.length >= 4 && /^\s*\d+(?:\.\d+)?\s*$/u.test(c[3] ?? ""); }).length;
  const items = loadPenaltyItems();
  const at0 = (path: string): string => items.find((i) => i.path === path)?.text ?? "";
  check("벌점 항목: 표의 점수 칸 수만큼 읽음", items.length > 100 && items.length === pointCells, `${items.length} / ${pointCells}`);
  check("벌점 항목: 가목·나목·다목 모두", ["가목", "나목", "다목"].every((p) => items.some((i) => i.path.includes(` ${p} `))));
  // 글이 빠지지 않았는가 — 표의 내용 칸 글을 모두 이은 것과, 읽어 낸 항목(큰 항목 이름 + 작은 항목 글)을 차례로 이은 것이 같아야 한다.
  // 항목 수만 세면 줄바꿈 자리를 새 항목으로 잘못 읽어 글이 잘려도 모른다("…라 한 / 다)을 설계도서…")
  const squash = (t: string): string => t.replace(/\s+/gu, "");
  const stream = body
    .split("\n")
    .map((l) => l.split("│"))
    .filter((c) => c.length >= 4 && !/번호/u.test(c[1] ?? ""))
    .map((c) => (c[2] ?? "").replace(/^\s+[가-하]\)\s+/u, ""))
    .join("")
    // 삭제된 항목("삭제 <2024.3.5.>")은 점수가 없어 항목이 아니다
    .replace(/삭제\s*<[\d.\s]+>/gu, "");
  let rebuilt = "";
  let group = "";
  for (const i of items) {
    const head = i.path.match(/^(제5호 [가-하]목 \d+\))(.*)$/u);
    if (!head) continue;
    if (head[1] !== group) { group = head[1] as string; rebuilt += i.itemTitle; }
    if (head[2]) rebuilt += i.text;
  }
  check("벌점 항목: 표의 글이 항목에 빠짐없이 들어감", squash(stream) === squash(rebuilt), `표 ${squash(stream).length}자 / 항목 ${squash(rebuilt).length}자`);
  check("벌점 항목: 가목 1)가) 토사붕괴 조건까지", normalizeLawText(at0("제5호 가목 1)가)")).endsWith("토사붕괴가발생한경우"));
  const at = (path: string) => items.find((i) => i.path === path);
  check("벌점 항목: 가목 2)가) 균열관리 3점", at("제5호 가목 2)가)")?.points === 3 && normalizeLawText(at("제5호 가목 2)가)")?.text ?? "").includes("균열관리를하지"));
  check("벌점 항목: 가목 7)가) 주요 구조부 검토·확인 없이 시공 3점", at("제5호 가목 7)가)")?.points === 3 && normalizeLawText(at("제5호 가목 7)가)")?.text ?? "").includes("주요구조부"));
  check("벌점 항목: 가목 15)나) 슬럼프시험 미실시·타설완료시간 1점", at("제5호 가목 15)나)")?.points === 1 && normalizeLawText(at("제5호 가목 15)나)")?.text ?? "").includes("타설완료시간"));
  // 상황 → 벌점 연결 자료: 가리키는 항목이 모두 원문에 있어야 한다(법령이 바뀌면 여기서 알린다)
  const links = loadPenaltyLinks();
  const missingPaths = Object.values(links.topics).flatMap((t) => t.paths).filter((p) => !items.some((i) => i.path === p));
  const unknownTopics = [...Object.values(links.workTypes), ...Object.values(links.tools), ...Object.values(links.documents)].flat().filter((t) => !links.topics[t]);
  check("벌점 연결 자료: 항목 번호가 모두 원문에 있음", missingPaths.length === 0, missingPaths.join(", "));
  check("벌점 연결 자료: 가리키는 상황이 모두 정의됨", unknownTopics.length === 0, unknownTopics.join(", "));
  const badSanctionRefs = Object.values(links.topics).flatMap((t) => t.sanctions ?? []).filter((r) => !sanctionByRef(r));
  check("벌점 연결 자료: 형벌·과태료 호 번호가 모두 원문에 있음", badSanctionRefs.length === 0, badSanctionRefs.join(", "));
  // 누구에게 매기는 벌점인지 — 시공 쪽(가목)과 건설사업관리 쪽(나목)을 가린다
  check(
    "벌점 항목: 가목=시공 쪽, 나목=건설사업관리 쪽",
    items.filter((i) => i.path.includes("가목")).every((i) => penaltyWho(i.part).startsWith("시공 쪽")) &&
      items.filter((i) => i.path.includes("나목")).every((i) => penaltyWho(i.part).startsWith("건설사업관리 쪽")),
  );

  // 형벌·과태료 — 호마다 처벌 내용과 원문 글. 벌점만 알리면 "벌금이 아니라 벌점"이라는 틀린 답이 나온다
  const sanctions = loadSanctionItems();
  const actText = (findLaw("건설기술 진흥법")?.articles ?? []).map((a) => a.text).join("\n").replace(/<[^>]*>/gu, "").replace(/\s+/gu, "");
  check("벌칙: 제88조 제4호 = 품질시험·검사 미실시, 2년 이하 징역 또는 2천만원 이하 벌금", sanctionByRef("제88조 제4호")?.punishment === "2년 이하의 징역 또는 2천만원 이하의 벌금" && (sanctionByRef("제88조 제4호")?.text ?? "").includes("품질시험 및 검사를 하지 아니한"));
  check("과태료: 제91조 제3항 제12호의2 = 정보망 입력, 300만원 이하", sanctionByRef("제91조 제3항 제12호의2")?.punishment === "300만원 이하의 과태료" && sanctionByRef("제91조 제3항 제12호의2")?.kind === "과태료");
  const notInSource = sanctions.filter((x) => !actText.includes(x.text.replace(/\s+/gu, "")));
  check(`벌칙·과태료 호 ${sanctions.length}개의 글이 모두 원문 그대로`, sanctions.length >= 40 && notInSource.length === 0, notInSource.map((x) => x.ref).join(", "));
  type SanctionOut = { sanctionItems?: Array<{ ref: string }>; penaltyItems?: Array<{ ref: string; who: string }> };
  const asked = (await callTool("search_quality_law_text", { query: "품질시험 안 하면 처벌" }, { graph })).result as SanctionOut;
  check("낱말 검색: '품질시험 안 하면 처벌' → 벌점과 함께 형벌(제88조 제4호)도 준다", (asked.sanctionItems ?? []).some((x) => x.ref === "제88조 제4호") && (asked.penaltyItems ?? []).every((p) => p.who.length > 0));
  // 맞지 않는 형벌을 붙이면 그 자체가 틀린 사실이 된다 — "없이" 같은 말 하나만 맞은 호는 붙이지 않는다
  const noCrime = (await callTool("search_quality_law_text", { query: "검측 없이 시공 벌점" }, { graph })).result as SanctionOut;
  check("낱말 검색: '검측 없이 시공 벌점' → 무관한 형벌 호를 붙이지 않는다", (noCrime.sanctionItems ?? []).length === 0, JSON.stringify(noCrime.sanctionItems?.map((x) => x.ref)));
  const planPkg = (await callTool("compile_quality_test_plan_references", { workTypes: ["work.earthwork"] }, { graph })).result as { relatedSanctions?: Array<{ ref: string }> };
  check("시험계획 근거 묶음: 품질시험 미실시 형벌(제88조 제4호)을 함께 싣는다", (planPkg.relatedSanctions ?? []).some((x) => x.ref === "제88조 제4호"));

  // 감리 의무 조문 — 감독 권한대행 포함(제8절)·미포함(제7절)의 같은 이름 조문을 잇는다. 이름이 다르면 연결이 틀린 것
  const dutyLinks = loadDutyLinks();
  const cmLaw = findLaw(dutyLinks.law);
  const titleOf = (n: string): string | undefined => cmLaw?.articles.find((a) => String(a.number) === n && !a.branch && !a.deleted)?.title;
  const badDuty = Object.entries(dutyLinks.duties).filter(([, d]) => !titleOf(d.withDelegation) || titleOf(d.withDelegation) !== titleOf(d.withoutDelegation));
  check("감리 의무 연결: 두 절의 조문이 모두 있고 이름이 같다", Object.keys(dutyLinks.duties).length >= 5 && badDuty.length === 0, badDuty.map(([k]) => k).join(", "));
  const unknownDuty = [...Object.values(dutyLinks.workTypes), ...Object.values(dutyLinks.tools), ...Object.values(dutyLinks.documents)].flat().filter((d) => !dutyLinks.duties[d]);
  check("감리 의무 연결: 가리키는 의무가 모두 정의됨", unknownDuty.length === 0, unknownDuty.join(", "));
  type DutyOut = { cmDuties?: Array<{ ref: string; text: string; otherCase: { ref: string } }> };
  const rebarInsp = (await callTool("compile_inspection_references", { workType: "work.rebar_placement" }, { graph })).result as DutyOut;
  const d86 = rebarInsp.cmDuties?.find((d) => d.ref === "제86조");
  check(
    "검측 근거 묶음: 검측 업무 조 전체(제86조 — 계속적인 입회·검측일 연기 시 비용 부담)와 철근이면 시공계획검토(제91조)를 싣는다",
    d86 !== undefined && d86.text.includes("계속적인 입회") && d86.text.includes("건설사업관리용역사업자 부담") && d86.otherCase.ref === "제56조" && (rebarInsp.cmDuties ?? []).some((d) => d.ref === "제91조"),
  );
  const rebarMat = (await callTool("get_material_quality_profile", { material: "철근" }, { graph })).result as DutyOut;
  check("자재 근거: 반입 검수 조(제88조 — 송장 확인·공인계량소 계량)를 싣는다", (rebarMat.cmDuties ?? []).some((d) => d.ref === "제88조" && d.text.includes("공인계량소") && d.text.includes("송장")));
  const insp = await callTool("compile_inspection_references", { workType: "work.rebar_placement" }, { graph });
  const inspPen = (insp.result as { relatedPenalties?: Array<{ ref: string; points: number }> }).relatedPenalties ?? [];
  check("검측 근거 묶음: 검토·확인 없이 시공(가목 7)가) 3점)과 철근 배근 불량 벌점을 함께 줌", inspPen.some((p) => p.ref === "별표 8 제5호 가목 7)가)" && p.points === 3) && inspPen.some((p) => p.ref === "별표 8 제5호 가목 4)가)"));
  // 어기면 어떻게 되는지 — 검색 결과에 벌점 항목이 번호·점수와 함께 붙는다
  const pen = await callTool("search_quality_law_text", { query: "균열 벌점" }, { graph });
  const penItems = (pen.result as { penaltyItems?: Array<{ ref: string; points: number }> }).penaltyItems ?? [];
  check("낱말 검색: '균열 벌점' → 벌점 항목 가목 2)가) 3점", penItems[0]?.ref === "별표 8 제5호 가목 2)가)" && penItems[0]?.points === 3, JSON.stringify(penItems[0]));
  const noPen = await callTool("search_quality_law_text", { query: "즉시 반품" }, { graph });
  check("낱말 검색: 제재와 무관한 낱말 하나에는 벌점 항목을 붙이지 않음", (noPen.result as { penaltyItems?: unknown[] }).penaltyItems === undefined);
  // 긴 조문 — 낱말이 든 항을 짚는다
  const pour = await callTool("search_quality_law_text", { query: "타설 입회", law: "사업관리지침" }, { graph });
  const pourHit = (pour.result as { items: Array<{ ref: string; paragraph?: string; snippet: string }> }).items.find((i) => i.ref === "제56조");
  check("낱말 검색: '타설 입회' → 사업관리지침 제56조 제5항을 snippet 으로", pourHit?.paragraph === "제5항" && pourHit.snippet.includes("반드시 입회"), JSON.stringify(pourHit?.paragraph));
  const ks = await callTool("search_quality_law_text", { query: "KS 인증 시험 면제" }, { graph });
  const ksTop = (ks.result as { items: Array<{ law: string; ref: string; paragraph?: string; snippet: string }> }).items[0];
  // 긴 항은 맞는 호(제2호 한국산업표준 인증제품)를 보이되, 머리글의 단서(발주자가 필요하다고 인정하면 검사)는 자르지 않는다
  check(
    "낱말 검색: 'KS 인증 시험 면제' → 시행령 제91조 제2항 제2호, 단서 포함",
    ksTop?.law === "건설기술 진흥법 시행령" && ksTop.ref === "제91조" && ksTop.paragraph === "제2항 제2호" && ksTop.snippet.includes("필요하다고 인정") && ksTop.snippet.includes("한국산업표준 인증제품"),
    JSON.stringify(ksTop),
  );
  // 계획 대상 — 16층 이상은 다중이용 건축물(입력한 multiUse 와 다르면 층수를 따른다)
  const tall = judgePlanTarget({ workKind: "building", floorArea: 35_000, totalCost: 90_000_000_000, floors: 20, multiUse: false });
  check("계획 대상: 20층·연면적 3만5천㎡ → 품질관리계획(다중이용 아님 입력은 층수로 바로잡음)", tall.qualityPlan === "applies" && tall.caveats.some((c) => c.includes("16층 이상")));
  const low = judgePlanTarget({ workKind: "building", floorArea: 35_000, totalCost: 90_000_000_000, floors: 12 });
  check("계획 대상: 12층·용도 모름 → 판정 보류(용도 기준을 알려 줌)", low.qualityPlan === "undetermined" && low.missingInputs.some((m) => m.includes("5천㎡")));
  // 레미콘 규격 — 둘째 수가 호칭강도
  const mix = await callTool("compile_concrete_pour_references", { mixCode: "25-24-150" }, { graph });
  const reading = (mix.result as { mixCodeReading?: { nominalStrengthMPa?: number; nominalSlumpMm?: number; slump?: { range: number[] }; strength?: { singleAtLeast: number } } }).mixCodeReading;
  check("레미콘 규격 25-24-150: 호칭강도 24·슬럼프 125~175·1회 하한 20.5", reading?.nominalStrengthMPa === 24 && reading.slump?.range.join("~") === "125~175" && reading.strength?.singleAtLeast === 20.5, JSON.stringify(reading));
}

testBundles();
testAnchors();
testNodesMatchBundle();
await testLookup();
testBoxTable();
await testPracticeAnswers();
console.log(`[laws] ${pass} 통과 / ${fail} 실패`);
process.exit(fail > 0 ? 1 : 0);
