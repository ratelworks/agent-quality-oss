#!/usr/bin/env tsx
/**
 * test-conformance.ts — 법령·고시가 정한 내용과 도구·양식이 어긋나지 않는지 보는 회귀 시험 (네트워크 없음)
 *
 *   1. 판정 수치의 닻: 코드의 판정 상수와 같은 수치가 수록 원문에 있다
 *   2. 품질관리계획·품질시험계획 대상 판정(시행령 제89조)
 *   3. 품질관리 대상공사 구분과 배치기준(시행규칙 별표 5)
 *   4. 도구 출력: 법령에 없는 수치·표현이 다시 들어오지 않았는지
 *
 * 항목마다 어떤 지적을 고친 것인지 적는다 — 같은 잘못이 돌아오면 이 시험이 실패한다.
 */
import { callTool, getToolSpecs } from "../../src/tool-registry.js";
import { loadOntologySync } from "../../src/ontology/loader.js";
import { OntologyGraph } from "../../src/ontology/graph.js";
import { quoteExists } from "../../src/knowledge/cite.js";
import { judgePlanTarget, judgeStaffingGrade, staffingStandard, type ProjectFacts } from "../../src/knowledge/plan-rules.js";
import { getSchema, listSchemaIds } from "../../src/schemas/loader.js";
import { fieldLabel, subFieldLabel } from "../../src/schemas/fields.js";
import { findAnnex, findArticle, findLaw, normalizeLawText } from "../../src/ontology/laws.js";
import { boxTableCells, parseBoxTables } from "../../src/lib/box-table.js";

// ── 상수 ────────────────────────────────────────────────────────────
const EOK = 100_000_000;
const DECREE = "건설기술 진흥법 시행령";
const RULE = "건설기술 진흥법 시행규칙";

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

// ── 1. 판정 수치의 닻 ───────────────────────────────────────────────
function testAnchors(): void {
  const anchors: Array<[string, { law: string; article?: string; annex?: string; quote: string }]> = [
    ["품질관리계획: 건설사업관리 대상 500억원", { law: DECREE, article: "89", quote: "건설사업관리 대상인 건설공사로서 총공사비" }],
    ["품질관리계획: 500억원 이상", { law: DECREE, article: "89", quote: "500억원 이상인 건설공사" }],
    ["품질관리계획: 다중이용 건축물 3만㎡", { law: DECREE, article: "89", quote: "다중이용 건축물의 건설공사로서 연면적이 3만제곱미터 이상" }],
    ["품질시험계획: 토목 5억원", { law: DECREE, article: "89", quote: "총공사비가 5억원 이상인 토목공사" }],
    ["품질시험계획: 건축 660㎡", { law: DECREE, article: "89", quote: "연면적이 660제곱미터 이상인 건축물의 건축공사" }],
    ["품질시험계획: 전문 2억원", { law: DECREE, article: "89", quote: "총공사비가 2억원 이상인 전문공사" }],
    ["제외: 조경식재공사", { law: RULE, article: "49", quote: "조경식재공사" }],
    ["제외: 철거공사", { law: RULE, article: "49", quote: "철거공사" }],
    ["제외: 원자력시설공사", { law: DECREE, article: "89", quote: "원자력시설공사" }],
    ["특급: 1,000억원 또는 5만㎡ 다중이용", { law: RULE, annex: "별표 5", quote: "총공사비가 1,000억원 이상인 건설공사 또는 연면적 5만㎡ 이상인 다중이용 건축물의 건설공사" }],
    ["특급·고급: 제1항제1호 및 제2호 대상", { law: RULE, annex: "별표 5", quote: "영 제89조제1항제1호 및 제2호에 따라 품질관리계획을 수립해야 하는 건설공사" }],
    ["중급: 100억원 또는 5,000㎡ 다중이용", { law: RULE, annex: "별표 5", quote: "총공사비가 100억원 이상인 건설공사 또는 연면적 5,000㎡ 이상인 다중이용 건축물의 건설공사" }],
    ["초급: 품질시험계획 대상", { law: RULE, annex: "별표 5", quote: "영 제89조제2항에 따라 품질시험계획을 수립해야 하는 건설공사로서 중급품질관리 대상 공사가 아닌 건설공사" }],
  ];
  for (const [name, spec] of anchors) check(`닻 — ${name}`, quoteExists(spec), `${spec.law} ${spec.article ?? spec.annex}: ${spec.quote}`);
  // 대조군 — 이전 판이 쓰던 수치는 원문에 없다
  check("대조군: 700억 경계는 별표 5 에 없음", !quoteExists({ law: RULE, annex: "별표 5", quote: "700억" }));
  check("대조군: 없는 조문은 인용할 수 없음", !quoteExists({ law: RULE, article: "999", quote: "품질" }));
}

