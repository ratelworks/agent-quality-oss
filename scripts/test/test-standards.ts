// ─────────────────────────────────────────────────────────────────────────────
// test-standards.ts — 국가건설기준(KCS)에 맞춘 판정과 노드의 회귀 시험.
//
// 여기 든 사례는 모두 현행 기준의 문구에서 나온 것이다.
//   압축강도  KCS 14 20 10 표 3.5-3 · 표 3.5-7 · 3.5.5.7 (4) · 2.2.2
//   온도      KCS 14 20 10 표 3.5-2 · KCS 14 20 40 3.3 · KCS 14 20 41 3.3
//   거푸집    KCS 14 20 12 표 3.3-1
// 기준 본문은 저장소에 없으므로, 문구 자체의 대조는 `npm run check:standards`(네트워크)가 한다.
// 이 시험은 판정 결과와 노드의 모양만 본다.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOntologySync } from "../../src/ontology/loader.js";
import { OntologyGraph } from "../../src/ontology/graph.js";
import { callTool } from "../../src/tool-registry.js";
import { collectStandardAnchors } from "../sync/check-standards.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const NODES_DIR = join(ROOT, "src/ontology/graph/nodes");
const STRENGTH = "test.compressive_strength";
const TEMPERATURE = "test.concrete_temperature";
const STRIPPING = "test.formwork_stripping_strength";

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
  legalVerdict: "PASS" | "FAIL" | "UNDETERMINED";
  criterionId: string | null;
  comparison: string;
  expertContext: string | null;
  neededInputs: string[];
  provisionalResult: { assumption: string; verdict: string } | null;
  candidateNonconformance: Array<{ id: string }>;
}

async function assess(observation: string, by: { testId?: string; criterionId?: string }): Promise<Assessment> {
  const res = await callTool("evaluate_observation", { observation, ...by }, { graph });
  return (res.result as { expertAssessment: Assessment }).expertAssessment;
}

async function expectVerdict(
  name: string,
  observation: string,
  by: { testId?: string; criterionId?: string },
  verdict: Assessment["legalVerdict"],
  criterion?: string,
): Promise<Assessment> {
  const a = await assess(observation, by);
  check(
    `${name} → ${verdict}`,
    a.legalVerdict === verdict && (criterion === undefined || a.criterionId === criterion),
    `${a.legalVerdict} · ${a.criterionId} · ${a.comparison}`,
  );
  return a;
}

