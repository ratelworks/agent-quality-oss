#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// test-noise-robustness.ts — 측정값이 아닌 수를 끼워 넣어도 판정이 뒤집히지 않는가.
//
// 현장 문장에는 측정값이 아닌 수가 많다(날짜·시각·전화번호·차량 번호·문서 번호·회차·측점·수량).
// 정답을 아는 문장(evaluation/field-judgment/seen.json)의 앞·뒤·쉼표 뒤에 그런 수를 끼워 넣고 다시 판정한다.
// 끼워 넣은 수는 판정과 무관하므로 결과는 원래 결과와 같거나, 확실하지 않아 되묻는 것이어야 한다.
// 정답이 아닌 합격·불합격이 하나라도 나오면 실패한다(합격이 불합격으로, 불합격이 합격으로, 되물어야 할 문장이 합격·불합격으로).
//
// 무작위 수는 씨앗이 정해져 있어 돌릴 때마다 같은 문장이 만들어진다.
//
// 실행: npm run test:noise
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOntologySync } from "../../src/ontology/loader.js";
import { OntologyGraph } from "../../src/ontology/graph.js";
import { callTool } from "../../src/tool-registry.js";

// ───── 상수 ─────
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CORPUS = join(ROOT, "evaluation/field-judgment/seen.json");
const TEST_ID: Record<string, string> = {
  slump: "test.slump",
  air: "test.air_content",
  compaction: "test.soil_compaction",
  chloride: "test.chloride",
  strength: "test.compressive_strength",
};
/** 문장 하나에서 만드는 변형 수 */
const VARIANTS_PER_SENTENCE = 6;
/** 변형 하나에 끼워 넣는 잡수의 수 */
const NOISE_PER_VARIANT = 2;
const SEED = 20261116;
/** 판정과 무관한 수 — 현장 문장에 실제로 섞여 나오는 것들 */
const NOISE: readonly string[] = [
  "2026-11-14", "26.11.14", "11/14", "11.14(금)", "11. 14.", "26-11-14", "2026.11", "11월 14일",
  "09:40", "14시 20분", "오전 9시", "15:05 측정",
  "담당 010-1234-5678", "기사 010-****-4471", "사무실 02-345-6789", "(끝번호 0418)",
  "차량 경기88자 4127", "82루 5519", "서울86사 1203",
  "납품서 No.2611-0387", "제2026-0458호", "송장 A-11152", "배치 #14", "문서 C-1107-22",
  "3호차", "5번차", "2대째입니다", "인원 4명 대기", "펌프카 1대", "7회차", "2리프트", "40루베 쳤음",
  "타설량 84㎥", "누계 216㎥", "시험빈도 1,000㎡당 1회", "단가 98,500원", "공시체 6개 제작",
  "103동 7F", "B동 3층", "STA.3+240", "No.12+10", "측점 5+120", "지하2층",
  "KS F 2402", "KCS 14 20 10 표 1.7-2", "표 5 참조", "업무지침 제41조",
  "운반 48분", "대기 6분", "롤러 10톤", "배관 85m",
];

interface Item {
  id: string;
  test: string;
  sentence: string;
  expected: "PASS" | "FAIL" | "ASK";
}
type Outcome = "PASS" | "FAIL" | "ASK";

/** 씨앗이 정해진 무작위 수 (mulberry32) */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 문장의 앞·뒤·쉼표 뒤 가운데 한 곳에 잡수를 끼워 넣는다 */
function insertNoise(sentence: string, noise: string, random: () => number): string {
  const commas = [...sentence.matchAll(/, /gu)].map((m) => (m.index ?? 0) + 2);
  const spots = [0, sentence.length, ...commas];
  const at = spots[Math.floor(random() * spots.length)] as number;
  if (at === 0) return `${noise}, ${sentence}`;
  if (at === sentence.length) return `${sentence}, ${noise}`;
  return `${sentence.slice(0, at)}${noise}, ${sentence.slice(at)}`;
}

async function judge(graph: OntologyGraph, item: Item, sentence: string): Promise<Outcome> {
  const r = await callTool("evaluate_observation", { observation: sentence, testId: TEST_ID[item.test] }, { graph });
  const verdict = (r.result as { expertAssessment: { verdict: string } }).expertAssessment.verdict;
  return verdict === "PASS" || verdict === "MARGINAL" ? "PASS" : verdict === "FAIL" ? "FAIL" : "ASK";
}

async function main(): Promise<void> {
  const graph = new OntologyGraph(loadOntologySync());
  const items = JSON.parse(readFileSync(CORPUS, "utf8")) as Item[];
  const random = seededRandom(SEED);
  let variants = 0;
  let same = 0;
  let asked = 0;
  let corrected = 0;
  const flipped: string[] = [];
  for (const item of items) {
    const original = await judge(graph, item, item.sentence);
    for (let v = 0; v < VARIANTS_PER_SENTENCE; v += 1) {
      let sentence = item.sentence;
      const used: string[] = [];
      for (let n = 0; n < NOISE_PER_VARIANT; n += 1) {
        const noise = NOISE[Math.floor(random() * NOISE.length)] as string;
        used.push(noise);
        sentence = insertNoise(sentence, noise, random);
      }
      const got = await judge(graph, item, sentence);
      variants += 1;
      // 틀린 판정 = 정답이 아닌 합격·불합격. 원래 되묻던 문장이 정답으로 바뀌는 것은 틀린 것이 아니다
      if (got === original) same += 1;
      else if (got === "ASK") asked += 1;
      else if (got === item.expected) corrected += 1;
      else flipped.push(`${item.id} [${item.test}] ${original} → ${got} · 끼워 넣은 것: ${used.join(" + ")}\n      ${JSON.stringify(sentence).slice(0, 260)}`);
    }
  }
  console.log(
    `[noise] 문장 ${items.length}개 × 변형 ${VARIANTS_PER_SENTENCE} = ${variants}건 · 판정 그대로 ${same} · 되묻는 쪽으로 바뀜 ${asked} · 되묻던 것이 정답으로 바뀜 ${corrected} · 틀린 합격·불합격 ${flipped.length}`,
  );
  if (flipped.length > 0) {
    for (const line of flipped.slice(0, 40)) console.error(`  ❌ ${line}`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
