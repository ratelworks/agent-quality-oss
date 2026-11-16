// ─────────────────────────────────────────────────────────────────────────────
// test-real-usage.ts — AI 비서를 실제로 붙여 썼을 때 드러난 문제의 회귀 시험.
//
// 설치한 패키지에 AI 비서를 MCP 로 연결해 현장 질문을 던졌을 때(2026-11-16) 나온 입력을 그대로 쓴다.
// AI 비서는 사람이 쓰는 문장을 그대로 넘긴다 — 날짜·규격이 섞이고, 기준을 함께 적고,
// 값을 여러 개 적고, 시험 id 를 짐작해서 넣는다. 그런 입력에서 틀린 판정을 내지 않아야 한다.
//
//   1) 슬럼프 — 허용오차는 호칭 슬럼프에 따라 다르다. 호칭 슬럼프를 모르면 판정하지 않는다
//   2) 문장에서 시험 알아보기 — 시험 id 를 주지 않거나 없는 id 를 줘도 문장의 시험 이름으로 찾는다
//   3) 값이 여러 개 — 하나만 골라 판정하지 않는다
//   4) 압축강도 — 공시체 3개는 1회 시험이다. 무엇인지 모르는 목록은 되묻는다
//   5) 검색 — 여러 낱말·문장으로 찾기
//   6) 문서 — 형식이 틀린 입력으로는 한글 파일을 만들지 않는다
//   7) 검측 — 검측 지점의 이름만이 아니라 무엇을 확인하는지를 준다
// ─────────────────────────────────────────────────────────────────────────────

import { mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ───── 상수 ─────
// 저장 폴더는 도구를 불러오기 전에 임시 폴더로 돌린다(사용자 자료를 건드리지 않는다)
const STORE = mkdtempSync(join(tmpdir(), "quality-usage-test-"));
process.env["QUALITY_LOCAL_DIR"] = STORE;

/** 슬럼프 — [문장, 기대 판정, 설명에 들어 있어야 하는 말] (KCS 14 20 10 표 1.7-2: 25 ±10 · 50·65 ±15 · 80 이상 ±25) */
const SLUMP_CASES: Array<[string, string, string]> = [
  ["슬럼프 200mm, 호칭 슬럼프 180mm", "PASS", "155~205"],
  ["배합 슬럼프 180mm 인데 측정 슬럼프 200mm", "PASS", "측정 200mm"],
  ["슬럼프 150mm, 호칭 슬럼프 180mm", "FAIL", "허용하한 155"],
  ["슬럼프 120mm (지정 슬럼프 120mm)", "PASS", "95~145"],
  ["슬럼프 185mm (기준 150±25mm)", "FAIL", "허용상한 175"],
  ["슬럼프 150±25mm 기준, 측정 185mm", "FAIL", "측정 185mm"],
  ["슬럼프 210mm 규격 25-24-180", "FAIL", "허용상한 205"],
  ["2026-11-16, 14:30 3호차 슬럼프 160mm, 규격 25-24-150", "PASS", "측정 160mm"],
  ["슬럼프 70mm, 호칭 슬럼프 65mm", "PASS", "±15"],
  ["슬럼프 40mm, 호칭 슬럼프 25mm", "FAIL", "±10"],
  ["슬럼프 110mm, 호칭 슬럼프 100mm", "PASS", "±25"],
  // 판정하지 않는 경우
  ["슬럼프 185mm", "UNDETERMINED", "호칭 슬럼프 값이 없어"],
  ["슬럼프 55mm, 지정 슬럼프 40mm", "UNDETERMINED", "허용오차 표에 없는 값"],
  ["호칭 슬럼프 150mm, 1호차 160mm, 2호차 190mm", "UNDETERMINED", "여러 개"],
  ["슬럼프 180mm, 기준 150±30mm", "UNDETERMINED", "결과가 갈립니다"],
];

const { loadOntologySync } = await import("../../src/ontology/loader.js");
const { OntologyGraph } = await import("../../src/ontology/graph.js");
const { callTool } = await import("../../src/tool-registry.js");

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

interface Assessment {
  verdict: string;
  comparison: string;
  criterionId: string | null;
  resolvedTest: { id: string; name: string; by: string } | null;
  applicableCriterion: string | null;
  neededInputs: string[];
  suggestedNextSteps: string[];
  expertContext: string | null;
}

async function evaluate(input: Record<string, unknown>): Promise<{ a: Assessment; basisIds: string[] }> {
  const response = await callTool("evaluate_observation", input, { graph });
  return {
    a: (response.result as { expertAssessment: Assessment }).expertAssessment,
    basisIds: (response.basis as Array<{ type: string; id: string }>).filter((b) => b.type === "ontology").map((b) => b.id),
  };
}

// ── 1. 슬럼프 ─────────────────────────────────────────────────────
async function testSlump(): Promise<void> {
  for (const [sentence, verdict, phrase] of SLUMP_CASES) {
    const { a } = await evaluate({ observation: sentence });
    check(`슬럼프: ${sentence} → ${verdict}`, a.verdict === verdict && a.comparison.includes(phrase), `${a.verdict} | ${a.comparison}`);
  }
  const noTarget = (await evaluate({ observation: "슬럼프 185mm" })).a;
  check("슬럼프: 호칭 슬럼프를 모르면 무엇이 필요한지 알림", noTarget.neededInputs.some((n) => n.includes("호칭 슬럼프")));
  check("슬럼프: 판정기준 표기에 허용오차 표가 나옴", (noTarget.applicableCriterion ?? "").includes("80 mm 이상 ±25"), noTarget.applicableCriterion ?? "");
  const judged = (await evaluate({ observation: "슬럼프 200mm, 호칭 슬럼프 180mm" })).a;
  check("슬럼프: 판정했으면 적용한 범위를 표기", (judged.applicableCriterion ?? "").includes("180 ± 25"), judged.applicableCriterion ?? "");
}

// ── 2. 문장에서 시험 알아보기 ─────────────────────────────────────
async function testTestResolution(): Promise<void> {
  const strength = await evaluate({ observation: "압축강도 25.1MPa (설계기준강도 27MPa)" });
  check(
    "시험 id 없이: 문장의 '압축강도'로 시험을 찾음",
    strength.a.resolvedTest?.id === "test.compressive_strength" && strength.a.resolvedTest.by === "observation" && strength.a.criterionId !== null,
    JSON.stringify(strength.a.resolvedTest),
  );
  check("시험 id 없이: 설계기준강도만으로는 합격으로 단정하지 않음", strength.a.verdict === "UNDETERMINED" && strength.a.neededInputs.some((n) => n.includes("호칭강도")));

  // AI 비서가 짐작해서 넣은 없는 id
  const guessed = await evaluate({ observation: "노상 다짐도 92%", testId: "test.field_density" });
  check("없는 시험 id: 문장으로 시험을 찾아 판정", guessed.a.resolvedTest?.id === "test.soil_compaction" && guessed.a.verdict === "FAIL", `${guessed.a.verdict} ${JSON.stringify(guessed.a.resolvedTest)}`);
  check("없는 시험 id: 없는 id 였다고 알림", (guessed.a.expertContext ?? "").includes("test.field_density"), guessed.a.expertContext ?? "");
  check("없는 시험 id: 근거에 없는 id 를 싣지 않음", guessed.basisIds.every((id) => graph.get(id) !== undefined), guessed.basisIds.join(", "));

  const badCriterion = await evaluate({ observation: "공기량 4.2%", criterionId: "criteria.nope" });
  check("없는 판정기준 id: 문장으로 찾아 판정하고 알림", badCriterion.a.verdict === "PASS" && (badCriterion.a.expertContext ?? "").includes("criteria.nope"), `${badCriterion.a.verdict} | ${badCriterion.a.expertContext}`);

  const part = await evaluate({ observation: "다짐도 92%" });
  check("부위를 모르는 다짐도: 판정하지 않고 부위를 물음", part.a.verdict === "UNDETERMINED" && part.a.neededInputs.some((n) => n.includes("부위")));

  const none = await evaluate({ observation: "오늘 날씨가 좋다" });
  check("시험이 없는 문장: 알아보지 못했다고 답함", none.a.resolvedTest === null && none.a.comparison.includes("알아보지 못했습니다"));
  check(
    "시험이 없는 문장: 콘크리트 전용 안내를 붙이지 않음",
    none.a.suggestedNextSteps.every((s) => !s.includes("compile_concrete_pour_references")) && none.a.suggestedNextSteps.some((s) => s.includes("search_quality_ontology")),
    none.a.suggestedNextSteps.join(" / "),
  );
  const soilNext = (await evaluate({ observation: "다짐도 92%" })).a.suggestedNextSteps;
  check("콘크리트가 아닌 시험: 콘크리트 전용 안내를 붙이지 않음", soilNext.every((s) => !s.includes("compile_concrete_pour_references")), soilNext.join(" / "));

  const asphalt = await evaluate({ observation: "아스팔트 포장 두께 48mm" });
  check("아스팔트 포장 두께: 콘크리트 포장 시험으로 잘못 잇지 않음", asphalt.a.resolvedTest === null, JSON.stringify(asphalt.a.resolvedTest));
}

// ── 3. 값이 여러 개 · 날짜가 섞인 문장 ─────────────────────────────
async function testValues(): Promise<void> {
  for (const sentence of ["공기량 7.5, 4.2 %", "공기량 7.5%, 4.2%"]) {
    const { a } = await evaluate({ observation: sentence });
    check(`값 여러 개: ${sentence} → 하나만 골라 합격으로 내지 않음`, a.verdict === "UNDETERMINED" && a.comparison.includes("여러 개"), `${a.verdict} | ${a.comparison}`);
  }
  const dated = (await evaluate({ observation: "2026-11-16 공기량 4.2%" })).a;
  check("날짜가 섞인 문장: 날짜를 범위로 읽지 않음", dated.verdict === "PASS", `${dated.verdict} | ${dated.comparison}`);
  const stated = (await evaluate({ observation: "공기량 6.5%, 기준 4.5±1.5%" })).a;
  check("기준을 함께 적은 문장: 측정값을 읽어 판정", stated.verdict === "FAIL" && stated.comparison.includes("6.5"), `${stated.verdict} | ${stated.comparison}`);
  const mixed = (await evaluate({ observation: "슬럼프 160mm, 공기량 4.5%", testId: "test.air_content" })).a;
  check("서로 다른 항목을 함께 적은 문장: 값 목록으로 보지 않음", !mixed.comparison.includes("여러 개"), mixed.comparison);
}

// ── 4. 압축강도 ───────────────────────────────────────────────────
async function testStrength(): Promise<void> {
  const specimens = (await evaluate({ observation: "28일 압축강도 공시체 3개가 25.1, 26.4, 27.8 MPa, 호칭강도 27MPa" })).a;
  check(
    "공시체 3개: 평균(26.43)을 1회 시험값으로 봄",
    specimens.verdict === "UNDETERMINED" && specimens.comparison.includes("1회 시험값 26.43") && specimens.comparison.includes("충족"),
    specimens.comparison,
  );
  const unclear = (await evaluate({ observation: "압축강도 25.1, 26.4, 27.8 MPa, 호칭강도 27MPa" })).a;
  check("무엇인지 모르는 값 3개: 공시체인지 3회인지 되물음", unclear.verdict === "UNDETERMINED" && unclear.comparison.includes("공시체 3개의 값(1회 시험)인지"), unclear.comparison);
  const threeTests = (await evaluate({ observation: "압축강도 3회 시험값 25.1MPa, 26.4MPa, 27.8MPa, 호칭강도 24MPa" })).a;
  check("3회 시험값: 두 기준을 모두 확인해 판정", threeTests.verdict === "PASS" && threeTests.comparison.includes("연속 3회 평균"), threeTests.comparison);
  const labelFirst = (await evaluate({ observation: "호칭강도 27MPa, 압축강도 3회 26.1, 26.4, 25.8 MPa" })).a;
  check("기준 강도를 앞에 적어도 시험값에 섞지 않음", labelFirst.verdict === "FAIL" && !labelFirst.comparison.includes("27, 26.1"), labelFirst.comparison);

  const chain = await callTool(
    "chain_test_report_review",
    { material: "material.ready_mixed_concrete", observations: ["압축강도 3회 시험값 25.1, 26.4, 27.8 MPa, 호칭강도 24MPa", "슬럼프 160mm, 호칭 슬럼프 150mm", "공기량 4.2%"] },
    { graph },
  );
  const verdicts = (chain.result as { verdicts: Array<{ verdict: string }> }).verdicts.map((v) => v.verdict);
  check("성적서 검토 체인: 시험 id 없이 항목마다 시험을 찾아 판정", verdicts.join(",") === "PASS,PASS,PASS", verdicts.join(","));
}

// ── 5. 검색 ───────────────────────────────────────────────────────
async function testSearch(): Promise<void> {
  const search = async (query: string, entityType?: string): Promise<Array<{ id: string; type: string; matchedBy: string }>> => {
    const response = await callTool("search_quality_ontology", entityType ? { query, entityType } : { query }, { graph });
    return (response.result as { matches: Array<{ id: string; type: string; matchedBy: string }> }).matches;
  };
  const long = await search("압축강도 합격 판정 기준 fck 평균");
  check("여러 낱말 검색: 시험과 판정기준을 찾음", long.some((m) => m.id === "test.compressive_strength") && long.some((m) => m.type === "AcceptanceCriteria"), long.map((m) => m.id).join(", "));
  const typed = await search("압축강도 합격 판정 기준 fck 평균", "AcceptanceCriteria");
  check("여러 낱말 검색: 종류를 지정하면 그 종류만", typed.length > 0 && typed.every((m) => m.type === "AcceptanceCriteria"));
  const short = await search("슬럼프");
  check("이름 검색은 예전대로", short[0]?.id === "test.slump" && short[0].matchedBy !== "sentence", JSON.stringify(short[0]));
  const nothing = await search("주말 회식 장소 추천");
  check("상관없는 문장: 결과 없음", nothing.length === 0, nothing.map((m) => m.id).join(", "));
}

// ── 6. 문서 ───────────────────────────────────────────────────────
async function testDocument(): Promise<void> {
  const dir = join(STORE, "documents", "ncr");
  const count = (): number => (existsSync(dir) ? readdirSync(dir).length : 0);
  const base = { documentId: "NCR-1", projectName: "시험 현장", reportDate: "2026-11-16", description: "슬럼프 185mm" };
  type Generated = { hwpxSaved?: boolean; hwpxPath?: string; problems: string[]; markdown?: string };
  const generate = async (formValues: Record<string, unknown>, format = "hwpx"): Promise<Generated> =>
    (await callTool("generate_quality_document", { docId: "ncr", format, formValues }, { graph })).result as Generated;

  // AI 비서가 목록 항목을 묶음 값으로 넣은 경우 — 예전에는 {"action":…} 이 본문에 찍힌 파일이 저장됐다
  const bad = await generate({ ...base, immediateActions: [{ action: "해당 차량 반품" }] });
  check("목록에 묶음 값: 한글 파일을 만들지 않음", bad.hwpxSaved === false && bad.hwpxPath === undefined && count() === 0, `saved=${bad.hwpxSaved} files=${count()}`);
  check("목록에 묶음 값: 무엇을 고칠지 알림", bad.problems.some((p) => p.includes("목록의 항목은 글자로")), bad.problems.join(" / "));
  check("목록에 묶음 값: 본문은 미리 볼 수 있게 돌려줌", typeof bad.markdown === "string" && bad.markdown.length > 0);
  const nested = await generate({ ...base, reportedBy: { name: { first: "김", last: "품질" } } });
  check("하위 항목에 묶음 값: 문제로 알리고 저장하지 않음", nested.hwpxSaved === false && nested.problems.some((p) => p.includes("글자 하나로 적으세요")), nested.problems.join(" / "));
  const wrongChoice = await generate({ ...base, reportDate: "11월 16일" });
  check("날짜 형식이 틀림: 저장하지 않음", wrongChoice.hwpxSaved === false && count() === 0);

  // 사람 항목은 성명·직책 묶음으로 받는다 — AI 비서가 실제로 넣은 모양 그대로
  const good = await generate({
    ...base,
    immediateActions: ["해당 차량 반품"],
    correctiveActions: ["공급사에 원인 조사 요청"],
    owner: { name: "박현장", role: "품질관리자" },
    approver: { name: "이감리", role: "감리원" },
  });
  check("고친 입력: 한글 파일을 저장", good.hwpxSaved === true && typeof good.hwpxPath === "string" && count() === 1 && good.problems.length === 0, `saved=${good.hwpxSaved} files=${count()} ${good.problems.join(" / ")}`);
  const body = (await generate({ ...base, immediateActions: ["해당 차량 반품"], owner: { name: "박현장", role: "품질관리자" }, approver: "이감리" }, "md")).markdown ?? "";
  check("본문: 사람 항목의 성명·직책이 글자로 들어감", body.includes("박현장") && body.includes("품질관리자") && body.includes("이감리"));
  check("본문: 묶음 값의 표기({\"…\"})가 없음", !body.includes('{"') && !body.includes("[object"), body.slice(0, 200));

  // 빈 필수 항목은 저장을 막지 않는다(빈칸을 둔 초안은 쓸 수 있다)
  const draft = await generate({ documentId: "NCR-2" });
  check("빈 필수 항목만 있는 초안: 저장함", draft.hwpxSaved === true);

  // 양식이 '묶음'이라고만 하고 하위 항목을 정하지 않으면 AI 비서가 모양을 짐작한다 — 그런 항목이 없어야 한다
  const { getSchema, listSchemaIds } = await import("../../src/schemas/loader.js");
  const loose: string[] = [];
  for (const id of listSchemaIds()) {
    for (const section of getSchema(id)?.sections ?? []) {
      for (const field of section.fields) {
        const isObject = field.type === "object" || field.type === "array<object>";
        if (isObject && !(Array.isArray(field.fields) && field.fields.length > 0)) loose.push(`${id}.${field.name}`);
      }
    }
  }
  check("양식: 하위 항목을 정하지 않은 묶음 항목이 없음", loose.length === 0, loose.join(", "));
}

// ── 7. 검측 ───────────────────────────────────────────────────────
interface Checkpoint {
  id: string;
  name: string;
  stage: string | null;
  checkItems: string | null;
  reference: string | null;
  checkedAgainst: string | null;
}

async function testInspection(): Promise<void> {
  // "내일 슬래브 타설인데 타설 전에 뭘 확인하나" — 예전에는 검측 지점의 이름만 돌아왔다
  const before = await callTool("compile_inspection_references", { workType: "콘크리트 타설", stage: "before" }, { graph });
  const point = (before.result as { checkpoints: Checkpoint[] }).checkpoints[0];
  check(
    "타설 전 검측: 확인할 내용과 근거 조항·대조한 판을 줌",
    point !== undefined && (point.checkItems ?? "").includes("이물질") && (point.reference ?? "").includes("3.3.1") && (point.checkedAgainst ?? "").includes("KCS 14 20 10"),
    JSON.stringify(point).slice(0, 200),
  );
  const all = await callTool("compile_inspection_references", { workType: "콘크리트 타설" }, { graph });
  const stages = (all.result as { checkpoints: Checkpoint[] }).checkpoints;
  check("타설 전·중·후 검측 모두 확인 내용이 있음", stages.length === 3 && stages.every((c) => (c.checkItems ?? "").length > 50), stages.map((c) => `${c.id}:${(c.checkItems ?? "").length}`).join(", "));
  check("타설 중 검측: 허용 이어치기 시간간격(표 3.3-1)을 줌", stages.some((c) => (c.checkItems ?? "").includes("2.0시간") && (c.checkItems ?? "").includes("2.5시간")));
  check("타설 후 검측: 습윤 양생 기간(표 3.4-1)을 줌", stages.some((c) => (c.checkItems ?? "").includes("표 3.4-1") && (c.checkItems ?? "").includes("5일")));

  // 다른 경로로 불러도 같은 내용이 나온다
  const briefing = await callTool("chain_daily_quality_briefing", { workTypes: ["철근 배근"] }, { graph });
  check("일일 브리핑: 철근 검측의 확인 기준(표 3.4-1)을 줌", JSON.stringify(briefing.result).includes("표 3.4-1"));
  const profile = await callTool("get_work_quality_profile", { workType: "콘크리트 타설" }, { graph });
  check("공종 프로필: 검측 지점에 확인 내용이 있음", JSON.stringify(profile.result).includes("이물질"));
  const pour = await callTool("compile_concrete_pour_references", {}, { graph });
  check("타설 근거 패키지: 검측 지점에 확인 내용이 있음", JSON.stringify(pour.result).includes("이물질"));

  // 수록한 검측 지점 전부 — 확인 내용이 없는 것이 생기면 알린다
  const empty = [...graph.entities.values()].filter((e) => e.type === "InspectionCheckpoint" && typeof e.meta["rule"] !== "string").map((e) => e.id);
  check("검측 지점 전부에 확인 내용이 수록돼 있음", empty.length === 0, empty.join(", "));
}

async function main(): Promise<void> {
  await testSlump();
  await testTestResolution();
  await testValues();
  await testStrength();
  await testSearch();
  await testDocument();
  await testInspection();
  console.log(`[real-usage] ${passed} 통과 / ${failed} 실패`);
  if (failed > 0) process.exit(1);
}

await main();
