#!/usr/bin/env node
/**
 * 정부 공식 자료 기반 커버리지 매트릭스.
 *
 * Ground truth 소스:
 *  - 건설공사 품질관리 업무지침 (고시 2025-311호, 2025.6.12 시행)
 *  - KCS 14 20 10 일반콘크리트 표준시방서
 *  - 건설기술 진흥법 시행령 §89~§93, 시행규칙 §50~§53
 *  - 업무지침 별표·별지 서식
 *
 * 3축 매트릭스:
 *  A. 법정 요구 항목 (업무지침이 요구하는 문서·시험·절차)
 *  B. KCS 14 20 10 기준 대조 (수치 일치 여부)
 *  C. 별지 서식 커버 (식별자·관련 조항)
 */

import { loadOntologySync } from '../src/ontology/loader.js';
import { OntologyGraph } from '../src/ontology/graph.js';
import { TOOL_MAP } from '../src/mcp/registry.js';
import type { ToolResponse } from '../src/mcp/types.js';

const graph = new OntologyGraph(loadOntologySync());

type Coverage = 'O' | '△' | '✗';

interface CheckRow {
  id: string;
  requirement: string;
  source: string;
  mcpTool: string | null;
  verification: () => Coverage;
  note?: string;
}

function stat(label: string, rows: CheckRow[]) {
  const results = rows.map((r) => ({
    id: r.id,
    requirement: r.requirement,
    source: r.source,
    tool: r.mcpTool,
    coverage: r.verification(),
    note: r.note,
  }));
  const O = results.filter((r) => r.coverage === 'O').length;
  const P = results.filter((r) => r.coverage === '△').length;
  const X = results.filter((r) => r.coverage === '✗').length;
  const total = results.length;
  const score = ((O * 1 + P * 0.5) / total) * 100;

  console.log(`\n━━━ ${label} ━━━`);
  for (const r of results) {
    const mark = r.coverage === 'O' ? '✓' : r.coverage === '△' ? '◐' : '✗';
    console.log(
      `  ${mark} [${r.id}] ${r.requirement}`,
    );
    console.log(`       source: ${r.source}`);
    if (r.tool) console.log(`       tool: ${r.tool}`);
    if (r.note) console.log(`       note: ${r.note}`);
  }
  console.log(`  ─ ${label} 커버리지: O=${O} △=${P} ✗=${X} (점수 ${score.toFixed(1)} / 100)`);
  return { O, P, X, score, total };
}

const run = (name: string, args: Record<string, unknown>): ToolResponse<any> => {
  const t = TOOL_MAP.get(name);
  if (!t) throw new Error(`tool not registered: ${name}`);
  return t.run(args, graph) as ToolResponse<any>;
};

