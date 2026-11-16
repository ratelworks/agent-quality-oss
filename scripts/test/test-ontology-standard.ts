// ─────────────────────────────────────────────────────────────────────────────
// test-ontology-standard.ts — 그래프의 표준 표현 검증(SHACL · RDF · 역관계)의 회귀 시험.
//
//   1) 형태 정의 파일이 코드의 정의와 같다
//   2) 실제 그래프 — 형태 정의 위반 0, RDF 로 옮겼다 되돌려도 원본과 같음, 한쪽에만 적힌 역관계 0
//   3) 대조군 — 일부러 어긋나게 만든 노드를 넣으면 제약마다 정확히 그 노드를 짚는다
//      ("위반 0" 은 제약이 아무것도 보지 않아도 나오므로, 제약이 실제로 잡는지를 따로 본다)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { loadOntologySync } from "../../src/ontology/loader.js";
import { OntologyGraph } from "../../src/ontology/graph.js";
import { RELATION_SPECS, requiredInverse } from "../../src/ontology/relations.js";
import { findOneSidedInverses, validateOntology } from "../../src/ontology/validator.js";
import { buildShapesTurtle } from "../ontology/generate-shapes.js";
import { SHAPES_PATH, diffNodes, fromNQuads, readContext, readNodeDocs, toNQuads, validateShapes } from "../ontology/rdf-graph.js";
import type { NodeDoc } from "../ontology/rdf-graph.js";

// ───── 상수 ─────
const SHAPE_NS = "https://quality.ratelworks.org/shapes/v1/";
const RDF_TYPE = "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>";
const NAME = "<https://schema.org/name>";
const ALIAS = "<http://www.w3.org/2004/02/skos/core#altLabel>";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) passed += 1;
  else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const context = readContext() as Record<string, unknown>;
const nodes = readNodeDocs();

/** "work:slab" 같은 줄임 주소를 온전한 IRI 로 */
function iri(compact: string): string {
  const colon = compact.indexOf(":");
  return String(context[compact.slice(0, colon)]) + compact.slice(colon + 1);
}

function firstOf(type: string): string {
  const found = nodes.find((n) => n["@type"] === type);
  if (!found) throw new Error(`${type} 노드가 없습니다`);
  return String(found["@id"]);
}

// ── 1. 형태 정의 파일 ──────────────────────────────────────────────
function testShapesFile(): void {
  const file = readFileSync(SHAPES_PATH, "utf8");
  check("형태 정의 파일이 코드의 정의와 같음 (다르면 npm run generate:shapes)", file === buildShapesTurtle());
  // 관계마다 도착 쪽 제약이 하나씩 있다
  const missing = Object.keys(RELATION_SPECS).filter((r) => !new RegExp(`^qsh:${r}-range a sh:(Node|Property)Shape ;$`, "m").test(file));
  check("관계마다 도착 쪽 제약이 있음", missing.length === 0, missing.join(","));
}

