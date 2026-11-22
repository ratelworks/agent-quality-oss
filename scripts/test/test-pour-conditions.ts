// ─────────────────────────────────────────────────────────────────────────────
// test-pour-conditions.ts — 타설 조건 사전 판정(evaluate_pour_conditions) 시험.
//
// 사례는 조건 목록(.specs/plans/2026-11-22-evaluate-pour-conditions.md C1~C15·D1~D3)에서
// 조건마다 최소 한 건, 경계값은 양쪽 모두 뽑았다. 기대값은 KCS 현행판 원문의 수치다.
// ─────────────────────────────────────────────────────────────────────────────

import { loadOntologySync } from "../../src/ontology/loader.js";
import { OntologyGraph } from "../../src/ontology/graph.js";
import { callTool } from "../../src/tool-registry.js";

// ───── 상수 ─────
const TOOL = "evaluate_pour_conditions";

interface Expect {
  regime?: string;
  transportMax?: number;
  liftMax?: number;
  tempMin?: number;
  tempMax?: number;
  checks?: Record<string, string>;
  missing?: string[];
  humanCheckpoint?: boolean;
  noteIncludes?: string;
  conflictCaseHasNoNumbers?: boolean;
  checklistIncludes?: string[];
}
interface Case {
  id: string;
  args: Record<string, unknown>;
  expect: Expect;
}

/** 서중 사례에 붙이는 한중 쪽 조건 — 한중 아님이 확정되게 */
const NOT_COLD = { minTempNext24h: 18, earlyFrostRiskLater: false };
/** 한중 사례에 붙이는 서중 쪽 조건 — 서중 아님이 확정되게 */
const NOT_HOT = { maxTempNext24h: 8 };

