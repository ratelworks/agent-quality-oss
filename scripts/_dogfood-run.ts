/**
 * Dogfooding 실행 스크립트.
 * 3개 페르소나(김신입/박경력/이감리)의 시나리오를 실제 Tool로 호출하고
 * 응답을 JSON으로 저장한다. 평가는 사람이 읽고 evaluation.md에 기록.
 */
import { writeFileSync } from 'node:fs';
import { TOOL_MAP } from '../src/mcp/registry.js';
import { OntologyGraph } from '../src/ontology/graph.js';
import { loadOntologySync } from '../src/ontology/loader.js';

interface Scenario {
  id: string;
  persona: string;
  context: string;
  intent: string;
  tool: string;
  args: Record<string, unknown>;
}

const graph = new OntologyGraph(loadOntologySync());

const SCENARIOS: Scenario[] = [
  // === 김신입 (현장 QC 1년차) ===
  {
    id: 'S01',
    persona: '김신입',
    context: '현장 도착해서 슬래브 타설 검측 들어가는데 뭘 봐야 하는지 막막함',
    intent: '검측 항목 전체 길잡이',
    tool: 'discover_relevant_domain',
    args: { situation: '내일 슬래브 콘크리트 타설인데 처음이라 뭘 준비해야 할지 모르겠어요', maxResults: 8 },
  },
  {
    id: 'S02',
    persona: '김신입',
    context: '슬럼프 시험 결과 200mm 나옴 - 기준 초과로 의심',
    intent: '관측값 1건 즉시 평가',
    tool: 'evaluate_observation',
    args: { observation: '슬럼프 200mm', testId: 'test.slump' },
  },
  {
    id: 'S03',
    persona: '김신입',
    context: '레미콘 도착하니 송장에 "공기량 7.5%"라고 적힘',
    intent: '관측값 평가 — 단위/기준 모름',
    tool: 'evaluate_observation',
    args: { observation: '공기량 7.5%', testId: 'test.air_content' },
  },
  {
    id: 'S04',
    persona: '김신입',
    context: '공시체 만들어야 한다는데 어떻게 만들고 양생을 어디서 해야 하는지 모름',
    intent: '공시체 기록 양식 확인',
    tool: 'get_specimen_record_schema',
    args: {},
  },
  {
    id: 'S05',
    persona: '김신입',
    context: '슬럼프 NG 났음 — NCR을 어떻게 써야 하지?',
    intent: 'NCR 패키지 일괄 요청',
    tool: 'compile_ncr_references',
    args: { ncrId: 'ncr.slump_too_high', workType: 'work.concrete_placement' },
  },

  // === 박경력 (현장 QC 7년차) ===
  {
    id: 'S06',
    persona: '박경력',
    context: '시방서 W/B 50%, KCS는 50% 이하만 명시 — 어느 쪽 우선?',
    intent: '근거 우선순위 확인',
    tool: 'map_quality_basis',
    args: {
      workType: 'work.concrete_placement',
      material: 'material.ready_mixed_concrete',
      testItem: 'test.slump',
      projectContext: { hasMixDesign: true, hasSpecification: true },
    },
  },
  {
    id: 'S07',
    persona: '박경력',
    context: '레미콘 차량 8대 동시 도착, 검측 인원 부족 — 시험 빈도 근거 확인',
    intent: '시험 빈도 정량 기준',
    tool: 'get_material_quality_profile',
    args: { material: '레미콘' },
  },
  {
    id: 'S08',
    persona: '박경력',
    context: '압축강도 28일 26MPa 나옴 (설계 24MPa) — 합격? 합격기준 정확히?',
    intent: '압축강도 합격 판정',
    tool: 'evaluate_observation',
    args: { observation: '28일 압축강도 26MPa', testId: 'test.compressive_strength' },
  },
  {
    id: 'S09',
    persona: '박경력',
    context: '하자 발생해서 NCR 닫는데 effectiveness check 누가 해야 하는지 사규/법령',
    intent: 'NCR 클로저 근거 추적',
    tool: 'explain_quality_decision_path',
    args: { entityId: 'ncr.slump_too_high' },
  },
  {
    id: 'S10',
    persona: '박경력',
    context: 'LLM이 만든 보고서에 "건설기술진흥법 제42조에 따라 반드시 시정조치해야" 라고 씀 — 이거 진짜 맞나?',
    intent: '근거 검증 — 환각 차단',
    tool: 'verify_quality_basis',
    args: {
      statement: '건설기술진흥법 제42조에 따라 반드시 즉시 시정조치하여야 합니다.',
      claimedBasisIds: ['standard.law.framework_act_42'],
    },
  },

  // === 이감리 (책임감리원) ===
  {
    id: 'S11',
    persona: '이감리',
    context: '시공사 ITP 받았는데 hold point 누락 의심 — 근거 법령 갖춰서 review',
    intent: 'ITP 양식·근거 확인',
    tool: 'get_itp_schema',
    args: {},
  },
  {
    id: 'S12',
    persona: '이감리',
    context: '시공사가 제출한 시험성적서 위조 의심 — 검토 보고서 작성',
    intent: '시험성적서 검토 근거+양식',
    tool: 'get_test_report_review_schema',
    args: {},
  },
  {
    id: 'S13',
    persona: '이감리',
    context: 'NCR 처리에서 발주처 통보가 의무인지 확인',
    intent: '품질관리 업무지침 검색',
    tool: 'search_quality_management_guideline',
    args: { query: '부적합 발주청 보고' },
  },
  {
    id: 'S14',
    persona: '이감리',
    context: '시공사가 인용한 "건설공사 품질관리 업무지침 별지 제3호 시정조치 요구서" 명칭 검증',
    intent: '서식 환각 검증',
    tool: 'verify_form_reference',
    args: { claim: '건설공사 품질관리 업무지침 별지 제3호 시정조치 요구서' },
  },
  {
    id: 'S15',
    persona: '이감리',
    context: '책임감리원 권한 근거가 되는 핵심 법률·시행령',
    intent: '법령 카탈로그',
    tool: 'list_core_quality_laws',
    args: { category: 'law' },
  },

  // === 추가 검증 시나리오 (cross-cutting) ===
  {
    id: 'S16',
    persona: '김신입',
    context: '"방수공사" 라고만 묻기 — 공종 모호',
    intent: 'resolve_worktype 모호 케이스',
    tool: 'resolve_worktype',
    args: { input: '방수' },
  },
  {
    id: 'S17',
    persona: '박경력',
    context: '온톨로지에 없는 공종 — "도장공사"',
    intent: 'discover_relevant_domain — 미커버 영역',
    tool: 'discover_relevant_domain',
    args: { situation: '내일 외벽 도장공사인데 시험·검측 알려주세요', maxResults: 5 },
  },
  {
    id: 'S18',
    persona: '이감리',
    context: '레미콘 송장에서 "기온 +33°C"',
    intent: '서머 콘크리트 / 한중·서중 인지',
    tool: 'evaluate_observation',
    args: { observation: '타설시 외기온도 33°C', testId: 'test.concrete_temperature' },
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

const path = 'evaluation/dogfooding-raw.json';
writeFileSync(path, JSON.stringify(out, null, 2), 'utf8');
console.log(`saved: ${path} (${out.length} scenarios)`);