// ── 2. 실제 그래프 ─────────────────────────────────────────────────
async function testRealGraph(): Promise<void> {
  const nquads = await toNQuads(nodes);
  const lines = nquads.split("\n").filter(Boolean);
  const graph = new OntologyGraph(loadOntologySync());
  const stats = graph.stats();

  const violations = await validateShapes(nquads);
  check("실제 그래프: 형태 정의 위반 0", violations.length === 0, violations.slice(0, 3).map((v) => `${v.focusNode} ${v.message}`).join(" ‖ "));

  const back = await fromNQuads(nquads);
  const differences = diffNodes(nodes, back);
  check("실제 그래프: RDF 로 옮겼다 되돌려도 원본과 같음", differences.length === 0, differences.slice(0, 3).join(" ‖ "));

  const oneSided = findOneSidedInverses(graph);
  check("실제 그래프: 한쪽에만 적힌 역관계 0", oneSided.length === 0, oneSided.slice(0, 3).map((i) => i.message).join(" ‖ "));
  check("실제 그래프: 무결성 검사에 경고·오류 없음", validateOntology(graph).issues.length === 0);

  // 실행할 때 쓰는 그래프와 RDF 가 같은 것을 담고 있는지 — 수로 견준다
  const count = (predicate: string): number => lines.filter((l) => l.split(" ")[1] === predicate).length;
  check("수 대조: 노드 수 = 종류가 적힌 RDF 주어 수", count(RDF_TYPE) === stats.total && nodes.length === stats.total, `${count(RDF_TYPE)} / ${stats.total}`);
  check("수 대조: 이름이 노드마다 하나", count(NAME) === stats.total, String(count(NAME)));
  const aliasTotal = [...graph.entities.values()].reduce((sum, e) => sum + e.aliases.length, 0);
  check("수 대조: 별칭 수", count(ALIAS) === aliasTotal, `${count(ALIAS)} / ${aliasTotal}`);
  const relationValues = back.reduce((sum, n) => {
    let total = 0;
    for (const [key, value] of Object.entries(n)) {
      if (key in RELATION_SPECS) total += Array.isArray(value) ? value.length : 1;
    }
    return sum + total;
  }, 0);
  check("수 대조: 관계 수", relationValues === stats.relations, `${relationValues} / ${stats.relations}`);

  // 순서가 뜻을 가지는 값(근거 우선순위)은 순서 그대로 돌아온다
  const ordered = nodes.find((n) => Array.isArray(n["basisPriority"]) && (n["basisPriority"] as unknown[]).length >= 3);
  const orderedBack = back.find((n) => n["@id"] === ordered?.["@id"]);
  check(
    "근거 우선순위는 순서 그대로 돌아옴",
    ordered !== undefined && JSON.stringify(orderedBack?.["basisPriority"]) === JSON.stringify(ordered["basisPriority"]),
    JSON.stringify(orderedBack?.["basisPriority"]),
  );
}