const CASES: Case[] = [
  // C1 서중 적용 경계
  { id: "C1 일평균 25.0 은 서중 아님", args: { dailyMeanTemp: 25, maxTempNext24h: 29, minTempNext24h: 18, earlyFrostRiskLater: false }, expect: { regime: "standard" } },
  { id: "C1 일평균 25.1 은 서중", args: { ...NOT_COLD, dailyMeanTemp: 25.1 }, expect: { regime: "hot_weather" } },
  { id: "C1 최고 30.0 은 서중 아님", args: { dailyMeanTemp: 22, maxTempNext24h: 30, minTempNext24h: 15, earlyFrostRiskLater: false }, expect: { regime: "standard" } },
  { id: "C1 최고 30.1 은 서중", args: { ...NOT_COLD, dailyMeanTemp: 22, maxTempNext24h: 30.1 }, expect: { regime: "hot_weather" } },
  // C2 한중 적용 경계
  { id: "C2 일평균 4.0 은 한중", args: { ...NOT_HOT, dailyMeanTemp: 4 }, expect: { regime: "cold_weather" } },
  { id: "C2 일평균 4.1 은 한중 아님", args: { dailyMeanTemp: 4.1, maxTempNext24h: 9, minTempNext24h: 0.1, earlyFrostRiskLater: false }, expect: { regime: "standard" } },
  { id: "C2 최저 0.0 은 한중", args: { ...NOT_HOT, dailyMeanTemp: 6, minTempNext24h: 0 }, expect: { regime: "cold_weather" } },
  { id: "C2 초기동해 위험만으로 한중", args: { dailyMeanTemp: 6, maxTempNext24h: 12, minTempNext24h: 2, earlyFrostRiskLater: true }, expect: { regime: "cold_weather" } },
  // C4·C11 외기온도 경계 — 운반은 25 이상, 이어치기는 25 초과
  { id: "C4/C11 외기 25.0", args: { dailyMeanTemp: 22, maxTempNext24h: 28, minTempNext24h: 15, earlyFrostRiskLater: false, ambientTemp: 25 }, expect: { regime: "standard", transportMax: 90, liftMax: 150 } },
  { id: "C4/C11 외기 24.9", args: { dailyMeanTemp: 22, maxTempNext24h: 28, minTempNext24h: 15, earlyFrostRiskLater: false, ambientTemp: 24.9 }, expect: { transportMax: 120, liftMax: 150 } },
  { id: "C4/C11 외기 25.1", args: { dailyMeanTemp: 22, maxTempNext24h: 28, minTempNext24h: 15, earlyFrostRiskLater: false, ambientTemp: 25.1 }, expect: { transportMax: 90, liftMax: 120 } },
  // C6 서중은 외기온도와 무관하게 90분
  { id: "C6 서중 + 외기 22 → 90분", args: { ...NOT_COLD, dailyMeanTemp: 26, ambientTemp: 22, mixToPlacementEndMinutes: 100 }, expect: { regime: "hot_weather", transportMax: 90, checks: { transport_time: "exceeds_standard" } } },
  // C5 일반 운반 초과 = 표준 초과(불합격 아님)
  { id: "C5 일반 130분 → 표준 초과", args: { dailyMeanTemp: 15, maxTempNext24h: 20, minTempNext24h: 8, earlyFrostRiskLater: false, ambientTemp: 18, mixToPlacementEndMinutes: 130 }, expect: { transportMax: 120, checks: { transport_time: "exceeds_standard" }, humanCheckpoint: false } },
  { id: "C4 일반 110분 → 통과", args: { dailyMeanTemp: 15, maxTempNext24h: 20, minTempNext24h: 8, earlyFrostRiskLater: false, ambientTemp: 18, mixToPlacementEndMinutes: 110 }, expect: { checks: { transport_time: "pass" } } },
  // C8 서중 타설 온도
  { id: "C8 서중 35.0 통과", args: { ...NOT_COLD, dailyMeanTemp: 27, concreteTemp: 35, massConcrete: false }, expect: { tempMax: 35, checks: { concrete_temperature: "pass" } } },
  { id: "C8 서중 35.1 불합격", args: { ...NOT_COLD, dailyMeanTemp: 27, concreteTemp: 35.1, massConcrete: false }, expect: { checks: { concrete_temperature: "fail" }, humanCheckpoint: true } },
  { id: "C8 서중 매스는 보류", args: { ...NOT_COLD, dailyMeanTemp: 27, concreteTemp: 33, massConcrete: true }, expect: { checks: { concrete_temperature: "undetermined" } } },
  { id: "C8 서중 매스 여부 미상 → 보류·되묻기", args: { ...NOT_COLD, dailyMeanTemp: 27, concreteTemp: 30 }, expect: { checks: { concrete_temperature: "undetermined" }, missing: ["massConcrete"] } },
  // C9 한중 타설 온도
  { id: "C9 단면 400·가혹 아님 → 하한 5", args: { ...NOT_HOT, dailyMeanTemp: 2, sectionThicknessMm: 400, harshWeather: false, concreteTemp: 7 }, expect: { tempMin: 5, tempMax: 20, checks: { concrete_temperature: "pass" } } },
  { id: "C9 단면 300 → 하한 10", args: { ...NOT_HOT, dailyMeanTemp: 2, sectionThicknessMm: 300, concreteTemp: 7 }, expect: { tempMin: 10, checks: { concrete_temperature: "fail" } } },
  { id: "C9 가혹 기상 → 하한 10", args: { ...NOT_HOT, dailyMeanTemp: 2, sectionThicknessMm: 500, harshWeather: true, concreteTemp: 9 }, expect: { tempMin: 10, checks: { concrete_temperature: "fail" } } },
  { id: "C9 단면·기상 미상 + 8 ℃ → 보류", args: { ...NOT_HOT, dailyMeanTemp: 2, concreteTemp: 8 }, expect: { checks: { concrete_temperature: "undetermined" }, missing: ["sectionThicknessMm", "harshWeather"] } },
  { id: "C9 단면·기상 미상 + 12 ℃ → 통과", args: { ...NOT_HOT, dailyMeanTemp: 2, concreteTemp: 12 }, expect: { checks: { concrete_temperature: "pass" } } },
  { id: "C9 단면·기상 미상 + 21 ℃ → 불합격", args: { ...NOT_HOT, dailyMeanTemp: 2, concreteTemp: 21 }, expect: { checks: { concrete_temperature: "fail" } } },
  // C10 한중 + 매스 → 미적용 단서
  { id: "C10 한중 매스 단서", args: { ...NOT_HOT, dailyMeanTemp: 2, sectionThicknessMm: 1200, harshWeather: false, massConcrete: true, concreteTemp: 22 }, expect: { checks: { concrete_temperature: "fail" }, noteIncludes: "§1.4(3)" } },
  // C12 강우·강설
  { id: "C12 강수 예보 → 판단 항목", args: { dailyMeanTemp: 15, precipitationExpected: true }, expect: { checks: { precipitation: "needs_judgment" } } },
  // D1 외기온도 여러 값 → 가장 높은 값
  { id: "D1 외기 [22, 26] → 26 사용", args: { dailyMeanTemp: 22, maxTempNext24h: 28, minTempNext24h: 15, earlyFrostRiskLater: false, ambientTemps: [22, 26] }, expect: { transportMax: 90, liftMax: 120 } },
  // D2 모르는 입력
  { id: "D2 최고 31·일평균 미상 → 미정(일평균 4 ℃ 이하 배제 불가)", args: { maxTempNext24h: 31, ...NOT_COLD }, expect: { regime: "undetermined", missing: ["dailyMeanTemp"] } },
  { id: "D2 최고 31·일평균 20 → 서중", args: { dailyMeanTemp: 20, maxTempNext24h: 31, ...NOT_COLD }, expect: { regime: "hot_weather" } },
  { id: "D2 서중 확정·한중 조건 미상 → 동시 해당 후보가 남아 미정", args: { dailyMeanTemp: 27 }, expect: { regime: "undetermined", missing: ["minTempNext24h", "earlyFrostRiskLater"] } },
  { id: "D3 동시 해당 후보에는 숫자 한도를 내지 않음", args: { dailyMeanTemp: 27, ambientTemp: 20, mixToPlacementEndMinutes: 100 }, expect: { regime: "undetermined", conflictCaseHasNoNumbers: true } },
  { id: "D3 서중·동시 해당 후보 → 한중 점검사항도 포함", args: { dailyMeanTemp: 27, ambientTemp: 20 }, expect: { regime: "undetermined", checklistIncludes: ["KCS 14 20 40 §3.3(2)", "KCS 14 20 41 §3.1(2)"] } },
  { id: "D3 한중·동시 해당 후보 → 서중 계획서도 포함", args: { dailyMeanTemp: 3 }, expect: { regime: "undetermined", checklistIncludes: ["KCS 14 20 41 §3.1(2)", "KCS 14 20 40 §3.3(3)"] } },
  { id: "D2 서중 + 24시간 이후 초기동해 위험 → 충돌", args: { dailyMeanTemp: 27, earlyFrostRiskLater: true }, expect: { regime: "conflict", humanCheckpoint: true } },
  // 일반 콘크리트 타설 온도 — 표 3.5-2 '정해진 조건에 적합할 것': 합격이 아니라 시방서 판단
  { id: "일반 콘크리트 온도 → 시방서 판단", args: { dailyMeanTemp: 15, maxTempNext24h: 20, minTempNext24h: 8, earlyFrostRiskLater: false, concreteTemp: 18 }, expect: { regime: "standard", checks: { concrete_temperature: "needs_judgment" } } },
  { id: "일반·한중 후보 섞임 + 12 ℃ → 미정(합격 아님)", args: { maxTempNext24h: 20, minTempNext24h: 2, earlyFrostRiskLater: false, concreteTemp: 12, massConcrete: false, harshWeather: false, sectionThicknessMm: 500 }, expect: { regime: "undetermined", checks: { concrete_temperature: "undetermined" } } },
  { id: "D2 초기동해 위험 미상 → 미정·되묻기", args: { dailyMeanTemp: 20, maxTempNext24h: 26, minTempNext24h: 12 }, expect: { regime: "undetermined", missing: ["earlyFrostRiskLater"] } },
  { id: "D2 기온 전부 미상 → 미정", args: {}, expect: { regime: "undetermined", missing: ["dailyMeanTemp"] } },
  { id: "D2 외기 미상 + 100분 → 미정", args: { dailyMeanTemp: 15, maxTempNext24h: 20, minTempNext24h: 8, earlyFrostRiskLater: false, mixToPlacementEndMinutes: 100 }, expect: { checks: { transport_time: "undetermined" }, missing: ["ambientTemp"] } },
  { id: "D2 외기 미상 + 80분 → 통과", args: { dailyMeanTemp: 15, maxTempNext24h: 20, minTempNext24h: 8, earlyFrostRiskLater: false, mixToPlacementEndMinutes: 80 }, expect: { checks: { transport_time: "pass" } } },
  // D3 서중·한중 동시
  { id: "D3 일평균 26 + 최저 -1 → 충돌", args: { dailyMeanTemp: 26, minTempNext24h: -1 }, expect: { regime: "conflict", humanCheckpoint: true } },
];