// ── 1. 압축강도 ─────────────────────────────────────────────────────
async function testStrength(): Promise<void> {
  const LE35 = "criteria.compressive_strength_statistical_le35";
  const GT35 = "criteria.compressive_strength_statistical_gt35";
  const by = { testId: STRENGTH };

  // 표 3.5-3 — 레디믹스트 콘크리트, 기준 강도는 호칭강도
  await expectVerdict("호칭강도 24: 평균 26·최저 22", "연속 3회 평균 26MPa 최저 22MPa, 호칭강도 24MPa", by, "PASS", LE35);
  await expectVerdict("호칭강도 24: 최저 19 (20.5 미만)", "3회 시험값 23 25 19 평균 22.3 최저 19, 호칭강도 24MPa", by, "FAIL", LE35);
  await expectVerdict("호칭강도 24: 평균 23.9", "연속 3회 평균 23.9MPa 최저 22MPa, 호칭강도 24MPa", by, "FAIL", LE35);
  await expectVerdict("호칭강도 40: 평균 41·최저 37 (90 % = 36)", "연속 3회 평균 41MPa 최저 37MPa, 호칭강도 40MPa", by, "PASS", GT35);
  await expectVerdict("호칭강도 40: 최저 35.5", "연속 3회 평균 41MPa 최저 35.5MPa, 호칭강도 40MPa", by, "FAIL", GT35);
  await expectVerdict("호칭강도 35: 최저 31.5 (경계)", "연속 3회 평균 36MPa 최저 31.5MPa, 호칭강도 35MPa", by, "PASS", LE35);

  // 설계기준압축강도만 알려 준 경우 — 호칭강도는 그보다 클 수 있다(기온보정강도·내구성기준압축강도).
  // 이전 판은 설계기준압축강도를 호칭강도로 보고 합격으로 냈다.
  const onlyFck = await expectVerdict("설계기준압축강도만: 넘어도 합격으로 단정하지 않음", "연속 3회 평균 25MPa 최저 22MPa, fck 24MPa", by, "UNDETERMINED", LE35);
  check("설계기준압축강도만: 가정을 둔 결과와 필요한 입력을 줌", onlyFck.provisionalResult?.verdict === "PASS" && onlyFck.neededInputs.some((n) => n.includes("호칭강도")), JSON.stringify(onlyFck.neededInputs));
  check("설계기준압축강도만: 불합격 후보를 내지 않음", onlyFck.candidateNonconformance.length === 0);
  await expectVerdict("설계기준압축강도만: 그 값에도 못 미치면 불합격", "연속 3회 평균 22MPa 최저 20MPa, fck 24MPa", by, "FAIL", LE35);
  await expectVerdict("품질기준강도 + 기온보정강도 = 호칭강도 27", "연속 3회 평균 25MPa 최저 24MPa, 설계기준압축강도 24, 내구성기준압축강도 24, 기온보정강도 3", by, "FAIL", LE35);
  await expectVerdict("품질기준강도 + 기온보정강도 0 = 호칭강도 24", "연속 3회 평균 25MPa 최저 24MPa, 품질기준강도 24, 기온보정강도 0", by, "PASS", LE35);
  const noStrength = await expectVerdict("강도를 알려 주지 않음", "연속 3회 평균 26MPa 최저 22MPa", by, "UNDETERMINED");
  check("강도를 알려 주지 않음: 호칭강도를 물음", noStrength.neededInputs.some((n) => n.includes("호칭강도")));

  // 시험값이 모자란 경우 — 확인 못한 기준이 있으면 합격으로 내지 않는다
  const single = await expectVerdict("1회 시험값만: ②는 충족이어도 합격 아님", "압축강도 1회 시험값 21MPa, 호칭강도 24MPa", by, "UNDETERMINED", LE35);
  check("1회 시험값만: 연속 3회 평균이 필요하다고 알림", single.neededInputs.some((n) => n.includes("연속 3회")), JSON.stringify(single.neededInputs));
  await expectVerdict("1회 시험값만: ② 미달이면 불합격", "압축강도 1회 시험값 18MPa, 호칭강도 24MPa", by, "FAIL", LE35);
  await expectVerdict("공시체 3개의 평균은 1회 시험값 (낱개 값으로 불합격 내지 않음)", "공시체 3개 평균 22.3MPa 최저 19MPa, 호칭강도 24MPa", by, "UNDETERMINED", LE35);
  await expectVerdict("5회 전체 평균만으로는 연속 3회 평균을 모름", "5회 평균 26MPa 최저 22MPa, 호칭강도 24MPa", by, "UNDETERMINED", LE35);
  await expectVerdict("시험값을 차례로: 모든 연속 3회 평균 충족", "시험값 26 25 27 22 23, 호칭강도 24MPa", by, "PASS", LE35);
  await expectVerdict("시험값을 차례로: 뒤쪽 연속 3회 평균 미달", "시험값 26 25 27 20 21, 호칭강도 24MPa", by, "FAIL", LE35);

  // 그 밖의 경우(현장 배치플랜트) — 평균이 품질기준강도 이상
  const SITE = "criteria.compressive_strength_site_batch";
  await expectVerdict("현장 배치플랜트: 평균 25 ≥ 품질기준강도 24", "현장 배치플랜트 압축강도 평균 25MPa, 품질기준강도 24MPa", by, "PASS", SITE);
  await expectVerdict("현장 배치플랜트: 평균 23", "현장 배치플랜트 압축강도 평균 23MPa, 품질기준강도 24MPa", by, "FAIL", SITE);

  // 표 3.5-7 — 현장양생공시체, 기준 강도는 품질기준강도
  const FIELD = "criteria.compressive_strength_field_cured";
  await expectVerdict("현장양생: 평균 25·최저 21", "현장양생 공시체 연속 3회 평균 25MPa 최저 21MPa, 품질기준강도 24MPa", by, "PASS", FIELD);
  await expectVerdict("현장양생: 최저 20", "현장양생 공시체 연속 3회 평균 25MPa 최저 20MPa, 품질기준강도 24MPa", by, "FAIL", FIELD);
  await expectVerdict("현장양생: 설계기준압축강도와 내구성기준압축강도 중 큰 값", "현장양생 공시체 연속 3회 평균 28MPa 최저 26MPa, fck 24, 내구성기준압축강도 30", by, "FAIL", FIELD);

  // 3.5.5.7 (4) — 코어: 평균 > 85 %, 각각 > 75 %
  const CORE = "criteria.compressive_strength_core";
  await expectVerdict("코어: 평균 22(>20.4)·최저 19(>18)", "코어 3개 평균 22MPa 최저 19MPa, 품질기준강도 24MPa", by, "PASS", CORE);
  await expectVerdict("코어: 최저 17", "코어 4개 평균 22MPa 최저 17MPa, 품질기준강도 24MPa", by, "FAIL", CORE);
  await expectVerdict("코어: 평균이 85 %와 같으면 미달(초과여야 함)", "코어 3개 평균 20.4MPa 최저 19MPa, 품질기준강도 24MPa", by, "FAIL", CORE);
  const coreFck = await expectVerdict("코어: 설계기준압축강도만 알면 단정하지 않음", "코어 3개 평균 22MPa 최저 19MPa, fck 24MPa", by, "UNDETERMINED", CORE);
  check("코어: 품질기준강도를 물음", coreFck.neededInputs.some((n) => n.includes("품질기준강도")));

  // 기준 노드와 입력이 어긋난 경우 — 판정하지 않고 맞는 기준을 알려 준다
  const wrongKind = await expectVerdict("레디믹스트 기준에 코어 시험값", "코어 3개 평균 22MPa 최저 19MPa, 품질기준강도 24MPa", { criterionId: LE35 }, "UNDETERMINED");
  check("레디믹스트 기준에 코어 시험값: 코어 기준을 알려 줌", wrongKind.comparison.includes("compressive_strength_core"));
  const wrongRange = await expectVerdict("35 이하 기준에 호칭강도 40", "연속 3회 평균 41MPa 최저 37MPa, 호칭강도 40MPa", { criterionId: LE35 }, "UNDETERMINED");
  check("35 이하 기준에 호칭강도 40: 초과 기준을 알려 줌", wrongRange.comparison.includes("_gt35"));

  const stripping = await assess("슬래브 거푸집 해체 시점 압축강도 16MPa, 호칭강도 24MPa", by);
  check("28일 검사에 거푸집 해체 강도를 물으면 해체 강도 시험을 안내", (stripping.expertContext ?? "").includes("test.formwork_stripping_strength"));
}