// ── 3-a. 대조군: 형태 정의 ─────────────────────────────────────────
async function testShapeControls(): Promise<void> {
  const standard = firstOf("Standard");
  const material = firstOf("Material");
  const test = firstOf("TestItem");
  const task = firstOf("Task");
  const work = firstOf("WorkType");
  const action = firstOf("CorrectiveAction");

  // 넣는 노드마다 어긋난 곳은 하나뿐이다 — [넣는 노드, 짚어야 하는 제약, 짚어야 하는 노드]
  const controls: Array<{ what: string; node: NodeDoc; shape: string; focus: string }> = [
    {
      what: "이름이 없는 노드",
      node: { "@id": "work:control_no_name", "@type": "WorkType", requiresStandard: [standard] },
      shape: "AnyNode-name",
      focus: "work:control_no_name",
    },
    {
      what: "정해지지 않은 종류",
      node: { "@id": "work:control_unknown_type", "@type": "Gadget", name: "대조군" },
      shape: "AnyNode-type",
      focus: "work:control_unknown_type",
    },
    {
      what: "종류와 맞지 않는 주소",
      node: { "@id": "work:control_wrong_address", "@type": "TestItem", name: "대조군", requiresStandard: [standard] },
      shape: "TestItemShape",
      focus: "work:control_wrong_address",
    },
    {
      what: "빈 별칭",
      node: { "@id": "work:control_blank_alias", "@type": "WorkType", name: "대조군", aliases: [""], requiresStandard: [standard] },
      shape: "AnyNode-alias",
      focus: "work:control_blank_alias",
    },
    {
      what: "관계가 엉뚱한 종류를 가리킴",
      node: { "@id": "work:control_wrong_range", "@type": "WorkType", name: "대조군", requiresStandard: [standard], usesMaterial: [test] },
      shape: "usesMaterial-range",
      focus: test,
    },
    {
      what: "관계가 없는 노드를 가리킴",
      node: { "@id": "work:control_dangling", "@type": "WorkType", name: "대조군", requiresStandard: [standard], usesMaterial: ["material:control_does_not_exist"] },
      shape: "usesMaterial-range",
      focus: "material:control_does_not_exist",
    },
    {
      what: "관계가 엉뚱한 종류에서 출발",
      node: { "@id": "material:control_wrong_domain", "@type": "Material", name: "대조군", requiresStandard: [standard], hasTask: [task] },
      shape: "hasTask-domain",
      focus: "material:control_wrong_domain",
    },
    {
      what: "근거 기준이 없는 공종",
      node: { "@id": "work:control_no_basis", "@type": "WorkType", name: "대조군", usesMaterial: [material] },
      shape: "WorkType-needs-requiresStandard",
      focus: "work:control_no_basis",
    },
    {
      what: "시험도 근거 기준도 없는 자재",
      node: { "@id": "material:control_no_test_or_basis", "@type": "Material", name: "대조군" },
      shape: "Material-needs-requiresTest-or-requiresStandard",
      focus: "material:control_no_test_or_basis",
    },
    {
      what: "나온 표준이 없는 판정 기준",
      node: { "@id": "criteria:control_no_source", "@type": "AcceptanceCriteria", name: "대조군", appliesTo: [test] },
      shape: "AcceptanceCriteria-needs-derivedFrom",
      focus: "criteria:control_no_source",
    },
    {
      what: "근거 우선순위가 빈 부적합",
      node: { "@id": "ncr:control_empty_priority", "@type": "Nonconformance", name: "대조군", immediateActions: [action], correctiveActions: [action], basisPriority: [] },
      shape: "Nonconformance-needs-basisPriority",
      focus: "ncr:control_empty_priority",
    },
    {
      what: "근거 우선순위에 공종이 들어감",
      node: { "@id": "ncr:control_priority_wrong_kind", "@type": "Nonconformance", name: "대조군", immediateActions: [action], correctiveActions: [action], basisPriority: [standard, work] },
      shape: "basisPriority-range",
      focus: "ncr:control_priority_wrong_kind",
    },
  ];

  const violations = await validateShapes(await toNQuads([...nodes, ...controls.map((c) => c.node)]));
  const actual = new Set(violations.map((v) => `${v.shape.replace(SHAPE_NS, "")} @ ${v.focusNode}`));
  const expected = new Set(controls.map((c) => `${c.shape} @ ${iri(c.focus)}`));
  for (const c of controls) {
    check(`대조군: ${c.what} → ${c.shape}`, actual.has(`${c.shape} @ ${iri(c.focus)}`), [...actual].filter((a) => a.includes(c.focus.split(":")[1] ?? "")).join(" ‖ "));
  }
  // 어긋나게 만든 곳 말고는 아무것도 짚지 않는다 — 제약이 멀쩡한 노드를 건드리지 않는지
  const extra = [...actual].filter((a) => !expected.has(a));
  check("대조군: 어긋나게 만든 곳만 짚음", extra.length === 0, extra.join(" ‖ "));
  check("대조군: 위반 메시지가 사람이 읽는 말", violations.every((v) => /[가-힣]/.test(v.message)), violations.find((v) => !/[가-힣]/.test(v.message))?.message ?? "");
}