// ─── A. 법정 요구 항목 매핑 ───
const A_ROWS: CheckRow[] = [
  {
    id: 'A1',
    requirement: '품질관리계획서 작성 (건진법 시행령 §89 대상 시)',
    source: '업무지침 §4 + 별표1 + 시행규칙 §52',
    mcpTool: 'get_quality_law_article, get_quality_guideline_article, get_standard_form_locator(form.quality_plan_annex1)',
    verification: () => {
      const law = run('get_quality_law_article', { articleId: 'standard.law.btia_decree_89' });
      const guide = run('get_quality_guideline_article', { articleId: 'standard.guideline.part2_art4' });
      const form = run('get_standard_form_locator', { formId: 'standard.form.quality_plan_annex1' });
      return law.result.article && guide.result.article && form.result.form ? 'O' : '△';
    },
  },
  {
    id: 'A2',
    requirement: '품질시험계획서 작성 (건진법 시행령 §90 대상)',
    source: '업무지침 §5 + 별표2 + 시행규칙 §53',
    mcpTool: 'get_quality_law_article, get_quality_guideline_article, get_standard_form_locator(별표2·form.test_plan_template)',
    verification: () => {
      const annex2 = run('get_standard_form_locator', { formId: 'standard.form.guideline_annex2' });
      const testPlan = run('get_standard_form_locator', { formId: 'standard.form.test_plan_template' });
      return annex2.result.form && testPlan.result.form ? 'O' : '△';
    },
  },
  {
    id: 'A3',
    requirement: '시험 빈도 — 굳지 않은 콘크리트 120㎥마다 (2024-638호 개정)',
    source: '업무지침 별표2 (개정판)',
    mcpTool: 'get_work_quality_profile + test-items.json frequency',
    verification: () => {
      const profile = run('get_work_quality_profile', { workType: 'work.concrete_placement' });
      const tests = profile.result.tests as Array<{ meta?: { frequency?: string } }>;
      const updated = tests.every((t) => t.meta?.frequency?.includes('120'));
      return updated ? 'O' : '✗';
    },
    note: '2024-638호 개정에서 150→120㎥ 변경됨',
  },
  {
    id: 'A4',
    requirement: '부적합 발생 시 조치 (업무지침 §7)',
    source: '업무지침 §7 + 별지 제6호 + 별지 제7호',
    mcpTool: 'compile_ncr_references, get_ncr_schema, get_standard_form_locator(별지 6·7호)',
    verification: () => {
      const ncr = run('compile_ncr_references', { ncrId: 'ncr.slump_too_high' });
      const form6 = run('get_standard_form_locator', { formId: 'standard.form.guideline_no6' });
      const form7 = run('get_standard_form_locator', { formId: 'standard.form.guideline_no7' });
      return ncr.result.ncrs.length > 0 && form6.result.form && form7.result.form ? 'O' : '△';
    },
  },
  {
    id: 'A5',
    requirement: '검사대행·시험기관 확인 (건진법 §60, 업무지침 §8)',
    source: '건진법 §60 + 업무지침 §8',
    mcpTool: 'get_quality_law_article(law.btia_60), get_quality_guideline_article(guideline.part2_art8), get_test_report_review_schema(custody section)',
    verification: () => {
      const law = run('get_quality_law_article', { articleId: 'standard.law.btia_60' });
      const guide = run('get_quality_guideline_article', { articleId: 'standard.guideline.part2_art8' });
      const tr = run('get_test_report_review_schema', {});
      const hasCustody = (tr.result.sections as Array<{ key: string }>).some((s) => s.key === 'custody');
      return law.result.article && guide.result.article && hasCustody ? 'O' : '△';
    },
  },
  {
    id: 'A6',
    requirement: '품질관리자 배치 (시행규칙 §50)',
    source: '시행규칙 §50 + 별지 제42호 (품질검사 실시대장)',
    mcpTool: 'get_quality_law_article(rule_50), get_standard_form_locator(rule_no42_quality_inspection_register)',
    verification: () => {
      const law = run('get_quality_law_article', { articleId: 'standard.law.btia_rule_50' });
      const form = run('get_standard_form_locator', { formId: 'standard.form.rule_no42_quality_inspection_register' });
      return law.result.article && form.result.form ? 'O' : '△';
    },
  },
  {
    id: 'A7',
    requirement: '품질관리계획 이행점검 (업무지침 §10 + 시행규칙 §51 별지 제43호)',
    source: '업무지침 §10 + 시행규칙 §51',
    mcpTool: 'get_quality_guideline_article(art10), get_standard_form_locator(rule_no43_quality_inspection_summary)',
    verification: () => {
      const guide = run('get_quality_guideline_article', { articleId: 'standard.guideline.part2_art10' });
      const form = run('get_standard_form_locator', { formId: 'standard.form.rule_no43_quality_inspection_summary' });
      return guide.result.article && form.result.form ? 'O' : '△';
    },
  },
  {
    id: 'A8',
    requirement: '레미콘·아스콘 현장배치플랜트 관리 (업무지침 제3편, 2025-311호 개정)',
    source: '업무지침 제3편',
    mcpTool: 'get_quality_guideline_article(part3)',
    verification: () => {
      const guide = run('get_quality_guideline_article', { articleId: 'standard.guideline.part3' });
      return guide.result.article ? 'O' : '✗';
    },
  },
  {
    id: 'A9',
    requirement: '철강구조물 제작공장 인증 (업무지침 제4편)',
    source: '업무지침 제4편',
    mcpTool: 'search_quality_management_guideline(part4) — skeleton 상태',
    verification: () => {
      const guide = run('get_quality_guideline_article', { articleId: 'standard.guideline.part4' });
      return guide.result.article?.skeleton ? '△' : guide.result.article ? 'O' : '✗';
    },
    note: 'Phase A skeleton — 식별자만, 공종 온톨로지 연계는 Phase B',
  },
  {
    id: 'A10',
    requirement: '가설기자재 품질관리 (업무지침 제5편)',
    source: '업무지침 제5편',
    mcpTool: 'search_quality_management_guideline(part5) — skeleton',
    verification: () => {
      const guide = run('get_quality_guideline_article', { articleId: 'standard.guideline.part5' });
      return guide.result.article?.skeleton ? '△' : guide.result.article ? 'O' : '✗';
    },
  },
  {
    id: 'A11',
    requirement: '기록 보존 (건진법 시행령 §93 + 건산법 §28 하자담보)',
    source: '건진법 시행령 §93 + 건산법 §28',
    mcpTool: '— 도메인 외부. agent-quality-audit-mcp(예정)로 분리.',
    verification: () => {
      // 본 MCP의 정체성은 "도메인 전문성 공급"이며 감사 증적 포장은 별도 책임.
      // 다만 보존 근거 법령(시행령 §93, 건산법 §28)은 내장되어 있어 안내 가능.
      const lawDecree = run('get_quality_law_article', { articleId: 'standard.law.btia_decree_93' });
      const lawCifa = run('get_quality_law_article', { articleId: 'standard.law.cifa_28' });
      return lawDecree.result.article && lawCifa.result.article ? '△' : '✗';
    },
    note: '5차 정체성 정리: export Tool은 분리. 보존 의무 법령 안내까지가 본 MCP의 책임.',
  },
  {
    id: 'A12',
    requirement: '청렴서약/이해관계확인 (업무지침 별지 제4호)',
    source: '업무지침 별지 제4호',
    mcpTool: 'get_standard_form_locator(guideline_no4)',
    verification: () => {
      const form = run('get_standard_form_locator', { formId: 'standard.form.guideline_no4' });
      return form.result.form ? 'O' : '✗';
    },
  },
];

