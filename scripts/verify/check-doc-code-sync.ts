#!/usr/bin/env tsx
/**
 * check-doc-code-sync.ts — 문서·코드 SSoT drift 자동 검출
 *
 * 코드에서 직접 추출한 정답값(version / 도구 수 / 그래프 노드 수)과
 * README/SECURITY/docs/주석의 표기를 비교하여 불일치를 차단한다.
 * release 전 prepublishOnly 에 추가하여 drift 를 publish 전에 잡는다.
 *
 * SSoT 정답값:
 *   - version    : package.json 의 version
 *   - versionTs  : src/version.ts 의 export const VERSION
 *   - toolCount  : build/tool-registry.js 의 TOOL_DEFS.length (env override 가능)
 *   - nodeCount  : src/ontology/graph/nodes/ 하위 *.jsonld 파일 수
 *
 * 검출 항목 (README / SECURITY / docs/** / src/**.ts 주석 순회. CHANGELOG 는 히스토리라 제외):
 *   1. (HIGH)   src/version.ts VERSION  != package.json version         → stale_version_ts
 *   2. (HIGH)   README badge release-vX.Y.Z != version                   → stale_release_badge
 *   3. (HIGH)   README badge MCP%20tools-N  != toolCount                 → stale_tool_count_badge
 *   4. (HIGH)   본문 "(MCP )?도구 N개"       != toolCount                 → stale_tool_count
 *   5. (MEDIUM) 본문 "그래프 노드 N개"        != nodeCount                 → stale_node_count
 *   6. (HIGH)   본문 "(패키지 버전: X.Y.Z)"   != version                   → stale_pkg_version
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

// 본문 수치 검사(도구/노드/패키지 버전) 에서 제외할 "역사 표기" 마커.
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

// ============================================================
// 2) SSoT 정답값 추출 (코드에서 직접)
// ============================================================
async function resolveSSoT() {
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

  return { version, versionTs, toolCount, nodeCount };
}

// ============================================================
// 3) 파일별 표기 검사
// ============================================================
function scanFile(
  file: string,
  ssot: { version: string; toolCount: number; nodeCount: number },
) {
  // 게이트 자기 자신·CHANGELOG(히스토리) 제외
  if (file.includes(SELF_FILE)) return;
  if (file.includes("CHANGELOG.md")) return;
  // ROADMAP 은 라운드별 시계열 문서 — 과거(초기 상태)·현재·목표 수치가 공존한다.
  // 문서 스스로 "최신 수치의 SSoT 는 README·CHANGELOG" 라 명시(ROADMAP.md line 12) →
  // 본문 수치 정합 강제 대상이 아니므로 통째 제외(현재값 정합은 README/SECURITY/docs 가 책임).
  if (file.includes("ROADMAP.md")) return;

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

  // 검출 2~6: 파일 순회
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
  console.log(`  - version:   ${ssot.version}`);
  console.log(`  - toolCount: ${ssot.toolCount}`);
  console.log(`  - nodeCount: ${ssot.nodeCount}`);
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