// ── 2. 콘크리트 온도 ────────────────────────────────────────────────
async function testTemperature(): Promise<void> {
  const by = { testId: TEMPERATURE };
  const general = await expectVerdict("일반 콘크리트: 수치 범위가 없어 판정하지 않음", "콘크리트 온도 28℃", by, "UNDETERMINED", "criteria.concrete_temperature_general");
  check("일반 콘크리트: 한중·서중 여부를 물음", general.neededInputs.some((n) => n.includes("한중")) && general.comparison.includes("정해진 조건"));
  const COLD = "criteria.concrete_temperature_cold_weather";
  const HOT = "criteria.concrete_temperature_hot_weather";
  await expectVerdict("한중: 12 ℃", "한중 콘크리트 타설 온도 12℃", by, "PASS", COLD);
  await expectVerdict("한중: 3 ℃", "한중 콘크리트 타설 온도 3℃", by, "FAIL", COLD);
  // 이전 판은 5~35 ℃ 한 범위로 묶어 한중 30 ℃ 를 합격으로 냈다
  await expectVerdict("한중: 30 ℃ (20 ℃ 초과)", "한중 콘크리트 타설 온도 30℃", by, "FAIL", COLD);
  await expectVerdict("서중: 30 ℃", "서중 콘크리트 온도 30℃", by, "PASS", HOT);
  await expectVerdict("서중: 36 ℃", "서중 콘크리트 온도 36℃", by, "FAIL", HOT);
  const ambient = await assess("외기온도 33℃", by);
  check("기온을 물으면 한중·서중 적용 조건을 알려 줌", (ambient.expertContext ?? "").includes("일평균기온 25℃ 초과") && (ambient.expertContext ?? "").includes("일평균기온 4℃ 이하"));
}

