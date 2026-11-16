// ─────────────────────────────────────────────────────────────────────────────
// build-data.test.mjs — 실행 중에 읽는 자료 파일이 빌드 결과에 모두 복사되는가.
//
// 도구는 src/ontology·src/schemas 의 JSON 을 실행 위치 기준으로 읽는다. tsc 는 JSON 을 옮기지 않으므로
// package.json 의 copy:data 가 옮겨야 한다. 빠지면 설치본에서만 ENOENT 로 실패하고 src 로 도는 시험은 통과한다
// (벌점 연결 자료가 빠져 근거 묶음 도구가 설치본에서 오류를 낸 일이 있었다).
// 빌드하지 않고 확인한다: 자료 파일마다 copy:data 가 그 파일이나 그 폴더를 옮기는지 본다.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ───── 상수 ─────
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** 실행 중에 자료를 읽는 폴더 — 바로 아래의 .json 파일 */
const DATA_DIRS = ["src/ontology", "src/schemas"];

test("실행 중에 읽는 자료 파일이 모두 빌드로 복사된다", () => {
  const copy = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts["copy:data"];
  assert.ok(typeof copy === "string" && copy.length > 0, "copy:data 스크립트가 없다");
  const missing = [];
  for (const dir of DATA_DIRS) {
    for (const name of readdirSync(join(ROOT, dir)).filter((n) => n.endsWith(".json"))) {
      const file = `${dir}/${name}`;
      // 그 파일을 옮기거나, 그 파일이 든 폴더를 통째로 옮겨야 한다
      if (!copy.includes(`'${file}'`) && !copy.includes(`'${dir}'`)) missing.push(file);
    }
  }
  assert.deepEqual(missing, [], `copy:data 가 옮기지 않는 자료 파일: ${missing.join(", ")}`);
});
