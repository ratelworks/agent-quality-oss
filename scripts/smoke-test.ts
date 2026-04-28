#!/usr/bin/env node
/**
 * 로컬 smoke test. 47 케이스 이상의 Tool 시나리오.
 */

import { loadOntologySync } from '../src/ontology/loader.js';
import { OntologyGraph } from '../src/ontology/graph.js';
import { TOOL_MAP } from '../src/mcp/registry.js';
import type { ToolResponse } from '../src/mcp/types.js';

const graph = new OntologyGraph(loadOntologySync());

interface Case {
  tool: string;
  args: Record<string, unknown>;
  assert: (r: ToolResponse<any>) => boolean;
}

const CASES: Case[] = [
  {
    tool: 'search_quality_ontology',
    args: { query: '슬래브 타설' },
    assert: (r) =>
      r.result.matchCount > 0 && r.result.matches[0].id === 'work.concrete_placement',
  },
  {
    tool: 'search_quality_ontology',
    args: { query: '슬럼프' },
    assert: (r) => r.result.matches.some((m: { id: string }) => m.id === 'test.slump'),
  },
  {
    tool: 'resolve_worktype',
    args: { input: '레미콘 타설' },
    assert: (r) =>
      r.result.resolved?.id === 'work.concrete_placement' &&
      r.result.relatedTests.some((t: { id: string }) => t.id === 'test.slump'),
  },
  {
    tool: 'get_work_quality_profile',
    args: { workType: '콘크리트 타설' },
    assert: (r) =>
      r.result.materials.length > 0 &&
      r.result.tests.length >= 5 &&
      r.result.inspectionCheckpoints.length === 3 &&
      r.result.qualityRisks.length >= 6,
  },
  {
    tool: 'get_material_quality_profile',
    args: { material: '레미콘' },
    assert: (r) =>
      r.result.tests.length >= 5 &&
      r.result.relatedWorks.some((w: { id: string }) => w.id === 'work.concrete_placement') &&
      r.result.possibleNonconformance.length > 0,
  },
  {
    tool: 'infer_quality_risks',
    args: { workType: '콘크리트 타설', observations: ['슬럼프 210mm'] },
    assert: (r) => {
      if (r.result.inferredRisks.length !== 1) return false;
      const slumpRisk = r.result.inferredRisks[0];
      if (slumpRisk.risk.id !== 'risk.slump_out_of_range') return false;
      const ncrIds = slumpRisk.nonconformance.map((n: { id: string }) => n.id);
      return (
        r.result.summary.fail === 1 &&
        ncrIds.includes('ncr.slump_too_high') &&
        !ncrIds.includes('ncr.slump_too_low') &&
        slumpRisk.nonconformance[0].owner &&
        slumpRisk.nonconformance[0].approver &&
        slumpRisk.immediateActions.some((a: { id: string }) => a.id === 'action.hold_delivery') &&
        r.humanCheckpoint.required === true
      );
    },
  },
  {
    tool: 'infer_quality_risks',
    args: { workType: '콘크리트 타설', observations: ['슬럼프 50mm'] },
    assert: (r) => {
      const slumpRisk = r.result.inferredRisks.find(
        (x: { risk: { id: string } }) => x.risk.id === 'risk.slump_out_of_range',
      );
      const ncrIds = slumpRisk?.nonconformance.map((n: { id: string }) => n.id) ?? [];
      return (
        r.result.summary.fail === 1 &&
        ncrIds.includes('ncr.slump_too_low') &&
        !ncrIds.includes('ncr.slump_too_high')
      );
    },
  },
  {
    tool: 'infer_quality_risks',
    args: { workType: '콘크리트 타설', observations: ['슬럼프 160mm'] },
    assert: (r) =>
      r.result.summary.pass === 1 &&
      r.result.summary.fail === 0 &&
      r.result.inferredRisks.length === 0 &&
      r.humanCheckpoint.required === false,
  },
  {
    tool: 'infer_quality_risks',
    args: { workType: '콘크리트 타설', observations: ['슬럼프 174mm'] },
    assert: (r) => r.result.summary.marginal === 1 && r.humanCheckpoint.required === true,
  },
  {
    tool: 'infer_quality_risks',
    args: { workType: '콘크리트 타설', observations: ['염화물 0.45 kg/㎥', '공기량 4.2%'] },
    assert: (r) =>
      r.result.summary.fail === 1 &&
      r.result.summary.pass === 1 &&
      r.result.inferredRisks.some((risk: { nonconformance: Array<{ id: string }> }) =>
        risk.nonconformance.some((n) => n.id === 'ncr.chloride_excess'),
      ),
  },
  {
    tool: 'infer_quality_risks',
    args: { workType: '콘크리트 타설' },
    assert: (r) =>
      r.result.mode === 'baseline' &&
      r.result.inferredRisks.length === 9 &&
      r.humanCheckpoint.required === false,
  },
  {
    tool: 'map_quality_basis',
    args: { workType: '콘크리트 타설', material: '레미콘', testItem: '슬럼프' },
    assert: (r) =>
      Array.isArray(r.result.factualBasis) &&
      Array.isArray(r.result.applicableBasis) &&
      r.result.factualBasis.every((b: { source: string }) => b.source === 'ontology_public_standard') &&
      r.result.applicableBasis.some((b: { id: string }) => b.id === 'doc.mix_design') &&
      r.humanCheckpoint.required === true,
  },
  {
    tool: 'map_quality_basis',
    args: {
      workType: '콘크리트 타설',
      material: '레미콘',
      testItem: '슬럼프',
      projectContext: { projectId: 'P001', availableDocuments: ['doc.mix_design'] },
    },
    assert: (r) => {
      const mix = r.result.factualBasis.find((b: { id: string }) => b.id === 'doc.mix_design');
      const spec = r.result.applicableBasis.find(
        (b: { id: string }) => b.id === 'doc.project_specification',
      );
      return mix && mix.source === 'project' && mix.priority === 1 && spec && r.humanCheckpoint.required === true;
    },
  },
  {
    tool: 'map_quality_basis',
    args: { nonconformance: 'ncr.low_compressive_strength' },
    assert: (r) => {
      const ids = r.result.factualBasis.map((b: { id: string }) => b.id);
      return ids.includes('standard.kcs_14_20.10.3_3') && ids.includes('standard.ks_f_2405');
    },
  },
  {
    tool: 'list_core_quality_laws',
    args: {},
    assert: (r) =>
      r.result.count >= 13 &&
      r.result.items.some((i: { id: string }) => i.id === 'standard.law.btia_55'),
  },
  {
    tool: 'list_core_quality_laws',
    args: { category: 'rule' },
    assert: (r) =>
      r.result.items.length >= 3 &&
      r.result.items.every((i: { category: string }) => i.category === 'rule'),
  },
  {
    tool: 'get_quality_law_article',
    args: { articleId: 'standard.law.btia_55' },
    assert: (r) =>
      r.result.article?.articleNo === '55' && r.result.article?.legalWeight === 'mandatory',
  },
  {
    tool: 'get_quality_law_article',
    args: { articleId: 'standard.law.nonexistent' },
    assert: (r) => r.result.article === null && r.humanCheckpoint.required === true,
  },
  {
    tool: 'search_quality_management_guideline',
    args: { part: '제2편' },
    assert: (r) =>
      r.result.count >= 5 &&
      r.result.items.every((i: { part?: string }) => (i.part ?? '').includes('제2편')),
  },
  {
    tool: 'get_quality_guideline_article',
    args: { articleId: 'standard.guideline.part2_art7' },
    assert: (r) => r.result.article?.articleNo === '7',
  },
  {
    tool: 'search_construction_standards',
    args: { series: 'KCS' },
    assert: (r) =>
      r.result.count >= 4 &&
      r.result.items.every((i: { id: string }) => i.id.startsWith('standard.kcs_')),
  },
  {
    tool: 'get_standard_form_locator',
    args: { formId: 'standard.form.rule_no42_quality_inspection_register' },
    assert: (r) =>
      r.result.form?.license?.includes('Type 4') &&
      r.result.form?.redistributionNote?.includes('포함되지 않는다'),
  },
  {
    tool: 'get_standard_form_locator',
    args: { query: '품질관리계획' },
    assert: (r) =>
      r.result.forms?.length >= 1 && r.result.forms[0].id.startsWith('standard.form.'),
  },
  {
    tool: 'map_quality_basis',
    args: { workType: '콘크리트 타설', agencyId: 'agency.lh' },
    assert: (r) => {
      const agencyBasis = r.result.factualBasis.find((b: { id: string }) => b.id === 'agency.lh');
      return (
        r.result.agency?.id === 'agency.lh' &&
        agencyBasis &&
        agencyBasis.priority === 1 &&
        agencyBasis.approverRole?.includes('LH')
      );
    },
  },
  {
    tool: 'search_quality_ontology',
    args: { query: '철근' },
    assert: (r) => r.result.matches.some((m: { id: string }) => m.id === 'work.rebar_placement'),
  },
  {
    tool: 'search_quality_ontology',
    args: { query: '철강구조물' },
    assert: (r) => r.result.matches.some((m: { id: string }) => m.id === 'work.steel_fabrication'),
  },
  {
    tool: 'get_work_quality_profile',
    args: { workType: '콘크리트 타설' },
    assert: (r) => r.result.materials.length > 0 && r.result.tests.length >= 5,
  },
  {
    tool: 'get_ncr_schema',
    args: {},
    assert: (r) => {
      const approval = r.result.sections.find((s: { key: string }) => s.key === 'approval');
      return (
        r.result.schemaId === 'ncr' &&
        approval &&
        approval.fields.some((f: { name: string }) => f.name === 'approver') &&
        approval.fields.some((f: { name: string }) => f.name === 'effectivenessCheck')
      );
    },
  },
  {
    tool: 'get_concrete_delivery_record_schema',
    args: { sectionKey: 'tests' },
    assert: (r) =>
      r.result.sections.length === 1 &&
      r.result.sections[0].fields.some((f: { name: string }) => f.name === 'slumpMm'),
  },
  {
    tool: 'get_itp_schema',
    args: {},
    assert: (r) => {
      const activities = r.result.sections.find((s: { key: string }) => s.key === 'activities');
      const pt = activities?.fields.find((f: { name: string }) => f.name === 'pointType');
      return pt?.type?.includes('H') && pt.type.includes('W');
    },
  },
  {
    tool: 'get_specimen_record_schema',
    args: {},
    assert: (r) => r.result.sections.some((s: { key: string }) => s.key === 'specimens'),
  },
  {
    tool: 'get_test_report_review_schema',
    args: {},
    assert: (r) => r.result.sections.some((s: { key: string }) => s.key === 'custody'),
  },
  {
    tool: 'compile_concrete_pour_references',
    args: {},
    assert: (r) =>
      r.result.acceptanceCriteria.length >= 5 &&
      r.result.legalReferences.some((l: { id: string }) => l.id === 'standard.guideline.part3') &&
      r.result.forms.deliveryRecord.schemaId === 'concrete_delivery_record' &&
      r.result.forms.specimenRecord.schemaId === 'specimen_record',
  },
  {
    tool: 'compile_inspection_references',
    args: { workType: '콘크리트 타설', stage: 'during' },
    assert: (r) =>
      r.result.checkpoints.length === 1 &&
      r.result.checkpoints[0].stage === 'during' &&
      r.result.forms.itp.schemaId === 'itp' &&
      r.result.legalReferences.some((l: { id: string }) => l.id === 'standard.law.btia_55'),
  },
  {
    tool: 'compile_ncr_references',
    args: { ncrId: 'ncr.slump_too_high' },
    assert: (r) => {
      const ncr = r.result.ncrs[0];
      return (
        ncr &&
        ncr.owner?.includes('품질관리자') &&
        ncr.approver?.includes('감리원') &&
        ncr.immediateActions.length >= 3 &&
        r.result.formSchema.schemaId === 'ncr' &&
        r.humanCheckpoint.required === true
      );
    },
  },
  {
    tool: 'compile_ncr_references',
    args: { testId: 'test.compressive_strength' },
    assert: (r) =>
      r.result.ncrs.some((n: { id: string }) => n.id === 'ncr.low_compressive_strength'),
  },
  // Step 5 — evaluate_observation (expertAssessment 형태로 출력)
  {
    tool: 'evaluate_observation',
    args: { observation: '슬럼프 210mm', criterionId: 'criteria.slump_general_150' },
    assert: (r) => {
      const ea = r.result.expertAssessment;
      return (
        ea.verdict === 'FAIL' &&
        ea.direction === 'too_high' &&
        ea.applicableCriterion?.includes('150 ± 25') &&
        ea.expertContext?.includes('베테랑') &&
        ea.candidateNonconformance.length > 0 &&
        ea.suggestedNextSteps.length >= 2 &&
        ea.legalBasis.includes('standard.kcs_14_20.10.3_2')
      );
    },
  },
  {
    tool: 'evaluate_observation',
    args: { observation: '슬럼프 160mm', criterionId: 'criteria.slump_general_150' },
    assert: (r) => {
      const ea = r.result.expertAssessment;
      return ea.verdict === 'PASS' && ea.marginalWarning === null && ea.candidateNonconformance.length === 0;
    },
  },
  {
    tool: 'evaluate_observation',
    args: { observation: '슬럼프 174mm', criterionId: 'criteria.slump_general_150' },
    assert: (r) => {
      const ea = r.result.expertAssessment;
      return ea.verdict === 'PASS' && ea.marginalWarning?.flagged === true;
    },
  },
  {
    tool: 'evaluate_observation',
    args: { observation: '곰보 발견', criterionId: 'criteria.slump_general_150' },
    assert: (r) =>
      r.result.expertAssessment.verdict === 'UNDETERMINED' && r.humanCheckpoint.required === true,
  },
  {
    tool: 'verify_quality_basis',
    args: {
      statement: '콘크리트 공사는 반드시 KCS 14 20에 따라 수행해야 한다.',
      claimedBasisIds: ['standard.kcs_14_20'],
    },
    assert: (r) =>
      r.result.triggeredStrongTerms.includes('반드시') &&
      r.result.verification === 'unsupported_strong_claim' &&
      r.humanCheckpoint.required === true,
  },
  {
    tool: 'verify_quality_basis',
    args: {
      statement: '품질관리계획서는 법령상 의무이다.',
      claimedBasisIds: ['standard.law.btia_55', 'standard.law.btia_decree_89'],
    },
    assert: (r) => r.result.verification === 'supported' && r.result.hasMandatoryBasis === true,
  },
  {
    tool: 'verify_quality_basis',
    args: {
      statement: '슬럼프 기준은 일반적으로 150±25mm 범위에서 관리된다.',
      claimedBasisIds: ['standard.nonexistent_fake_id', 'standard.kcs_14_20'],
    },
    assert: (r) => r.result.verification === 'partial_hallucination' && r.result.invalidCount === 1,
  },
  {
    tool: 'get_project_info',
    args: {},
    assert: (r) =>
      r.result.license === 'MIT' &&
      r.result.providedBy.nameKo === '황룡건설(주)' &&
      r.result.developedBy.nameKo === '주식회사 라텔웍스' &&
      r.result.legalDisclaimer.includes('법적 책임은 품질관리자'),
  },
  // 5차 신설 — discover_relevant_domain
  {
    tool: 'discover_relevant_domain',
    args: { situation: '오늘 슬래브 콘크리트 타설' },
    assert: (r) =>
      r.result.primaryWorkType?.id === 'work.concrete_placement' &&
      r.result.expertGuidance.length > 0 &&
      r.result.domainPackage.WorkType.length > 0,
  },
  // 5차 신설 — explain_quality_decision_path
  {
    tool: 'explain_quality_decision_path',
    args: { entityId: 'ncr.slump_too_high' },
    assert: (r) => {
      const path = r.result.path;
      return (
        Array.isArray(path) &&
        path.length >= 3 &&
        path.some((p: { type: string }) => p.type === 'TestItem') &&
        path.some((p: { type: string }) => p.type === 'AcceptanceCriteria')
      );
    },
  },
  // 5차 신설 — verify_form_reference
  {
    tool: 'verify_form_reference',
    args: { claim: '시행규칙 별지 제42호 점검결과 통보서' },
    assert: (r) =>
      r.result.verification.status === 'name_mismatch' &&
      r.result.verification.matchedForm.correctName.includes('품질검사 실시대장'),
  },
  {
    tool: 'verify_form_reference',
    args: { formId: 'standard.form.rule_no42_quality_inspection_register' },
    assert: (r) =>
      r.result.verification.status === 'verified' &&
      r.result.verification.matchedForm.correctName.includes('품질검사 실시대장'),
  },
  // next_steps decorator — 모든 응답에 자동 첨부
  {
    tool: 'list_core_quality_laws',
    args: {},
    assert: (r) =>
      Array.isArray(r.nextSteps) &&
      r.nextSteps.length > 0 &&
      r.nextSteps[0].tool === 'get_quality_law_article',
  },
];

