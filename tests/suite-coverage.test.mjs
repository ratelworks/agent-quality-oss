// suite-coverage.test.mjs — tools.suite.md 무결성 게이트 (순수 node:test)
//
// 회귀 검증 정의(tests/tools.suite.md)가 실제 코드·실행체와 정합하는지 확인한다.
// 스위트 정의가 "허구의 도구"를 참조하거나 smoke 실행체와 어긋나면
// 검증 자산이 부패한다 — 이 게이트가 그 부패를 차단한다.
//
// 빌드 의존 최소화: build/ 산출물을 실행하지 않고 src 를 정적 파싱한다.
//   - 등록 도구 SSoT  : src/tool-registry.ts 의 LEGACY_MODULES + import 매핑 → src/tools/*.ts 의 spec.name
//   - suite 정의       : tests/tools.suite.md 의 `tool:` 필드 + uncovered_tools 블록
//   - 실행체(runner)   : scripts/smoke-test.ts 의 CASES 배열 `tool:` 필드
//
// 판정 원칙:
//   - 모순(suite 가 미등록 도구 참조 / smoke 와 도구집합 불일치 / smoke_case 수 불일치)  → FAIL
//   - 커버리지 부재(46개 중 일부 미커버)                                                 → 로그만 (점진 확장 대상, fail 아님)

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── 상수 (파일 최상단) ────────────────────────────────────────
const ROOT = resolve(import.meta.dirname, "..");
const REGISTRY_PATH = resolve(ROOT, "src/tool-registry.ts");
const TOOLS_DIR = resolve(ROOT, "src/tools");
const SUITE_PATH = resolve(ROOT, "tests/tools.suite.md");
const SMOKE_PATH = resolve(ROOT, "scripts/smoke-test.ts");
const EXPECTED_TOOL_COUNT = 52; // src/tool-registry.ts 헤더 SSoT (현재 52개)

// ── 정적 파싱 헬퍼 ────────────────────────────────────────────

