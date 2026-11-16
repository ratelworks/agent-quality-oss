// ─────────────────────────────────────────────────────────────────────────────
// test-field-questions.ts — 현장 말투 질문에 맞는 시험·기준·조문이 답에 나오는지 잰다.
//
// 무엇을 재나
//   fixtures 의 질문을 상황 안내 도구(discover_relevant_domain)에 글자 그대로 넣고,
//   돌아온 답에 그 상황에서 반드시 나와야 하는 그래프 노드·법령 조문·품질시험기준 행이 있는지 센다.
//   답이 길어졌는지가 아니라 맞는 것이 빠지지 않는지를 본다. 정답이 모두 나온 질문만 적중으로 친다.
//
// 사용
//   tsx scripts/test/test-field-questions.ts                    맞춰 보는 묶음 — 빠진 정답을 질문별로 보여 준다
//   tsx scripts/test/test-field-questions.ts --holdout          보지 않는 묶음 — 전체 적중률만 보여 준다
//   tsx scripts/test/test-field-questions.ts --min 80           적중률(%)이 이보다 낮으면 실패
//   tsx scripts/test/test-field-questions.ts --holdout --detail 보지 않는 묶음의 문항별 결과(본 뒤에는 회귀 확인용이 된다)
//   tsx scripts/test/test-field-questions.ts --set-c            도구를 고정한 뒤에 쓴 묶음 — 전체 적중률만 보여 준다
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOntologySync } from "../../src/ontology/loader.js";
import { OntologyGraph } from "../../src/ontology/graph.js";
import { callTool } from "../../src/tool-registry.js";

// ───── 상수 ─────
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const DEV_FIXTURE = "field-questions.json";
const HOLDOUT_FIXTURE = "field-questions-holdout.json";
const SET_C_FIXTURE = "field-questions-set-c.json";
const TOOL = "discover_relevant_domain";

interface Question {
  id: string;
  question: string;
  expect: string[];
}

interface Answer {
  domainPackage?: Record<string, Array<{ id: string }>>;
  lawArticles?: Array<{ law: string; ref: string }>;
  testStandards?: Array<{ category: string; item: string }>;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const squash = (s: string): string => s.replace(/\s+/g, "");

/** 정답 하나가 답에 있는가 */
function found(expected: string, answer: Answer): boolean {
  const colon = expected.indexOf(":");
  const kind = expected.slice(0, colon);
  const rest = expected.slice(colon + 1);
  if (kind === "node") {
    return Object.values(answer.domainPackage ?? {}).some((bucket) => bucket.some((hit) => hit.id === rest));
  }
  if (kind === "law") {
    const split = rest.indexOf(":");
    const law = rest.slice(0, split);
    const ref = squash(rest.slice(split + 1));
    return (answer.lawArticles ?? []).some((a) => a.law === law && squash(a.ref) === ref);
  }
  if (kind === "row") {
    const [category = "", item = ""] = rest.split("|");
    return (answer.testStandards ?? []).some((r) => squash(r.category).includes(squash(category)) && squash(r.item).includes(squash(item)));
  }
  throw new Error(`알 수 없는 정답 표기: ${expected}`);
}

async function main(): Promise<void> {
  const holdout = process.argv.includes("--holdout");
  const setC = process.argv.includes("--set-c");
  const detail = process.argv.includes("--detail") || (!holdout && !setC);
  const min = arg("--min") !== undefined ? Number(arg("--min")) : undefined;
  const fixture = setC ? SET_C_FIXTURE : holdout ? HOLDOUT_FIXTURE : DEV_FIXTURE;
  const { questions } = JSON.parse(readFileSync(join(FIXTURES, fixture), "utf8")) as { questions: Question[] };
  const graph = new OntologyGraph(loadOntologySync());

  let hits = 0;
  let expectedTotal = 0;
  let expectedFound = 0;
  for (const q of questions) {
    const answer = (await callTool(TOOL, { situation: q.question }, { graph })).result as Answer;
    const missing = q.expect.filter((e) => !found(e, answer));
    expectedTotal += q.expect.length;
    expectedFound += q.expect.length - missing.length;
    if (missing.length === 0) hits += 1;
    else if (detail) console.log(`  ✗ ${q.id} "${q.question}" — 빠짐: ${missing.join(", ")}`);
  }

  const rate = (hits / questions.length) * 100;
  const label = setC ? "고정한 뒤에 쓴 묶음" : holdout ? "보지 않는 묶음" : "맞춰 보는 묶음";
  console.log(
    `[field-questions] ${label}: 질문 ${hits}/${questions.length} 적중 (${rate.toFixed(1)}%) · 정답 ${expectedFound}/${expectedTotal} 개`,
  );
  if (min !== undefined && rate < min) {
    console.error(`[field-questions] 적중률이 기준(${min}%)보다 낮습니다.`);
    process.exit(1);
  }
}

await main();
