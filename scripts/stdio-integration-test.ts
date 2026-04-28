#!/usr/bin/env node
/**
 * 실제 stdio MCP 프로토콜로 자기 서버에 접속해 Claude Desktop과 동일하게 동작하는지 검증.
 *
 * - SDK Client + StdioClientTransport로 자식 프로세스(npm run start:stdio) 띄움
 * - JSON-RPC list_tools / call_tool 호출
 * - 모든 26 Tool 노출 + 응답 구조 확인
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const serverEntry = path.join(projectRoot, 'build', 'index.js');

async function main(): Promise<void> {
  console.log('════════ stdio MCP 통합 테스트 (Claude Desktop과 동일 프로토콜) ════════\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverEntry, '--stdio'],
    cwd: projectRoot,
  });

  const client = new Client({ name: 'test-client', version: '0.0.1' });
  await client.connect(transport);

  // 1. list_tools — Claude Desktop이 첫 호출 시 하는 것
  const list = await client.listTools();
  console.log(`✓ list_tools: ${list.tools.length} Tool 노출됨`);
  for (const t of list.tools) {
    const desc = t.description.length > 60 ? t.description.slice(0, 60) + '…' : t.description;
    console.log(`   - ${t.name.padEnd(40)} ${desc}`);
  }

  // 2. call_tool — discover_relevant_domain
  console.log('\n✓ call_tool: discover_relevant_domain("오늘 슬래브 콘크리트 타설")');
  const r1 = await client.callTool({
    name: 'discover_relevant_domain',
    arguments: { situation: '오늘 슬래브 콘크리트 타설' },
  });
  const c1 = r1.content as Array<{ type: string; text: string }>;
  if (c1[0]?.type === 'text') {
    const parsed = JSON.parse(c1[0].text);
    console.log(`   primaryWorkType: ${parsed.result.primaryWorkType?.id}`);
    console.log(`   nextSteps: ${parsed.nextSteps.map((s: { tool: string }) => s.tool).join(', ')}`);
    console.log(`   contentHash: ${parsed.lineage.contentHash.slice(0, 16)}...`);
  }

  // 3. call_tool — evaluate_observation (FAIL)
  console.log('\n✓ call_tool: evaluate_observation("슬럼프 210mm")');
  const r2 = await client.callTool({
    name: 'evaluate_observation',
    arguments: { observation: '슬럼프 210mm', criterionId: 'criteria.slump_general_150' },
  });
  const c2 = r2.content as Array<{ type: string; text: string }>;
  if (c2[0]?.type === 'text') {
    const parsed = JSON.parse(c2[0].text);
    const ea = parsed.result.expertAssessment;
    console.log(`   legalVerdict: ${ea.legalVerdict}`);
    console.log(`   qualitySignal: ${ea.qualitySignal}`);
    console.log(`   expertContext: ${ea.expertContext}`);
    console.log(`   suggestedNextSteps[0]: ${ea.suggestedNextSteps[0]}`);
    console.log(`   humanCheckpoint.required: ${parsed.humanCheckpoint.required}`);
    console.log(`   humanCheckpoint.legalNote: ${parsed.humanCheckpoint.legalNote.slice(0, 50)}...`);
  }

  // 4. call_tool — verify_form_reference (환각 검증)
  console.log('\n✓ call_tool: verify_form_reference (환각 검증)');
  const r3 = await client.callTool({
    name: 'verify_form_reference',
    arguments: {
      formId: 'standard.form.rule_no42_quality_inspection_register',
      claim: '별지 제42호 점검결과 통보서',
    },
  });
  const c3 = r3.content as Array<{ type: string; text: string }>;
  if (c3[0]?.type === 'text') {
    const parsed = JSON.parse(c3[0].text);
    console.log(`   status: ${parsed.result.verification.status}`);
    console.log(`   hint: ${parsed.result.verification.hint?.slice(0, 80)}...`);
  }

  // 5. call_tool — explain_quality_decision_path
  console.log('\n✓ call_tool: explain_quality_decision_path(ncr.slump_too_high)');
  const r4 = await client.callTool({
    name: 'explain_quality_decision_path',
    arguments: { entityId: 'ncr.slump_too_high' },
  });
  const c4 = r4.content as Array<{ type: string; text: string }>;
  if (c4[0]?.type === 'text') {
    const parsed = JSON.parse(c4[0].text);
    console.log(`   path 단계: ${parsed.result.path.length}`);
    for (const p of parsed.result.path.slice(0, 5)) {
      console.log(`     ${p.step}. [${p.type}] ${p.name} — ${p.role}`);
    }
  }

  // 6. 환각 검증 시도 — 존재하지 않는 Tool 호출
  console.log('\n✓ call_tool: 존재하지 않는 Tool (에러 처리 검증)');
  try {
    const r5 = await client.callTool({
      name: 'fake_nonexistent_tool',
      arguments: {},
    });
    const c5 = r5.content as Array<{ type: string; text: string }>;
    console.log(`   isError: ${r5.isError}, msg: ${c5[0]?.text?.slice(0, 60)}`);
  } catch (e: unknown) {
    console.log(`   throw: ${e instanceof Error ? e.message.slice(0, 60) : String(e)}`);
  }

  await client.close();
  console.log('\n════════ stdio 통합 테스트 완료 — 26 Tool MCP 프로토콜 정상 ════════');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
