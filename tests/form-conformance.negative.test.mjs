// form-conformance.negative.test.mjs — 게이트가 허위 근거(미실재 basis)를 잡는지 fixture 로 검증
//
// 순수 node:test. form-conformance.ts 가
//   - 정합 fixture(basis 가 그래프 노드에 모두 실재)에서 exit 0 (release OK)
//   - drift fixture(가짜 IRI basis)에서 exit 1 (release blocker) 로 차단
// 하는지 임시 디렉토리 fixture 로 확인한다.
//
// fixture 구조 (게이트의 FORM_CONFORMANCE_ROOT override 가 읽는 형태):
//   {ROOT}/document-schemas.json   — { schemas: { ... } }
//   {ROOT}/nodes/*.jsonld          — 그래프 노드 (loader 가 @id 첫 콜론→점 변환)
//
// loader 의 zod 검증(EntityZ)을 통과해야 하므로 노드는 type prefix(standard.)·name(비어있지 않음)을 갖춘다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

// ── 상수 ────────────────────────────────────────────────────
const GATE_ABS_PATH = resolve(
  import.meta.dirname,
  "../scripts/verify/form-conformance.ts",
);

// 정합 fixture 에서 양식 basis 가 가리킬 실재 노드들의 단축 id.
// 게이트는 graph.get(basis) 로 조회 → 노드 @id 는 "standard:guideline.part2_art7" 형태로 둔다.
const REAL_BASIS_A = "standard.guideline.part2_art7";
const REAL_BASIS_B = "standard.law.btia_55";
const FAKE_BASIS = "standard.law.nonexistent_999";

// 단축 id("standard.law.btia_55") → 노드 @id("standard:law.btia_55") 역변환 (첫 점만 콜론으로).
function toNodeIri(shortId) {
  const i = shortId.indexOf(".");
  return i < 0 ? shortId : shortId.slice(0, i) + ":" + shortId.slice(i + 1);
}

// Standard 노드 .jsonld 1건 생성 (zod EntityZ 통과: @type Standard + name 비어있지 않음).
function writeStandardNode(nodesDir, shortId, name, meta = {}) {
  // 파일명은 단축 id 의 prefix 제거분(중복 점 허용). 결정론적이면 충분.
  const fname = shortId.replace(/[^a-zA-Z0-9._-]/g, "_") + ".jsonld";
  const node = {
    "@id": toNodeIri(shortId),
    "@type": "Standard",
    name,
    _meta: meta,
  };
  writeFileSync(join(nodesDir, fname), JSON.stringify(node, null, 2));
}

// fixture 디렉토리 골격 생성.
//   opts.basis      — ncr 양식의 basis 배열 (검증 변인)
//   opts.realNodes  — 생성할 실재 노드 단축 id 목록 (기본: REAL_BASIS_A, REAL_BASIS_B)
function buildFixture(opts) {
  const dir = mkdtempSync(join(tmpdir(), "qoss-formconf-"));
  const nodesDir = join(dir, "nodes");
  mkdirSync(nodesDir, { recursive: true });

  // 그래프 노드 생성 (실재 basis 후보)
  const realNodes = opts.realNodes ?? [REAL_BASIS_A, REAL_BASIS_B];
  for (const id of realNodes) {
    // meta.articleNo 를 마지막 숫자로 채워 reference 토큰 교차(LOW)도 정상 통과하게 둔다.
    const tail = id.match(/(\d+)$/);
    const meta = tail ? { category: "law", articleNo: tail[1] } : { category: "law" };
    writeStandardNode(nodesDir, id, `근거 노드 ${id}`, meta);
  }

  // document-schemas.json — ncr 양식 1건만 (basis 변인)
  const schemas = {
    schemas: {
      ncr: {
        id: "ncr",
        title: "부적합 보고서(NCR) 양식",
        basis: opts.basis,
        reference: "건설기술 진흥법 §55 + 업무지침 제2편 §7",
      },
    },
  };
  writeFileSync(
    join(dir, "document-schemas.json"),
    JSON.stringify(schemas, null, 2),
  );

  return dir;
}

// 게이트 실행 (fixture ROOT 주입). exit != 0 이면 execFileSync 가 throw.
function runGate(fixtureDir) {
  execFileSync("npx", ["tsx", GATE_ABS_PATH], {
    env: {
      ...process.env,
      FORM_CONFORMANCE_ROOT: fixtureDir,
    },
    encoding: "utf8",
  });
}

// ── test 1: 정합 fixture → exit 0 ────────────────────────────
test("정합 fixture(basis 모두 실재) → exit 0 (release OK)", () => {
  // basis 두 개 모두 그래프 노드로 생성 → missing 없음 → exit 0 → throw 안 함
  const dir = buildFixture({ basis: [REAL_BASIS_A, REAL_BASIS_B] });
  try {
    assert.doesNotThrow(() => runGate(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── test 2: drift fixture(가짜 IRI) → exit 1 ─────────────────
test("drift fixture(가짜 basis IRI) → exit 1 (release blocker)", () => {
  // FAKE_BASIS 노드는 생성하지 않음 → graph.get() 실패 → missing_basis HIGH → exit 1 → throw
  const dir = buildFixture({ basis: [REAL_BASIS_A, FAKE_BASIS] });
  try {
    assert.throws(() => runGate(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── test 3: basis 빈 배열 → exit 1 ───────────────────────────
test("basis 빈 배열 → exit 1 (empty_basis)", () => {
  const dir = buildFixture({ basis: [] });
  try {
    assert.throws(() => runGate(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── test 4: basis 타입 불일치(Standard 아님) → exit 1 ────────
test("basis 가 Standard 아닌 노드 → exit 1 (basis_type_mismatch)", () => {
  // work.* prefix 의 WorkType 노드를 만들고, 양식 basis 가 그것을 가리키게 한다.
  const dir = mkdtempSync(join(tmpdir(), "qoss-formconf-"));
  const nodesDir = join(dir, "nodes");
  mkdirSync(nodesDir, { recursive: true });
  // WorkType 노드 (id prefix work.) — EntityZ 통과
  writeFileSync(
    join(nodesDir, "work_concrete_placement.jsonld"),
    JSON.stringify(
      { "@id": "work:concrete_placement", "@type": "WorkType", name: "콘크리트 타설" },
      null,
      2,
    ),
  );
  const schemas = {
    schemas: {
      ncr: {
        id: "ncr",
        title: "부적합 보고서(NCR) 양식",
        // Standard 가 아니라 WorkType 을 근거로 (허위 — 양식 근거는 Standard 여야 함)
        basis: ["work.concrete_placement"],
        reference: "테스트",
      },
    },
  };
  writeFileSync(join(dir, "document-schemas.json"), JSON.stringify(schemas, null, 2));
  try {
    assert.throws(() => runGate(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── test 5: prepublishOnly 배선 회귀 ─────────────────────────
// prepublishOnly 체인에 게이트가 연결됐는지 — 연결 안 하면 release 전 자동 실행되지 않아
// 허위 근거가 publish 로 새어나간다. 게이트 "작동"과 별개로 "배선"을 회귀로 고정.
test("prepublishOnly 에 form-conformance 연결됨", () => {
  const pkg = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
  );
  assert.ok(
    pkg.scripts.prepublishOnly.includes("form-conformance"),
    "prepublishOnly 체인에 form-conformance 가 없습니다",
  );
});
