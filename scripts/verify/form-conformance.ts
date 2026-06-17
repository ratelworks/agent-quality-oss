#!/usr/bin/env tsx
/**
 * form-conformance.ts — 양식 법적 근거(basis IRI) ↔ 온톨로지 그래프 노드 대조 게이트
 *
 * 본질(자기참조 탈출):
 *   src/schemas/document-schemas.json 의 19종 양식이 인용한 법적 근거(basis[] IRI)가
 *   실제 온톨로지 그래프 노드에 *실재* 하는지 검증한다. 양식이 그래프에 없는 법령/기준을
 *   근거로 광고하면 = 허위 근거 → HIGH → exit 1.
 *
 *   validate:ontology 는 그래프 *내부* 참조(노드↔노드 관계)만 본다. document-schemas.json 의
 *   basis 는 그래프 *밖*(스키마 파일)에서 그래프를 가리키므로 validate:ontology 의 사각이다.
 *   이 게이트가 그 경계(양식 basis → 그래프 노드)를 메운다.
 *
 * basis IRI → 그래프 노드 해석 (런타임 도구와 동일 로직 재사용):
 *   basis 문자열(예: "standard.guideline.part2_art7")은 이미 단축 id 형태다.
 *   loader 가 노드 @id("standard:guideline.part2_art7")를 fromIri(첫 콜론→점)로 변환해
 *   동일한 단축 id("standard.guideline.part2_art7")로 그래프에 적재한다.
 *   따라서 map_quality_basis 도구와 동일하게 graph.get(basis) 로 직접 조회한다
 *   (직접 변환 규칙 재발명 금지 — 런타임 해석과 1:1 정합이어야 게이트가 의미를 가진다).
 *
 * 검출 항목:
 *   1. (HIGH) basis IRI 가 그래프 노드에 미존재          → missing_basis
 *   2. (HIGH) basis IRI 가 존재하나 Standard 타입이 아님  → basis_type_mismatch
 *   3. (HIGH) 양식에 basis 가 비어 있음(빈 배열/누락)      → empty_basis
 *   4. (HIGH) README "19종" 광고 ↔ 실제 양식 수 불일치    → form_count_mismatch
 *      (check:doc-code-sync 와 축이 다름 — 그쪽은 도구/노드/버전, 여기선 "양식 수")
 *   5. (LOW)  reference 텍스트의 "§NN"·"별표N" 토큰이 어떤 basis 노드 meta(articleNo 등)와도
 *             교차되지 않음                                → reference_token_unmatched
 *             (약식 보조 신호 — basis 실재가 핵심이라 LOW. exit code 에 영향 없음)
 *
 * 검증 범위(scope) — 의도적 한정:
 *   공식 근거 basis[] 만 그래프 실재를 강제한다. referenceStandard(ISO 등)·retention 의
 *   부수 법 인용(예: 보존기간 "시행령 §93")은 *비구속 설명 텍스트*라 범위 밖이다.
 *   이를 basis 로 강제하면 보존기간 설명에까지 그래프 노드를 요구해 false-positive 를 유발한다
 *   (교차 검토 반영: 부수 인용은 양식의 *공식 근거*가 아니라 맥락 설명이다).
 *
 * env override:
 *   FORM_CONFORMANCE_ROOT — 설정 시 {ROOT}/document-schemas.json + {ROOT}/nodes/ 를 사용
 *                           (negative test 가 fixture 를 주입하기 위함). 미설정 시 실제 repo.
 *
 * file-only 작성 — 빌드/실행은 별도. tsx(ESM) 실행 전제. dynamic import 로 loader/graph 재사용.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ============================================================
// 0) 상수 (파일 최상단)
// ============================================================
const __dirname = dirname(fileURLToPath(import.meta.url));

// repo 루트 (scripts/verify/ 기준 두 단계 위)
const REPO_ROOT = resolve(__dirname, "..", "..");

// FORM_CONFORMANCE_ROOT — fixture 주입용 override (negative test).
//   설정 시: 스키마 = {ROOT}/document-schemas.json, 노드 = {ROOT}/nodes/
//   미설정 시: 실제 repo 경로 사용.
const FIXTURE_ROOT = process.env["FORM_CONFORMANCE_ROOT"]
  ? resolve(process.env["FORM_CONFORMANCE_ROOT"])
  : null;

// 실제 repo 의 스키마/노드 경로
const REAL_SCHEMA_PATH = resolve(REPO_ROOT, "src/schemas/document-schemas.json");
const REAL_NODES_DIR = resolve(REPO_ROOT, "src/ontology/graph/nodes");

// 적용 경로 (fixture 우선)
const SCHEMA_PATH = FIXTURE_ROOT
  ? join(FIXTURE_ROOT, "document-schemas.json")
  : REAL_SCHEMA_PATH;
const NODES_DIR = FIXTURE_ROOT ? join(FIXTURE_ROOT, "nodes") : REAL_NODES_DIR;

// README "N종" 광고 추출 대상 (fixture 에서는 검사 생략 — README 미주입)
const README_PATH = resolve(REPO_ROOT, "README.md");

// basis 가 가리켜야 하는 그래프 엔티티 타입 (양식 근거는 전부 Standard 노드)
const EXPECTED_BASIS_TYPE = "Standard";

// loader 동적 import 경로 (build 우선 → src tsx fallback).
//   build/ 가 있으면 컴파일 산출물을, 없으면 tsx 가 src 를 직접 로드한다.
const LOADER_BUILD = resolve(REPO_ROOT, "build/ontology/loader.js");
const GRAPH_BUILD = resolve(REPO_ROOT, "build/ontology/graph.js");
const LOADER_SRC = resolve(REPO_ROOT, "src/ontology/loader.ts");
const GRAPH_SRC = resolve(REPO_ROOT, "src/ontology/graph.ts");

// ============================================================
// 1) 타입
// ============================================================
type Severity = "HIGH" | "LOW";

interface Issue {
  severity: Severity;
  category: string;
  formId: string;
  basis?: string;
  message: string;
}

// document-schemas.json 의 양식 1건 (필요한 필드만)
interface FormSchema {
  id?: string;
  title?: string;
  basis?: unknown;
  reference?: unknown;
}

// 그래프 조회에 필요한 최소 인터페이스 (loader/graph 의 BaseEntity 부분집합)
interface GraphEntityLike {
  id: string;
  type: string;
  name?: string;
  meta?: Record<string, unknown> | undefined;
}

interface GraphLike {
  version: string;
  get(id: string): GraphEntityLike | undefined;
}

// ============================================================
// 2) loader/graph 재사용 — 런타임 도구와 동일한 해석으로 그래프 구성
// ============================================================
async function buildGraph(): Promise<GraphLike> {
  // build 산출물 우선, 없으면 src(tsx) 사용.
  const useBuild = existsSync(LOADER_BUILD) && existsSync(GRAPH_BUILD);
  const loaderPath = useBuild ? LOADER_BUILD : LOADER_SRC;
  const graphPath = useBuild ? GRAPH_BUILD : GRAPH_SRC;

  const loaderMod = await import(pathToFileURL(loaderPath).href);
  const graphMod = await import(pathToFileURL(graphPath).href);

  const loadOntologySync = loaderMod.loadOntologySync as
    | ((opts?: { nodesDir?: string; strict?: boolean }) => unknown)
    | undefined;
  const OntologyGraph = graphMod.OntologyGraph as
    | (new (data: unknown) => GraphLike)
    | undefined;

  if (typeof loadOntologySync !== "function" || typeof OntologyGraph !== "function") {
    throw new Error(
      "loader.loadOntologySync / graph.OntologyGraph 를 찾지 못했습니다. 온톨로지 모듈 export 를 확인하세요.",
    );
  }

  // fixture 든 실제든 NODES_DIR 을 명시 주입 → map_quality_basis 와 동일하게 graph.get() 으로 해석.
  const data = loadOntologySync({ nodesDir: NODES_DIR, strict: true });
  return new OntologyGraph(data);
}

// ============================================================
// 3) 스키마 로드 / 유틸
// ============================================================
function loadSchemas(): Record<string, FormSchema> {
  if (!existsSync(SCHEMA_PATH)) {
    console.error(`document-schemas.json 을 찾을 수 없습니다: ${SCHEMA_PATH}`);
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`document-schemas.json 파싱 실패: ${msg}`);
    process.exit(1);
  }
  if (!parsed || typeof parsed !== "object") {
    console.error("document-schemas.json: 객체 형식이 아닙니다.");
    process.exit(1);
  }
  const schemas = (parsed as { schemas?: unknown }).schemas;
  if (!schemas || typeof schemas !== "object" || Array.isArray(schemas)) {
    console.error("document-schemas.json: 'schemas' 객체가 없습니다.");
    process.exit(1);
  }
  return schemas as Record<string, FormSchema>;
}

// basis 를 안전하게 string[] 로 정규화 (배열 아님/누락 → 빈 배열)
function normalizeBasis(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

// README 본문에서 "양식 N종" 광고 수 추출.
//   ⚠️ 반드시 *양식(document form)* 컨텍스트의 N종만 잡는다. README 에는 "공종(WorkType) 19종"
//      처럼 양식이 아닌 N종 표기가 먼저 등장하므로, "양식" 인접 토큰을 동반한 패턴만 매칭한다.
//      (양식 컨텍스트가 없으면 null → 검사 생략 — 무관한 N종을 양식 수로 오인하지 않음.)
function extractAdvertisedFormCount(): number | null {
  if (!existsSync(README_PATH)) return null;
  let text: string;
  try {
    text = readFileSync(README_PATH, "utf8");
  } catch {
    return null;
  }
  // 패턴 A: "양식 ... 19종" / "양식(19종)" / "양식 구조(19종)" — '양식' 뒤 가까이 N종.
  const after = text.match(/양식[^\n]{0,8}?[(（]?\s*(\d+)\s*종/);
  const afterN = after?.[1];
  if (afterN !== undefined) {
    const n = parseInt(afterN, 10);
    if (Number.isFinite(n)) return n;
  }
  // 패턴 B: "19종 ... 양식" — N종 뒤 가까이 '양식'.
  const before = text.match(/(\d+)\s*종[^\n]{0,8}?양식/);
  const beforeN = before?.[1];
  if (beforeN !== undefined) {
    const n = parseInt(beforeN, 10);
    if (Number.isFinite(n)) return n;
  }
  // 양식 컨텍스트 N종이 없으면 검사 생략 (무관한 N종을 양식 수로 오인 방지).
  return null;
}

// reference 텍스트에서 §NN / 별표N / 제NN호 / 별지 제NN호 토큰을 추출 (약식 교차용).
function extractReferenceTokens(reference: unknown): string[] {
  if (typeof reference !== "string") return [];
  const tokens: string[] = [];
  // §NN  (조문 번호)
  for (const m of reference.matchAll(/§\s*(\d+)/g)) {
    const n = m[1];
    if (n !== undefined) tokens.push(`art:${n}`);
  }
  // 제NN조
  for (const m of reference.matchAll(/제\s*(\d+)\s*조/g)) {
    const n = m[1];
    if (n !== undefined) tokens.push(`art:${n}`);
  }
  // 별표N
  for (const m of reference.matchAll(/별표\s*(\d+)/g)) {
    const n = m[1];
    if (n !== undefined) tokens.push(`annex:${n}`);
  }
  // 별지 제NN호 / 제NN호 (서식)
  for (const m of reference.matchAll(/제\s*(\d+)\s*호/g)) {
    const n = m[1];
    if (n !== undefined) tokens.push(`form:${n}`);
  }
  return [...new Set(tokens)];
}

// basis 노드 집합의 meta(articleNo 등)에서 교차 가능한 토큰 집합을 만든다.
function collectBasisMetaTokens(nodes: GraphEntityLike[]): Set<string> {
  const set = new Set<string>();
  for (const node of nodes) {
    const meta = node.meta ?? {};
    const articleNo = meta["articleNo"];
    if (typeof articleNo === "string" || typeof articleNo === "number") {
      set.add(`art:${String(articleNo)}`);
    }
    // basis id 의 마지막 숫자(law.btia_55 → 55, guideline.part2_art7 → 7)도 보조 토큰화.
    const tail = node.id.match(/(\d+)$/);
    const tailN = tail?.[1];
    if (tailN !== undefined) set.add(`art:${tailN}`);
    // 서식 노드(form.*)는 form:NN 토큰 후보.
    const formNo = node.id.match(/no(\d+)/i);
    const formN = formNo?.[1];
    if (formN !== undefined) set.add(`form:${formN}`);
  }
  return set;
}

// ============================================================
// 4) 검사 본체
// ============================================================
async function main(): Promise<void> {
  const issues: Issue[] = [];

  const graph = await buildGraph();
  const schemas = loadSchemas();
  const formIds = Object.keys(schemas);

  let totalBasis = 0;
  let resolvedBasis = 0;

  for (const formId of formIds) {
    const form = schemas[formId];
    if (!form) continue;
    const basisList = normalizeBasis(form.basis);

    // 검출 3: basis 비어 있음
    if (basisList.length === 0) {
      issues.push({
        severity: "HIGH",
        category: "empty_basis",
        formId,
        message: `양식 '${formId}' 에 법적 근거(basis)가 비어 있습니다. 양식은 최소 1개의 근거 IRI 를 가져야 합니다.`,
      });
      continue;
    }

    const resolvedNodes: GraphEntityLike[] = [];

    for (const basis of basisList) {
      totalBasis += 1;
      const node = graph.get(basis);

      // 검출 1: basis 미존재
      if (!node) {
        issues.push({
          severity: "HIGH",
          category: "missing_basis",
          formId,
          basis,
          message: `양식 '${formId}' 의 근거 '${basis}' 가 온톨로지 그래프 노드에 실재하지 않습니다 (허위 근거).`,
        });
        continue;
      }

      // 검출 2: 타입 불일치 (Standard 아님)
      if (node.type !== EXPECTED_BASIS_TYPE) {
        issues.push({
          severity: "HIGH",
          category: "basis_type_mismatch",
          formId,
          basis,
          message: `양식 '${formId}' 의 근거 '${basis}' 가 ${EXPECTED_BASIS_TYPE} 가 아닌 '${node.type}' 노드입니다. 양식 근거는 ${EXPECTED_BASIS_TYPE} 노드여야 합니다.`,
        });
        continue;
      }

      resolvedBasis += 1;
      resolvedNodes.push(node);
    }

    // 검출 5 (LOW): reference 토큰 ↔ basis 노드 meta 약식 교차.
    //   basis 가 모두 실재할 때만 보조 검사 (basis 자체가 깨졌으면 무의미).
    if (resolvedNodes.length === basisList.length) {
      const refTokens = extractReferenceTokens(form.reference);
      if (refTokens.length > 0) {
        const metaTokens = collectBasisMetaTokens(resolvedNodes);
        // reference 의 조문/별표/서식 토큰 중 어떤 것도 basis 노드 meta 와 교차되지 않으면 신호.
        const anyMatch = refTokens.some((t) => metaTokens.has(t));
        if (!anyMatch) {
          issues.push({
            severity: "LOW",
            category: "reference_token_unmatched",
            formId,
            message: `양식 '${formId}' 의 reference 토큰(${refTokens.join(", ")})이 basis 노드 meta 와 교차되지 않습니다 (약식 신호 — basis 실재는 정상).`,
          });
        }
      }
    }
  }

  // 검출 4: README "N종" 광고 ↔ 실제 양식 수 (fixture 에서는 README 미주입 → null → 생략)
  const advertised = FIXTURE_ROOT ? null : extractAdvertisedFormCount();
  if (advertised !== null && advertised !== formIds.length) {
    issues.push({
      severity: "HIGH",
      category: "form_count_mismatch",
      formId: "(README)",
      message: `README 광고 양식 수(${advertised}종)와 document-schemas.json 실제 양식 수(${formIds.length}종)가 불일치합니다.`,
    });
  }

  // ── 출력 ──────────────────────────────────────────────────
  const high = issues.filter((i) => i.severity === "HIGH");
  const low = issues.filter((i) => i.severity === "LOW");

  console.log("[form-conformance] 양식 basis ↔ 그래프 노드 대조");
  console.log(`  온톨로지 버전: ${graph.version}`);
  console.log(`  양식 수:       ${formIds.length}`);
  console.log(`  basis 총계:    ${totalBasis}건 (실재 ${resolvedBasis}건)`);
  console.log();

  if (high.length > 0) {
    console.log(`[HIGH] ${high.length}건`);
    // 카테고리별 그룹
    const byCat = high.reduce<Record<string, Issue[]>>((acc, i) => {
      (acc[i.category] = acc[i.category] ?? []).push(i);
      return acc;
    }, {});
    for (const [cat, list] of Object.entries(byCat)) {
      console.log(`  [${cat}] ${list.length}건`);
      for (const item of list) {
        const tag = item.basis ? `${item.formId} → ${item.basis}` : item.formId;
        console.log(`    · ${tag}: ${item.message}`);
      }
    }
    console.log();
  }

  if (low.length > 0) {
    console.log(`[LOW] ${low.length}건 (참고 — exit code 무관)`);
    for (const item of low) {
      console.log(`    · ${item.formId}: ${item.message}`);
    }
    console.log();
  }

  if (high.length > 0) {
    console.error(
      `[form-conformance] ❌ 미실재/불일치 근거 ${high.length}건 — release blocker. 양식 basis 가 그래프 노드에 실재하지 않습니다.`,
    );
    process.exit(1);
  }

  console.log(`[form-conformance] OK ✅ basis ${resolvedBasis}건 실재 (${formIds.length}종 양식)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
