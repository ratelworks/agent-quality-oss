// ─────────────────────────────────────────────────────────────────────────────
// test-field-search.ts — 문장 검색과 현장 표현 자료의 회귀 시험.
//
//   1) 현장 표현 자료(ontology/field-phrases.json) — 가리키는 노드·조문이 실제로 있는지
//   2) 글 조각 내기 — 한글은 두 글자 단위, 영문·숫자는 낱말째
//   3) 상황 안내 도구 — 문장에서 찾은 것, 품질과 상관없는 문장, 예전처럼 짧게 넣은 공종
//   4) 현장 표현은 찾는 데만 쓰고 답에는 나오지 않는다
//
// 적중률은 test-field-questions.ts 가 잰다.
// ─────────────────────────────────────────────────────────────────────────────

import { loadOntologySync } from "../../src/ontology/loader.js";
import { OntologyGraph } from "../../src/ontology/graph.js";
import { loadLaws } from "../../src/ontology/laws.js";
import { bigrams, SentenceIndex } from "../../src/lib/sentence-search.js";
import { expandFieldTerms, loadFieldPhrases } from "../../src/knowledge/field-phrases.js";
import { searchLawArticlesBySentence, searchNodesBySentence, searchTestRowsBySentence } from "../../src/knowledge/field-search.js";
import { callTool } from "../../src/tool-registry.js";

// ───── 상수 ─────
const TOOL = "discover_relevant_domain";
/** 품질관리와 상관없는 문장 — 아무것도 내지 않아야 한다 */
const UNRELATED = [
  "오늘 점심은 뭘 먹을까",
  "주말에 비가 온다고 한다",
  "회식 장소를 어디로 잡을까",
  "휴가는 언제 가는 게 좋을까",
  "안전모를 안 쓴 사람이 있다",
  "fcn fcr fck",
  "월급은 언제 들어오나",
  "내일 몇 시에 출근해야 하나",
  "숙소는 누가 잡아 주나",
  "작업자가 사다리에서 떨어졌다",
  "소장님이 회의하자고 한다",
  "하도급 대금이 아직 안 들어왔다",
];
/** 지금은 걸러 내지 못하는 문장 — 결과가 나온다는 것을 숨기지 않고 적어 둔다(고쳐지면 위 목록으로 옮긴다) */
const KNOWN_LEAKS = ["차를 어디에 세워야 하나", "크레인 신호수가 자리에 없다"];

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

interface Answer {
  domainPackage: Record<string, Array<{ id: string; score: number }>>;
  lawArticles: Array<{ law: string; ref: string; title: string }>;
  testStandards: Array<{ id: string; category: string; item: string; frequency: string }>;
  primaryWorkType: { id: string } | null;
}

async function ask(situation: string): Promise<{ result: Answer; basis: Array<{ type: string; id: string }>; raw: string }> {
  const response = await callTool(TOOL, { situation }, { graph });
  return { result: response.result as Answer, basis: response.basis as Array<{ type: string; id: string }>, raw: JSON.stringify(response) };
}

const resultCount = (a: Answer): number => Object.values(a.domainPackage).flat().length + a.lawArticles.length + a.testStandards.length;

// ── 1. 현장 표현 자료 ──────────────────────────────────────────────
function testPhraseData(): void {
  const { terms, rowTerms, phrases } = loadFieldPhrases();
  check("현장 표현 자료를 읽음", Object.keys(terms).length > 0 && Object.keys(phrases).length > 0);

  const lawTargets = new Set<string>();
  for (const law of loadLaws()) {
    for (const a of law.articles) if (!a.deleted) lawTargets.add(`${law.id}:제${a.number}조${a.branch ? `의${a.branch}` : ""}`);
    for (const x of law.annexes) lawTargets.add(`${law.id}:${x.kind} ${x.key}`);
  }
  const unknown = Object.keys(phrases).filter((key) => !graph.entities.has(key) && !lawTargets.has(key));
  check("현장 표현이 가리키는 노드·조문이 모두 있음", unknown.length === 0, unknown.join(", "));

  const empty = [
    ...Object.entries(phrases).filter(([, list]) => list.length === 0 || list.some((p) => p.trim() === "")).map(([k]) => k),
    ...Object.entries({ ...terms, ...rowTerms }).filter(([k, list]) => k.trim() === "" || list.length === 0 || list.some((t) => t.trim() === "")).map(([k]) => k),
  ];
  check("빈 표현·빈 용어가 없음", empty.length === 0, empty.join(", "));
  const duplicated = Object.entries(phrases).filter(([, list]) => new Set(list).size !== list.length).map(([k]) => k);
  check("같은 표현을 두 번 적지 않음", duplicated.length === 0, duplicated.join(", "));
}

// ── 2. 글 조각 내기 ────────────────────────────────────────────────
function testBigrams(): void {
  check("한글은 두 글자 단위", JSON.stringify(bigrams("슬럼프가 질다")) === JSON.stringify(["슬럼", "럼프", "프가", "질다"]));
  check("띄어쓰기를 넘는 쌍은 만들지 않음", !bigrams("공기량 시험").includes("량시"));
  check("영문·숫자는 낱말째", JSON.stringify(bigrams("KS F 2311 fck")) === JSON.stringify(["ks", "2311", "fck"]));
  check("한글과 숫자가 붙어 있으면 나눔", JSON.stringify(bigrams("28일 강도")) === JSON.stringify(["28", "강도"]));

  const index = new SentenceIndex([
    { id: "a", title: "슬럼프 시험", body: "콘크리트 반죽이 내려앉는 높이를 잰다" },
    { id: "b", title: "공기량 시험", body: "콘크리트에 든 공기의 양을 잰다" },
  ]);
  check("문장과 가까운 글이 먼저", index.search("슬럼프가 너무 크다", 5)[0]?.id === "a");
  check("닿는 데가 없으면 내지 않음", index.search("오늘 날씨", 5).length === 0);
  check("세지 않을 조각을 빼면 그 조각만 겹친 글은 내지 않음", index.search("시험", 5, new Set(["시험"])).length === 0);
  check("같은 입력에 같은 결과", JSON.stringify(index.search("콘크리트 시험", 5)) === JSON.stringify(index.search("콘크리트 시험", 5)));
}