let pass = 0;
let fail = 0;

for (const [idx, c] of CASES.entries()) {
  const tool = TOOL_MAP.get(c.tool);
  if (!tool) {
    console.log(`✗ [${idx + 1}] ${c.tool}: tool not registered`);
    fail++;
    continue;
  }
  const t0 = performance.now();
  let response: ToolResponse<any>;
  try {
    response = tool.run(c.args, graph) as ToolResponse<any>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`✗ [${idx + 1}] ${c.tool}: threw ${msg}`);
    fail++;
    continue;
  }
  const ms = (performance.now() - t0).toFixed(2);

  const schemaOk =
    response != null &&
    response.result !== undefined &&
    Array.isArray(response.basis) &&
    response.basis.length > 0 &&
    response.lineage?.toolName === c.tool &&
    response.lineage?.ontologyVersion === graph.version &&
    response.lineage?.contentHash?.length === 64 &&
    response.lineage?.contentHashAlgo === 'sha256' &&
    response.humanCheckpoint?.legalNote?.includes('최종 판정과 법적 책임');
  if (!schemaOk) {
    console.log(`✗ [${idx + 1}] ${c.tool}: 공통 스키마 위반`);
    console.log(JSON.stringify(response, null, 2));
    fail++;
    continue;
  }

  let ok = false;
  try {
    ok = Boolean(c.assert(response));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`✗ [${idx + 1}] ${c.tool}: assert threw ${msg}`);
    fail++;
    continue;
  }

  if (ok) {
    console.log(`✓ [${idx + 1}] ${c.tool} (${ms}ms)`);
    pass++;
  } else {
    console.log(`✗ [${idx + 1}] ${c.tool}: assert 실패`);
    console.log('  input :', JSON.stringify(c.args));
    console.log('  result:', JSON.stringify(response.result, null, 2));
    fail++;
  }
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
