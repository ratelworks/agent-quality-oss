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
import { loadPenaltyItems } from "../../src/knowledge/penalty-points.js";
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
  const nothing = await callTool("search_quality_law_text", { query: "양자컴퓨터" }, { graph });
  check("낱말 검색: 없는 낱말은 0건이고 없다고 알린다", (nothing.result as { count: number; note: string }).count === 0 && (nothing.result as { note: string }).note.includes("없습니다"));
  const viaGuideline = await callTool("search_quality_management_guideline", { query: "겸직" }, { graph });
  check("지침 검색: 조항 요약에 없으면 조문 본문 결과를 함께 준다", (viaGuideline.result as { lawTextHits: Array<{ ref: string }> }).lawTextHits.some((h) => h.ref === "제91조"));

  const byLaw = await callTool("get_quality_law_article", { law: "건설기술 진흥법 시행령", article: "제89조" }, { graph });
  const r1 = byLaw.result as { law: { edition: string }; article: { text: string; title: string } };
  check("도구: 법령+조문으로 원문", r1.article.title === "품질관리계획 등의 수립대상 공사" && r1.article.text.includes("660제곱미터") && /제\d+호/.test(r1.law.edition));
  const byAnnex = await callTool("get_quality_law_article", { law: "시행규칙", annex: "별표 5" }, { graph });
  check("도구: 법령+별표로 원문", (byAnnex.result as { annex: { title: string } }).annex.title.includes("배치기준"));
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
  const ksTop = (ks.result as { items: Array<{ law: string; ref: string; paragraph?: string }> }).items[0];
  check("낱말 검색: 'KS 인증 시험 면제' → 시행령 제91조 제2항", ksTop?.law === "건설기술 진흥법 시행령" && ksTop.ref === "제91조" && ksTop.paragraph === "제2항", JSON.stringify(ksTop));
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