// ── 2. 계획 대상 판정 ───────────────────────────────────────────────
function testPlanTarget(): void {
  const base: ProjectFacts = { cmSupervised: false, multiUse: false, contractRequiresQualityPlan: false };
  const cases: Array<[string, ProjectFacts, string, string]> = [
    // [이름, 입력, 품질관리계획, 품질시험계획]
    ["전문공사 3억원 — 품질시험계획 대상(이전 판은 '5억 미만 대상 외')", { ...base, workKind: "specialty", totalCost: 3 * EOK }, "not_applies", "applies"],
    ["전문공사 1.9억원 — 대상 아님", { ...base, workKind: "specialty", totalCost: 1.9 * EOK }, "not_applies", "not_applies"],
    ["건축공사 1억원·700㎡ — 품질시험계획 대상(금액과 무관)", { ...base, workKind: "building", totalCost: 1 * EOK, floorArea: 700 }, "not_applies", "applies"],
    ["건축공사 30억원·600㎡ — 대상 아님", { ...base, workKind: "building", totalCost: 30 * EOK, floorArea: 600 }, "not_applies", "not_applies"],
    ["토목공사 5억원 — 품질시험계획 대상", { ...base, workKind: "civil", totalCost: 5 * EOK }, "not_applies", "applies"],
    ["토목공사 4.9억원 — 대상 아님", { ...base, workKind: "civil", totalCost: 4.9 * EOK }, "not_applies", "not_applies"],
    ["건설사업관리 대상 500억원 — 품질관리계획 대상", { ...base, cmSupervised: true, totalCost: 500 * EOK, workKind: "civil" }, "applies", "not_applies"],
    ["600억원이지만 건설사업관리 대상 아님 — 품질관리계획 아님, 품질시험계획", { ...base, totalCost: 600 * EOK, workKind: "civil" }, "not_applies", "applies"],
    ["다중이용 3만㎡ — 품질관리계획 대상", { ...base, multiUse: true, floorArea: 30_000, workKind: "building", totalCost: 100 * EOK }, "applies", "not_applies"],
    ["계약으로 정한 품질관리계획", { ...base, contractRequiresQualityPlan: true, workKind: "specialty", totalCost: 1 * EOK }, "applies", "not_applies"],
    ["철거공사 — 수립하지 않을 수 있음", { totalCost: 900 * EOK, cmSupervised: true, exempt: "demolition" }, "not_applies", "not_applies"],
    ["총공사비 3억원만 — 판정 못함(공사 종류에 따라 갈림)", { totalCost: 3 * EOK, cmSupervised: false, multiUse: false }, "not_applies", "undetermined"],
    ["총공사비 600억원만 — 판정 못함(건설사업관리 대상 여부 필요)", { totalCost: 600 * EOK }, "undetermined", "undetermined"],
    ["입력 없음 — 판정 못함", {}, "undetermined", "undetermined"],
  ];
  for (const [name, facts, qualityPlan, testPlan] of cases) {
    const j = judgePlanTarget(facts);
    check(`대상 판정 — ${name}`, j.qualityPlan === qualityPlan && j.testPlan === testPlan, `${j.qualityPlan}/${j.testPlan} · ${j.conclusion}`);
  }
  const partial = judgePlanTarget({ totalCost: 3 * EOK, cmSupervised: false, multiUse: false });
  check("판정 못함일 때 필요한 입력을 알려 줌", partial.missingInputs.includes("공사 종류(토목·건축·전문)"), partial.missingInputs.join(","));
  const decided = judgePlanTarget({ workKind: "specialty", totalCost: 3 * EOK, cmSupervised: false, multiUse: false });
  check("판정 근거가 원문 문구임", decided.grounds.some((g) => g.includes("총공사비가 2억원 이상인 전문공사")), decided.grounds.join(" / "));
}

