/**
 * Round 02 — 콘크리트·레미콘 실무 dogfooding.
 * 시나리오는 evaluation/round-02-scenarios.md 참조.
 */
import { writeFileSync } from 'node:fs';
import { TOOL_MAP } from '../src/mcp/registry.js';
import { OntologyGraph } from '../src/ontology/graph.js';
import { loadOntologySync } from '../src/ontology/loader.js';

// R0-G2 자동 채점 입력 스펙.
// - expectedVerdict       : evaluate_observation 전용 (legalVerdict 비교)
// - expectedHitsMin/Max   : discover_xxx / search_xxx 응답의 hit 수 범위 (R0 단계 미커버 영역 보호)
// - expectedBasisIds      : actual basis[].id에 모두 포함되어야 PASS
// - forbiddenBasisIds     : actual basis[].id에 하나라도 등장하면 false PASS (오인용 검출)
// - expectedSourceStatus  : sourceStatusSummary.worst가 이 등급 이상이면 통과
// - notes                 : 인간 가독 (R3·R5 등 도입 후 expected 변경 예정 메모)
interface ScenarioExpectation {
  expectedVerdict?: 'PASS' | 'FAIL' | 'UNDETERMINED' | 'MARGINAL';
  expectedHitsMin?: number;
  expectedHitsMax?: number;
  expectedBasisIds?: string[];
  forbiddenBasisIds?: string[];
  expectedSourceStatus?: 'verified' | 'indirect_source' | 'skeleton' | 'unknown';
  notes?: string;
}

interface Scenario extends ScenarioExpectation {
  id: string;
  persona: string;
  intent: string;
  expect: string;
  tool: string;
  args: Record<string, unknown>;
}

const graph = new OntologyGraph(loadOntologySync());

