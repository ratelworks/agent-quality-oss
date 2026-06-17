// doc-code-sync.negative.test.mjs — 게이트가 실제 drift 를 잡는지 fixture 로 검증
//
// 순수 node:test. check-doc-code-sync.ts 가
//   - drift 주입 fixture 에서 exit 1 (release blocker) 로 차단하는가
//   - 정합 fixture 에서 exit 0 (release OK) 로 통과하는가
// 를 임시 디렉토리 fixture 로 확인한다. (README badge / SECURITY 버전 / docs 도구수 괄호)
//
// 게이트 SSoT 추출 중 toolCount 는 DOC_SYNC_TOOLCOUNT env(ROOT override 동반 시만)로,
// ROOT 는 DOC_SYNC_ROOT env 로 주입 → fixture 만으로 빌드 없이 실행 가능.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

// ── 상수 ────────────────────────────────────────────────────
const GATE_ABS_PATH = resolve(
  import.meta.dirname,
  "../scripts/verify/check-doc-code-sync.ts",
);
const FIXTURE_VERSION = "0.3.0";
const FIXTURE_TOOLCOUNT = "46";

// fixture 디렉토리 골격 생성.
//   opts.readme   — README.md 본문 (badge 변인)
//   opts.security — SECURITY.md 본문 (버전 표기 변인, 선택)
//   opts.setup    — docs/SETUP_CLAUDE_DESKTOP.md 본문 (도구수 괄호 변인, 선택)
// package.json(version) + src/version.ts(VERSION) 는 항상 FIXTURE_VERSION 으로 정합 생성
// → 각 테스트의 변인(README/SECURITY/docs)만 격리해 검증한다.
function buildFixture(opts) {
  const dir = mkdtempSync(join(tmpdir(), "qoss-docsync-"));
  // package.json — version 만 (게이트는 pkg.version 만 읽음)
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ version: FIXTURE_VERSION }, null, 2),
  );
  // src/version.ts — VERSION 정합 (version_ts drift 는 이 테스트의 변인이 아님)
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src", "version.ts"),
    `export const VERSION = "${FIXTURE_VERSION}";\n`,
  );
  // README.md — badge 표기
  writeFileSync(join(dir, "README.md"), opts.readme ?? "# fixture\n");
  // SECURITY.md (선택)
  if (opts.security !== undefined) {
    writeFileSync(join(dir, "SECURITY.md"), opts.security);
  }
  // docs/SETUP_CLAUDE_DESKTOP.md (선택)
  if (opts.setup !== undefined) {
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "SETUP_CLAUDE_DESKTOP.md"), opts.setup);
  }
  return dir;
}

// 게이트 실행 (fixture ROOT + toolCount env 주입). exit != 0 이면 execFileSync 가 throw.
function runGate(fixtureDir) {
  execFileSync("npx", ["tsx", GATE_ABS_PATH], {
    env: {
      ...process.env,
      DOC_SYNC_ROOT: fixtureDir,
      DOC_SYNC_TOOLCOUNT: FIXTURE_TOOLCOUNT,
    },
    encoding: "utf8",
  });
}

// ── README badge fixture (drift 변인) ────────────────────────
const NEGATIVE_README = [
  "# agent-quality-oss",
  "",
  "[![Release](https://img.shields.io/badge/release-v9.9.9-blue.svg)](./CHANGELOG.md)",
  "[![Tools](https://img.shields.io/badge/MCP%20tools-99-orange.svg)](#)",
  "",
].join("\n");
const POSITIVE_README = [
  "# agent-quality-oss",
  "",
  `[![Release](https://img.shields.io/badge/release-v${FIXTURE_VERSION}-blue.svg)](./CHANGELOG.md)`,
  `[![Tools](https://img.shields.io/badge/MCP%20tools-${FIXTURE_TOOLCOUNT}-orange.svg)](#)`,
  "",
].join("\n");

