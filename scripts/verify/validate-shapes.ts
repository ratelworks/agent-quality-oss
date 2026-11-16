// ─────────────────────────────────────────────────────────────────────────────
// validate-shapes.ts — 그래프를 표준 도구로 검증한다. 한 건이라도 어긋나면 실패(종료 코드 1).
//
//   1) 형태 정의(SHACL) — 표준 SHACL 엔진으로 노드 전체를 본다
//   2) RDF 대조 — 그래프를 RDF 로 옮겼다가 되돌려 원본과 견준다(옮기다 사라지는 값이 없는지)
//   3) 역관계 — 한쪽에만 적힌 짝 관계가 없는지
//
// 사용:
//   npm run validate:shapes
//   QUALITY_NODES_DIR=<내 노드 폴더> npm run validate:shapes   # 직접 고친 그래프를 볼 때
// ─────────────────────────────────────────────────────────────────────────────

import { loadOntologySync } from "../../src/ontology/loader.js";
import { OntologyGraph } from "../../src/ontology/graph.js";
import { findOneSidedInverses } from "../../src/ontology/validator.js";
import { NODES_DIR, diffNodes, fromNQuads, readNodeDocs, toNQuads, validateShapes } from "../ontology/rdf-graph.js";

// ───── 상수 ─────
const MAX_LINES = 40;

function report(title: string, lines: string[]): number {
  if (lines.length === 0) {
    console.log(`✓ ${title}`);
    return 0;
  }
  console.log(`✗ ${title} — ${lines.length}건`);
  for (const line of lines.slice(0, MAX_LINES)) console.log(`    ${line}`);
  if (lines.length > MAX_LINES) console.log(`    … 외 ${lines.length - MAX_LINES}건`);
  return lines.length;
}

async function main(): Promise<void> {
  const nodesDir = process.env["QUALITY_NODES_DIR"] ?? NODES_DIR;
  const nodes = readNodeDocs(nodesDir);
  const nquads = await toNQuads(nodes);
  console.log(`[shapes] 노드 ${nodes.length}개 · RDF 문장 ${nquads.split("\n").filter(Boolean).length}개`);

  let problems = 0;
  const violations = await validateShapes(nquads);
  problems += report(
    "형태 정의(SHACL)",
    violations.map((v) => `${v.focusNode} — ${v.message}`),
  );
  problems += report("RDF 로 옮겼다 되돌려 원본과 대조", diffNodes(nodes, await fromNQuads(nquads)));
  const graph = new OntologyGraph(loadOntologySync({ nodesDir }));
  problems += report(
    "역관계가 양쪽에 적혀 있음",
    findOneSidedInverses(graph).map((i) => `${i.entityId ?? ""}: ${i.message}`),
  );

  if (problems > 0) {
    console.error(`\n[shapes] 어긋난 곳 ${problems}건`);
    process.exit(1);
  }
  console.log("\n[shapes] 모두 통과");
}

await main();