const SCENARIOS: Scenario[] = [
  {
    id: 'C01',
    persona: '신입',
    intent: '슬럼프 경계값 (175mm = 150+25)',
    expect: 'PASS marginal (KCS 14 20 10 §1.7.3 표 1.7-2 허용오차 ±25)',
    tool: 'evaluate_observation',
    args: { observation: '슬럼프 175mm', testId: 'test.slump' },
    expectedVerdict: 'PASS',
    expectedBasisIds: ['criteria.slump_general_150'],
    // expectedSourceStatus는 응답 신뢰도 KPI(measure.ts)로 별도 추적 — 시나리오 PASS 게이트에서 분리. R6 Glossary 마이그레이션 후 R6+ baseline에서 재도입.
  },
  {
    id: 'C02',
    persona: '신입',
    intent: '7일 강도로 합부 가능?',
    expect: '7일은 28일 표준양생 판정 대상 X 환기',
    tool: 'evaluate_observation',
    args: { observation: '7일 압축강도 18MPa, 호칭 24MPa', testId: 'test.compressive_strength' },
    expectedVerdict: 'FAIL',
    notes: 'R1 통계 모드: 단일값 18MPa, fcn=24, le35 1회 기준 18 < (24-3.5)=20.5 → FAIL. 7일 양생 부적절 환기는 expertContext에서 LLM이 처리. 향후 timing(7일 vs 28일) parser 도입 시 UNDETERMINED로 분기 가능.',
  },
  {
    id: 'C03',
    persona: '경력',
    intent: '1회 -3.5MPa 룰 (단일값 21MPa, R1 검증)',
    expect: '단일 시험값 21MPa, fcn 24 → 표 3.5-3 (≤35MPa, 1회 ≥ fcn-3.5 = 20.5) → PASS marginal(평균 미수반)',
    tool: 'evaluate_observation',
    args: { observation: '압축강도 1회 시험값 21MPa, 호칭강도 24MPa', testId: 'test.compressive_strength' },
    expectedVerdict: 'PASS',
    expectedBasisIds: ['criteria.compressive_strength_statistical_le35'],
    // expectedSourceStatus는 응답 신뢰도 KPI(measure.ts)로 별도 추적 — 시나리오 PASS 게이트에서 분리. R6 Glossary 마이그레이션 후 R6+ baseline에서 재도입.
    notes: 'R1 (2026-04-28) 통계 모드 도입. 단일값 입력이라 평균 검증 부재 → MARGINAL = legalVerdict PASS + qualitySignal=marginal. expectedVerdict=PASS는 legalVerdict 비교.',
  },
  {
    id: 'C03b',
    persona: '경력',
    intent: 'R1 통계 series PASS — 평균 26 최저 22, fcn 24',
    expect: 'series 입력. ≤35MPa: 평균 26 ≥ 24 AND 최저 22 ≥ 20.5 → 둘 다 통과 → PASS (full)',
    tool: 'evaluate_observation',
    args: { observation: '연속 3회 평균 26MPa 최저 22MPa, 호칭강도 24MPa', testId: 'test.compressive_strength' },
    expectedVerdict: 'PASS',
    expectedBasisIds: ['criteria.compressive_strength_statistical_le35'],
    // expectedSourceStatus는 응답 신뢰도 KPI(measure.ts)로 별도 추적 — 시나리오 PASS 게이트에서 분리. R6 Glossary 마이그레이션 후 R6+ baseline에서 재도입.
    notes: 'R1 통계 모드 series 입력 검증. partial=false. legalVerdict=PASS, qualitySignal=in_range.',
  },
  {
    id: 'C03c',
    persona: '경력',
    intent: 'R1 통계 series FAIL — 평균 25 최저 19, fcn 24',
    expect: 'series 입력. ≤35MPa: 평균 25 ≥ 24 OK BUT 최저 19 < 20.5 → 1회 기준 미달 → FAIL',
    tool: 'evaluate_observation',
    args: { observation: '3회 시험값 23 25 19 평균 22.3 최저 19, 호칭강도 24MPa', testId: 'test.compressive_strength' },
    expectedVerdict: 'FAIL',
    expectedBasisIds: ['criteria.compressive_strength_statistical_le35'],
    // expectedSourceStatus는 응답 신뢰도 KPI(measure.ts)로 별도 추적 — 시나리오 PASS 게이트에서 분리. R6 Glossary 마이그레이션 후 R6+ baseline에서 재도입.
    notes: 'R1 통계 모드 1회 기준 단독 미달. ncr.compressive_strength_statistical_fail 후속 발화 검증.',
  },
  {
    id: 'C03d',
    persona: '경력',
    intent: 'R1 통계 gt35 — 평균 41 최저 37, fcn 40',
    expect: 'series. >35MPa: 평균 41 ≥ 40 OK AND 최저 37 ≥ 40×0.9=36 → 통과 → PASS',
    tool: 'evaluate_observation',
    args: { observation: '연속 3회 평균 41MPa 최저 37MPa, 호칭강도 40MPa', testId: 'test.compressive_strength' },
    expectedVerdict: 'PASS',
    expectedBasisIds: ['criteria.compressive_strength_statistical_gt35'],
    // expectedSourceStatus는 응답 신뢰도 KPI(measure.ts)로 별도 추적 — 시나리오 PASS 게이트에서 분리. R6 Glossary 마이그레이션 후 R6+ baseline에서 재도입.
    notes: 'R1 gt35 분기 검증. fcn=40 → gt35 자동 선택.',
  },
  {
    id: 'C04',
    persona: '경력',
    intent: '기둥 측면 해체 강도 (R5 H1 미도입, R1 통계 모드 부재 fcn으로 UNDETERMINED 기대)',
    expect: 'KCS 14 20 12 §3.3.1 측면 5MPa↑. 7MPa 가능. R1 통계 criterion이 fcn 미입력 → UNDETERMINED. R5 H1 도입 후 거푸집 별도 criteria.',
    tool: 'evaluate_observation',
    args: { observation: '기둥 거푸집 해체 시점 압축강도 7MPa', testId: 'test.compressive_strength' },
    expectedVerdict: 'UNDETERMINED',
    forbiddenBasisIds: ['criteria.compressive_strength_design'],
    notes: 'R1: pickBestCriterion이 statistical_le35 우선 선택, fcn 미입력 → UNDETERMINED. deprecated design은 forbidden. R5 H1 도입 후 거푸집 부재 키워드 라우팅으로 PASS.',
  },
  {
    id: 'C05',
    persona: '경력',
    intent: '한중 적용 기준 (R6 미도입)',
    expect: '하루평균 4℃ 이하 → 한중 콘크리트 (KCS 14 20 40 §1.1(2)). R6 WorkType 도입 전 hit 적음.',
    tool: 'discover_relevant_domain',
    args: { situation: '내일 외기온도 3℃ 예보. 일반 콘크리트로 시공해도 되나요', maxResults: 6 },
    expectedHitsMax: 4,
    notes: 'R6 work.cold_weather_concrete 도입 후 expectedHitsMin: 1 추가 + cold_weather worktype 매칭 검증.',
  },
  {
    id: 'C06',
    persona: '경력',
    intent: '운반시간 한도 (R4 미도입, false PASS 차단 핵심)',
    expect: '외기 25℃↑ 1.5h(90분) 한도, 95분 > 90분 → 반송 (KCS 14 20 10 §3.2(3)). R4 미도입 시 UNDETERMINED 정상.',
    tool: 'evaluate_observation',
    args: { observation: '외기 28℃, 비비기-타설 운반시간 95분', testId: 'test.concrete_temperature' },
    expectedVerdict: 'UNDETERMINED',
    forbiddenBasisIds: ['criteria.concrete_temperature_general'],
    notes: 'C06이 R3 D1 false PASS 직격 시나리오. testItem이 concrete_temperature지만 실제는 운반시간 평가 필요. concrete_temperature 기준에 잘못 라우팅되면 false PASS. R4 D5 도입 후 test.delivery_time + criteria.delivery_time_25c_high로 정확 매칭.',
  },
  {
    id: 'C07',
    persona: '감리',
    intent: '슬래브 해체 강도 (R5 H2 미도입, R1 통계 모드로 인해 statistical 평가)',
    expect: 'fck=24, 24×2/3=16 + 14MPa↑ → 승인. R5 H2 미도입 — R1에서는 statistical_le35로 평가 (16 < 20.5 → FAIL).',
    tool: 'evaluate_observation',
    args: { observation: '슬래브 거푸집 해체 시점 압축강도 16MPa, 설계기준압축강도 fck 24MPa', testId: 'test.compressive_strength' },
    expectedVerdict: 'FAIL',
    notes: 'R1: statistical_le35로 평가, fcn=24, 16 < 20.5 → FAIL. R5 H2 도입 후 슬래브 부재 키워드 라우팅 → 거푸집 별도 criteria → PASS.',
  },
  {
    id: 'C08',
    persona: '감리',
    intent: '코어 §3.5.5.7 평가 (R7 G 미도입, R1 통계 모드와 차이)',
    expect: '코어 §3.5.5.7(4): 평균≥fcn×0.85 AND 각각≥fcn×0.75. R1 통계는 §3.5.3.2 (-3.5 또는 ×0.9) — 코어 기준과 다름. R1에서는 잘못된 분기로 PASS 가능 → forbidden 검출.',
    tool: 'evaluate_observation',
    args: { observation: '코어 4개 평균 22MPa 최저 17MPa, fck 24MPa', testId: 'test.compressive_strength' },
    expectedVerdict: 'FAIL',
    notes: 'R1 statistical_le35: 평균 22 ≥ 24? FAIL. 그러나 진짜 코어 기준은 평균≥20.4 AND 각각≥18 — 평균 22≥20.4 OK, 최저 17<18 → FAIL. 우연히 verdict 일치. R7 G 코어 별도 criterion 필요. 향후 timing parser(코어 키워드) 도입.',
  },
  {
    id: 'C09',
    persona: '감리',
    intent: '강우 시 빗물 고임 (R7 미도입)',
    expect: 'KCS 14 20 10 §3.3.2(10): 제거 후 타설. R7 강우 키워드 인식 도입 전 hit 적음.',
    tool: 'discover_relevant_domain',
    args: { situation: '타설 중 비. 표면 빗물 고임. 어떻게 처리하나요', maxResults: 5 },
    expectedHitsMax: 3,
    notes: 'R7 강우 키워드 도입 후 expectedHitsMin: 1 + standard.kcs_14_20.10.3_3_2 매칭.',
  },
  {
    id: 'C10',
    persona: '공장',
    intent: '기온보정 Tn 표 (R7 K 미도입)',
    expect: 'KCS 14 20 10 표 2.2-1 (시멘트×재령×기온 3D). R7 K 도입 전 search threshold로 환각 차단 확인.',
    tool: 'search_construction_standards',
    args: { query: '기온보정값 Tn 28일 예상평균기온' },
    expectedHitsMax: 5,
    notes: 'R7 K 도입 후 expectedHitsMin: 1 + standard.kcs_14_20.10.2_2_2 (Tn 표) 매칭.',
  },
  {
    id: 'C11',
    persona: '신입',
    intent: '콜드조인트 NCR 양식 (R0-G1 정정 후)',
    expect: 'ncr.cold_joint basisPriority에 §3.3.2(8) 표 3.3-1 + §1.4 콜드조인트 정의 포함 확인',
    tool: 'compile_ncr_references',
    args: { ncrId: 'ncr.cold_joint', workType: 'work.concrete_placement' },
    expectedBasisIds: ['standard.kcs_14_20.10.3_3_2', 'standard.kcs_14_20.10.1_4'],
    notes: 'R0-G1 인용 정정으로 §3.3.2 + §1.4 노드가 새로 ref됨. R0-G1 검증 시나리오.',
  },
  {
    id: 'C12',
    persona: '경력',
    intent: 'fck/fcn/fcr/fcm 용어 (R1 Glossary 미도입, G4 환각 차단 확인)',
    expect: 'R1 Glossary entity 도입 전 NO_MATCH. G4 score threshold로 "광역자치단체"와 환각 매칭 차단 확인.',
    tool: 'search_quality_ontology',
    args: { query: 'fck fcn fcr fcm 호칭강도 설계기준 배합강도' },
    expectedHitsMax: 8,
    forbiddenBasisIds: ['agency.metropolitan_city'],
    notes: 'R0-G4 환각 차단 검증 시나리오. R1 Glossary 도입 후 expectedHitsMin: 4 (fck/fcn/fcr/fcm 4개 용어).',
  },
  {
    id: 'C13',
    persona: '신입',
    intent: '한중 양생온도 정의 (R6 미도입)',
    expect: '콘크리트 온도. 5℃↑ 유지, 0℃↑ 2일 (KCS 14 20 40 §3.4.1(4)). R6 미도입 시 hit 적음.',
    tool: 'discover_relevant_domain',
    args: { situation: '한중 시공인데 양생온도가 콘크리트 온도인지 외기온도인지 헷갈려요', maxResults: 6 },
    expectedHitsMax: 4,
    notes: 'R6 work.cold_weather_concrete + Glossary 양생온도 도입 후 expectedHitsMin: 2.',
  },
];

const out: Array<Scenario & { ms?: number; response?: unknown; error?: string }> = [];
for (const sc of SCENARIOS) {
  const tool = TOOL_MAP.get(sc.tool);
  if (!tool) {
    out.push({ ...sc, error: `tool not registered: ${sc.tool}` });
    continue;
  }
  try {
    const t0 = performance.now();
    const r = await tool.run(sc.args, graph);
    const ms = Math.round(performance.now() - t0);
    out.push({ ...sc, ms, response: r });
  } catch (e) {
    const err = e as Error;
    out.push({ ...sc, error: String(err?.stack ?? err) });
  }
}

const path = `evaluation/r02-${process.argv[2] ?? 'baseline'}.json`;
writeFileSync(path, JSON.stringify(out, null, 2), 'utf8');
console.log(`saved: ${path} (${out.length} scenarios)`);
