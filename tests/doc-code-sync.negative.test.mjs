// doc-code-sync.negative.test.mjs — 게이트가 실제 drift 를 잡는지 fixture 로 검증
//
// 순수 node:test. check-doc-code-sync.ts 가
//   - drift 주입 fixture 에서 차단(HIGH=exit 1 / MEDIUM=issue 출력)하는가
//   - 정합 fixture 에서 exit 0 (release OK) 로 통과하는가
// 를 임시 디렉토리 fixture 로 확인한다.
//
// 검사 대상(기존 7 + P0 확장 4):
//   기존: README badge / SECURITY 버전 / docs 도구수 괄호 / prepublishOnly 배선
//   확장: 양식종수(HIGH) · 근거등급 enum(HIGH) · 관계수(MEDIUM) · smoke수(MEDIUM)
//
// SSoT 추출은 모두 DOC_SYNC_* env override(DOC_SYNC_ROOT 동반 시만)로 주입 →
// fixture 만으로 빌드·src 없이 실행 가능. production(DOC_SYNC_ROOT 미설정)은 항상 실측.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

// ── 상수 (파일 최상단) ───────────────────────────────────────
const GATE_ABS_PATH = resolve(
  import.meta.dirname,
  "../scripts/verify/check-doc-code-sync.ts",
);
const FIXTURE_VERSION = "0.3.0";
const FIXTURE_TOOLCOUNT = "46";
const FIXTURE_RELATIONCOUNT = "930";
const FIXTURE_FORMCOUNT = "19";
const FIXTURE_SMOKECOUNT = "87";
const FIXTURE_SOURCESTATUS = "indirect_source,skeleton,verified";

// ── README 조각 ──────────────────────────────────────────────
// 근거등급 표 — 정합(실사용 3종 전부 명시)
const GRADE_TABLE_FULL = [
  "## 신뢰성 — 근거 등급",
  "",
  "| 등급 | 의미 |",
  "|---|---|",
  "| `verified` | 별표2·법령 본문과 1:1 대조 완료 |",
  "| `indirect_source` | 간접 인용 |",
  "| `skeleton` | 출처 미확정 |",
].join("\n");
// 근거등급 표 — skeleton 행 누락(drift: 실사용 등급이 표에 없음)
const GRADE_TABLE_MISSING = [
  "## 신뢰성 — 근거 등급",
  "",
  "| 등급 | 의미 |",
  "|---|---|",
  "| `verified` | 별표2·법령 본문과 1:1 대조 완료 |",
  "| `indirect_source` | 간접 인용 |",
].join("\n");

const BADGE_OK = [
  `[![Release](https://img.shields.io/badge/release-v${FIXTURE_VERSION}-blue.svg)](./CHANGELOG.md)`,
  `[![Tools](https://img.shields.io/badge/MCP%20tools-${FIXTURE_TOOLCOUNT}-orange.svg)](#)`,
].join("\n");
const BADGE_DRIFT = [
  "[![Release](https://img.shields.io/badge/release-v9.9.9-blue.svg)](./CHANGELOG.md)",
  "[![Tools](https://img.shields.io/badge/MCP%20tools-99-orange.svg)](#)",
].join("\n");

// README 조립 — badge + 근거등급표 + (선택) 본문 표기.
// 기본값은 전부 정합 → 변인만 바꿔 격리 검증.
function readme({ badge = BADGE_OK, grades = GRADE_TABLE_FULL, body = "" } = {}) {
  return ["# agent-quality-oss", "", badge, "", grades, "", body, ""].join("\n");
}

// ── SECURITY.md fixture (버전 표기 변인) ─────────────────────
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
const NEGATIVE_SETUP = ["# Claude Desktop 설정", "", "키 없이 모든 도구(99개)가 동작합니다.", ""].join("\n");
const POSITIVE_SETUP = [
  "# Claude Desktop 설정",
  "",
  `키 없이 모든 도구(${FIXTURE_TOOLCOUNT}개)가 동작합니다.`,
  "",
].join("\n");

// ── fixture 디렉토리 골격 ────────────────────────────────────
function buildFixture(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "qoss-docsync-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version: FIXTURE_VERSION }, null, 2));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "version.ts"), `export const VERSION = "${FIXTURE_VERSION}";\n`);
  writeFileSync(join(dir, "README.md"), opts.readme ?? readme());
  if (opts.security !== undefined) writeFileSync(join(dir, "SECURITY.md"), opts.security);
  if (opts.setup !== undefined) {
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "SETUP_CLAUDE_DESKTOP.md"), opts.setup);
  }
  return dir;
}

// 게이트 실행 — 모든 SSoT 를 env 로 주입(fixture 모드). exit 0 이면 stdout 반환, !=0 이면 throw.
function runGate(fixtureDir) {
  return execFileSync("npx", ["tsx", GATE_ABS_PATH], {
    env: {
      ...process.env,
      DOC_SYNC_ROOT: fixtureDir,
      DOC_SYNC_TOOLCOUNT: FIXTURE_TOOLCOUNT,
      DOC_SYNC_RELATIONCOUNT: FIXTURE_RELATIONCOUNT,
      DOC_SYNC_FORMCOUNT: FIXTURE_FORMCOUNT,
      DOC_SYNC_SMOKECOUNT: FIXTURE_SMOKECOUNT,
      DOC_SYNC_SOURCESTATUS: FIXTURE_SOURCESTATUS,
    },
    encoding: "utf8",
  });
}

