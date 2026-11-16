// ─────────────────────────────────────────────────────────────────────────────
// copy-build-data.mjs — 실행 중에 읽는 자료 파일을 빌드 결과의 같은 자리로 옮긴다.
//
// tsc 는 .ts 만 옮긴다. 도구는 자료(src/ontology · src/schemas 아래의 JSON·JSON-LD 등)를
// 코드 파일 위치 기준의 상대 경로로 읽으므로, 빌드 결과에도 같은 상대 경로에 있어야 한다.
// 자료 폴더 아래의 코드가 아닌 파일을 통째로 옮긴다 — 파일을 하나씩 적어 두면 새 자료를 더할 때
// 빠뜨리기 쉽다(벌점 연결 자료가 빠져 설치본에서 근거 묶음 도구가 실패한 일이 있었다).
// 확인: tests/build-data.test.mjs 가 빌드 결과를 원본과 바이트 단위로 대조한다.
// ─────────────────────────────────────────────────────────────────────────────

import { cpSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ───── 상수 ─────
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(ROOT, "src");
const OUT_DIR = path.join(ROOT, "build");
/** 실행 중에 자료를 읽는 폴더 (src 기준) */
const DATA_ROOTS = ["ontology", "schemas"];
/** 코드 파일 — tsc 가 따로 옮긴다 */
const CODE_RE = /\.ts$/u;

/** 폴더 아래의 코드가 아닌 파일 (src 기준 상대 경로) */
function dataFilesUnder(rel) {
  const out = [];
  for (const entry of readdirSync(path.join(SRC_DIR, rel), { withFileTypes: true })) {
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...dataFilesUnder(child));
    else if (entry.isFile() && !CODE_RE.test(entry.name)) out.push(child);
  }
  return out;
}

try {
  const files = DATA_ROOTS.flatMap((root) => dataFilesUnder(root));
  for (const rel of files) {
    const target = path.join(OUT_DIR, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(SRC_DIR, rel), target);
  }
  console.log(`[copy-data] 자료 파일 ${files.length}개를 build 로 옮겼습니다.`);
} catch (err) {
  console.error(`[copy-data] 자료 파일을 옮기지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
