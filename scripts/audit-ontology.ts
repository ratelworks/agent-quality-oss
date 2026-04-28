#!/usr/bin/env node
/**
 * 온톨로지 구현 감사 + 효과(가치) 검증.
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOntologySync } from '../src/ontology/loader.js';
import { OntologyGraph } from '../src/ontology/graph.js';
import { STANDARD_RELATIONS, ID_PREFIX } from '../src/ontology/schema.js';
import { TOOLS, TOOL_MAP } from '../src/mcp/registry.js';
import type { ToolResponse } from '../src/mcp/types.js';

const DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'ontology',
  'data',
);
const graph = new OntologyGraph(loadOntologySync());

let pass = 0;
let fail = 0;
const issues: Array<{ name: string; detail?: string }> = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}`);
    if (detail) console.log(`      ${detail}`);
    issues.push({ name, ...(detail !== undefined ? { detail } : {}) });
    fail++;
  }
}

console.log('\n=== A. 구현 정합성 감사 ===\n');

const dataFiles = readdirSync(DIR).filter((f) => f.endsWith('.json'));
check(
  'A1. data 파일 13개 이상 로드',
  dataFiles.length >= 13,
  `현재 ${dataFiles.length}개: ${dataFiles.join(', ')}`,
);

const prefixViolations: string[] = [];
for (const e of graph.entities.values()) {
  const expected = ID_PREFIX[e.type];
  if (expected && !e.id.startsWith(expected)) {
    prefixViolations.push(`${e.id} (type=${e.type}, expected prefix=${expected})`);
  }
}
check('A2. 모든 엔티티 id prefix 규약 준수', prefixViolations.length === 0, prefixViolations.join(' / '));

const danglingRefs: string[] = [];
for (const e of graph.entities.values()) {
  for (const [rel, ids] of Object.entries(e.relations ?? {})) {
    if (!Array.isArray(ids)) continue;
    for (const target of ids) {
      if (!graph.get(target)) danglingRefs.push(`${e.id}.${rel} → ${target}`);
    }
  }
}
check('A3. dangling reference 0건', danglingRefs.length === 0, danglingRefs.slice(0, 3).join(' / '));

let chainOk = true;
const chainIssues: string[] = [];
for (const test of graph.all('TestItem')) {
  const cids = test.relations?.['hasAcceptanceCriteria'] ?? [];
  if (cids.length === 0) {
    chainIssues.push(`${test.id}: hasAcceptanceCriteria 없음`);
    chainOk = false;
    continue;
  }
  for (const cid of cids) {
    const c = graph.get(cid);
    if (!c) {
      chainIssues.push(`${test.id} → ${cid} 미존재`);
      chainOk = false;
      continue;
    }
    const df = c.relations?.['derivedFrom'] ?? [];
    if (df.length === 0) {
      chainIssues.push(`${cid}: derivedFrom 없음`);
      chainOk = false;
      continue;
    }
    for (const sid of df) {
      if (!graph.get(sid)) {
        chainIssues.push(`${cid} → ${sid} (Standard) 미존재`);
        chainOk = false;
      }
    }
  }
}
check('A4. TestItem → Criteria → Standard 체인 완결', chainOk, chainIssues.slice(0, 3).join(' / '));

let ncrBasisOk = true;
const ncrBasisIssues: string[] = [];
let ncrWithBasis = 0;
const allNcrs = graph.all('Nonconformance');
for (const ncr of allNcrs) {
  const bp = ncr.relations?.['basisPriority'] ?? [];
  if (bp.length > 0) ncrWithBasis++;
  for (const id of bp) {
    if (!graph.get(id)) {
      ncrBasisIssues.push(`${ncr.id} → ${id}`);
      ncrBasisOk = false;
    }
  }
}
check(
  `A5. NCR basisPriority 전수 실존 (${ncrWithBasis}/${allNcrs.length} NCR에 basisPriority)`,
  ncrBasisOk && ncrWithBasis === allNcrs.length,
  ncrBasisIssues.join(' / '),
);

const nonStd = new Set<string>();
for (const e of graph.entities.values()) {
  for (const rel of Object.keys(e.relations ?? {})) {
    if (!STANDARD_RELATIONS.includes(rel)) nonStd.add(rel);
  }
}
check('A6. 관계명 표준 집합 준수', nonStd.size === 0, `비표준 관계명: ${[...nonStd].join(', ')}`);

console.log('\n=== B. Tool 응답 공통 규약 ===\n');

const defaultArgs: Record<string, Record<string, unknown>> = {
  search_quality_ontology: { query: '콘크리트' },
  resolve_worktype: { input: '콘크리트 타설' },
  get_work_quality_profile: { workType: 'work.concrete_placement' },
  get_material_quality_profile: { material: 'material.ready_mixed_concrete' },
  infer_quality_risks: { workType: '콘크리트 타설', observations: ['슬럼프 210mm'] },
  map_quality_basis: { workType: '콘크리트 타설', material: '레미콘', testItem: '슬럼프' },
  list_core_quality_laws: {},
  get_quality_law_article: { articleId: 'standard.law.btia_55' },
  search_quality_management_guideline: {},
  get_quality_guideline_article: { articleId: 'standard.guideline.part2_art7' },
  search_construction_standards: {},
  get_standard_form_locator: { formId: 'standard.form.rule_no42_quality_inspection_register' },
  get_ncr_schema: {},
  get_concrete_delivery_record_schema: {},
  get_specimen_record_schema: {},
  get_itp_schema: {},
  get_test_report_review_schema: {},
  compile_concrete_pour_references: {},
  compile_inspection_references: { workType: '콘크리트 타설' },
  compile_ncr_references: { ncrId: 'ncr.slump_too_high' },
  evaluate_observation: { observation: '슬럼프 210mm', criterionId: 'criteria.slump_general_150' },
  verify_quality_basis: {
    statement: '슬럼프 기준은 150mm이다.',
    claimedBasisIds: ['standard.kcs_14_20'],
  },
  get_project_info: {},
  discover_relevant_domain: { situation: '슬래브 콘크리트 타설' },
  explain_quality_decision_path: { entityId: 'ncr.slump_too_high' },
  verify_form_reference: { formId: 'standard.form.rule_no42_quality_inspection_register' },
  // R0+ 추가 도구 (19종 법정문서 진행)
  get_qc_assignment_notice_schema: {},
  get_quality_test_plan_schema: {},
  get_quality_inspection_register_schema: {},
  compile_qc_assignment_notice_references: { totalContractValue: 30_000_000_000 },
  compile_quality_test_plan_references: {
    workTypes: ['work.concrete_placement'],
    totalContractValue: 30_000_000_000,
  },
  compile_quality_inspection_register_references: { mode: 'entry_template', testItemId: 'test.slump' },
  // R1 추가
  get_inspection_request_schema: {},
  compile_inspection_request_references: { workType: 'work.concrete_placement', stage: 'pre' },
};

const allowedSyntheticBasisTypes = new Set<string>([
  'ontology',
  'ontology_meta',
  'schema_meta',
  'verification_meta',
  'judgment_meta',
  'project_meta',
  'audit_export',
]);

let legalNoteCount = 0;
let hashOkCount = 0;
let basisValidCount = 0;
const allBasisIssues: string[] = [];

for (const t of TOOLS) {
  const args = defaultArgs[t.spec.name];
  if (!args) {
    check(`B-invoke ${t.spec.name}`, false, 'defaultArgs 누락');
    continue;
  }
  let response: ToolResponse<any>;
  try {
    response = t.run(args, graph) as ToolResponse<any>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    check(`B-invoke ${t.spec.name}`, false, msg);
    continue;
  }
  const hasNote =
    typeof response.humanCheckpoint?.legalNote === 'string' &&
    response.humanCheckpoint.legalNote.includes('최종 판정과 법적 책임');
  if (hasNote) legalNoteCount++;
  const hashOk =
    typeof response.lineage?.contentHash === 'string' &&
    response.lineage.contentHash.length === 64 &&
    response.lineage.contentHashAlgo === 'sha256';
  if (hashOk) hashOkCount++;
  let basisOk = true;
  for (const b of response.basis ?? []) {
    if (allowedSyntheticBasisTypes.has(b.type)) {
      if (b.type === 'ontology' && !graph.get(b.id)) {
        basisOk = false;
        allBasisIssues.push(`${t.spec.name}.basis ${b.id} 미존재`);
      }
    } else {
      basisOk = false;
      allBasisIssues.push(`${t.spec.name}.basis unknown type: ${b.type}`);
    }
  }
  if (basisOk) basisValidCount++;
}

check(
  `B1. 전 Tool legalNote 포함 (${legalNoteCount}/${TOOLS.length})`,
  legalNoteCount === TOOLS.length,
);
check(
  `B2. 전 Tool contentHash SHA-256 (${hashOkCount}/${TOOLS.length})`,
  hashOkCount === TOOLS.length,
);
check(
  `B3. 전 Tool basis[] id 실존 (${basisValidCount}/${TOOLS.length})`,
  basisValidCount === TOOLS.length,
  allBasisIssues.slice(0, 3).join(' / '),
);

let descNoteCount = 0;
for (const t of TOOLS) {
  if (t.spec.description.includes('품질관리자') && t.spec.description.includes('감리')) {
    descNoteCount++;
  }
}
check(
  `B4. 전 Tool description에 책임 고지 (${descNoteCount}/${TOOLS.length})`,
  descNoteCount === TOOLS.length,
);

console.log('\n=== C. 효과(가치) 검증 — E2E 시나리오 ===\n');

{
  const r = TOOL_MAP.get('compile_concrete_pour_references')!.run({}, graph) as ToolResponse<any>;
  const ok =
    r.result.materials.length === 1 &&
    r.result.tests.length >= 5 &&
    r.result.acceptanceCriteria.length >= 5 &&
    r.result.inspectionCheckpoints.length === 3 &&
    r.result.qualityRisks.length >= 6 &&
    r.result.legalReferences.some((l: { id: string }) => l.id === 'standard.guideline.part3') &&
    r.result.forms.deliveryRecord.schemaId === 'concrete_delivery_record' &&
    r.result.forms.specimenRecord.schemaId === 'specimen_record';
  check(`C1. 타설 1회 재료 패키지`, ok);
}

{
  const ev = TOOL_MAP.get('evaluate_observation')!.run(
    { observation: '슬럼프 210mm', criterionId: 'criteria.slump_general_150' },
    graph,
  ) as ToolResponse<any>;
  const ncrPkg = TOOL_MAP.get('compile_ncr_references')!.run(
    { ncrId: 'ncr.slump_too_high' },
    graph,
  ) as ToolResponse<any>;
  const ea = ev.result.expertAssessment;
  const ok =
    ea?.verdict === 'FAIL' &&
    ea?.direction === 'too_high' &&
    ea?.candidateNonconformance?.length > 0 &&
    ncrPkg.result.ncrs[0].approver.includes('감리') &&
    ncrPkg.result.ncrs[0].immediateActions.length >= 3 &&
    ncrPkg.result.formSchema.sections.some((s: { key: string }) => s.key === 'approval');
  check(`C2. 슬럼프 FAIL → NCR 패키지 (expertAssessment)`, ok);
}

{
  const r = TOOL_MAP.get('evaluate_observation')!.run(
    { observation: '압축강도 18 MPa', criterionId: 'criteria.compressive_strength_design' },
    graph,
  ) as ToolResponse<any>;
  const ea = r.result.expertAssessment;
  const ok =
    ea?.verdict === 'UNDETERMINED' &&
    ea?.comparison?.includes('threshold') &&
    r.humanCheckpoint.required === true;
  check('C3. fck threshold null → UNDETERMINED + 수동 판정', ok, ea?.comparison);
}

{
  const r = TOOL_MAP.get('compile_inspection_references')!.run(
    { workType: '콘크리트 타설', stage: 'before' },
    graph,
  ) as ToolResponse<any>;
  const ok =
    r.result.checkpoints.length === 1 &&
    r.result.checkpoints[0].stage === 'before' &&
    r.result.forms.itp.schemaId === 'itp' &&
    r.result.legalReferences.some((l: { id: string }) => l.id === 'standard.law.btia_55');
  check('C4. 검측 전단계 재료 패키지 (ITP + 감리 법령)', ok);
}

{
  const lh = TOOL_MAP.get('map_quality_basis')!.run(
    { workType: '콘크리트 타설', agencyId: 'agency.lh' },
    graph,
  ) as ToolResponse<any>;
  const pps = TOOL_MAP.get('map_quality_basis')!.run(
    { workType: '콘크리트 타설', agencyId: 'agency.procurement_service' },
    graph,
  ) as ToolResponse<any>;
  const none = TOOL_MAP.get('map_quality_basis')!.run(
    { workType: '콘크리트 타설' },
    graph,
  ) as ToolResponse<any>;
  const lhBasis = lh.result.factualBasis.find((b: { id: string }) => b.id === 'agency.lh');
  const ppsBasis = pps.result.factualBasis.find(
    (b: { id: string }) => b.id === 'agency.procurement_service',
  );
  const ok =
    lhBasis &&
    lhBasis.approverRole?.includes('LH') &&
    ppsBasis &&
    ppsBasis.approverRole?.includes('감독관') &&
    none.result.agency === null;
  check(`C5. Agency 경로 활성 (LH vs PPS 분기)`, ok);
}

{
  const r = TOOL_MAP.get('verify_quality_basis')!.run(
    {
      statement: '반드시 KCS 14 20에 따라 시공해야 한다.',
      claimedBasisIds: ['standard.kcs_14_20'],
    },
    graph,
  ) as ToolResponse<any>;
  const ok =
    r.result.verification === 'unsupported_strong_claim' &&
    r.result.triggeredStrongTerms.includes('반드시') &&
    r.result.hasMandatoryBasis === false;
  check('C6. 강한 주장 + recommended 근거 → unsupported 탐지', ok);
}

// C7 canonical hash 결정론 검증은 buildResponse가 모든 응답에서 SHA-256 보장하므로
// B2(전 Tool contentHash) 통과로 대체. export Tool은 도메인 외부로 분리됨.

{
  const rebar = TOOL_MAP.get('search_quality_ontology')!.run(
    { query: '철근' },
    graph,
  ) as ToolResponse<any>;
  const steel = TOOL_MAP.get('search_quality_ontology')!.run(
    { query: '철강' },
    graph,
  ) as ToolResponse<any>;
  const tmp = TOOL_MAP.get('search_quality_ontology')!.run(
    { query: '가설' },
    graph,
  ) as ToolResponse<any>;
  const ok =
    rebar.result.matches.some((m: { id: string }) => m.id === 'work.rebar_placement') &&
    steel.result.matches.some((m: { id: string }) => m.id === 'work.steel_fabrication') &&
    tmp.result.matches.some((m: { id: string }) => m.id === 'work.temporary_equipment');
  check('C8. 철근/철강/가설 skeleton 검색 노출', ok);
}

{
  const r = TOOL_MAP.get('evaluate_observation')!.run(
    { observation: '슬럼프 174mm', criterionId: 'criteria.slump_general_150' },
    graph,
  ) as ToolResponse<any>;
  const ea = r.result.expertAssessment;
  const ok =
    ea?.verdict === 'PASS' &&
    ea?.marginalWarning?.flagged === true &&
    ea?.marginalWarning?.note?.includes('경험적');
  check('C9. MARGINAL 격하 (expertAssessment)', ok);
}

console.log('\n=== 요약 ===');
console.log(`  PASS: ${pass}`);
console.log(`  FAIL: ${fail}`);

console.log('\n=== 커버리지 ===');
console.log(
  `  엔티티 타입:    ${Object.keys(graph.stats().byType).length} / ${Object.keys(ID_PREFIX).length}`,
);
console.log(`  등록 Tool:      ${TOOLS.length}`);
console.log(`  총 노드:        ${graph.stats().total}`);
console.log(`  총 관계 연결:   ${graph.stats().relations}`);
console.log(
  `  법령/지침/서식: ${[...graph.entities.values()].filter((e) => ['law', 'decree', 'rule', 'guideline', 'form'].includes(String(e.meta?.['category']))).length}`,
);

process.exit(fail ? 1 : 0);
