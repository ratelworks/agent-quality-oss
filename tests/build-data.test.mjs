// ─────────────────────────────────────────────────────────────────────────────
// build-data.test.mjs — 실행 중에 읽는 자료 파일이 빌드 결과의 같은 자리에 원본 그대로 있는가.
//
// 도구는 src/ontology·src/schemas 아래의 자료를 코드 위치 기준 상대 경로로 읽는다. tsc 는 자료를 옮기지 않으므로
// 빠지거나 다른 자리로 가면 설치본에서만 ENOENT 로 실패하고, src 로 도는 다른 시험은 통과한다
// (벌점 연결 자료가 빠져 근거 묶음 도구가 설치본에서 오류를 낸 일이 있었다).
// 빌드 결과를 직접 본다 — `npm run build` 뒤에 실행한다(CI·게시 전 검사는 빌드한 뒤 시험을 돌린다).
// 자료 파일 목록은 복사 스크립트와 따로 원본 폴더를 훑어 만든다.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

// ───── 상수 ─────
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "src");
const BUILD_DIR = join(ROOT, "build");
/** 실행 중에 자료를 읽는 폴더 (src 기준) */
const DATA_ROOTS = ["ontology", "schemas"];
/** 반드시 있어야 하는 자료 — 폴더 훑기가 비어도 시험이 통과하지 않게 */
const REQUIRED = ["ontology/penalty-links.json", "ontology/field-phrases.json", "schemas/document-schemas.json", "schemas/field-labels.json"];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.isFile() && !e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

test("실행 중에 읽는 자료 파일이 빌드 결과의 같은 자리에 원본 그대로 있다", () => {
  assert.ok(existsSync(join(BUILD_DIR, "index.js")), "빌드 결과가 없다 — npm run build 뒤에 실행한다");
  const files = DATA_ROOTS.flatMap((r) => walk(join(SRC_DIR, r))).map((f) => relative(SRC_DIR, f));
  for (const req of REQUIRED) assert.ok(files.includes(req), `원본에 ${req} 가 없다`);
  const missing = [];
  const differ = [];
  for (const rel of files) {
    const built = join(BUILD_DIR, rel);
    if (!existsSync(built)) missing.push(rel);
    else if (!readFileSync(built).equals(readFileSync(join(SRC_DIR, rel)))) differ.push(rel);
  }
  assert.deepEqual(missing, [], `빌드 결과에 없는 자료 파일: ${missing.slice(0, 10).join(", ")}`);
  assert.deepEqual(differ, [], `원본과 다른 자료 파일: ${differ.slice(0, 10).join(", ")}`);
});