// ─── B. KCS 14 20 10 기준 대조 ───
const B_ROWS: CheckRow[] = [
  {
    id: 'B1',
    requirement: 'KCS §3.2: 보통 콘크리트 공기량 4.5±1.5%',
    source: 'KCS 14 20 10 §3.2 표 1.7-3',
    mcpTool: 'criteria.air_content_general',
    verification: () => {
      const c = graph.get('criteria.air_content_general');
      return c?.meta?.['target'] === 4.5 && c?.meta?.['plusMinus'] === 1.5 && c?.meta?.['unit'] === '%' ? 'O' : '✗';
    },
  },
  {
    id: 'B2',
    requirement: 'KCS §3.2: 경량 콘크리트 공기량 5.5±1.5%',
    source: 'KCS 14 20 10 §3.2 표 1.7-3',
    mcpTool: 'criteria.air_content_lightweight',
    verification: () => {
      const c = graph.get('criteria.air_content_lightweight');
      return c?.meta?.['target'] === 5.5 && c?.meta?.['plusMinus'] === 1.5 ? 'O' : '✗';
    },
  },
  {
    id: 'B3',
    requirement: 'KCS §3.2: 포장 콘크리트 공기량 4.5±1.5%',
    source: 'KCS 14 20 10 §3.2 표 1.7-3',
    mcpTool: 'criteria.air_content_pavement',
    verification: () => {
      const c = graph.get('criteria.air_content_pavement');
      return c?.meta?.['target'] === 4.5 && c?.meta?.['plusMinus'] === 1.5 ? 'O' : '✗';
    },
  },
  {
    id: 'B4',
    requirement: 'KCS §3.2: 고강도 공기량 3.5%±1.5%',
    source: 'KCS 14 20 10 §3.2 표 1.7-3',
    mcpTool: 'criteria.air_content_high_strength',
    verification: () => {
      const c = graph.get('criteria.air_content_high_strength');
      return c?.meta?.['target'] === 3.5 && c?.meta?.['plusMinus'] === 1.5 ? 'O' : '✗';
    },
  },
  {
    id: 'B5',
    requirement: 'KCS §3.2: 염화물 이온 0.30 kg/㎥ 이하',
    source: 'KCS 14 20 10 §3.2',
    mcpTool: 'criteria.chloride_limit_030',
    verification: () => {
      const c = graph.get('criteria.chloride_limit_030');
      return c?.meta?.['operator'] === 'le' && c?.meta?.['threshold'] === 0.3 && c?.meta?.['unit'] === 'kg/㎥' ? 'O' : '✗';
    },
  },
  {
    id: 'B6',
    requirement: 'KCS §3.2: 슬럼프 (KS F 2402) 기준 ±25mm (일반)',
    source: 'KCS 14 20 10 §3.2 + KS F 2402',
    mcpTool: 'criteria.slump_general_150',
    verification: () => {
      const c = graph.get('criteria.slump_general_150');
      return c?.meta?.['plusMinus'] === 25 && c?.meta?.['unit'] === 'mm' ? 'O' : '✗';
    },
  },
  {
    id: 'B7',
    requirement: 'KCS §3.3: 압축강도 fck 이상 (설계기준강도)',
    source: 'KCS 14 20 10 §3.3',
    mcpTool: 'criteria.compressive_strength_design',
    verification: () => {
      const c = graph.get('criteria.compressive_strength_design');
      return c?.meta?.['operator'] === 'ge' && c?.meta?.['threshold'] === null ? '△' : c ? 'O' : '✗';
    },
    note: 'threshold는 프로젝트 주입 대기 (fck 값). 복합 판정(3공시체 평균 + 개별 0.85fck)은 Phase A 범위 밖',
  },
  {
    id: 'B8',
    requirement: '시험빈도: 굳지 않은 콘크리트 120㎥마다 1회',
    source: '업무지침 2024-638호 별표2 (150→120 개정)',
    mcpTool: 'test-items.json frequency 필드',
    verification: () => {
      const slump = graph.get('test.slump');
      return (slump?.meta?.['frequency'] as string | undefined)?.includes('120') ? 'O' : '✗';
    },
  },
  {
    id: 'B9',
    requirement: '시험빈도: 단위수량 1회/일, 120㎥마다',
    source: '업무지침 2024-638호 별표2 (신설)',
    mcpTool: 'test.unit_water_content',
    verification: () => {
      const u = graph.get('test.unit_water_content');
      const freq = u?.meta?.['frequency'] as string | undefined;
      return freq?.includes('120') && freq?.includes('1회/일') ? 'O' : '✗';
    },
  },
];