// ── SECURITY.md fixture (버전 표기 변인) ─────────────────────
//   supported 표 행 "| N.N.x | ✅ |" + 본문 "현재 버전(vX.Y.Z)" 두 케이스 동시.
const NEGATIVE_SECURITY = [
  "# Security Policy",
  "",
  "| 버전 | 보안 패치 지원 | 비고 |",
  "|---|:--:|---|",
  "| 9.9.x | ✅ | 현재 공개 준비판 (v9.9.9) |",
  "",
  "- **런타임**: 현재 버전(v9.9.9)은 외부 서버와 통신하지 않습니다.",
  "",
].join("\n");
const POSITIVE_SECURITY = [
  "# Security Policy",
  "",
  "| 버전 | 보안 패치 지원 | 비고 |",
  "|---|:--:|---|",
  `| ${FIXTURE_VERSION.split(".").slice(0, 2).join(".")}.x | ✅ | 현재 공개 준비판 (v${FIXTURE_VERSION}) |`,
  "",
  `- **런타임**: 현재 버전(v${FIXTURE_VERSION})은 외부 서버와 통신하지 않습니다.`,
  "",
].join("\n");

// ── docs/SETUP fixture (도구수 괄호 변인) ────────────────────
const NEGATIVE_SETUP = [
  "# Claude Desktop 설정",
  "",
  "키 없이 모든 도구(99개)가 동작합니다.",
  "",
].join("\n");
const POSITIVE_SETUP = [
  "# Claude Desktop 설정",
  "",
  `키 없이 모든 도구(${FIXTURE_TOOLCOUNT}개)가 동작합니다.`,
  "",
].join("\n");

// ── test 1·2: README badge ───────────────────────────────────
test("README badge drift 주입 시 exit 1 (release blocker)", () => {
  const dir = buildFixture({ readme: NEGATIVE_README });
  try {
    // badge release-v9.9.9 / MCP%20tools-99 → HIGH 2건 → exit 1 → throw
    assert.throws(() => runGate(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("README badge 정합 시 exit 0 (release OK)", () => {
  const dir = buildFixture({ readme: POSITIVE_README });
  try {
    // 모든 HIGH 검사 통과 → exit 0 → throw 안 함
    assert.doesNotThrow(() => runGate(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── test 3·4: SECURITY.md 버전 표기 (갭1) ────────────────────
test("SECURITY 버전 drift 주입 시 exit 1 (supported 표 행 + 현재 버전)", () => {
  // README 는 정합으로 고정 → SECURITY 만 변인. supported 9.9.x / 현재 버전(v9.9.9) → HIGH → exit 1
  const dir = buildFixture({ readme: POSITIVE_README, security: NEGATIVE_SECURITY });
  try {
    assert.throws(() => runGate(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SECURITY 버전 정합 시 exit 0", () => {
  const dir = buildFixture({ readme: POSITIVE_README, security: POSITIVE_SECURITY });
  try {
    assert.doesNotThrow(() => runGate(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── test 5·6: docs 도구수 괄호 (갭2) ─────────────────────────
test("docs 도구수 괄호 drift 주입 시 exit 1 (도구(99개))", () => {
  // README 정합 → docs/SETUP 만 변인. "도구(99개)" → HIGH stale_tool_count → exit 1
  const dir = buildFixture({ readme: POSITIVE_README, setup: NEGATIVE_SETUP });
  try {
    assert.throws(() => runGate(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("docs 도구수 괄호 정합 시 exit 0 (도구(46개))", () => {
  const dir = buildFixture({ readme: POSITIVE_README, setup: POSITIVE_SETUP });
  try {
    assert.doesNotThrow(() => runGate(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── test 7: prepublishOnly 배선 회귀 ─────────────────────────
// prepublishOnly 체인에 게이트가 연결됐는지 — 연결 안 하면 release 전 자동 실행되지 않아
// drift 가 publish 로 새어나간다. 게이트 "작동"과 별개로 "배선"을 회귀로 고정.
test("prepublishOnly 에 check:doc-code-sync 연결됨", () => {
  const pkg = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
  );
  assert.ok(
    pkg.scripts.prepublishOnly.includes("check:doc-code-sync"),
    "prepublishOnly 체인에 check:doc-code-sync 가 없습니다",
  );
});
