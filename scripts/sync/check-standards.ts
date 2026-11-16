// ─────────────────────────────────────────────────────────────────────────────
// check-standards.ts — 노드가 근거로 적은 국가건설기준(KCS·KDS)의 판과 인용 구절을
// 국가건설기준센터의 공식 본문과 대조한다.
//
//   npm run check:standards                 공식 사이트에서 받아 대조 (네트워크 필요)
//   npm run check:standards -- --cache-dir <폴더>   받은 응답을 폴더에 두고 다시 쓴다
//
// 노드의 _meta.verifiedAgainst 가 { standard, edition, clause, quotes[] } 모양이면 대조 대상이다.
//   - edition 이 현행판의 개정일과 다르면 → 기준이 개정됨 (노드를 다시 확인해야 함)
//   - quotes 의 구절이 현행 본문에 없으면 → 인용이 틀렸거나 문구가 바뀜
// 둘 중 하나라도 있으면 종료 코드 3.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchClauses, fetchEditions, normalizeStandardText } from "./kcsc.js";

// ───── 상수 ─────
const NODES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/ontology/graph/nodes");
const EXIT_MISMATCH = 3;

export interface StandardAnchor {
  standard: string;
  edition: string;
  clause: string;
  quotes: string[];
}

interface AnchoredNode {
  id: string;
  anchor: StandardAnchor;
}

export function isStandardAnchor(value: unknown): value is StandardAnchor {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["standard"] === "string" &&
    typeof v["edition"] === "string" &&
    typeof v["clause"] === "string" &&
    Array.isArray(v["quotes"]) &&
    v["quotes"].every((q) => typeof q === "string")
  );
}

/** 노드 파일에서 국가건설기준을 근거로 적은 것만 모은다 */
export function collectStandardAnchors(nodesDir = NODES_DIR): AnchoredNode[] {
  const out: AnchoredNode[] = [];
  for (const dir of readdirSync(nodesDir)) {
    for (const file of readdirSync(join(nodesDir, dir))) {
      if (!file.endsWith(".jsonld")) continue;
      const node = JSON.parse(readFileSync(join(nodesDir, dir, file), "utf8")) as {
        "@id": string;
        _meta?: { verifiedAgainst?: unknown };
      };
      const raw = node._meta?.verifiedAgainst;
      for (const item of Array.isArray(raw) ? raw : [raw]) {
        if (isStandardAnchor(item)) out.push({ id: node["@id"], anchor: item });
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const cacheAt = process.argv.indexOf("--cache-dir");
  const cacheDir = cacheAt >= 0 ? process.argv[cacheAt + 1] : undefined;
  const anchored = collectStandardAnchors();
  const byStandard = new Map<string, AnchoredNode[]>();
  for (const a of anchored) {
    byStandard.set(a.anchor.standard, [...(byStandard.get(a.anchor.standard) ?? []), a]);
  }

  const problems: string[] = [];
  let quotes = 0;
  for (const [code, nodes] of [...byStandard.entries()].sort()) {
    const editions = await fetchEditions(code, cacheDir);
    const current = editions.find((e) => e.current);
    if (!current) {
      problems.push(`${code}: 현행판을 찾지 못함`);
      continue;
    }
    const clauses = await fetchClauses(current.docInfoSeq, cacheDir);
    const text = normalizeStandardText(
      clauses
        .filter((c) => !c.abolished)
        .map((c) => c.text)
        .join("\n"),
    );
    console.log(`[standards] ${code} ${current.name} — 현행판 ${current.revisedOn} · 노드 ${nodes.length}개`);
    for (const { id, anchor } of nodes) {
      if (anchor.edition !== current.revisedOn) {
        problems.push(`${id}: ${code} 가 개정됨 — 노드는 ${anchor.edition} 판, 현행은 ${current.revisedOn} 판`);
      }
      for (const quote of anchor.quotes) {
        quotes += 1;
        if (!text.includes(normalizeStandardText(quote))) {
          problems.push(`${id}: ${code} ${anchor.clause} 에 없는 구절 — "${quote}"`);
        }
      }
    }
  }

  console.log(`[standards] 기준 ${byStandard.size}종 · 노드 ${anchored.length}개 · 인용 ${quotes}건 대조`);
  if (problems.length > 0) {
    for (const p of problems) console.error(`  ❌ ${p}`);
    console.error(`[standards] 어긋난 곳 ${problems.length}건`);
    process.exit(EXIT_MISMATCH);
  }
  console.log("[standards] 모두 현행판과 일치");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
