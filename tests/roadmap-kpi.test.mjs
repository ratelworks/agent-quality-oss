// roadmap-kpi.test.mjs — ROADMAP §6 KPI 표가 현행 수치와 정합하는지 회귀 고정
//
// ROADMAP 은 시계열 문서라 doc-code-sync 게이트 대상이 아니다(초기 상태 스냅샷 보존).
// 그러나 §6 측정 메트릭(KPI) 표의 '현' 컬럼은 현재 상태를 가리켜야 한다.
// 과거 drift(9/19·36/54·verified 103 같은 초기 라운드 수치가 '현'에 잔존)를 재발 방지.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROADMAP = readFileSync(resolve(import.meta.dirname, "../ROADMAP.md"), "utf8");

// §6 KPI '현' 컬럼에 있던 초기 라운드 수치(현행 아님) — 잔존 시 fail
const OUTDATED_KPI = [
  "9/19 = 47",
  "36/54 = 67",
  "그래프 verified 노드 수 | 103",
  "46/54 = 85%", // Round 8 완료(2026-07-02, 52개·제네릭 설계)로 폐기된 표기
  "330노드 / verified 69", // Round 1.3·1.5 완료(2026-07-02)로 폐기된 표기
  "382노드 / verified 149", // 손으로 적던 표기 — 자리 표시로 바꿈
  "worst 0% / any 0% / ratio 0%", // 2026-11-16 다시 측정
];

test("ROADMAP §6 KPI 에 outdated 수치 부재 (현행 정합)", () => {
  for (const m of OUTDATED_KPI) {
    assert.ok(!ROADMAP.includes(m), `ROADMAP §6 KPI '현' 컬럼에 outdated 수치 잔존: "${m}"`);
  }
});

test("ROADMAP 의 현행 수치는 자료에서 다시 적는 자리에 있다", () => {
  assert.ok(ROADMAP.includes("19/19 = 100%"), "19종 schema 현행 수치(19/19 = 100%) 없음");
  // 손으로 적은 수는 낡는다 — 그래프·도구 수는 docs:sync 가 채우는 자리 표시로만 둔다(docs:check 가 값을 검사)
  for (const key of ["tools", "verified", "criteria", "graph"]) {
    assert.ok(ROADMAP.includes(`<!-- stat:${key} -->`), `ROADMAP 에 자리 표시 stat:${key} 없음`);
  }
});
