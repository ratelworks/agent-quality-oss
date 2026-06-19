#!/usr/bin/env tsx
/**
 * check-doc-code-sync.ts — 문서·코드 SSoT drift 자동 검출
 *
 * 코드에서 직접 추출한 정답값(version / 도구 수 / 그래프 노드·관계 수 /
 * 양식 종수 / smoke 케이스 수 / 근거등급 enum)과
 * README/SECURITY/docs/주석의 표기를 비교하여 불일치를 차단한다.
 * release 전 prepublishOnly 에 추가하여 drift 를 publish 전에 잡는다.
 *
 * SSoT 정답값:
 *   - version           : package.json 의 version
 *   - versionTs         : src/version.ts 의 export const VERSION
 *   - toolCount         : build/tool-registry.js 의 TOOL_DEFS.length (env override 가능)
 *   - nodeCount         : src/ontology/graph/nodes/ 하위 *.jsonld 파일 수
 *   - relationCount     : 그래프 로드 후 관계(엣지) 총수 (build/ontology 산출물 dynamic import, env override 가능)
 *   - formCount         : src/tools/get-*-schema.ts 파일 수 (문서 양식 종수, env override 가능)
 *   - smokeCount        : scripts/smoke-test.ts 의 CASES 배열 길이 (정적 파싱, env override 가능)
 *   - sourceStatusGrades: 노드 *.jsonld 의 _meta.sourceStatus 에 실제 등장하는 등급 집합 (env override 가능)
 *
 * env override (test fixture 전용 — DOC_SYNC_ROOT 동반 시에만 적용. production 은 항상 실측):
 *   - DOC_SYNC_TOOLCOUNT     : toolCount 주입 (build/tool-registry.js 우회)
 *   - DOC_SYNC_RELATIONCOUNT : relationCount 주입 (build/ontology import 우회)
 *   - DOC_SYNC_FORMCOUNT     : formCount 주입 (src/tools 파일수 산정 우회)
 *   - DOC_SYNC_SMOKECOUNT    : smokeCount 주입 (smoke-test.ts 파싱 우회)
 *   - DOC_SYNC_SOURCESTATUS  : sourceStatusGrades 주입 (쉼표 구분, 노드 jsonld 파싱 우회)
 *   fixture(임시 디렉토리, build·src 없음)가 SSoT 를 주입해 정합/불일치 시나리오를 테스트하기 위함.
 *
 * 검출 항목 (README / SECURITY / docs/** / src/**.ts 주석 순회. CHANGELOG 는 히스토리라 제외):
 *   1. (HIGH)   src/version.ts VERSION  != package.json version             → stale_version_ts
 *   2. (HIGH)   README badge release-vX.Y.Z != version                       → stale_release_badge
 *   3. (HIGH)   README badge MCP%20tools-N  != toolCount                     → stale_tool_count_badge
 *   4. (HIGH)   본문 "(MCP )?도구 N개"       != toolCount                     → stale_tool_count
 *   5. (MEDIUM) 본문 "그래프 노드 N개"        != nodeCount                     → stale_node_count
 *   6. (HIGH)   본문 "(패키지 버전: X.Y.Z)"   != version                       → stale_pkg_version
 *   7. (HIGH)   SECURITY 지원 버전 표 "| N.N.x | ✅" minor != version minor    → stale_supported_minor
 *   8. (HIGH)   SECURITY "현재 …(vX.Y.Z)"   != version                       → stale_current_version
 *   9. (HIGH)   근거등급 표에 실사용 등급 누락                                  → missing_source_status_grade
 *  10. (MEDIUM) 본문 "관계 N개" / "관계 N"    != relationCount                 → stale_relation_count
 *  11. (HIGH)   양식 문맥의 "N종"            != formCount                     → stale_form_count
 *  12. (MEDIUM) smoke "N/M 통과"            != smokeCount(분자·분모)          → stale_smoke_count
 *
 * file-only 작성 — 빌드/실행은 별도. dynamic import 사용으로 tsx(ESM) 실행 전제.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ============================================================
// 0) 상수 (파일 최상단)
// ============================================================
const __dirname = fileURLToPath(new URL(".", import.meta.url));
// ROOT — env override 허용 (negative test 가 fixture 디렉토리를 먹이기 위함)
const ROOT = process.env.DOC_SYNC_ROOT
  ? resolve(process.env.DOC_SYNC_ROOT)
  : resolve(__dirname, "..", "..");

// 검사 제외 디렉토리 (자동 생성 산출물·git·캐시·테스트 자산).
// tests/ 제외 이유: 테스트 fixture·완료신호(test-results.json)는 의도적으로 drift 값
// (release-v9.9.9 / MCP%20tools-99 등)을 담으므로 문서 SSoT 정합 검사 대상이 아니다(자기참조 오탐 방지).
const EXCLUDED_DIRS = ["node_modules", "build", "dist", ".git", "coverage", ".cache", "tests"];

// 검사 대상 확장자
const SCAN_EXTENSIONS = /\.(md|ts|json)$/;

// .json 중 수치 표기가 없어 검사에서 제외할 파일명
const EXCLUDED_JSON = ["package.json", "package-lock.json", "tsconfig.json"];

// 게이트 자기 자신 — 정규식이 자기 매칭되므로 scanFile 에서 skip
const SELF_FILE = "check-doc-code-sync.ts";

// 그래프 노드 디렉토리 (nodeCount 산정 대상)
const NODES_DIR = "src/ontology/graph/nodes";

// 양식 종수(formCount) 산정 대상 디렉토리 — get-*-schema.ts 파일 수
const TOOLS_DIR = "src/tools";
const FORM_SCHEMA_FILE = /^get-.+-schema\.ts$/;

// 양식 종수("N종") 검사(검출 11)의 대상 = 사용자 노출 표면만.
//   README/SECURITY/docs/** 와 src/tools/**.ts(도구 description) 는 MCP 클라이언트·LLM·사용자가
//   직접 보는 표기이므로 전체 양식 종수와 정합해야 한다.
//   반면 scripts/ 내부 유틸(_audit-legal-docs.ts 의 "위 8종" = 감사 대상 법정문서 부분집합 등)은
//   양식 전체 종수 주장이 아니라 부분·맥락 수치이므로 검사 대상에서 제외한다(오탐 방지).
const FORM_COUNT_SURFACE = [
  /^README\.md$/,
  /^SECURITY\.md$/,
  /^docs\//,
  /^src\/tools\/.+\.ts$/,
];

// rel(ROOT 기준 상대경로)이 양식 종수 검사 대상(사용자 노출 표면)인가
function isFormCountSurface(rel: string): boolean {
  return FORM_COUNT_SURFACE.some((re) => re.test(rel));
}

// smoke 케이스 수(smokeCount) 산정 대상 파일
const SMOKE_TEST_FILE = "scripts/smoke-test.ts";
// CASES 배열 내 최상위 케이스의 "tool:" 속성 행 (4칸 들여쓰기 + tool 키).
// 중첩 assert 안의 risk:{id} 등과 구분되도록 행 시작 들여쓰기로 고정한다.
const SMOKE_CASE_LINE = /^ {4}tool:\s*['"]/;

// 관계 수 산정에 사용할 build 산출물 (loader/graph dynamic import).
// validate-ontology.ts·audit 와 동일한 경로로 관계 총수를 센다.
const BUILD_LOADER = "build/ontology/loader.js";
const BUILD_GRAPH = "build/ontology/graph.js";

// 본문 수치 검사(도구/노드/패키지 버전/관계/양식 등) 에서 제외할 "역사 표기" 마커.
// ROADMAP 의 「초기 상태」 스냅샷처럼 의도적으로 보존된 과거 수치를 drift 로 오판하지 않기 위함.
// badge 검사(README)는 절대 역사 표기가 될 수 없으므로 이 가드를 적용하지 않는다 (항상 strict).
const HISTORY_MARKERS = [
  "초기 상태",
  "초기 라운드",
  "시점 기록",
  "이력",
  "이전",
  "종전",
  "당시",
  "구버전",
];

// 라인이 역사 표기인가 (본문 수치 검사 skip 판단)
function isHistoricalLine(line: string): boolean {
  if (HISTORY_MARKERS.some((m) => line.includes(m))) return true;
  // "36 ~ 54", "9/19" 같은 범위·진행 표기도 현재 단일값 단정이 아니므로 제외
  if (/\d+\s*~\s*\d+/.test(line)) return true;
  return false;
}

interface DriftIssue {
  severity: "HIGH" | "MEDIUM" | "LOW";
  category: string;
  file: string;
  line?: number;
  expected: string;
  found: string;
  hint?: string;
}

const issues: DriftIssue[] = [];

// SSoT 정답값 형태 — scanFile 에 넘기는 묶음.
interface SSoT {
  version: string;
  versionTs: string | null;
  toolCount: number;
  nodeCount: number;
  relationCount: number;
  formCount: number;
  smokeCount: number;
  sourceStatusGrades: string[];
}

// ============================================================
// 1) 디렉토리 순회 유틸
// ============================================================

// 검사 대상 파일 수집 (재귀)
function walk(dir: string, files: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const e of entries) {
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (EXCLUDED_DIRS.includes(e)) continue;
      walk(full, files);
    } else {
      if (!SCAN_EXTENSIONS.test(e)) continue;
      // 수치 표기 없는 설정성 .json 제외
      if (e.endsWith(".json") && EXCLUDED_JSON.includes(e)) continue;
      files.push(full);
    }
  }
  return files;
}

// *.jsonld 파일 수 재귀 카운트 (그래프 노드 수 산정)
function countJsonld(dir: string): number {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  let count = 0;
  for (const e of entries) {
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      count += countJsonld(full);
    } else if (e.endsWith(".jsonld")) {
      count += 1;
    }
  }
  return count;
}

// src/tools/get-*-schema.ts 파일 수 카운트 (양식 종수 산정)
function countFormSchemas(dir: string): number {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  let count = 0;
  for (const e of entries) {
    if (FORM_SCHEMA_FILE.test(e)) count += 1;
  }
  return count;
}

// scripts/smoke-test.ts 의 CASES 배열 길이 정적 파싱.
// 런타임 실행 없이 "최상위 케이스 tool: 행" 수를 세어 결정론적으로 산정한다.
function countSmokeCases(file: string): number {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return 0;
  }
  let count = 0;
  for (const line of text.split("\n")) {
    if (SMOKE_CASE_LINE.test(line)) count += 1;
  }
  return count;
}

// 노드 *.jsonld 의 _meta.sourceStatus 에 실제 등장하는 등급 distinct 집합.
// JSON 파싱으로 정확히 추출 (정규식 누락 방지). 정렬해 결정론 출력.
function collectSourceStatusGrades(dir: string, acc: Set<string> = new Set()): Set<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      collectSourceStatusGrades(full, acc);
    } else if (e.endsWith(".jsonld")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(full, "utf8"));
      } catch {
        continue;
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const meta = (parsed as Record<string, unknown>)["_meta"];
        if (meta && typeof meta === "object" && !Array.isArray(meta)) {
          const grade = (meta as Record<string, unknown>)["sourceStatus"];
          if (typeof grade === "string" && grade.trim()) acc.add(grade.trim());
        }
      }
    }
  }
  return acc;
}

// ============================================================
// 2) SSoT 정답값 추출 (코드에서 직접)
// ============================================================
async function resolveSSoT(): Promise<SSoT> {
  // version — package.json
  const pkgPath = resolve(ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const version: string = pkg.version;

  // versionTs — src/version.ts 의 VERSION 상수
  let versionTs: string | null = null;
  const versionTsPath = resolve(ROOT, "src/version.ts");
  if (existsSync(versionTsPath)) {
    const m = readFileSync(versionTsPath, "utf8").match(
      /export const VERSION = "(\d+\.\d+\.\d+)"/,
    );
    versionTs = m ? (m[1] ?? null) : null;
  }

  // toolCount — test fixture 전용 override(ROOT override 동반 시만), 그 외엔 build/tool-registry.js 의 TOOL_DEFS.length
  //   production(DOC_SYNC_ROOT 미설정 = 실제 repo) 에서는 DOC_SYNC_TOOLCOUNT 가 stale 로 남아 있어도
  //   무시하고 build 산출물을 강제로 import 한다 → 진짜 TOOL_DEFS.length drift 를 놓치지 않는다.
  let toolCount: number;
  if (process.env.DOC_SYNC_TOOLCOUNT && process.env.DOC_SYNC_ROOT) {
    toolCount = parseInt(process.env.DOC_SYNC_TOOLCOUNT, 10);
  } else {
    const registryPath = resolve(ROOT, "build/tool-registry.js");
    if (!existsSync(registryPath)) {
      console.error(
        "build/ 가 없습니다. 'npm run build' 후 실행하세요 (TOOL_DEFS 산정에 컴파일 산출물이 필요).",
      );
      process.exit(1);
    }
    const mod = await import(pathToFileURL(registryPath).href);
    if (!mod.TOOL_DEFS || !Array.isArray(mod.TOOL_DEFS)) {
      console.error(
        "build/tool-registry.js 에서 TOOL_DEFS 배열을 찾지 못했습니다. 빌드 산출물을 확인하세요.",
      );
      process.exit(1);
    }
    toolCount = mod.TOOL_DEFS.length;
  }

  // nodeCount — src/ontology/graph/nodes/ 하위 *.jsonld 재귀 카운트
  const nodeCount = countJsonld(resolve(ROOT, NODES_DIR));

  // relationCount — test fixture 전용 override(ROOT override 동반 시만), 그 외엔 그래프 로드 실측.
  //   fixture(임시 디렉토리)엔 build/ontology 산출물이 없어 resolveRelationCount 가 process.exit 로
  //   죽으므로, fixture 모드에서는 env 값을 주입해 dynamic import 자체를 건너뛴다.
  //   production(DOC_SYNC_ROOT 미설정 = 실제 repo) 에서는 env 를 무시하고 build 산출물을 강제 import →
  //   진짜 관계 수 drift 를 놓치지 않는다. (toolCount 와 동일 원칙)
  //   실측 경로: loadOntologySync() + OntologyGraph(data).stats().relations
  //   (validate-ontology.ts·audit 와 동일. 'npm run build' 선행, build 부재 시 명확히 에러.)
  let relationCount: number;
  if (process.env.DOC_SYNC_RELATIONCOUNT && process.env.DOC_SYNC_ROOT) {
    relationCount = parseInt(process.env.DOC_SYNC_RELATIONCOUNT, 10);
  } else {
    relationCount = await resolveRelationCount(nodeCount);
  }

  // formCount — test fixture 전용 override(ROOT override 동반 시만), 그 외엔 src/tools/get-*-schema.ts 파일 수.
  //   production 에서는 env 를 무시하고 항상 파일 수 실측 (toolCount 와 동일 원칙).
  let formCount: number;
  if (process.env.DOC_SYNC_FORMCOUNT && process.env.DOC_SYNC_ROOT) {
    formCount = parseInt(process.env.DOC_SYNC_FORMCOUNT, 10);
  } else {
    formCount = countFormSchemas(resolve(ROOT, TOOLS_DIR));
  }

  // smokeCount — test fixture 전용 override(ROOT override 동반 시만), 그 외엔 smoke-test.ts CASES 배열 길이.
  //   production 에서는 env 를 무시하고 항상 정적 파싱 실측 (toolCount 와 동일 원칙).
  let smokeCount: number;
  if (process.env.DOC_SYNC_SMOKECOUNT && process.env.DOC_SYNC_ROOT) {
    smokeCount = parseInt(process.env.DOC_SYNC_SMOKECOUNT, 10);
  } else {
    smokeCount = countSmokeCases(resolve(ROOT, SMOKE_TEST_FILE));
  }

  // sourceStatusGrades — test fixture 전용 override(ROOT override 동반 시만), 그 외엔 노드 jsonld 실측.
  //   env 는 쉼표 구분 문자열을 받아 trim·빈값 제거·정렬한다(실측 경로와 동일하게 정렬 결정론 유지).
  //   production 에서는 env 를 무시하고 항상 노드 *.jsonld 의 _meta.sourceStatus distinct 집합 실측.
  let sourceStatusGrades: string[];
  if (process.env.DOC_SYNC_SOURCESTATUS && process.env.DOC_SYNC_ROOT) {
    sourceStatusGrades = process.env.DOC_SYNC_SOURCESTATUS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
  } else {
    sourceStatusGrades = [
      ...collectSourceStatusGrades(resolve(ROOT, NODES_DIR)),
    ].sort();
  }

  return {
    version,
    versionTs,
    toolCount,
    nodeCount,
    relationCount,
    formCount,
    smokeCount,
    sourceStatusGrades,
  };
}

// 관계 총수 산정 — build/ontology 산출물(loader/graph)을 dynamic import.
//   toolCount 의 build 강제 import 패턴과 동일. build 부재 시 명확히 에러로 중단.
async function resolveRelationCount(nodeCount: number): Promise<number> {
  const loaderPath = resolve(ROOT, BUILD_LOADER);
  const graphPath = resolve(ROOT, BUILD_GRAPH);
  if (!existsSync(loaderPath) || !existsSync(graphPath)) {
    console.error(
      `build/ontology 산출물이 없습니다 (${BUILD_LOADER} / ${BUILD_GRAPH}). 'npm run build' 후 실행하세요 (관계 수 산정에 컴파일 산출물이 필요).`,
    );
    process.exit(1);
  }

  const loaderMod = await import(pathToFileURL(loaderPath).href);
  const graphMod = await import(pathToFileURL(graphPath).href);
  if (typeof loaderMod.loadOntologySync !== "function") {
    console.error(
      "build/ontology/loader.js 에서 loadOntologySync 를 찾지 못했습니다. 빌드 산출물을 확인하세요.",
    );
    process.exit(1);
  }
  if (typeof graphMod.OntologyGraph !== "function") {
    console.error(
      "build/ontology/graph.js 에서 OntologyGraph 를 찾지 못했습니다. 빌드 산출물을 확인하세요.",
    );
    process.exit(1);
  }

  // build/ontology 산출물은 기본적으로 build 기준 노드 디렉토리를 본다.
  // 이 repo(ROOT)의 src 노드를 SSoT 로 강제하기 위해 QUALITY_NODES_DIR 를 명시 지정.
  const data = loaderMod.loadOntologySync({
    nodesDir: resolve(ROOT, NODES_DIR),
  });
  const graph = new graphMod.OntologyGraph(data);
  const stats = graph.stats();
  const relations = stats?.relations;
  if (typeof relations !== "number") {
    console.error(
      "OntologyGraph.stats().relations 가 숫자가 아닙니다. 빌드 산출물을 확인하세요.",
    );
    process.exit(1);
  }
  return relations;
}

// ============================================================
// 3) 파일별 표기 검사
// ============================================================
function scanFile(file: string, ssot: SSoT) {
  // 게이트 자기 자신·CHANGELOG(히스토리) 제외
  if (file.includes(SELF_FILE)) return;
  if (file.includes("CHANGELOG.md")) return;
  // ROADMAP 은 라운드별 시계열 문서 — 과거(초기 상태)·현재·목표 수치가 공존한다.
  // 문서 스스로 "최신 수치의 SSoT 는 README·CHANGELOG" 라 명시(ROADMAP.md line 12) →
  // 본문 수치 정합 강제 대상이 아니므로 통째 제외(현재값 정합은 README/SECURITY/docs 가 책임).
  if (file.includes("ROADMAP.md")) return;
  // plan.md 도 ROADMAP 과 같은 시계열 계획 문서 — "Phase4 양식 스키마 5종" 같은
  // 부분집합·계획 단계 수치를 담는다. 전체 양식 종수 정합 대상이 아니므로 통째 제외.
  if (file.includes("plan.md")) return;

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  const lines = text.split("\n");
  const rel = file.startsWith(ROOT + "/") ? file.slice(ROOT.length + 1) : file;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const lineNo = i + 1;

    // === 검출 2: README badge release-vX.Y.Z (HIGH) ===
    const badgeMatch = line.match(/release-v(\d+\.\d+\.\d+)/);
    if (badgeMatch && badgeMatch[1] !== ssot.version) {
      issues.push({
        severity: "HIGH",
        category: "stale_release_badge",
        file: rel,
        line: lineNo,
        expected: `release-v${ssot.version}`,
        found: `release-v${badgeMatch[1]}`,
        hint: "README badge release-v 가 package.json version 과 불일치. release bump 시 동기화 필수.",
      });
    }

    // === 검출 3: README badge MCP%20tools-N (HIGH) ===
    const toolBadgeMatch = line.match(/MCP%20tools-(\d+)/);
    const toolBadgeN = toolBadgeMatch?.[1];
    if (toolBadgeN && parseInt(toolBadgeN, 10) !== ssot.toolCount) {
      issues.push({
        severity: "HIGH",
        category: "stale_tool_count_badge",
        file: rel,
        line: lineNo,
        expected: `MCP%20tools-${ssot.toolCount}`,
        found: `MCP%20tools-${toolBadgeMatch[1]}`,
        hint: "README badge MCP tools 수가 TOOL_DEFS.length 와 불일치. 도구 추가/제거 시 동기화 필수.",
      });
    }

    // === 검출 4: 본문 "(MCP )?도구 N개" (HIGH) ===
    // "MCP 도구 46개" / "도구 **46개**" / "도구 46개 목록" / "도구(46개)" / "도구（46개）" 모두 매치.
    //   [(（]? 로 여는 괄호(반각·전각)를 선택 허용 — docs/SETUP 의 "도구(46개)" 표기 포착.
    // 역사 표기 라인(ROADMAP 「초기 상태」 등)은 제외 — 의도 보존된 과거 수치.
    const toolBodyMatch = line.match(/(?:MCP )?도구\s*[(（]?\s*\*{0,2}(\d+)개/);
    const toolBodyN = toolBodyMatch?.[1];
    if (
      toolBodyN &&
      !isHistoricalLine(line) &&
      parseInt(toolBodyN, 10) !== ssot.toolCount
    ) {
      issues.push({
        severity: "HIGH",
        category: "stale_tool_count",
        file: rel,
        line: lineNo,
        expected: `도구 ${ssot.toolCount}개`,
        found: `도구 ${toolBodyMatch[1]}개`,
        hint: "본문의 도구 수가 TOOL_DEFS.length 와 불일치. 도구 추가/제거 시 본문 표기도 갱신.",
      });
    }

    // === 검출 5: 본문 "그래프 노드 N개" (MEDIUM) ===
    const nodeBodyMatch = line.match(/그래프 노드\s*\*{0,2}(\d+)개/);
    const nodeBodyN = nodeBodyMatch?.[1];
    if (
      nodeBodyN &&
      !isHistoricalLine(line) &&
      parseInt(nodeBodyN, 10) !== ssot.nodeCount
    ) {
      issues.push({
        severity: "MEDIUM",
        category: "stale_node_count",
        file: rel,
        line: lineNo,
        expected: `그래프 노드 ${ssot.nodeCount}개`,
        found: `그래프 노드 ${nodeBodyMatch[1]}개`,
        hint: "본문의 그래프 노드 수가 src/ontology/graph/nodes/ 의 *.jsonld 실측과 불일치.",
      });
    }

    // === 검출 6: 본문 "(패키지 버전: X.Y.Z)" (HIGH) ===
    const pkgVerMatch = line.match(/\(패키지 버전:\s*(\d+\.\d+\.\d+)\)/);
    if (pkgVerMatch && !isHistoricalLine(line) && pkgVerMatch[1] !== ssot.version) {
      issues.push({
        severity: "HIGH",
        category: "stale_pkg_version",
        file: rel,
        line: lineNo,
        expected: `(패키지 버전: ${ssot.version})`,
        found: `(패키지 버전: ${pkgVerMatch[1]})`,
        hint: "본문의 '(패키지 버전: …)' 표기가 package.json version 과 불일치.",
      });
    }

    // === 검출 7: SECURITY 지원 버전 표 행 "| N.N.x | ✅ ..." (HIGH) ===
    //   ✅ 지원 행은 항상 현재 minor 를 가리키므로 SSoT version 의 minor 와 일치해야 한다.
    //   (✅ 표 행은 본질적으로 현재 상태이므로 역사 가드를 적용하지 않는다 — safety 레퍼런스 동일.)
    const supportedRowMatch = line.match(/^\|\s*(\d+\.\d+)\.x\s*\|\s*✅/);
    if (supportedRowMatch) {
      const ssotMinor = ssot.version.split(".").slice(0, 2).join(".");
      if (supportedRowMatch[1] !== ssotMinor) {
        issues.push({
          severity: "HIGH",
          category: "stale_supported_minor",
          file: rel,
          line: lineNo,
          expected: `${ssotMinor}.x`,
          found: `${supportedRowMatch[1]}.x`,
          hint: "SECURITY 지원 버전 표의 ✅ minor 가 package.json minor 와 불일치. release bump 시 갱신.",
        });
      }
    }

    // === 검출 8: SECURITY 본문 "현재 ... (vX.Y.Z)" (HIGH) ===
    //   "현재 공개 준비판 (v0.3.0)" · "현재 버전(v0.3.0)" 둘 다 매치.
    //   [^()\n]* 로 첫 여는 괄호 앞까지만 소비 → 현재 표현 직후의 (vX.Y.Z) 만 포착.
    //   역사 표기 라인(이전/종전 등)은 제외.
    const currentVerMatch = line.match(/현재[^()\n]*\(v(\d+\.\d+\.\d+)\)/);
    const currentVer = currentVerMatch?.[1];
    if (
      currentVer &&
      !isHistoricalLine(line) &&
      currentVer !== ssot.version
    ) {
      issues.push({
        severity: "HIGH",
        category: "stale_current_version",
        file: rel,
        line: lineNo,
        expected: ssot.version,
        found: currentVer,
        hint: "SECURITY 등 본문의 '현재 …(vX.Y.Z)' 표기가 package.json version 과 불일치.",
      });
    }

    // === 검출 10: 본문 "관계 N개" / "관계 N" (MEDIUM) ===
    //   "관계 **930개**"(노드·관계가 한 줄에 공존, line 61) 와 "관계 930"(line 222) 둘 다 포착.
    //   `관계` 직후 숫자가 와야만 매치 → "관계 추론"·"관계명"·"관계 정의" 같은 서술 표현은 미매치.
    //   같은 라인의 노드 수(검출 5)와는 정규식 키워드가 달라 충돌하지 않는다.
    const relationBodyMatch = line.match(/관계\s*\*{0,2}(\d+)\s*개?\*{0,2}/);
    const relationBodyN = relationBodyMatch?.[1];
    if (
      relationBodyN &&
      !isHistoricalLine(line) &&
      parseInt(relationBodyN, 10) !== ssot.relationCount
    ) {
      issues.push({
        severity: "MEDIUM",
        category: "stale_relation_count",
        file: rel,
        line: lineNo,
        expected: `관계 ${ssot.relationCount}`,
        found: `관계 ${relationBodyMatch[1]}`,
        hint: "본문의 관계 수가 그래프 관계 총수(loadOntologySync + OntologyGraph.stats().relations)와 불일치.",
      });
    }

    // === 검출 11: 양식 문맥의 "N종" (HIGH) ===
    //   "문서 양식 구조 19종" / "양식 19종" / "문서 양식 구조(19종)" / "... 등 19종"(양식 나열 줄) 포착.
    //   라인에 `양식` 이 있을 때만 검사 → "공종(WorkType) 19종"(WorkType 수, line 61)은 양식이 없어 제외.
    //   사용자 노출 표면(README/SECURITY/docs/**/src/tools/**.ts)만 검사 → scripts/ 내부 유틸의
    //   부분·맥락 수치("위 8종" 등)는 양식 전체 종수 주장이 아니므로 제외(오탐 방지).
    //   역사·범위 표기(점진 확장 표기 등)는 isHistoricalLine 으로 별도 처리(현재 단정 표기만 검사).
    if (isFormCountSurface(rel) && line.includes("양식")) {
      const formMatch = line.match(/[(（]?\s*\*{0,2}(\d+)\s*종/);
      const formN = formMatch?.[1];
      if (
        formN &&
        !isHistoricalLine(line) &&
        parseInt(formN, 10) !== ssot.formCount
      ) {
        issues.push({
          severity: "HIGH",
          category: "stale_form_count",
          file: rel,
          line: lineNo,
          expected: `${ssot.formCount}종`,
          found: `${formMatch[1]}종`,
          hint: "본문의 양식 종수가 src/tools/get-*-schema.ts 파일 수와 불일치. 양식 추가/제거 시 본문 표기도 갱신.",
        });
      }
    }

    // === 검출 12: smoke "N/M 통과" (MEDIUM) ===
    //   "smoke 회귀: 86/86 통과" 처럼 smoke·회귀 문맥의 "분자/분모 통과" 표기 포착.
    //   분자·분모 모두 smokeCount 와 일치해야 한다(둘 중 하나라도 어긋나면 drift).
    //   smoke·회귀 키워드가 있는 라인으로 한정 → 무관한 "N/N 통과" 오탐 방지.
    if ((line.includes("smoke") || line.includes("회귀")) && !isHistoricalLine(line)) {
      const smokeMatch = line.match(/(\d+)\s*\/\s*(\d+)\s*통과/);
      const smokeNum = smokeMatch?.[1];
      const smokeDen = smokeMatch?.[2];
      if (
        smokeNum &&
        smokeDen &&
        (parseInt(smokeNum, 10) !== ssot.smokeCount ||
          parseInt(smokeDen, 10) !== ssot.smokeCount)
      ) {
        issues.push({
          severity: "MEDIUM",
          category: "stale_smoke_count",
          file: rel,
          line: lineNo,
          expected: `${ssot.smokeCount}/${ssot.smokeCount} 통과`,
          found: `${smokeMatch[1]}/${smokeMatch[2]} 통과`,
          hint: "본문의 smoke 통과 수가 scripts/smoke-test.ts 의 CASES 배열 길이와 불일치. 케이스 추가/제거 시 본문 표기도 갱신.",
        });
      }
    }
  }
}

// 근거등급 enum 정합 검사 (검출 9, HIGH) — 라인 순회와 별개로 README 표 전체를 1회 검사.
//   SSoT(노드 _meta.sourceStatus 실사용 등급) 중 README "신뢰성 — 근거 등급" 표에
//   누락된 등급이 있으면 HIGH. (역으로 표에만 있고 미사용인 등급은 미래 대비 허용 → 무시.)
//   README 표 행 형식: "| `verified` | ..." — 코드펜스로 감싼 등급 코드를 추출.
function checkSourceStatusGrades(ssot: SSoT) {
  const readmePath = resolve(ROOT, "README.md");
  if (!existsSync(readmePath)) return;
  let text: string;
  try {
    text = readFileSync(readmePath, "utf8");
  } catch {
    return;
  }

  // README 표에 코드펜스(`등급`)로 나열된 등급 코드 집합 추출.
  //   "| `verified` |" 같은 표 행의 백틱 안 토큰만 수집한다.
  const declared = new Set<string>();
  for (const line of text.split("\n")) {
    // 표 행(파이프로 시작)에서만 백틱 코드 추출 → 본문 인라인 코드 오수집 방지.
    if (!line.trimStart().startsWith("|")) continue;
    const m = line.match(/^\|\s*`([a-z_]+)`\s*\|/);
    if (m && m[1]) declared.add(m[1]);
  }

  // 실사용 등급(SSoT) 중 README 표에 누락된 것 → HIGH.
  for (const grade of ssot.sourceStatusGrades) {
    if (!declared.has(grade)) {
      issues.push({
        severity: "HIGH",
        category: "missing_source_status_grade",
        file: "README.md",
        expected: `근거 등급 표에 \`${grade}\` 행 존재`,
        found: `\`${grade}\` 누락 (노드 _meta.sourceStatus 에는 사용 중)`,
        hint: "노드에서 실제 쓰이는 근거 등급이 README '신뢰성 — 근거 등급' 표에 없습니다. 사용자가 모르는 등급으로 응답이 나가지 않도록 표에 추가하세요.",
      });
    }
  }
}

// ============================================================
// 4) 실행
// ============================================================
async function main() {
  const ssot = await resolveSSoT();

  // 검출 1: src/version.ts VERSION != package.json version (HIGH)
  //   런타임 MCP 선언·CLI 배너가 옛 버전을 표시하는 사고 방지.
  if (ssot.versionTs === null || ssot.versionTs !== ssot.version) {
    issues.push({
      severity: "HIGH",
      category: "stale_version_ts",
      file: "src/version.ts",
      expected: ssot.version,
      found: ssot.versionTs ?? "(VERSION 상수 미검출)",
      hint: "src/version.ts 의 VERSION 이 package.json version 과 불일치 — release bump 시 두 파일 동시 갱신 필수.",
    });
  }

  // 검출 9: 근거등급 enum 정합 (README 표 1회 검사)
  checkSourceStatusGrades(ssot);

  // 검출 2~8, 10~12: 파일 순회
  const files = walk(ROOT);
  for (const f of files) scanFile(f, ssot);

  // ── 출력 ──────────────────────────────────────────────────
  const grouped = issues.reduce(
    (acc, i) => {
      (acc[i.severity] = acc[i.severity] || []).push(i);
      return acc;
    },
    {} as Record<string, DriftIssue[]>,
  );

  console.log("doc-code SSoT drift 검증");
  console.log("SSoT 기준값:");
  console.log(`  - version:        ${ssot.version}`);
  console.log(`  - toolCount:      ${ssot.toolCount}`);
  console.log(`  - nodeCount:      ${ssot.nodeCount}`);
  console.log(`  - relationCount:  ${ssot.relationCount}`);
  console.log(`  - formCount:      ${ssot.formCount}`);
  console.log(`  - smokeCount:     ${ssot.smokeCount}`);
  console.log(`  - sourceStatus:   ${ssot.sourceStatusGrades.join(", ")}`);
  console.log();
  console.log("발견 issues:");
  console.log(`  HIGH:   ${(grouped.HIGH || []).length}`);
  console.log(`  MEDIUM: ${(grouped.MEDIUM || []).length}`);
  console.log(`  LOW:    ${(grouped.LOW || []).length}`);
  console.log();

  for (const sev of ["HIGH", "MEDIUM", "LOW"] as const) {
    const list = grouped[sev] || [];
    if (list.length === 0) continue;
    console.log(`[${sev}] ${list.length}건`);
    // 카테고리별 그룹
    const byCat = list.reduce(
      (acc, i) => {
        (acc[i.category] = acc[i.category] || []).push(i);
        return acc;
      },
      {} as Record<string, DriftIssue[]>,
    );
    for (const [cat, items] of Object.entries(byCat)) {
      console.log(`  [${cat}] ${items.length}건`);
      for (const item of items.slice(0, 5)) {
        console.log(
          `    · ${item.file}:${item.line ?? "-"} — 기대 ${item.expected} / 발견 ${item.found}`,
        );
      }
      if (items.length > 5) console.log(`    ... 외 ${items.length - 5}건`);
    }
    console.log();
  }

  if ((grouped.HIGH || []).length > 0) {
    console.error(`✗ HIGH ${(grouped.HIGH || []).length} 건 발견. release blocker.`);
    process.exit(1);
  }
  console.log("✓ HIGH 0 건 — release OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
