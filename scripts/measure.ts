#!/usr/bin/env node
/**
 * R0-G2: 자동 채점.
 *
 * 입력  : evaluation/r02-{label}.json (scripts/_dogfood-r02.ts 산출물)
 * 출력  : evaluation/r02-{label}.metrics.json + 콘솔 표
 *
 * 4종 핵심 메트릭:
 *  1. PASS율            = (expected와 일치) / 전체
 *  2. false PASS율      = (expectedVerdict !== PASS인데 실제 PASS) / 전체
 *  3. 근거 오인용률      = (forbiddenBasisIds 등장한 시나리오) / 전체
 *  4. 노드 활용률        = build/graph/graph.summary.json에서 가져옴
 *
 * 사용:
 *   tsx scripts/_dogfood-r02.ts baseline       # r02-baseline.json 생성
 *   tsx scripts/dump-graph.ts --json-only      # graph.summary.json 갱신
 *   tsx scripts/measure.ts baseline            # r02-baseline.metrics.json + 콘솔
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSchemaIds } from '../src/schemas/loader.js';
import { LEGAL_DOCUMENTS_19, computeCoverage } from '../src/schemas/legal-documents-19.js';

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const label = process.argv[2] ?? 'baseline';
const inputPath = path.join(PROJECT_ROOT, 'evaluation', `r02-${label}.json`);
const outputPath = path.join(PROJECT_ROOT, 'evaluation', `r02-${label}.metrics.json`);
const summaryPath = path.join(PROJECT_ROOT, 'build', 'graph', 'graph.summary.json');

if (!existsSync(inputPath)) {
  console.error(`입력 파일 없음: ${path.relative(PROJECT_ROOT, inputPath)}`);
  console.error(`먼저 'tsx scripts/_dogfood-r02.ts ${label}'를 실행하세요.`);
  process.exit(1);
}

interface ScenarioResult {
  id: string;
  tool: string;
  expectedVerdict?: 'PASS' | 'FAIL' | 'UNDETERMINED' | 'MARGINAL';
  expectedHitsMin?: number;
  expectedHitsMax?: number;
  expectedBasisIds?: string[];
  forbiddenBasisIds?: string[];
  expectedSourceStatus?: 'verified' | 'indirect_source' | 'skeleton' | 'unknown';
  notes?: string;
  response?: any;
  error?: string;
  ms?: number;
}

const results: ScenarioResult[] = JSON.parse(readFileSync(inputPath, 'utf8'));

// ---------------------------------------------------------------------

interface ScenarioGrade {
  id: string;
  tool: string;
  pass: boolean;
  isFalsePass: boolean;
  basisHit: 'all' | 'partial' | 'missing' | 'n/a';
  basisMisuse: boolean;
  hitsCount: number;
  actualVerdict?: string;
  details: string[];
}

const SOURCE_RANK: Record<string, number> = {
  verified: 3,
  unknown: 2,
  indirect_source: 1,
  skeleton: 0,
};

function extractVerdict(response: any): string | undefined {
  if (!response?.result) return undefined;
  const r = response.result;
  // evaluate_observation: result.expertAssessment.legalVerdict
  if (r.expertAssessment?.legalVerdict) return r.expertAssessment.legalVerdict;
  if (r.legalVerdict) return r.legalVerdict;
  return undefined;
}

function extractHitsCount(response: any): number {
  if (!response?.result) return 0;
  const r = response.result;
  if (Array.isArray(r.hits)) return r.hits.length;
  if (Array.isArray(r.matchedDomains)) return r.matchedDomains.length;
  if (Array.isArray(r.entities)) return r.entities.length;
  if (Array.isArray(r.standards)) return r.standards.length;
  if (Array.isArray(r.results)) return r.results.length;
  return 0;
}

function extractBasisIds(response: any): string[] {
  if (!Array.isArray(response?.basis)) return [];
  return response.basis.map((b: any) => String(b.id));
}

function gradeScenario(s: ScenarioResult): ScenarioGrade {
  const details: string[] = [];
  let pass = true;
  let isFalsePass = false;

  if (s.error) {
    return {
      id: s.id,
      tool: s.tool,
      pass: false,
      isFalsePass: false,
      basisHit: 'n/a',
      basisMisuse: false,
      hitsCount: 0,
      details: [`error: ${s.error.split('\n')[0]}`],
    };
  }

  const actualVerdict = extractVerdict(s.response);
  const hitsCount = extractHitsCount(s.response);
  const basisIds = extractBasisIds(s.response);

  // 1. expectedVerdict 검사
  if (s.expectedVerdict !== undefined) {
    if (actualVerdict === undefined) {
      pass = false;
      details.push(`verdict 추출 실패 (expected ${s.expectedVerdict})`);
    } else if (actualVerdict !== s.expectedVerdict) {
      pass = false;
      details.push(`verdict mismatch: actual=${actualVerdict}, expected=${s.expectedVerdict}`);
      // false PASS: 정답이 PASS 아닌데 실제 PASS
      if (s.expectedVerdict !== 'PASS' && actualVerdict === 'PASS') {
        isFalsePass = true;
        details.push('⚠ false PASS — 정답이 PASS가 아닌데 PASS로 처리');
      }
    }
  }

  // 2. expectedHits 검사
  if (s.expectedHitsMin !== undefined && hitsCount < s.expectedHitsMin) {
    pass = false;
    details.push(`hits ${hitsCount} < expectedHitsMin ${s.expectedHitsMin}`);
  }
  if (s.expectedHitsMax !== undefined && hitsCount > s.expectedHitsMax) {
    pass = false;
    details.push(`hits ${hitsCount} > expectedHitsMax ${s.expectedHitsMax}`);
  }

  // 3. expectedBasisIds 검사
  let basisHit: ScenarioGrade['basisHit'] = 'n/a';
  if (s.expectedBasisIds && s.expectedBasisIds.length > 0) {
    const present = s.expectedBasisIds.filter((id) => basisIds.includes(id));
    const missing = s.expectedBasisIds.filter((id) => !basisIds.includes(id));
    if (missing.length === 0) basisHit = 'all';
    else if (present.length > 0) basisHit = 'partial';
    else basisHit = 'missing';
    if (basisHit !== 'all') {
      pass = false;
      details.push(`expectedBasisIds 미충족: 누락=[${missing.join(', ')}]`);
    }
  }

  // 4. forbiddenBasisIds 검사 (오인용 검출)
  let basisMisuse = false;
  if (s.forbiddenBasisIds && s.forbiddenBasisIds.length > 0) {
    const found = s.forbiddenBasisIds.filter((id) => basisIds.includes(id));
    if (found.length > 0) {
      basisMisuse = true;
      pass = false;
      details.push(`⚠ 금지 basis 등장: [${found.join(', ')}]`);
    }
  }

  // 5. expectedSourceStatus 검사
  if (s.expectedSourceStatus) {
    const worst = s.response?.sourceStatusSummary?.worst as string | undefined;
    if (worst && SOURCE_RANK[worst]! < SOURCE_RANK[s.expectedSourceStatus]!) {
      pass = false;
      details.push(`sourceStatus.worst=${worst} < expected ${s.expectedSourceStatus}`);
    }
  }

  return {
    id: s.id,
    tool: s.tool,
    pass,
    isFalsePass,
    basisHit,
    basisMisuse,
    hitsCount,
    actualVerdict,
    details,
  };
}

// ---------------------------------------------------------------------

const grades = results.map(gradeScenario);
const total = grades.length;
const passCount = grades.filter((g) => g.pass).length;
const falsePassCount = grades.filter((g) => g.isFalsePass).length;
const basisMisuseCount = grades.filter((g) => g.basisMisuse).length;
const errorCount = grades.filter((g) => g.details[0]?.startsWith('error:')).length;

let nodeUtilization: number | null = null;
let graphSummary: any = null;
if (existsSync(summaryPath)) {
  graphSummary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  nodeUtilization = graphSummary.counts.utilizationRate;
}

// R0+ KPI: 19종 법정문서 커버리지
const registeredSchemas = new Set(listSchemaIds());
const coverage = computeCoverage(registeredSchemas);

// R0+ KPI: 응답 신뢰도 — 단일 worst 지표의 "역설"(verified 자산이 그래프에 존재해도
// basis에 skeleton이 하나라도 섞이면 worst===verified가 0이 되어 신뢰도 0%로 보고됨)을
// 해소하기 위해 보수적·관용적·비중 3관점 지표를 함께 산출한다. 숫자 부풀리기가 아니라
// 측정의 정직성(어떤 관점으로 보느냐를 명시)을 높이는 것이 목적.
//
// 한 응답(시나리오)의 verified basis 개수와 전체 basis 개수를 추출한다.
//  - 1순위: basis[] 각 항목의 sourceStatus (개별 라벨이 있는 신형 응답)
//  - 2순위: sourceStatusSummary.counts (개별 라벨은 없고 요약만 있는 응답)
//  - 둘 다 없으면 hasStatusData=false (구형 응답 — 비중 산정 불가)
interface VerifiedBreakdown {
  verified: number; // 이 응답의 verified basis 개수
  totalBasis: number; // 이 응답의 전체 basis 개수
  hasStatusData: boolean; // sourceStatus 정보(개별 라벨 또는 counts)가 존재하는가
}

function extractVerifiedBreakdown(response: any): VerifiedBreakdown {
  // 1순위: basis[] 개별 sourceStatus
  const basis = Array.isArray(response?.basis) ? response.basis : [];
  const labeled = basis.filter(
    (b: any) => typeof b?.sourceStatus === 'string',
  );
  if (labeled.length > 0) {
    const verified = labeled.filter(
      (b: any) => b.sourceStatus === 'verified',
    ).length;
    // 개별 라벨이 일부만 있을 수 있으나, 비중 분모는 라벨이 달린 basis 수로 본다
    // (라벨 없는 basis는 상태 불명 — 비중 계산에서 제외해야 verified 비중이 왜곡 안 됨)
    return { verified, totalBasis: labeled.length, hasStatusData: true };
  }

  // 2순위: sourceStatusSummary.counts
  const counts = response?.sourceStatusSummary?.counts;
  if (counts && typeof counts === 'object') {
    const verified = Number(counts.verified) || 0;
    const totalBasis = Object.values(counts).reduce(
      (sum: number, n) => sum + (Number(n) || 0),
      0,
    );
    return { verified, totalBasis, hasStatusData: true };
  }

  // sourceStatus 정보 없음 (구형 응답)
  return { verified: 0, totalBasis: basis.length, hasStatusData: false };
}

const breakdowns = results.map((s) => extractVerifiedBreakdown(s.response));

// 지표 1 (보수적, 기존 worst 유지): basis 최저 등급이 verified인 응답 비율.
// = 응답의 모든 근거가 verified여야 카운트. 가장 엄격해 0%가 나오기 쉽다.
const trustWorstVerifiedScenarios = results.filter(
  (s) => s.response?.sourceStatusSummary?.worst === 'verified',
).length;
const trustWorstVerifiedRate = total ? trustWorstVerifiedScenarios / total : 0;

// 지표 2 (관용적): basis에 verified가 1개 이상 포함된 응답 비율.
// = 검증된 근거를 (일부라도) 활용한 응답 비율. worst의 "역설" 해소가 한눈에 보인다.
const trustAnyVerifiedScenarios = breakdowns.filter(
  (b) => b.hasStatusData && b.verified > 0,
).length;
const trustAnyVerifiedRate = total ? trustAnyVerifiedScenarios / total : 0;

// 지표 3 (비중): 시나리오별 (verified basis 수 / 전체 basis 수)의 평균.
// = 응답 근거 중 검증분이 차지하는 평균 비중. sourceStatus 정보가 있는
// 응답만 평균에 포함하며, 어떤 응답에도 정보가 없으면 'n/a'.
const ratioEligible = breakdowns.filter(
  (b) => b.hasStatusData && b.totalBasis > 0,
);
const trustVerifiedBasisRatio: number | 'n/a' =
  ratioEligible.length > 0
    ? ratioEligible.reduce((sum, b) => sum + b.verified / b.totalBasis, 0) /
      ratioEligible.length
    : 'n/a';

const metrics = {
  label,
  generatedAt: new Date().toISOString(),
  scenarios: total,
  passRate: total ? passCount / total : 0,
  falsePassRate: total ? falsePassCount / total : 0,
  basisMisuseRate: total ? basisMisuseCount / total : 0,
  errorRate: total ? errorCount / total : 0,
  nodeUtilizationRate: nodeUtilization,
  documentCoverageRate: coverage.rate,
  // 응답 신뢰도 3지표 (worst의 역설 해소 — 보수적/관용적/비중 3관점)
  trustWorstVerifiedRate, // 보수적: 모든 근거가 verified인 응답 비율
  trustAnyVerifiedRate, // 관용적: verified 근거 1개 이상 포함 응답 비율
  trustVerifiedBasisRatio, // 비중: 응답 근거 중 verified 평균 비중 ('n/a' 가능)
  documentCoverage: {
    total: coverage.total,
    covered: coverage.covered,
    missing: coverage.missing.map((m) => m.title),
    byCategory: coverage.byCategory,
  },
  graphCounts: graphSummary?.counts ?? null,
  perScenario: grades,
};

writeFileSync(outputPath, JSON.stringify(metrics, null, 2), 'utf8');

// ---------------------------------------------------------------------

console.log(`\n=== R0-G2 Auto-Score (${label}) ===\n`);
console.log(`시나리오: ${total}건`);
console.log(`PASS율               ${pct(metrics.passRate)} (${passCount}/${total})`);
console.log(`false PASS율         ${pct(metrics.falsePassRate)} (${falsePassCount}/${total}) ★ 0 목표`);
console.log(`근거 오인용률        ${pct(metrics.basisMisuseRate)} (${basisMisuseCount}/${total}) ★ 0 목표`);
console.log(`오류율               ${pct(metrics.errorRate)} (${errorCount}/${total})`);
if (nodeUtilization !== null) {
  console.log(`노드 활용률          ${pct(nodeUtilization)} (graph.summary.json)`);
} else {
  console.log(`노드 활용률          — (build/graph/graph.summary.json 부재. dump-graph.ts 실행 필요)`);
}
console.log(
  `★ 문서 커버리지       ${pct(coverage.rate)} (${coverage.covered}/${coverage.total}) ★ R10 목표 100%`,
);
console.log(`★ 응답 신뢰도(verified) — 같은 데이터를 3관점으로 본 정직한 지표:`);
console.log(
  `   worst  ${pct(trustWorstVerifiedRate)} (${trustWorstVerifiedScenarios}/${total}) — 모든 근거가 verified (가장 보수적)`,
);
console.log(
  `   any    ${pct(trustAnyVerifiedRate)} (${trustAnyVerifiedScenarios}/${total}) — verified 근거 1개 이상 포함`,
);
console.log(
  `   ratio  ${trustVerifiedBasisRatio === 'n/a' ? 'n/a (sourceStatus 정보 부재)' : pct(trustVerifiedBasisRatio)} — 응답 근거 중 verified 평균 비중`,
);
console.log(
  `   카테고리별: plan ${coverage.byCategory.plan!.covered}/${coverage.byCategory.plan!.total} · daily ${coverage.byCategory.daily!.covered}/${coverage.byCategory.daily!.total} · cumulative ${coverage.byCategory.cumulative!.covered}/${coverage.byCategory.cumulative!.total} · ncr ${coverage.byCategory.nonconformance!.covered}/${coverage.byCategory.nonconformance!.total} · audit ${coverage.byCategory.audit!.covered}/${coverage.byCategory.audit!.total}`,
);
if (coverage.missing.length > 0) {
  console.log(`   미커버 ${coverage.missing.length}종:`);
  for (const m of coverage.missing) {
    console.log(`     - ${m.title} [${m.category}] ${m.legalBasis}`);
  }
}

console.log(`\n시나리오별:`);
for (const g of grades) {
  const status = g.pass ? 'PASS' : g.isFalsePass ? 'FALSE-PASS' : g.basisMisuse ? 'MISUSE' : 'FAIL';
  const marker = g.pass ? '✓' : g.isFalsePass ? '🚨' : g.basisMisuse ? '⚠' : '✗';
  const verdictPart = g.actualVerdict ? `verdict=${g.actualVerdict}` : `hits=${g.hitsCount}`;
  console.log(
    `  ${marker} ${g.id.padEnd(4)} ${status.padEnd(11)} ${g.tool.padEnd(38)} ${verdictPart}`,
  );
  for (const d of g.details) console.log(`         ${d}`);
}

console.log(`\n출력: ${path.relative(PROJECT_ROOT, outputPath)}`);

function pct(v: number | null): string {
  if (v === null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}
