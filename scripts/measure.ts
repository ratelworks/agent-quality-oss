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

// R0+ KPI: 응답 신뢰도 — sourceStatusSummary.worst === 'verified' 비율
const trustScenarios = results.filter(
  (s) => s.response?.sourceStatusSummary?.worst === 'verified',
).length;
const responseTrustRate = total ? trustScenarios / total : 0;

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
  responseTrustRate,
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
console.log(
  `★ 응답 신뢰도(verified) ${pct(responseTrustRate)} (${trustScenarios}/${total})`,
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
