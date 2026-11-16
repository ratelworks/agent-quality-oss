// ─────────────────────────────────────────────────────────────────────────────
// sync-ks-names.ts — KS 표준 노드의 이름을 국가기술표준원(e나라 표준인증)의 표준명과 맞춘다.
//
//   npm run sync:ks-names              노드의 이름·개정확인일을 공식 목록 값으로 고친다
//   npm run check:ks-names             고치지 않고 다른 곳만 알린다 (다르면 종료 코드 3)
//
// KS 번호는 맞는데 표준명이 옛 표기이거나 다른 표준의 이름을 붙인 경우를 잡는다.
// 번호 자체가 용도에 맞는지(예: 현장 밀도는 KS F 2311)는 사람이 품질시험기준(업무지침 별표 2)과 견줘야 한다.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lookupKs, normalizeKsName } from "./ks-lookup.js";

// ───── 상수 ─────
const STANDARDS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/ontology/graph/nodes/standards");
const KS_NUMBER = /^(KS [A-Z](?: ISO)? \d+(?:-\d+)?)/;
const REQUEST_GAP_MS = 400;
const EXIT_MISMATCH = 3;

interface KsNode {
  "@id": string;
  name: string;
  aliases?: string[];
  _meta?: Record<string, unknown>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  const files = readdirSync(STANDARDS_DIR).filter((f) => f.startsWith("ks_") && f.endsWith(".jsonld"));
  const problems: string[] = [];
  let changed = 0;

  for (const file of files) {
    const path = join(STANDARDS_DIR, file);
    const node = JSON.parse(readFileSync(path, "utf8")) as KsNode;
    const meta = (node._meta ??= {});
    const number = (typeof meta["ksNumber"] === "string" ? meta["ksNumber"] : KS_NUMBER.exec(node.name)?.[1]) ?? null;
    if (!number) {
      problems.push(`${node["@id"]}: 이름에서 KS 번호를 읽지 못함 — "${node.name}"`);
      continue;
    }
    const listed = (await lookupKs(number)).find((r) => !r.abolished);
    await sleep(REQUEST_GAP_MS);
    if (!listed) {
      problems.push(`${node["@id"]}: ${number} 를 표준 목록에서 찾지 못함(폐지됐을 수 있음)`);
      continue;
    }
    const wantedName = `${number} ${listed.name}`;
    const same =
      normalizeKsName(String(meta["officialName"] ?? "")) === normalizeKsName(listed.name) &&
      normalizeKsName(node.name) === normalizeKsName(wantedName) &&
      meta["confirmedOn"] === listed.confirmedOn;
    if (same) continue;
    if (checkOnly) {
      problems.push(`${node["@id"]}: 표준명·개정확인일이 다름 — 노드 "${node.name}"(${String(meta["confirmedOn"] ?? "없음")}) / 공식 "${wantedName}"(${listed.confirmedOn})`);
      continue;
    }
    node.name = wantedName;
    meta["ksNumber"] = number;
    meta["officialName"] = listed.name;
    meta["confirmedOn"] = listed.confirmedOn;
    node.aliases = [...new Set([number, ...(node.aliases ?? [])])];
    writeFileSync(path, `${JSON.stringify(node, null, 2)}\n`);
    changed += 1;
  }

  console.log(`[ks-names] KS 노드 ${files.length}개 · ${checkOnly ? "점검" : `고침 ${changed}개`}`);
  if (problems.length > 0) {
    for (const p of problems) console.error(`  ❌ ${p}`);
    process.exit(EXIT_MISMATCH);
  }
  console.log("[ks-names] 모두 공식 표준명과 일치");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