// ── 3-b. 대조군: RDF 대조 ──────────────────────────────────────────
async function testRoundTripControls(): Promise<void> {
  const material = firstOf("Material");
  const standard = firstOf("Standard");
  const broken: NodeDoc[] = [
    // 맥락 정의에 없는 속성 — RDF 로 옮길 때 조용히 사라진다
    { "@id": "work:control_unknown_key", "@type": "WorkType", name: "대조군", requiresStandard: [standard], extraNote: "사라지는 값" },
    // 주소가 아닌 글자를 관계 값으로 적음
    { "@id": "work:control_text_as_relation", "@type": "WorkType", name: "대조군", requiresStandard: [standard], usesMaterial: ["그냥 글자"] },
    // 같은 별칭을 두 번 적음
    { "@id": "work:control_duplicate_alias", "@type": "WorkType", name: "대조군", aliases: ["같은 말", "같은 말"], requiresStandard: [standard] },
    // 근거 우선순위는 순서가 뜻이라, 순서가 바뀌면 다른 값이다
    { "@id": "work:control_fine", "@type": "WorkType", name: "대조군", requiresStandard: [standard], usesMaterial: [material] },
  ];
  const all = [...nodes, ...broken];
  const differences = diffNodes(all, await fromNQuads(await toNQuads(all)));
  check("대조군: 맥락 정의에 없는 속성이 사라진 것을 알림", differences.includes("work:control_unknown_key: extraNote 가 RDF 에서 사라짐"), differences.join(" ‖ "));
  check("대조군: 주소가 아닌 관계 값이 사라진 것을 알림", differences.includes("work:control_text_as_relation: usesMaterial 가 RDF 에서 사라짐"), differences.join(" ‖ "));
  check("대조군: 겹친 별칭이 하나로 줄어든 것을 알림", differences.includes("work:control_duplicate_alias: aliases 값이 달라짐"), differences.join(" ‖ "));
  check("대조군: 멀쩡한 노드는 알리지 않음", differences.length === 3, differences.join(" ‖ "));

  // 순서가 바뀐 근거 우선순위는 다른 값으로 본다
  const ordered = nodes.find((n) => Array.isArray(n["basisPriority"]) && (n["basisPriority"] as unknown[]).length >= 2);
  if (!ordered) throw new Error("근거 우선순위가 둘 이상인 노드가 없습니다");
  const reversed = { ...ordered, basisPriority: [...(ordered["basisPriority"] as unknown[])].reverse() };
  check("대조군: 근거 우선순위의 순서가 바뀌면 달라졌다고 봄", diffNodes([ordered], [reversed]).length === 1);
  const shuffled = { ...ordered, requiresEvidence: [...((ordered["requiresEvidence"] as unknown[] | undefined) ?? [])].reverse() };
  check("대조군: 순서 없는 관계는 순서가 바뀌어도 같다고 봄", diffNodes([ordered], [shuffled]).length === 0);
}

// ── 3-c. 대조군: 역관계 ────────────────────────────────────────────
function testInverseControls(): void {
  check("역관계 규칙: 자재 → 시험 은 시험 → 자재 로 되돌린다", requiredInverse("requiresTest", "Material", "TestItem") === "targetMaterial");
  check("역관계 규칙: 검측 → 공종 은 공종 → 검측 으로 되돌린다", requiredInverse("relatedWork", "InspectionCheckpoint", "WorkType") === "hasInspectionCheckpoint");
  check("역관계 규칙: 시험 → 공종 은 되돌릴 짝이 없다", requiredInverse("relatedWork", "TestItem", "WorkType") === undefined);
  check("역관계 규칙: 리스크 → 시험 은 되돌릴 짝이 없다", requiredInverse("relatedTest", "QualityRisk", "TestItem") === undefined);
  check("역관계 규칙: 짝이 없는 관계", requiredInverse("requiresStandard", "WorkType", "Standard") === undefined);
  // 짝은 양쪽에서 서로를 가리킨다
  const lopsided = Object.entries(RELATION_SPECS).filter(([name, spec]) => spec.inverse !== undefined && RELATION_SPECS[spec.inverse].inverse !== name);
  check("역관계 선언은 양쪽에서 서로를 가리킴", lopsided.length === 0, lopsided.map(([n]) => n).join(","));

  // 한쪽을 지우면 정확히 그 한 건을 알린다
  const graph = new OntologyGraph(loadOntologySync());
  const testItem = [...graph.entities.values()].find((e) => e.type === "TestItem" && (e.relations["targetMaterial"] ?? []).length === 1);
  if (!testItem) throw new Error("대상 자재가 하나인 시험이 없습니다");
  const materialId = (testItem.relations["targetMaterial"] ?? [])[0] ?? "";
  testItem.relations["targetMaterial"] = [];
  const found = findOneSidedInverses(graph);
  check(
    "대조군: 시험 쪽 짝을 지우면 그 한 건을 알림",
    found.length === 1 && found[0]?.code === "ONE_SIDED_INVERSE" && found[0].entityId === materialId && found[0].message.includes(testItem.id),
    JSON.stringify(found.slice(0, 2)),
  );
  check("대조군: 한쪽 역관계는 경고이며 서버 기동을 막지 않음", found[0]?.level === "warn" && validateOntology(graph).ok);
}

async function main(): Promise<void> {
  testShapesFile();
  await testRealGraph();
  await testShapeControls();
  await testRoundTripControls();
  testInverseControls();
  console.log(`[ontology-standard] ${passed} 통과 / ${failed} 실패`);
  if (failed > 0) process.exit(1);
}

await main();