// ── 3. 대상공사 구분과 배치기준 ─────────────────────────────────────
function testStaffing(): void {
  const standard = staffingStandard();
  check("배치기준 표: 네 구분", standard.rows.map((r) => r.grade).join(",") === "special,high,mid,entry");
  check("배치기준 비고 두 항", standard.notes.length === 2 && standard.notes[0]?.startsWith("1.") === true && standard.notes[1]?.startsWith("2.") === true, String(standard.notes.length));
  const staffCount = (text: string): number => (text.match(/1명 이상/g) ?? []).length;
  const byGrade = Object.fromEntries(standard.rows.map((r) => [r.grade, r]));
  check("특급 3명·고급 3명·중급 2명·초급 1명(이전 판은 2·2·1·1)", staffCount(byGrade["special"]?.staff ?? "") === 3 && staffCount(byGrade["high"]?.staff ?? "") === 3 && staffCount(byGrade["mid"]?.staff ?? "") === 2 && staffCount(byGrade["entry"]?.staff ?? "") === 1);
  check("품질관리 경력 3·2·1년", /경력 3\s*년/.test(byGrade["special"]?.staff ?? "") && /경력 2\s*년/.test(byGrade["high"]?.staff ?? "") && /경력 1\s*년/.test(byGrade["mid"]?.staff ?? ""));
  check("시험실 50㎡·50㎡·18㎡·18㎡", standard.rows.map((r) => r.labSize.replace(/\s/g, "")).join(",") === "50㎡이상,50㎡이상,18㎡이상,18㎡이상");

  const cm = { cmSupervised: true, multiUse: false, contractRequiresQualityPlan: false } as const;
  const none = { cmSupervised: false, multiUse: false, contractRequiresQualityPlan: false } as const;
  const cases: Array<[string, ProjectFacts, string | null]> = [
    ["건설사업관리 대상 1,000억원 → 특급", { ...cm, totalCost: 1_000 * EOK, workKind: "civil" }, "special"],
    ["건설사업관리 대상 700억원 → 고급(이전 판은 특급)", { ...cm, totalCost: 700 * EOK, workKind: "civil" }, "high"],
    ["건설사업관리 대상 500억원 → 고급", { ...cm, totalCost: 500 * EOK, workKind: "civil" }, "high"],
    ["다중이용 5만㎡ → 특급", { ...none, multiUse: true, floorArea: 50_000, totalCost: 300 * EOK, workKind: "building" }, "special"],
    ["다중이용 3만㎡ → 고급", { ...none, multiUse: true, floorArea: 30_000, totalCost: 300 * EOK, workKind: "building" }, "high"],
    ["건설사업관리 대상 아님 700억원 → 중급(품질관리계획 대상이 아니므로)", { ...none, totalCost: 700 * EOK, workKind: "civil" }, "mid"],
    ["100억원 → 중급", { ...none, totalCost: 100 * EOK, workKind: "civil" }, "mid"],
    ["다중이용 5,000㎡·50억원 → 중급", { ...none, multiUse: true, floorArea: 5_000, totalCost: 50 * EOK, workKind: "building" }, "mid"],
    ["토목 99억원 → 초급", { ...none, totalCost: 99 * EOK, workKind: "civil" }, "entry"],
    ["전문 3억원 → 초급", { ...none, totalCost: 3 * EOK, workKind: "specialty" }, "entry"],
    ["토목 4억원 → 구분 없음(품질시험계획 대상 아님)", { ...none, totalCost: 4 * EOK, workKind: "civil" }, null],
    ["700억원만 → 판정 못함", { totalCost: 700 * EOK }, null],
  ];
  for (const [name, facts, grade] of cases) {
    const j = judgeStaffingGrade(facts);
    check(`구분 판정 — ${name}`, j.grade === grade, `${j.grade} · ${j.conclusion}`);
  }
  const open = judgeStaffingGrade({ totalCost: 700 * EOK });
  check("판정 못함일 때 후보와 필요한 입력을 알려 줌", open.candidates.length > 1 && open.missingInputs.length > 0);
}