// ── 3. 현장 용어 ───────────────────────────────────────────────────
function testTerms(): void {
  check("현장 용어의 표준 말을 덧붙임", expandFieldTerms("들밀도 시험").includes("현장밀도"));
  check("용어가 없으면 그대로", expandFieldTerms("품질관리비 산출") === "품질관리비 산출");
  check("표에서만 쓰는 표기는 그 표를 찾을 때만", !expandFieldTerms("철근 시험").includes("봉강") && expandFieldTerms("철근 시험", true).includes("철근콘크리트용봉강"));
}

// ── 4. 상황 안내 도구 ──────────────────────────────────────────────
async function testDiscover(): Promise<void> {
  // 예전처럼 짧게 넣은 공종 — 공종을 알아보고 주변 노드를 펼친다
  const short = await ask("콘크리트 타설");
  check("짧게 넣은 공종: 공종을 알아봄", short.result.primaryWorkType?.id === "work.concrete_placement");
  check("짧게 넣은 공종: 시험이 따라옴", (short.result.domainPackage["TestItem"] ?? []).some((t) => t.id === "test.slump"));

  // 문장 — 노드·조문·시험기준 행
  const slump = await ask("레미콘이 너무 질게 와서 타설을 멈췄다");
  check("문장: 맞는 시험과 부적합이 나옴", (slump.result.domainPackage["TestItem"] ?? []).some((t) => t.id === "test.slump") && (slump.result.domainPackage["Nonconformance"] ?? []).some((n) => n.id === "ncr.slump_too_high"));
  const density = await ask("들밀도 시험은 얼마마다 해야 하나");
  check("문장: 품질시험기준 행과 빈도가 나옴", density.result.testStandards.some((r) => r.item.includes("현장밀도") && r.frequency.length > 0), JSON.stringify(density.result.testStandards.slice(0, 2)));
  check("문장: 시험기준 행을 냈으면 별표 2 를 근거로 밝힘", density.basis.some((b) => b.type === "law_text" && b.id === "quality_guideline:별표 2"));
  const staff = await ask("우리 현장은 품질관리자를 몇 명 둬야 하나");
  check("문장: 맞는 별표가 나옴", staff.result.lawArticles.some((a) => a.law === "btia_rule" && a.ref === "별표 5"), JSON.stringify(staff.result.lawArticles));
  check("문장: 조문을 냈으면 근거로 밝힘", staff.basis.some((b) => b.type === "law_text" && b.id === "btia_rule:별표 5"));
  check("문장: 조문은 법령 이름·제목과 함께", staff.result.lawArticles.every((a) => a.title.length > 0 && typeof (a as { lawName?: string }).lawName === "string"));

  // 직접 부르는 함수도 같은 결과
  check("함수: 노드", searchNodesBySentence(graph, "거푸집을 떼니 곰보가 났다").some((h) => h.entity.id === "ncr.honeycomb"));
  check("함수: 조문", searchLawArticlesBySentence("불량 레미콘은 어떻게 처리하나").some((a) => a.law === "quality_guideline" && a.ref === "제41조"));
  check("함수: 시험기준 행", searchTestRowsBySentence("스티로폼 단열재 시험").some((r) => r.category.includes("발포폴리스티렌")));

  // 품질과 상관없는 문장
  const leaked: string[] = [];
  for (const sentence of UNRELATED) {
    const a = await ask(sentence);
    if (resultCount(a.result) > 0) leaked.push(sentence);
  }
  check(`품질과 상관없는 문장 ${UNRELATED.length}개에는 아무것도 내지 않음`, leaked.length === 0, leaked.join(" / "));
  const empty = await ask(UNRELATED[0] ?? "");
  check("찾은 것이 없으면 없다고 밝힘", empty.basis.some((b) => b.id === "no_match") && empty.result.primaryWorkType === null);
  // 아직 걸러 내지 못하는 문장 — 고쳐지면 이 검사가 알려 준다
  let stillLeaking = 0;
  for (const sentence of KNOWN_LEAKS) if (resultCount((await ask(sentence)).result) > 0) stillLeaking += 1;
  check("알려진 한계: 걸러 내지 못하는 문장 목록이 지금 상태와 같음", stillLeaking === KNOWN_LEAKS.length, `${stillLeaking}/${KNOWN_LEAKS.length} — 걸러지게 됐으면 UNRELATED 로 옮긴다`);

  // 현장 표현은 찾는 데만 쓴다 — 답에 그 문장이 그대로 나오면 안 된다
  const phraseTexts = Object.values(loadFieldPhrases().phrases).flat().filter((p) => p.length >= 8);
  const exposed = [slump, density, staff, short].flatMap((a) => phraseTexts.filter((p) => a.raw.includes(p)));
  check("현장 표현 문장은 답에 나오지 않음", exposed.length === 0, exposed.slice(0, 3).join(" / "));
}

async function main(): Promise<void> {
  testPhraseData();
  testBigrams();
  testTerms();
  await testDiscover();
  console.log(`[field-search] ${passed} 통과 / ${failed} 실패`);
  if (failed > 0) process.exit(1);
}

await main();
