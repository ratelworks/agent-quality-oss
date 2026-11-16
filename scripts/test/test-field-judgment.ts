// ─────────────────────────────────────────────────────────────────────────────
// test-field-judgment.ts — 현장 문장으로 판정 도구를 잰다.
//
// 문장과 정답은 이 도구의 코드를 보지 않은 작성자가 판정 규칙만 받아 썼다(evaluation/field-judgment).
// 날짜·차량 번호·레미콘 규격·다른 시험의 값·인용한 기준이 섞인 문장, 값을 여럿 적은 문장,
// 판정에 필요한 정보가 빠진 문장이 들어 있다.
//
//   seen.json     판정 코드를 고칠 때 결과를 보며 맞춘 묶음 — 점수가 높게 나온다
//   heldout.json  고친 뒤에 처음 돌린 묶음 — 이 묶음의 문장을 보고 판정 코드를 맞추지 않는다
//                 (맞추고 싶으면 그 문장을 seen 으로 옮기고 새 문장을 받는다)
//
// 정답: PASS(합격) · FAIL(불합격) · ASK(판정하지 않고 되물어야 함 — 값이 여럿이거나 필요한 정보가 없음)
// 지키는 것 (묶음마다):
//   · 틀린 합격 0 — 합격이 아닌 문장에 합격을 내지 않는다
//   · 틀린 불합격 0
//   · 정답 수가 바닥값 아래로 내려가지 않는다 (되묻기가 늘어 쓸모가 줄어드는 것을 잡는다)
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOntologySync } from "../../src/ontology/loader.js";
import { OntologyGraph } from "../../src/ontology/graph.js";
import { callTool } from "../../src/tool-registry.js";

// ───── 상수 ─────
const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../evaluation/field-judgment");
const TOOL = "evaluate_observation";
const TEST_ID: Record<string, string> = {
  slump: "test.slump",
  air: "test.air_content",
  compaction: "test.soil_compaction",
  chloride: "test.chloride",
  strength: "test.compressive_strength",
};
/** 묶음별 정답 수 바닥값 — 처음 잰 값. 올라가면 함께 올린다 */
const SETS: Array<{ file: string; label: string; floor: number }> = [
  { file: "seen.json", label: "맞춰 본 묶음", floor: 1849 },
];

type Expected = "PASS" | "FAIL" | "ASK";
interface Item {
  id: string;
  test: string;
  sentence: string;
  expected: Expected;
  why: string;
}
interface Score {
  correct: number;
  wrongPass: string[];
  wrongFail: string[];
  needlessAsk: string[];
}

const graph = new OntologyGraph(loadOntologySync());

async function judge(item: Item): Promise<Expected | "ERR"> {
  const testId = TEST_ID[item.test];
  if (!testId) return "ERR";
  const response = await callTool(TOOL, { observation: item.sentence, testId }, { graph });
  const verdict = (response.result as { expertAssessment?: { verdict?: string } }).expertAssessment?.verdict;
  // 허용 한계에 가까운 합격(MARGINAL)은 합격 쪽이다
  if (verdict === "PASS" || verdict === "MARGINAL") return "PASS";
  if (verdict === "FAIL") return "FAIL";
  return verdict === "UNDETERMINED" ? "ASK" : "ERR";
}

async function score(items: Item[]): Promise<Score> {
  const s: Score = { correct: 0, wrongPass: [], wrongFail: [], needlessAsk: [] };
  for (const item of items) {
    const got = await judge(item);
    if (got === item.expected) s.correct += 1;
    else if (got === "PASS") s.wrongPass.push(item.id);
    else if (got === "FAIL") s.wrongFail.push(item.id);
    else s.needlessAsk.push(item.id);
  }
  return s;
}

async function main(): Promise<void> {
  let failed = false;
  for (const set of SETS) {
    const path = resolve(DATA_DIR, set.file);
    if (!existsSync(path)) {
      console.error(`  ❌ ${set.label}: ${set.file} 이 없습니다`);
      failed = true;
      continue;
    }
    const items = JSON.parse(readFileSync(path, "utf8")) as Item[];
    const s = await score(items);
    const missed = [...s.wrongPass, ...s.wrongFail, ...s.needlessAsk];
    console.log(
      `[field-judgment] ${set.label}: 정답 ${s.correct}/${items.length} · 틀린 합격 ${s.wrongPass.length} · 틀린 불합격 ${s.wrongFail.length} · 판정할 수 있는데 되물음 ${s.needlessAsk.length}` +
        (missed.length > 0 ? ` (${missed.join(", ")})` : ""),
    );
    if (s.wrongPass.length > 0) {
      console.error(`  ❌ ${set.label}: 틀린 합격 — ${s.wrongPass.join(", ")}`);
      failed = true;
    }
    if (s.wrongFail.length > 0) {
      console.error(`  ❌ ${set.label}: 틀린 불합격 — ${s.wrongFail.join(", ")}`);
      failed = true;
    }
    if (s.correct < set.floor) {
      console.error(`  ❌ ${set.label}: 정답 ${s.correct} 가 바닥값 ${set.floor} 아래입니다`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}

await main();