// ── 4. 도구 출력 ────────────────────────────────────────────────────
async function testToolOutputs(): Promise<void> {
  const qc = JSON.stringify((await callTool("compile_qc_assignment_notice_references", { totalContractValue: 700 * EOK }, { graph })).result);
  check("배치 도구: 700억 입력에 등급을 단정하지 않음", !qc.includes("특급 권장") && qc.includes("가릴 수 없습니다"));
  check("배치 도구: 법령에 없는 구분 기준(700억·공기·공종·상주)을 말하지 않음", !/700억|공기\/공종|상주\/비상주|별표7/.test(qc));
  check("배치 도구: 별표 5 원문 수치가 들어 있음", qc.includes("1,000억원") && qc.includes("품질관리 경력 3"));
  check("배치 도구: 신고 서식이 법령에 없음을 밝힘", qc.includes("배치 신고 조항과 전용 서식이 없습니다") && qc.includes("현장기술인 지정신고서"));

  const qtp = (await callTool("compile_quality_test_plan_references", { totalContractValue: 3 * EOK, workKind: "specialty", cmSupervised: false, multiUse: false }, { graph })).result as {
    planTarget: { testPlan: string };
    legalContents: { lines: string[] };
  };
  const qtpText = JSON.stringify(qtp);
  check("시험계획 도구: 전문공사 3억원을 대상으로 판정", qtp.planTarget.testPlan === "applies");
  check("시험계획 도구: '5억 미만 대상 외'·'완화 불가'·'발주청 승인' 표현이 없음", !/5억 미만|완화 불가|발주청 승인/.test(qtpText));
  check("시험계획 도구: 별표 9 의 법정 항목을 모두 실음", ["다. 시험 계획물량", "마. 시험 횟수", "마. 시험실 배치 평면도", "다. 품질관리 업무 수행기간"].every((l) => qtp.legalContents.lines.includes(l)));
  check("시험계획 도구: 빈도 조정 근거가 원문 문장", qtpText.includes("시험빈도를 조정할 수 있다") && qtpText.includes("착공"));

  const request = JSON.stringify((await callTool("compile_inspection_request_references", {}, { graph })).result);
  check("검측요청 도구: 법령에 없는 요청 기한(24~48시간·8시간)과 '미입회 불인정'을 말하지 않음", !/24~48|8시간|인정되지 않음/.test(request) && request.includes("정해져 있지 않습니다"));
  const register = JSON.stringify((await callTool("compile_quality_inspection_register_references", {}, { graph })).result);
  check("실시대장 도구: 7일 이내 정보망 입력과 과태료 근거를 원문으로 줌", register.includes("7일 이내") && register.includes("거짓으로 입력한 자"));
  check("실시대장 도구: '매일 누적·비치 의무'·'분기·연 단위 제출'·KOLAS 를 말하지 않음", !/매일 누적|비치 의무|분기·연|KOLAS/.test(register));
  const basisMap = JSON.stringify((await callTool("map_quality_basis", { workType: "콘크리트 타설" }, { graph })).result);
  check("근거 지도: 기준 순서가 법정 서열이 아님을 밝힘", basisMap.includes("법령이 정한 서열이 아니라") && basisMap.includes("설계도서에 반영하여야 한다"));
  // 도구 설명 전체 — 고친 표현이 되돌아오지 않게
  const descriptions = getToolSpecs().map((t) => `${t.name}: ${t.description}`).join("\n");
  check("도구 설명: KOLAS·24~48h·매일 누적·§57 전문기관·발주청 승인 표현이 없음", !/KOLAS|24~48|매일 누적|전문기관|발주청 승인/.test(descriptions), descriptions.split("\n").filter((l) => /KOLAS|24~48|매일 누적|전문기관|발주청 승인/.test(l)).join(" / ").slice(0, 300));
}

