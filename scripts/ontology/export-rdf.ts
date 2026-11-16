// ─────────────────────────────────────────────────────────────────────────────
// export-rdf.ts — 그래프 전체를 RDF(N-Quads)로 내보낸다. 다른 RDF 도구·그래프 저장소에 싣는 용도.
//
// 사용:
//   npm run -s export:rdf > quality-graph.nq
//   npm run export:rdf -- --out quality-graph.nq
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync } from "node:fs";
import { NODES_DIR, readNodeDocs, toNQuads } from "./rdf-graph.js";

async function main(): Promise<void> {
  const outIndex = process.argv.indexOf("--out");
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
  if (outIndex >= 0 && !outPath) {
    console.error("--out 뒤에 파일 경로를 적어 주세요.");
    process.exit(2);
  }
  const nodes = readNodeDocs(process.env["QUALITY_NODES_DIR"] ?? NODES_DIR);
  const nquads = await toNQuads(nodes);
  if (outPath) {
    writeFileSync(outPath, nquads, "utf8");
    console.error(`[rdf] 노드 ${nodes.length}개 · RDF 문장 ${nquads.split("\n").filter(Boolean).length}개 → ${outPath}`);
    return;
  }
  process.stdout.write(nquads);
}

await main();