// ───── 실행 ─────

/** 경우가 여럿이면 첫 경우 — 한도 값을 단정하는 사례는 경우가 하나가 되도록 입력을 준다 */
function first<T>(x: T | T[]): T | undefined {
  return Array.isArray(x) ? x[0] : x;
}

const graph = new OntologyGraph(loadOntologySync());
const failures: string[] = [];

for (const c of CASES) {
  const res = (await callTool(TOOL, c.args, { graph } as never)) as Record<string, any>;
  const body = res;
  const r = body.result;
  const hc = body.humanCheckpoint?.required === true;
  const errs: string[] = [];
  const e = c.expect;
  if (e.regime && r.regime !== e.regime) errs.push(`regime ${r.regime} ≠ ${e.regime}`);
  const lim = first(r.limits);
  if (e.transportMax !== undefined && lim?.transportMaxMinutes !== e.transportMax)
    errs.push(`운반 한도 ${lim?.transportMaxMinutes} ≠ ${e.transportMax}`);
  if (e.liftMax !== undefined && lim?.liftIntervalMaxMinutes !== e.liftMax)
    errs.push(`이어치기 한도 ${lim?.liftIntervalMaxMinutes} ≠ ${e.liftMax}`);
  if (e.tempMin !== undefined && lim?.concreteTemperature?.min !== e.tempMin)
    errs.push(`온도 하한 ${lim?.concreteTemperature?.min} ≠ ${e.tempMin}`);
  if (e.tempMax !== undefined && lim?.concreteTemperature?.max !== e.tempMax)
    errs.push(`온도 상한 ${lim?.concreteTemperature?.max} ≠ ${e.tempMax}`);
  for (const [item, outcome] of Object.entries(e.checks ?? {})) {
    const got = (r.checks ?? []).find((x: any) => x.item === item)?.outcome;
    if (got !== outcome) errs.push(`${item} ${got} ≠ ${outcome}`);
  }
  for (const m of e.missing ?? []) if (!(r.missingInputs ?? []).includes(m)) errs.push(`빠진 입력에 ${m} 없음`);
  if (e.humanCheckpoint !== undefined && hc !== e.humanCheckpoint) errs.push(`humanCheckpoint ${hc} ≠ ${e.humanCheckpoint}`);
  if (e.noteIncludes && !JSON.stringify(r.checks ?? []).includes(e.noteIncludes)) errs.push(`안내에 ${e.noteIncludes} 없음`);
  for (const cl of e.checklistIncludes ?? [])
    if (!(r.checklist ?? []).some((x: any) => x.clause === cl)) errs.push(`점검사항에 ${cl} 없음`);
  if (e.conflictCaseHasNoNumbers) {
    const cs = (Array.isArray(r.limits) ? r.limits : [r.limits]).filter((l: any) => l.regime === "conflict");
    if (cs.length === 0) errs.push("동시 해당 후보 없음");
    for (const l of cs)
      if (l.transportMaxMinutes !== undefined || l.liftIntervalMaxMinutes !== undefined || !l.hold) errs.push("동시 해당 후보에 숫자 한도가 있거나 보류 표시가 없음");
  }
  if (!Array.isArray(body.basis) || body.basis.length === 0) errs.push("basis 비어 있음");
  if (errs.length) failures.push(`✗ ${c.id}: ${errs.join(" / ")}`);
}

console.log(`[pour-conditions] ${CASES.length - failures.length}/${CASES.length} 통과`);
if (failures.length) {
  for (const f of failures) console.log(f);
  process.exit(1);
}