// ── 5. 문서 양식 ↔ 법령·서식 원문 ───────────────────────────────────
function testSchemas(): void {
  let citations = 0;
  const bad: string[] = [];
  const unclassified: string[] = [];
  for (const id of listSchemaIds()) {
    const schema = getSchema(id);
    if (!schema) continue;
    if (!schema.classification) unclassified.push(id);
    if (!schema.citations || schema.citations.length === 0) bad.push(`${id}: 인용 없음`);
    for (const spec of schema.citations ?? []) {
      citations += 1;
      if (!quoteExists(spec)) bad.push(`${id}: ${spec.law} ${spec.article ?? spec.annex} — "${spec.quote}"`);
    }
    if (schema.officialForm) {
      const law = findLaw(schema.officialForm.law);
      if (!law || !findAnnex(law, schema.officialForm.annex)) bad.push(`${id}: 따르는 서식이 수록본에 없음 — ${schema.officialForm.annex}`);
    }
    if ((schema.classification === "statutory_form" || schema.classification === "notice_form" || schema.classification === "statutory_content") && !schema.officialForm) {
      bad.push(`${id}: 서식을 따르는 문서인데 officialForm 이 없음`);
    }
  }
  console.log(`[conformance] 양식 인용 ${citations}건`);
  check("모든 양식에 법령과의 관계(classification)가 있음", unclassified.length === 0, unclassified.join(","));
  check("양식의 인용 구절이 모두 수록 원문에 있음", bad.length === 0, bad.slice(0, 8).join(" / "));
  check("인용이 비어 있지 않음", citations >= 60, String(citations));

  const rule = findLaw("건설기술 진흥법 시행규칙");
  const decree = findLaw("건설기술 진흥법 시행령");
  const guideline = findLaw("건설공사 품질관리 업무지침");
  if (!rule || !decree || !guideline) throw new Error("수록 원문 없음");
  const columnsOf = (docId: string, fieldName: string): string[] => {
    const field = getSchema(docId)?.sections.flatMap((s) => s.fields).find((f) => f.name === fieldName);
    return (field?.fields ?? []).map((key) => normalizeLawText(subFieldLabel(key, docId)));
  };

  // 품질검사 실시대장 — 표의 열이 별지 제42호의 열과 같은 순서로 모두 있다 (이전 판은 법정 열 5개가 없었다)
  // 머리가 두 줄이다 — 품질관리기술인·건설사업관리기술인 확인 칸은 아래 줄에서 성명·서명으로 나뉜다. 위 줄만 보면 서명 칸이 빠진 것을 놓친다
  const f42Rows = parseBoxTables(findAnnex(rule, "별지 제42호")?.text ?? "")[0]?.rows ?? [];
  const f42Top = (f42Rows[1] ?? []).map(normalizeLawText);
  const f42Sub = (f42Rows[2] ?? []).map(normalizeLawText);
  const f42: string[] = [];
  {
    let j = 0;
    let group: string[] = [];
    for (const cell of f42Sub) {
      if (cell === f42Top[j]) { f42.push(cell); j += 1; group = []; continue; }
      if (group.length > 0 && cell === f42Top[j + 1]) { j += 1; f42.push(cell); j += 1; group = []; continue; }
      if (group.includes(cell)) { j += 1; group = []; }
      group.push(cell);
      f42.push((f42Top[j] ?? "") + cell);
    }
  }
  check("실시대장: 별지 제42호의 열 15개(성명·서명 나뉜 칸 포함)와 같음", f42.length === 15 && columnsOf("quality_inspection_register", "entries").join("|") === f42.join("|"), `${columnsOf("quality_inspection_register", "entries").join("|")} ≠ ${f42.join("|")}`);

  // 성과 총괄표 — 별지 제43호의 열(공종·종류·계획·실시·합격·불합격·재시험·비고)
  const f43 = parseBoxTables(findAnnex(rule, "별지 제43호")?.text ?? "")[0]?.rows[1]?.map(normalizeLawText) ?? [];
  check("총괄표: 별지 제43호의 열과 같음", columnsOf("quality_inspection_summary", "items").map((c) => c.replace(/건수$/, "")).join("|") === f43.join("|"), `${columnsOf("quality_inspection_summary", "items").join("|")} ≠ ${f43.join("|")}`);
  const summaryText = JSON.stringify(getSchema("quality_inspection_summary"));
  check("총괄표: 제출 시기가 검사 신청 때(분기·연 단위 아님)", summaryText.includes("기성부분검사") && !/분기|월\/분기\/연/.test(summaryText));

  // 품질시험계획서 — 별표 9 의 항목이 모두 있다
  const t9 = normalizeLawText(findAnnex(decree, "별표 9")?.text ?? "");
  const planLabels = ["testItems", "labEquipment", "qcPersonnel"].flatMap((name) => columnsOf("quality_test_plan", name));
  for (const item of ["공종", "시험종목", "시험계획물량", "시험빈도", "장비명", "규격", "단위", "수량", "성명", "등급", "품질관리업무수행기간"]) {
    check(`시험계획서: 별표 9 항목 — ${item}`, t9.includes(item) && planLabels.includes(item));
  }
  check("시험계획서: 품질관리비가 필수 항목이 아님", !(getSchema("quality_test_plan")?.sections.flatMap((s) => s.fields).some((f) => f.required && /cost/i.test(f.name)) ?? true));

  // 품질관리계획서 — 별표 1 의 항목을 빠짐없이 다룬다 (이전 판은 일부만 다뤘다)
  const annex1Items = (parseBoxTables(findAnnex(guideline, "별표 1")?.text ?? "")[0]?.rows ?? []).slice(1).map((r) => normalizeLawText(r[0] ?? ""));
  const planFields = (getSchema("quality_plan")?.sections ?? []).filter((s) => s.origin === "legal" && s.key !== "approval").flatMap((s) => s.fields);
  const missingItems = annex1Items.filter((item) => !planFields.some((f) => item.endsWith(normalizeLawText(fieldLabel("quality_plan", f.name)))));
  check(`계획서: 별표 1 의 항목 ${annex1Items.length}개를 모두 다룸`, annex1Items.length >= 30 && missingItems.length === 0 && planFields.length === annex1Items.length, `빠짐 ${missingItems.join(",")} · 필드 ${planFields.length}`);

  // 검측요청서·자재 공급원 승인 — 고시 서식의 항목
  const cm = findLaw("건설공사 사업관리방식 검토기준 및 업무수행지침");
  const f36 = normalizeLawText(findAnnex(cm ?? rule, "별지 제36호")?.text ?? "");
  const requestLabels = (getSchema("inspection_request")?.sections ?? []).filter((s) => s.origin === "legal").flatMap((s) => s.fields.map((f) => normalizeLawText(fieldLabel("inspection_request", f.name))));
  for (const item of ["위치및공종", "검측부위", "검측요구일시", "검측사항", "검측결과", "지시사항", "책임건설사업관리기술인"]) {
    check(`검측요청서: 별지 제36호 항목 — ${item}`, f36.includes(item) && requestLabels.includes(item));
  }
  check("검측요청서: 서식에 없는 사전 통보 시간을 요구하지 않음", !JSON.stringify(getSchema("inspection_request")).includes("leadTime"));
  const f37 = boxTableCells(findAnnex(cm ?? rule, "별지 제37호")?.text ?? "").map(normalizeLawText).join("|");
  const approvalLabels = (getSchema("material_source_approval")?.sections ?? []).flatMap((s) => s.fields.map((f) => normalizeLawText(fieldLabel("material_source_approval", f.name))));
  for (const item of ["문서번호", "품명", "규격", "제조회사명", "시공자의견", "특기사항", "검토의견"]) {
    check(`자재 공급원 승인: 별지 제37호 항목 — ${item}`, f37.includes(item) && approvalLabels.includes(item));
  }

  // 시공품질관리 점검표·실적보고서·불량자재폐기 확약서 — 서식의 칸 이름과 인쇄된 행이 양식에 모두 있다
  const labelsOf = (docId: string): string[] =>
    (getSchema(docId)?.sections ?? []).flatMap((sec) => sec.fields.flatMap((f) => [fieldLabel(docId, f.name), ...(f.fields ?? []).map((k) => subFieldLabel(k, docId))])).map(normalizeLawText);
  const notesOf = (docId: string): string => normalizeLawText(JSON.stringify(getSchema(docId) ?? {}));
  const formCase = (docId: string, law: string, annex: string, labels: string[], rows: string[]): void => {
    const lawDoc = findLaw(law);
    // 두 줄에 걸친 칸("자재공급 / 공 장 명")은 칸 단위로 이어 붙여 본다
    const annexText = findAnnex(lawDoc ?? rule, annex)?.text ?? "";
    const text = normalizeLawText(annexText) + "|" + boxTableCells(annexText).map(normalizeLawText).join("|");
    const have = labelsOf(docId);
    const missingLabels = labels.filter((l) => !text.includes(normalizeLawText(l)) || !have.includes(normalizeLawText(l)));
    const missingRows = rows.filter((r) => !text.includes(normalizeLawText(r)) || !notesOf(docId).includes(normalizeLawText(r)));
    check(`${docId}: ${annex} 의 칸 ${labels.length}개·서식 행 ${rows.length}개가 양식에 있다`, missingLabels.length === 0 && missingRows.length === 0, [...missingLabels, ...missingRows].join(","));
  };
  formCase("ready_mixed_placement_check", "건설공사 품질관리 업무지침", "별지 제11호",
    ["공사명", "점검일자", "자재공급공장명", "자재반입량", "공사감독자", "시공자", "구조물명", "부위", "장비명", "규격", "사용대수", "점검결과", "조치내용", "원재료점검내용", "품질시험구분", "시방기준", "총검사횟수", "합격횟수", "불합격횟수", "소속", "성명", "서명"],
    ["펌프카", "진동기", "양생기", "콘크리트의종류", "시멘트의종류", "혼화제의종류", "혼화재의종류", "일일배합표확인", "슬럼프시험", "공기량시험", "염화물이온량(Cl-)", "공시체강도시험"]);
  formCase("asphalt_placement_check", "건설공사 품질관리 업무지침", "별지 제12호",
    ["현장명", "점검일자", "자재공급공장명", "자재반입량", "공사감독자", "시공자", "시공위치", "점검항목", "규격", "사용대수", "점검결과", "조치내용", "점검", "품질시험구분", "시방기준", "총검사횟수", "합격횟수", "불합격횟수"],
    ["마카담로라", "타이어로라", "탄뎀로라", "휘니셔", "안정도", "흐름도", "공극률", "포화도", "역청함유량", "체가름(입도)", "혼합물온도", "혼합물밀도", "포설두께", "시공조인트"]);
  formCase("defective_material_disposal_pledge", "건설공사 품질관리 업무지침", "별지 제13호",
    ["운반차번호", "자재명및규격", "반품현장", "반품일시", "반품지시자", "반품사유", "구분(직책)", "성명", "전화번호", "주소"],
    ["운전기사", "품질관리책임자", "납품서(구입자용)"]);
  // 레미콘 기록지 — 업무지침 제38조제3항(납품서 확인 사항)의 용어 / 대행 의뢰 — 시행규칙 제56조제1항의 용어
  {
    const t38 = normalizeLawText(findArticle(guideline, "38")?.text ?? "");
    const delivery = labelsOf("concrete_delivery_record");
    const words = ["운반차번호", "생산시각", "도착시각", "타설완료시각", "규격", "용적(㎥)", "인수자"];
    check("레미콘 기록지: 칸 이름이 업무지침 제38조제3항의 용어(운반차 번호·생산·도착시각·타설완료시각·규격·용적·인수자)", words.every((w) => delivery.includes(w)) && ["운반차번호", "생산", "도착시각", "타설완료시각", "규격및용적", "인수자"].every((w) => t38.includes(w)), delivery.join(","));
    const t56 = normalizeLawText(findArticle(rule, "56")?.text ?? "");
    const request = labelsOf("test_request");
    check("대행 의뢰서: 시험 칸이 시행규칙 제56조제1항의 용어(품질검사 종목·기준)", request.includes("품질검사종목") && request.includes("품질검사기준") && t56.includes("품질검사의종목ㆍ기준"), request.join(","));
  }
  check("확약서: 서식에 인쇄된 확약 문장을 본문에 그대로 넣는다", (getSchema("defective_material_disposal_pledge")?.sections ?? []).some((sec) => sec.statement === "상기와 같이 반품 지시된 불량자재는 폐기처리 할 것을 확약합니다."));
  {
    // 별지 제18호 — 공종·종목·계획 + (전월까지·금월·누계) × (실시·합격·불합격·재시험) = 15열
    const f18Rows = parseBoxTables(findAnnex(cm ?? rule, "별지 제18호")?.text ?? "")[0]?.rows ?? [];
    const f18Text = normalizeLawText(findAnnex(cm ?? rule, "별지 제18호")?.text ?? "");
    const cols = columnsOf("monthly_test_report", "items");
    const groups = ["전월까지", "금월", "누계"];
    const kinds = ["실시", "합격", "불합격", "재시험"];
    const expected = groups.flatMap((g) => kinds.map((k) => g + k));
    const subRow = f18Rows.map((r) => r.map(normalizeLawText)).find((r) => r.filter((c) => c === "재시험").length === 3) ?? [];
    check(
      "실적보고서: 별지 제18호의 15열(공종·종목·계획 + 전월까지·금월·누계 × 실시·합격·불합격·재시험)",
      cols.length === 15 && cols[0] === "공종" && cols.slice(3).join("|") === expected.join("|") && groups.every((g) => f18Text.includes(g)) && kinds.every((k) => subRow.filter((c) => c === k).length === 3),
      cols.join("|"),
    );
  }

  // 되돌아오면 안 되는 표현
  const all = JSON.stringify(listSchemaIds().map((id) => getSchema(id)));
  check("양식: KOLAS 를 대행 기관 요건으로 적지 않음", !all.includes("KOLAS"));
  check("양식: 성과 총괄표가 아닌 문서에 '시설물 존속기간 보존'을 붙이지 않음", !/총괄표에 포함되어|총괄표 통합 시|총괄표와 함께 시설물/.test(all));
  check("양식: '발주청 승인'이 아니라 발주자 승인", !all.includes("발주청 승인"));
  check("양식: 150㎥ 빈도를 말하지 않음", !all.includes("150㎥마다"));
}

testAnchors();
testSchemas();
testPlanTarget();
testStaffing();
await testToolOutputs();
console.log(`[conformance] ${pass} 통과 / ${fail} 실패`);
process.exit(fail > 0 ? 1 : 0);