// 1) tool-registry.ts → 등록된 도구의 spec.name 집합 (코드 SSoT)
//    import * as ALIAS from "./tools/FILE.js"  +  LEGACY_MODULES 배열 멤버(ALIAS) 를 교차해
//    실제 등록된 모듈 파일만 골라 각 파일의 spec.name 을 읽는다.
function readRegisteredToolNames() {
  const registry = readFileSync(REGISTRY_PATH, "utf8");

  // import alias → 파일 베이스명 매핑
  const importMap = new Map(); // alias -> file basename (확장자 제거)
  const importRe =
    /import\s+\*\s+as\s+(\w+)\s+from\s+["']\.\/tools\/([\w-]+)\.js["']/g;
  let m;
  while ((m = importRe.exec(registry)) !== null) {
    importMap.set(m[1], m[2]);
  }

  // LEGACY_MODULES 배열 본문 추출
  // 주의: 타입 주석 `ToolModuleLegacy[]` 의 [] 가 아니라 대입 `= [ ... ]` 의 배열을 잡아야 한다.
  const legacyStart = registry.indexOf("LEGACY_MODULES");
  const assignIdx = registry.indexOf("= [", legacyStart);
  const arrOpen = assignIdx === -1 ? -1 : assignIdx + 2; // '= [' 의 '[' 위치
  const arrClose = arrOpen === -1 ? -1 : registry.indexOf("]", arrOpen);
  assert.ok(
    legacyStart !== -1 && arrOpen !== -1 && arrClose !== -1,
    "tool-registry.ts 에서 LEGACY_MODULES 배열을 찾지 못했습니다",
  );
  const legacyBody = registry.slice(arrOpen + 1, arrClose);
  const registeredAliases = legacyBody
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\w+$/.test(s));

  // 각 등록 alias → 파일 → spec.name
  const names = [];
  const fileByName = new Map();
  for (const alias of registeredAliases) {
    const file = importMap.get(alias);
    assert.ok(
      file,
      `LEGACY_MODULES 의 '${alias}' 에 대응하는 import 를 찾지 못했습니다`,
    );
    const toolSrc = readFileSync(resolve(TOOLS_DIR, `${file}.ts`), "utf8");
    // 두 가지 도구 정의 패턴을 모두 지원:
    //   1) 일반 도구: export const spec: ToolSpec = { name: '...' }
    //   2) schema 팩토리: createSchemaTool({ toolName: '...' }) — spec.name = toolName
    const nameMatch = toolSrc.match(/(?:name|toolName):\s*["']([a-z_]+)["']/);
    assert.ok(
      nameMatch,
      `src/tools/${file}.ts 에서 spec name(name/toolName) 을 정적 파싱하지 못했습니다`,
    );
    names.push(nameMatch[1]);
    fileByName.set(nameMatch[1], file);
  }
  return { names, fileByName };
}

// 2) tools.suite.md → 케이스가 참조하는 도구 집합 + smoke_case 인덱스 + uncovered 선언
function readSuite() {
  const suite = readFileSync(SUITE_PATH, "utf8");

  // 케이스 블록의 tool: 필드 (uncovered_tools 의 "- name" 과 구분하기 위해 'tool:' 키만)
  const tools = [];
  const toolRe = /^tool:\s*([a-z_]+)\s*$/gm;
  let m;
  while ((m = toolRe.exec(suite)) !== null) tools.push(m[1]);

  // smoke_case: N 인덱스
  const smokeCases = [];
  const scRe = /^smoke_case:\s*(\d+)\s*$/gm;
  while ((m = scRe.exec(suite)) !== null) smokeCases.push(Number(m[1]));

  // id: TC-tools-NNN (중복 검사용)
  const ids = [];
  const idRe = /^id:\s*(TC-tools-\d+)\s*$/gm;
  while ((m = idRe.exec(suite)) !== null) ids.push(m[1]);

  // uncovered_tools 블록의 "- tool_name"
  const uncovered = [];
  const uncStart = suite.indexOf("uncovered_tools:");
  if (uncStart !== -1) {
    const uncBlock = suite.slice(uncStart);
    const uncRe = /^\s*-\s+([a-z_]+)\s*$/gm;
    while ((m = uncRe.exec(uncBlock)) !== null) uncovered.push(m[1]);
  }

  return { tools, smokeCases, ids, uncovered };
}

// 3) smoke-test.ts CASES → 실행체가 호출하는 도구 집합 (1-based 인덱스 순서 보존)
function readSmokeTools() {
  const smoke = readFileSync(SMOKE_PATH, "utf8");
  const start = smoke.indexOf("const CASES: Case[] = [");
  const end = smoke.indexOf("\nlet pass", start);
  assert.ok(
    start !== -1 && end !== -1,
    "smoke-test.ts 에서 CASES 배열 범위를 찾지 못했습니다",
  );
  const block = smoke.slice(start, end);
  const tools = [];
  const re = /^\s*tool:\s*['"]([a-z_]+)['"]/gm;
  let m;
  while ((m = re.exec(block)) !== null) tools.push(m[1]);
  return tools; // 인덱스 i (0-based) = smoke_case (i+1)
}

// ── 테스트 ────────────────────────────────────────────────────

test("(a) tools.suite.md 가 파싱되고 케이스가 존재한다", () => {
  const { tools, ids, smokeCases } = readSuite();
  assert.ok(tools.length > 0, "suite 에 tool: 필드를 가진 케이스가 없습니다");
  assert.ok(ids.length > 0, "suite 에 TC-tools-* id 가 없습니다");
  // 케이스 수 == tool 필드 수 == smoke_case 수 (각 케이스가 3요소를 모두 가짐)
  assert.strictEqual(
    tools.length,
    ids.length,
    `케이스 id 수(${ids.length}) 와 tool 필드 수(${tools.length}) 가 다릅니다`,
  );
  assert.strictEqual(
    tools.length,
    smokeCases.length,
    `tool 필드 수(${tools.length}) 와 smoke_case 수(${smokeCases.length}) 가 다릅니다`,
  );
});

test("(a') TC-tools-* id 가 유일하다 (중복 케이스 금지)", () => {
  const { ids } = readSuite();
  const seen = new Set();
  const dup = [];
  for (const id of ids) {
    if (seen.has(id)) dup.push(id);
    seen.add(id);
  }
  assert.deepStrictEqual(dup, [], `중복 id: ${dup.join(", ")}`);
});

test("(b) suite 가 참조하는 도구는 실제 등록된 46개 도구의 부분집합이다 (허구 도구 차단)", () => {
  const { names } = readRegisteredToolNames();
  const registered = new Set(names);
  const { tools, uncovered } = readSuite();

  // 케이스가 참조한 도구 + uncovered 선언 도구 모두 실제 등록 도구여야 한다
  const referenced = new Set([...tools, ...uncovered]);
  const ghosts = [...referenced].filter((t) => !registered.has(t));
  assert.deepStrictEqual(
    ghosts,
    [],
    `suite 가 미등록(존재하지 않는) 도구를 참조합니다: ${ghosts.join(", ")}`,
  );
});

test("(b') 등록 도구 수가 SSoT(52)와 일치한다", () => {
  const { names } = readRegisteredToolNames();
  assert.strictEqual(
    names.length,
    EXPECTED_TOOL_COUNT,
    `등록 도구 수 ${names.length} != SSoT ${EXPECTED_TOOL_COUNT} (tool-registry.ts 변경 시 이 상수도 갱신)`,
  );
});

test("(c) 46개 도구 중 회귀 케이스 보유/미보유를 집계해 출력한다 (silent 누락 금지)", () => {
  const { names } = readRegisteredToolNames();
  const registered = new Set(names);
  const { tools } = readSuite();
  const covered = new Set(tools.filter((t) => registered.has(t)));

  const coveredList = [...registered].filter((t) => covered.has(t)).sort();
  const uncoveredList = [...registered].filter((t) => !covered.has(t)).sort();

  console.log(
    `\n[suite-coverage] 등록 도구 ${registered.size}개 중 회귀 케이스 보유 ${coveredList.length}개 / 미보유 ${uncoveredList.length}개`,
  );
  if (uncoveredList.length > 0) {
    console.log("[suite-coverage] 미커버 도구 (점진 확장 대상):");
    for (const t of uncoveredList) console.log(`  - ${t}`);
  } else {
    console.log("[suite-coverage] 전 도구 커버 완료 ✅");
  }

  // 커버리지 부재 자체는 fail 이 아니다 (확장 대상). 집계가 동작하는지만 단언.
  assert.strictEqual(
    coveredList.length + uncoveredList.length,
    registered.size,
    "커버/미커버 집계가 등록 도구 총수와 맞지 않습니다",
  );
});

test("(c') suite 의 uncovered_tools 선언이 실제 미커버 도구와 정확히 일치한다 (선언 정합)", () => {
  const { names } = readRegisteredToolNames();
  const registered = new Set(names);
  const { tools, uncovered } = readSuite();
  const covered = new Set(tools.filter((t) => registered.has(t)));
  const actualUncovered = [...registered]
    .filter((t) => !covered.has(t))
    .sort();
  const declaredUncovered = [...uncovered].sort();

  // 선언이 누락/과잉되면 문서가 코드와 drift — 모순으로 차단
  assert.deepStrictEqual(
    declaredUncovered,
    actualUncovered,
    `suite 의 uncovered_tools 선언이 실제 미커버 도구와 다릅니다.\n` +
      `  선언: ${declaredUncovered.join(", ")}\n` +
      `  실제: ${actualUncovered.join(", ")}`,
  );
});

test("(d) suite 가 smoke-test.ts 실행체와 정합한다 (smoke_case → 도구 1:1 매핑)", () => {
  const smokeTools = readSmokeTools(); // index i(0-based) = smoke_case i+1
  const { tools, smokeCases } = readSuite();

  // smoke 케이스 총수 일치
  assert.strictEqual(
    tools.length,
    smokeTools.length,
    `suite 케이스 수(${tools.length}) 와 smoke CASES 수(${smokeTools.length}) 가 다릅니다 — ` +
      `한쪽만 추가/삭제되어 정의-실행체가 어긋났습니다`,
  );

  // 각 케이스의 (smoke_case 인덱스 → 도구)가 smoke 실행체의 해당 인덱스 도구와 일치
  const mismatches = [];
  for (let i = 0; i < tools.length; i++) {
    const sc = smokeCases[i]; // suite 가 선언한 smoke 인덱스 (1-based)
    const suiteTool = tools[i];
    const smokeTool = smokeTools[sc - 1];
    if (suiteTool !== smokeTool) {
      mismatches.push(
        `smoke_case ${sc}: suite="${suiteTool}" vs smoke="${smokeTool ?? "(없음)"}"`,
      );
    }
  }
  assert.deepStrictEqual(
    mismatches,
    [],
    `suite 의 smoke_case 매핑이 실행체와 어긋납니다:\n  ${mismatches.join("\n  ")}`,
  );

  // smoke_case 인덱스가 1..N 을 빠짐없이 덮는다 (누락/중복 인덱스 차단)
  const sortedSc = [...smokeCases].sort((a, b) => a - b);
  const expected = Array.from({ length: smokeTools.length }, (_, i) => i + 1);
  assert.deepStrictEqual(
    sortedSc,
    expected,
    "smoke_case 인덱스가 1..N 을 연속으로 덮지 않습니다 (누락 또는 중복)",
  );
});
