/**
 * 법적으로 필요한 문서 커버리지 감사.
 *
 * 한국 건설 품질관리에서 법령·고시·시방기준이 의무화한 문서:
 *   1. NCR (부적합 보고서) — 건설기술 진흥법 §54, 시행령 §91·92
 *   2. ITP (검사·시험계획서) — 품질관리 업무지침 §7
 *   3. 시험성적서 (Test Report) — 건설공사 품질관리 업무지침
 *   4. 공시체 기록 (Specimen Record) — KCS 14 20 10 §3.5
 *   5. 콘크리트 납품서 (Delivery Record) — KS F 4009
 *   6. 시정조치 요구서 (Form, 별지) — 업무지침 별지
 *   7. 점검결과 통보서 (Form, 별지) — 시행규칙 별지
 *   8. 품질관리계획서 (QMP) — 진흥법 §55, 시행령 §89
 *
 * 본 스크립트는 위 8종이 우리 MCP에서 (a) 양식 스키마 (b) 법적 근거 (c) 보존 의무
 * 셋 다 회수 가능한지 점검한다.
 */
import { TOOL_MAP } from '../src/mcp/registry.js';
import { OntologyGraph } from '../src/ontology/graph.js';
import { loadOntologySync } from '../src/ontology/loader.js';
import type { ToolResponse } from '../src/mcp/types.js';

const graph = new OntologyGraph(loadOntologySync());

function call(tool: string, args: Record<string, unknown>): ToolResponse | { error: string } {
  const m = TOOL_MAP.get(tool);
  if (!m) return { error: `tool not registered: ${tool}` };
  try {
    return m.run(args, graph);
  } catch (e) {
    return { error: String((e as Error).message ?? e) };
  }
}

interface DocCheck {
  doc: string;
  legalBasis: string;
  schemaTool?: string;
  schemaArgs?: Record<string, unknown>;
  formIdOrQuery?: { kind: 'form'; query: string } | { kind: 'guideline'; query: string };
  expectedFields?: string[];
}

const CHECKS: DocCheck[] = [
  {
    doc: 'NCR (부적합 보고서)',
    legalBasis: '건설기술 진흥법 §54, 시행령 §91·92, 업무지침 §17',
    schemaTool: 'get_ncr_schema',
    schemaArgs: {},
    expectedFields: ['documentId', 'description', 'effectivenessCheck', 'closureCriteria', 'correctiveActions'],
  },
  {
    doc: 'ITP (검사·시험계획서)',
    legalBasis: '품질관리 업무지침 §7, KCS 10 10 05',
    schemaTool: 'get_itp_schema',
    schemaArgs: {},
    expectedFields: ['workType', 'pointType', 'frequency', 'acceptanceCriteria'],
  },
  {
    doc: '시험성적서 검토',
    legalBasis: '품질관리 업무지침 §10·11',
    schemaTool: 'get_test_report_review_schema',
    schemaArgs: {},
    expectedFields: ['testedBy', 'reportNo', 'sealId', 'reviewedBy'],
  },
  {
    doc: '공시체 기록',
    legalBasis: 'KCS 14 20 10 §3.5, KS F 2403',
    schemaTool: 'get_specimen_record_schema',
    schemaArgs: {},
    expectedFields: ['specimenId', 'pourDate', 'curingMethod', 'compressiveStrengthMpa'],
  },
  {
    doc: '콘크리트 납품서',
    legalBasis: 'KS F 4009 (레디믹스트 콘크리트)',
    schemaTool: 'get_concrete_delivery_record_schema',
    schemaArgs: {},
    expectedFields: ['truckNo', 'strengthGrade', 'slumpMm', 'airPercent', 'arrivalTime'],
  },
  {
    doc: '시정조치 요구서 (별지)',
    legalBasis: '업무지침 별지 제3호',
    formIdOrQuery: { kind: 'form', query: '시정조치 요구서' },
  },
  {
    doc: '점검결과 통보서 (별지 제42호)',
    legalBasis: '시행규칙 별지 제42호',
    formIdOrQuery: { kind: 'form', query: '점검결과 통보서' },
  },
  {
    doc: '품질관리계획서 (QMP)',
    legalBasis: '진흥법 §55, 시행령 §89, 업무지침 §3',
    formIdOrQuery: { kind: 'guideline', query: '품질관리계획' },
  },
];

interface AuditRow {
  doc: string;
  legalBasis: string;
  schema: 'PASS' | 'FAIL' | 'N/A';
  legalLink: 'PASS' | 'FAIL' | 'N/A';
  retention: 'PASS' | 'FAIL' | 'N/A';
  notes: string[];
}

const rows: AuditRow[] = [];