// ─── C. 시행규칙 별지 서식 + 업무지침 별표/별지 커버 ───
const C_ROWS: CheckRow[] = [
  {
    id: 'C1',
    requirement: '시행규칙 별지 제42호 (품질검사 실시대장)',
    source: '건진법 시행규칙 §50',
    mcpTool: 'get_standard_form_locator(rule_no42_quality_inspection_register)',
    verification: () => {
      const f = graph.get('standard.form.rule_no42_quality_inspection_register');
      return f?.meta?.['license'] === 'Korea Open Government License Type 4' ? 'O' : '✗';
    },
    note: '5차 검증 정정: 이전 "점검결과 통보서" → "품질검사 실시대장"',
  },
  {
    id: 'C2',
    requirement: '시행규칙 별지 제43호 (품질검사 성과 총괄표)',
    source: '건진법 시행규칙 §51',
    mcpTool: 'get_standard_form_locator(rule_no43_quality_inspection_summary)',
    verification: () => (graph.get('standard.form.rule_no43_quality_inspection_summary') ? 'O' : '✗'),
    note: '5차 검증 정정: 이전 "이행점검 결과 통보서" → "품질검사 성과 총괄표"',
  },
  {
    id: 'C3',
    requirement: '업무지침 별표1 (품질관리계획서 작성기준)',
    source: '업무지침 별표1',
    mcpTool: 'get_standard_form_locator(quality_plan_annex1)',
    verification: () => (graph.get('standard.form.quality_plan_annex1') ? 'O' : '✗'),
  },
  {
    id: 'C4',
    requirement: '업무지침 별표2 (시험종목·방법·빈도)',
    source: '업무지침 별표2',
    mcpTool: 'get_standard_form_locator(guideline_annex2)',
    verification: () => (graph.get('standard.form.guideline_annex2') ? 'O' : '✗'),
  },
  {
    id: 'C5',
    requirement: '업무지침 별지 제4호 (청렴서약·이해관계확인서)',
    source: '업무지침 별지 제4호',
    mcpTool: 'get_standard_form_locator(guideline_no4)',
    verification: () => (graph.get('standard.form.guideline_no4') ? 'O' : '✗'),
  },
  {
    id: 'C6',
    requirement: '업무지침 별지 제6호 (부적합 조치결과 확인서)',
    source: '업무지침 별지 제6호',
    mcpTool: 'get_standard_form_locator(guideline_no6)',
    verification: () => (graph.get('standard.form.guideline_no6') ? 'O' : '✗'),
  },
  {
    id: 'C7',
    requirement: '업무지침 별지 제7호 (확인보고서)',
    source: '업무지침 별지 제7호',
    mcpTool: 'get_standard_form_locator(guideline_no7)',
    verification: () => (graph.get('standard.form.guideline_no7') ? 'O' : '✗'),
  },
  {
    id: 'C8',
    requirement: '업무지침 품질시험계획서 표준 양식 (별지)',
    source: '업무지침 별지',
    mcpTool: 'get_standard_form_locator(test_plan_template)',
    verification: () => (graph.get('standard.form.test_plan_template') ? 'O' : '✗'),
  },
];

const A = stat('A. 법정 요구 항목 (업무지침 2025-311호 + 건진법)', A_ROWS);
const B = stat('B. KCS 14 20 10 기준 대조 (수치 일치)', B_ROWS);
const C = stat('C. 시행규칙·업무지침 별지 서식 커버', C_ROWS);

console.log('\n━━━━━ 종합 ━━━━━');
console.log(`  A 법정 요구:   ${A.score.toFixed(1)} / 100 (O=${A.O} △=${A.P} ✗=${A.X})`);
console.log(`  B KCS 기준:    ${B.score.toFixed(1)} / 100 (O=${B.O} △=${B.P} ✗=${B.X})`);
console.log(`  C 별지 서식:   ${C.score.toFixed(1)} / 100 (O=${C.O} △=${C.P} ✗=${C.X})`);
const overall =
  (A.score * A.total + B.score * B.total + C.score * C.total) / (A.total + B.total + C.total);
console.log(`  ─ 종합 가중 평균: ${overall.toFixed(1)} / 100`);

process.exit(A.X + B.X + C.X > 0 ? 1 : 0);