// ── 3. 거푸집 해체 강도 ─────────────────────────────────────────────
async function testStripping(): Promise<void> {
  const by = { testId: STRIPPING };
  const SLAB = "criteria.formwork_strip_slab_bottom";
  // 이전 판은 부재와 무관하게 측면 기준(5 MPa)으로 견주어 합격으로 냈다
  await expectVerdict("슬래브 밑면·다층구조: 16 < 설계기준압축강도 24", "슬래브 밑면 거푸집 해체 압축강도 16MPa, fck 24MPa, 다층구조", by, "FAIL", SLAB);
  await expectVerdict("슬래브 밑면·단층구조: 16 = 24 의 2/3배", "슬래브 밑면 거푸집 해체 압축강도 16MPa, fck 24MPa, 단층구조", by, "PASS", SLAB);
  await expectVerdict("슬래브 밑면·단층구조: 최소 14 MPa (설계기준압축강도 18)", "슬래브 밑면 거푸집 해체 압축강도 13MPa, fck 18MPa, 단층구조", by, "FAIL", SLAB);
  const unknownStory = await expectVerdict("슬래브 밑면: 단층·다층을 모르면 그 사이 값은 판정하지 않음", "슬래브 밑면 거푸집 해체 압축강도 17MPa, fck 24MPa", by, "UNDETERMINED", SLAB);
  check("슬래브 밑면: 단층·다층을 물음", unknownStory.neededInputs.some((n) => n.includes("단층")));
  await expectVerdict("슬래브 밑면: 설계기준압축강도 이상이면 어느 쪽이든 충족", "슬래브 밑면 거푸집 해체 압축강도 24MPa, fck 24MPa", by, "PASS", SLAB);
  await expectVerdict("보 밑면: 단층 기준에도 못 미침", "보 밑면 거푸집 해체 압축강도 12MPa, fck 24MPa", by, "FAIL", SLAB);
  await expectVerdict("다층구조·필러 동바리: 14 이상이면 구조계산서 확인", "슬래브 밑면 거푸집 해체 압축강도 16MPa, fck 24MPa, 다층구조, 필러 동바리", by, "UNDETERMINED", SLAB);
  await expectVerdict("기둥 측면: 6 ≥ 5", "기둥 측면 거푸집 해체 압축강도 6MPa", by, "PASS", "criteria.formwork_strip_side");
  await expectVerdict("내구성이 중요한 구조물: 8 < 10", "내구성이 중요한 구조물 측면 거푸집 해체 압축강도 8MPa", by, "FAIL", "criteria.formwork_strip_durable");
  const noMember = await expectVerdict("부재를 말하지 않음: 측면 기준으로 합격 내지 않음", "거푸집 해체 압축강도 6MPa", by, "UNDETERMINED", SLAB);
  check("부재를 말하지 않음: 밑면 기준으로 본 사실을 알림", (noMember.expertContext ?? "").includes("가장 엄격한"));
  check("부재를 말하지 않음: 조건별 결과를 함께 보여 줌", noMember.comparison.includes("조건에 따라 결과가 달라"), noMember.comparison);
  const belowAll = await expectVerdict("부재를 말하지 않아도 모든 기준에 못 미치면 불합격", "거푸집 해체 압축강도 4MPa", by, "FAIL", SLAB);
  check("모든 기준에 못 미침: 그 사실을 알림", (belowAll.expertContext ?? "").includes("어느 조건의 기준으로도 미달"), belowAll.expertContext ?? "");

  // 관측값 여러 개를 한꺼번에 보는 도구도 같은 기준 선택을 쓴다
  const risks = await callTool("infer_quality_risks", { workType: "거푸집 및 동바리", observations: ["슬래브 밑면 거푸집 해체강도 12MPa, fck 24MPa", "거푸집 해체강도 6MPa"] }, { graph });
  const summary = (risks.result as { summary: { pass: number; fail: number; undetermined: number } }).summary;
  check("위험 추론: 밑면 12 MPa 는 불합격, 부재 없는 6 MPa 는 판정하지 않음", summary.fail === 1 && summary.undetermined === 1 && summary.pass === 0, JSON.stringify(summary));
}

// ── 4. 노드 ─────────────────────────────────────────────────────────
function testNodes(): void {
  const anchors = collectStandardAnchors(NODES_DIR);
  check("국가건설기준을 근거로 적은 노드가 있음", anchors.length >= 20, String(anchors.length));
  const malformed = anchors.filter(
    (a) => !/^(KCS|KDS) \d{2} \d{2} \d{2}$/.test(a.anchor.standard) || !/^\d{4}-\d{2}-\d{2}$/.test(a.anchor.edition) || a.anchor.clause.trim() === "" || a.anchor.quotes.length === 0 || a.anchor.quotes.some((q) => q.trim().length < 4),
  );
  check("근거 표기가 기준 코드·판(개정일)·조항·인용 구절을 모두 갖춤", malformed.length === 0, malformed.map((a) => a.id).join(","));

  let all = "";
  for (const dir of readdirSync(NODES_DIR)) {
    for (const file of readdirSync(join(NODES_DIR, dir))) all += readFileSync(join(NODES_DIR, dir, file), "utf8");
  }
  // 옛 판 본문의 글자 겹침에서 온 말 — 현행 기준에 없는 용어다
  check("노드: '호칭강도품질기준강도'를 쓰지 않음", !all.includes("호칭강도품질기준강도"));
  // 현행판에서 없어진 규정
  check("노드: 현장양생 85 % 규정(삭제됨)을 인용하지 않음", !/표준양생\s*×\s*85|표준양생의 85/.test(all));
  const temperature = JSON.parse(readFileSync(join(NODES_DIR, "criteria/concrete_temperature_general.jsonld"), "utf8")) as { _meta: Record<string, unknown> };
  check("일반 콘크리트 온도 기준이 수치 범위를 갖지 않음", temperature._meta["min"] === undefined && temperature._meta["max"] === undefined);
}

async function main(): Promise<void> {
  await testStrength();
  await testTemperature();
  await testStripping();
  testNodes();
  console.log(`[standards-judgment] ${passed} 통과 / ${failed} 실패`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