// MEDIUM 검사용 — exit 0(throw 안 함)이지만 stdout 에 issue 카테고리가 찍히는지 확인.
function runGateStdout(fixtureDir) {
  try {
    return runGate(fixtureDir);
  } catch (e) {
    // HIGH 가 섞여 exit 1 이면 stdout 은 e.stdout 에 담김 (테스트 의도상 HIGH 0 이어야 정상)
    return String(e.stdout ?? "");
  }
}

function withFixture(opts, fn) {
  const dir = buildFixture(opts);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 기존 1·2: README badge ───────────────────────────────────
test("README badge drift 주입 시 exit 1 (release blocker)", () => {
  withFixture({ readme: readme({ badge: BADGE_DRIFT }) }, (dir) => {
    assert.throws(() => runGate(dir));
  });
});

test("README badge 정합 시 exit 0 (release OK)", () => {
  withFixture({ readme: readme() }, (dir) => {
    assert.doesNotThrow(() => runGate(dir));
  });
});

// ── 기존 3·4: SECURITY.md 버전 표기 ──────────────────────────
test("SECURITY 버전 drift 주입 시 exit 1 (supported 표 행 + 현재 버전)", () => {
  withFixture({ readme: readme(), security: NEGATIVE_SECURITY }, (dir) => {
    assert.throws(() => runGate(dir));
  });
});

test("SECURITY 버전 정합 시 exit 0", () => {
  withFixture({ readme: readme(), security: POSITIVE_SECURITY }, (dir) => {
    assert.doesNotThrow(() => runGate(dir));
  });
});

// ── 기존 5·6: docs 도구수 괄호 ───────────────────────────────
test("docs 도구수 괄호 drift 주입 시 exit 1 (도구(99개))", () => {
  withFixture({ readme: readme(), setup: NEGATIVE_SETUP }, (dir) => {
    assert.throws(() => runGate(dir));
  });
});

test("docs 도구수 괄호 정합 시 exit 0 (도구(46개))", () => {
  withFixture({ readme: readme(), setup: POSITIVE_SETUP }, (dir) => {
    assert.doesNotThrow(() => runGate(dir));
  });
});

// ── 기존 7: prepublishOnly 배선 회귀 ─────────────────────────
test("prepublishOnly 에 check:doc-code-sync 연결됨", () => {
  const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"));
  assert.ok(
    pkg.scripts.prepublishOnly.includes("check:doc-code-sync"),
    "prepublishOnly 체인에 check:doc-code-sync 가 없습니다",
  );
});

// ── P0 확장 8·9: 양식 종수 (HIGH) ────────────────────────────
test("양식 종수 drift 주입 시 exit 1 (양식 5종 != formCount 19)", () => {
  withFixture({ readme: readme({ body: "문서 양식 구조 5종을 제공합니다." }) }, (dir) => {
    assert.throws(() => runGate(dir));
  });
});

test("양식 종수 정합 시 exit 0 (양식 19종)", () => {
  withFixture({ readme: readme({ body: "문서 양식 구조 19종을 제공합니다." }) }, (dir) => {
    assert.doesNotThrow(() => runGate(dir));
  });
});

// ── P0 확장 10·11: 근거등급 enum (HIGH) ──────────────────────
test("근거등급 표 누락 시 exit 1 (skeleton 미등재 — 실사용 등급이 표에 없음)", () => {
  withFixture({ readme: readme({ grades: GRADE_TABLE_MISSING }) }, (dir) => {
    assert.throws(() => runGate(dir));
  });
});

test("근거등급 표 정합 시 exit 0 (verified·indirect_source·skeleton 3종 명시)", () => {
  withFixture({ readme: readme({ grades: GRADE_TABLE_FULL }) }, (dir) => {
    assert.doesNotThrow(() => runGate(dir));
  });
});

// ── P0 확장 12: 관계 수 (MEDIUM — exit 0 이나 issue 출력) ─────
test("관계 수 drift 시 stale_relation_count 출력 (MEDIUM, exit 0)", () => {
  withFixture({ readme: readme({ body: "그래프 관계 999개 를 보유합니다." }) }, (dir) => {
    const out = runGateStdout(dir);
    assert.match(out, /stale_relation_count/, "관계 수 drift 가 MEDIUM 으로 보고되지 않음");
  });
});

// ── P0 확장 13: smoke 수 (MEDIUM — exit 0 이나 issue 출력) ────
test("smoke 수 drift 시 stale_smoke_count 출력 (MEDIUM, exit 0)", () => {
  withFixture({ readme: readme({ body: "smoke 회귀: 99/99 통과" }) }, (dir) => {
    const out = runGateStdout(dir);
    assert.match(out, /stale_smoke_count/, "smoke 수 drift 가 MEDIUM 으로 보고되지 않음");
  });
});
