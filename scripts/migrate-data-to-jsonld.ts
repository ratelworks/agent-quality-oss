// ─────────────────────────────────────────────────────────────────────────────
// migrate-data-to-jsonld.ts — Phase 2: plain JSON 엔티티(data/*.json)를
// agent-safety-oss 와 동일한 JSON-LD 노드 구조(graph/nodes/{type}/{id}.jsonld)로 변환.
//
// 비파괴: data/*.json 은 그대로 두고 graph/nodes/ 에 JSON-LD 를 병행 생성한다.
// 검증 통과 후 Phase 3(graphology 로더)에서 런타임을 전환한다.
//
// 변환 규칙:
//   - id 점→콜론 IRI:  work.concrete  →  work:concrete  (context.jsonld 프리픽스)
//   - @type: 엔티티 type 그대로 (context 가 quality:WorkType 등으로 매핑)
//   - relations 값도 동일하게 IRI 화
//   - meta → _meta (safety 의 출처·감사 메타 컨벤션)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "src/ontology/data");
const OUT_DIR = path.join(ROOT, "src/ontology/graph/nodes");

// EntityType → safety 식 디렉토리명 (복수형 snake_case)
const TYPE_DIR: Record<string, string> = {
  WorkType: "work_types",
  Task: "tasks",
  Material: "materials",
  Equipment: "equipment",
  Standard: "standards",
  Specification: "specifications",
  TestItem: "tests",
  InspectionCheckpoint: "inspections",
  AcceptanceCriteria: "criteria",
  QualityRisk: "risks",
  Nonconformance: "nonconformances",
  CorrectiveAction: "corrective_actions",
  EvidenceDocument: "evidence_documents",
  Agency: "agencies",
  SiteRecord: "site_records",
  Project: "projects",
};

// "work.concrete_placement" → "work:concrete_placement" (첫 점만 콜론으로)
function toIri(id: string): string {
  const i = id.indexOf(".");
  if (i < 0) return id;
  return id.slice(0, i) + ":" + id.slice(i + 1);
}

interface RawEntity {
  id: string;
  type: string;
  name?: string;
  aliases?: string[];
  meta?: Record<string, unknown>;
  relations?: Record<string, string[]>;
}

function main(): void {
  // 멱등성: 기존 nodes/ 제거 후 재생성 (data 가 SSoT)
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });

  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  let count = 0;
  const byType: Record<string, number> = {};
  const seen = new Set<string>();

  for (const file of files) {
    const raw = JSON.parse(readFileSync(path.join(DATA_DIR, file), "utf8")) as
      | { entities?: RawEntity[] }
      | RawEntity[];
    const entities = Array.isArray(raw) ? raw : (raw.entities ?? []);
    if (!Array.isArray(entities)) continue;

    for (const e of entities) {
      if (!e?.id || !e?.type) continue;
      if (seen.has(e.id)) {
        process.stderr.write(`[warn] 중복 id: ${e.id} (${file})\n`);
        continue;
      }
      seen.add(e.id);

      const node: Record<string, unknown> = {
        "@context": "../../context.jsonld",
        "@id": toIri(e.id),
        "@type": e.type,
      };
      if (e.name) node["name"] = e.name;
      if (e.aliases && e.aliases.length > 0) node["aliases"] = e.aliases;
      if (e.meta && Object.keys(e.meta).length > 0) node["_meta"] = e.meta;

      for (const [rel, vals] of Object.entries(e.relations ?? {})) {
        if (Array.isArray(vals) && vals.length > 0) {
          node[rel] = vals.map(toIri);
        }
      }

      const dir = TYPE_DIR[e.type] ?? e.type.toLowerCase();
      const outDir = path.join(OUT_DIR, dir);
      mkdirSync(outDir, { recursive: true });
      const shortId = e.id.slice(e.id.indexOf(".") + 1) || e.id;
      const safeName = shortId.replace(/[^a-zA-Z0-9_.가-힣-]/g, "_");
      writeFileSync(path.join(outDir, `${safeName}.jsonld`), JSON.stringify(node, null, 2) + "\n");
      count++;
      byType[e.type] = (byType[e.type] ?? 0) + 1;
    }
  }

  process.stdout.write(`[migrate] ${count} 노드 → ${path.relative(ROOT, OUT_DIR)}\n`);
  process.stdout.write(
    `[migrate] 타입별: ${Object.entries(byType)
      .map(([t, n]) => `${t}=${n}`)
      .join(" · ")}\n`,
  );
}

main();