for (const c of CHECKS) {
  const row: AuditRow = {
    doc: c.doc,
    legalBasis: c.legalBasis,
    schema: 'N/A',
    legalLink: 'N/A',
    retention: 'N/A',
    notes: [],
  };

  // (a) 스키마 — *_schema 도구로 회수
  if (c.schemaTool) {
    const r = call(c.schemaTool, c.schemaArgs ?? {});
    if ('error' in r) {
      row.schema = 'FAIL';
      row.notes.push(`schema 호출 실패: ${r.error}`);
    } else {
      row.schema = 'PASS';
      const result = r.result as Record<string, unknown>;
      const schemaJson = JSON.stringify(result);
      const missing = (c.expectedFields ?? []).filter((f) => !schemaJson.includes(f));
      if (missing.length > 0) row.notes.push(`스키마 필드 누락 의심: ${missing.join(', ')}`);

      const basis = r.basis ?? [];
      row.legalLink = basis.length > 0 ? 'PASS' : 'FAIL';
      if (basis.length === 0) row.notes.push('basis[] 비어 있음 (법적 근거 회수 실패)');

      // 보존 의무 정보가 응답 또는 evidence-documents.json에 있는가?
      const hasRetention = /보존|retention|기간|year|연도/i.test(schemaJson);
      row.retention = hasRetention ? 'PASS' : 'FAIL';
      if (!hasRetention) row.notes.push('보존 기간 정보 미회수 (스키마 응답에 retention 필드 없음)');
    }
  }

  // (b) 별지·서식 — get_standard_form_locator로 회수
  if (c.formIdOrQuery?.kind === 'form') {
    const r = call('get_standard_form_locator', { query: c.formIdOrQuery.query });
    if ('error' in r) {
      row.schema = 'FAIL';
      row.notes.push(`form locator 호출 실패: ${r.error}`);
    } else {
      const result = r.result as { count?: number; forms?: unknown[]; mode?: string };
      const count = result.count ?? 0;
      row.schema = count > 0 ? 'PASS' : 'FAIL';
      if (count === 0) row.notes.push(`별지 검색 결과 0건: "${c.formIdOrQuery.query}"`);
      else {
        const forms = (result.forms ?? []) as Array<Record<string, unknown>>;
        const first = forms[0] ?? {};
        row.legalLink = first['relatedArticle'] || first['referenceDoc'] ? 'PASS' : 'FAIL';
        const hasUrl = Boolean(first['sourceUrl']);
        row.retention = hasUrl ? 'PASS' : 'FAIL';
        if (!first['relatedArticle'] && !first['referenceDoc']) row.notes.push('relatedArticle/referenceDoc 미회수');
        if (!hasUrl) row.notes.push('sourceUrl 누락 — 공식 다운로드 경로 안내 불가');
      }
    }
  }

  // (c) 업무지침 조항 — search_quality_management_guideline
  if (c.formIdOrQuery?.kind === 'guideline') {
    const r = call('search_quality_management_guideline', { query: c.formIdOrQuery.query });
    if ('error' in r) {
      row.schema = 'FAIL';
      row.notes.push(`guideline 검색 실패: ${r.error}`);
    } else {
      const result = r.result as { count?: number; items?: Array<Record<string, unknown>> };
      const count = result.count ?? 0;
      row.schema = count > 0 ? 'PASS' : 'FAIL';
      if (count === 0) row.notes.push(`업무지침 검색 0건: "${c.formIdOrQuery.query}"`);
      else {
        const first = result.items?.[0] ?? {};
        row.legalLink = first['articleNo'] ? 'PASS' : 'FAIL';
        if (!first['articleNo']) row.notes.push('articleNo 미회수');
        const skeleton = first['skeleton'];
        if (skeleton) row.notes.push('해당 조항이 skeleton 상태(본문 미수록) — 원문 회수 불가');
        row.retention = 'N/A';
      }
    }
  }

  rows.push(row);
}

// === 출력: 표 + 점수 ===
console.log('\n=== 법적 필수 문서 커버리지 감사 ===\n');
const HEADERS = ['문서', '법적 근거', '스키마/검색', '법적 링크', '보존/원문'];
const MAX_DOC = Math.max(...rows.map((r) => [...r.doc].length), [...HEADERS[0]!].length);
const MAX_BASIS = Math.max(...rows.map((r) => [...r.legalBasis].length), [...HEADERS[1]!].length);

function pad(s: string, n: number): string {
  let len = 0;
  for (const ch of s) len += /[ㄱ-힝]/u.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - len));
}

console.log(
  `| ${pad(HEADERS[0]!, MAX_DOC)} | ${pad(HEADERS[1]!, MAX_BASIS)} | ${HEADERS[2]} | ${HEADERS[3]} | ${HEADERS[4]} |`,
);
console.log(`|${'-'.repeat(MAX_DOC + 2)}|${'-'.repeat(MAX_BASIS + 2)}|------|------|------|`);
for (const r of rows) {
  console.log(
    `| ${pad(r.doc, MAX_DOC)} | ${pad(r.legalBasis, MAX_BASIS)} | ${r.schema.padEnd(4)} | ${r.legalLink.padEnd(4)} | ${r.retention.padEnd(4)} |`,
  );
}

console.log('\n=== 발견된 결함 ===\n');
let issueCount = 0;
for (const r of rows) {
  if (r.notes.length > 0) {
    console.log(`▸ ${r.doc}`);
    for (const n of r.notes) console.log(`    - ${n}`);
    issueCount += r.notes.length;
  }
}
if (issueCount === 0) console.log('(없음)');

const score = rows.reduce((acc, r) => {
  const p = (v: string) => (v === 'PASS' ? 1 : v === 'N/A' ? 0.5 : 0);
  return acc + p(r.schema) + p(r.legalLink) + p(r.retention);
}, 0);
const max = rows.length * 3;
console.log(`\n=== 점수: ${score.toFixed(1)} / ${max} (${((score / max) * 100).toFixed(0)}%) ===`);
console.log(`결함 ${issueCount}건`);
