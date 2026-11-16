#!/usr/bin/env tsx
/**
 * sync-laws.ts — 품질관리 관련 법령·고시의 전 조문과 별표·서식을 받아 src/ontology/laws/ 에 싣는다.
 *
 * 대상: 건설기술 진흥법 · 시행령 · 시행규칙 · 건설공사 품질관리 업무지침 ·
 *       건설공사 사업관리방식 검토기준 및 업무수행지침
 *
 * 출처: 법제처 국가법령정보센터 OpenAPI (lawService.do). 법령·고시는 저작권법 제7조에 따라
 *       자유롭게 실을 수 있다.
 *
 * 사용:
 *   LAW_OC=<법제처 OpenAPI 등록 ID> tsx scripts/sync/sync-laws.ts          # 현행판을 받아 갱신
 *   tsx scripts/sync/sync-laws.ts --from-dir <XML 을 받아 둔 폴더>           # 받아 둔 XML 로 갱신
 *   tsx scripts/sync/sync-laws.ts --check                                    # 수록본이 현행판과 같은지만 확인
 *
 * 받아 둔 XML 의 파일 이름: <id>.xml (id 는 아래 INSTRUMENTS 의 id)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { missingArticleNumbers, parseAdmRulXml, parseLawXml, type LawKind, type ParsedLaw } from "./law-xml.js";

// ── 상수 ────────────────────────────────────────────────────────────
const ROOT = join(import.meta.dirname, "..", "..");
const OUT_DIR = join(ROOT, "src/ontology/laws");
const API = "https://www.law.go.kr/DRF/lawService.do";
const REQUEST_GAP_MS = 400;
const EXIT_OUTDATED = 3;

interface Instrument {
  id: string;
  kind: LawKind;
  name: string;
  /** 본문·인용에서 쓰이는 다른 이름 */
  aliases: string[];
  /** lawService.do 요청 인자 — 법령은 법령ID(ID), 행정규칙은 행정규칙ID(LID) 로 현행판을 받는다 */
  query: { target: "law" | "admrul"; key: "ID" | "LID"; value: string };
  /** 사람이 여는 원문 주소 */
  url: string;
}

export const INSTRUMENTS: Instrument[] = [
  {
    id: "btia",
    kind: "act",
    name: "건설기술 진흥법",
    aliases: ["건설기술진흥법", "건진법", "법"],
    query: { target: "law", key: "ID", value: "001807" },
    url: "https://www.law.go.kr/법령/건설기술진흥법",
  },
  {
    id: "btia_decree",
    kind: "decree",
    name: "건설기술 진흥법 시행령",
    aliases: ["건설기술진흥법 시행령", "건설기술진흥법시행령", "건진법 시행령", "시행령", "영"],
    query: { target: "law", key: "ID", value: "002111" },
    url: "https://www.law.go.kr/법령/건설기술진흥법시행령",
  },
  {
    id: "btia_rule",
    kind: "rule",
    name: "건설기술 진흥법 시행규칙",
    aliases: ["건설기술진흥법 시행규칙", "건설기술진흥법시행규칙", "건진법 시행규칙", "시행규칙", "규칙"],
    query: { target: "law", key: "ID", value: "006175" },
    url: "https://www.law.go.kr/법령/건설기술진흥법시행규칙",
  },
  {
    id: "quality_guideline",
    kind: "notice",
    name: "건설공사 품질관리 업무지침",
    aliases: ["품질관리 업무지침", "건설공사품질관리업무지침", "업무지침", "품질지침"],
    query: { target: "admrul", key: "LID", value: "48782" },
    url: "https://www.law.go.kr/행정규칙/건설공사품질관리업무지침",
  },
  {
    id: "cm_guideline",
    kind: "notice",
    name: "건설공사 사업관리방식 검토기준 및 업무수행지침",
    aliases: ["사업관리방식 검토기준 및 업무수행지침", "건설공사사업관리방식검토기준및업무수행지침", "사업관리지침", "사업관리방식 지침"],
    query: { target: "admrul", key: "LID", value: "48823" },
    url: "https://www.law.go.kr/행정규칙/건설공사사업관리방식검토기준및업무수행지침",
  },
];

export interface LawBundle extends ParsedLaw {
  id: string;
  kind: LawKind;
  aliases: string[];
  source: { provider: string; url: string; license: string };
}

async function fetchXml(inst: Instrument, oc: string): Promise<string> {
  const url = `${API}?OC=${encodeURIComponent(oc)}&target=${inst.query.target}&type=XML&${inst.query.key}=${inst.query.value}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${inst.name}: 응답 ${res.status}`);
  const xml = await res.text();
  if (!xml.includes("조문내용")) throw new Error(`${inst.name}: 조문이 없는 응답 — ${xml.slice(0, 200).replace(/\s+/g, " ")}`);
  return xml;
}

function toBundle(inst: Instrument, xml: string): LawBundle {
  const parsed = inst.query.target === "law" ? parseLawXml(xml) : parseAdmRulXml(xml);
  if (parsed.name.replace(/\s/g, "") !== inst.name.replace(/\s/g, "")) {
    throw new Error(`${inst.name}: 받은 문서의 이름이 다릅니다 — ${parsed.name}`);
  }
  const missing = missingArticleNumbers(parsed.articles);
  if (parsed.articles.length === 0 || missing.length > 0) {
    throw new Error(`${inst.name}: 조문 번호가 이어지지 않습니다 — 빠진 번호 ${missing.join(", ") || "(조문 없음)"}`);
  }
  return {
    id: inst.id,
    kind: inst.kind,
    aliases: inst.aliases,
    source: {
      provider: "법제처 국가법령정보센터",
      url: inst.url,
      license: "저작권법 제7조 — 법령·고시는 저작권 보호 대상이 아님",
    },
    ...parsed,
  };
}

function editionOf(b: { promulgationNumber: string; effectiveDate: string }): string {
  return `${b.promulgationNumber} · 시행 ${b.effectiveDate}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fromDirIndex = args.indexOf("--from-dir");
  const fromDir = fromDirIndex >= 0 ? args[fromDirIndex + 1] : undefined;
  const checkOnly = args.includes("--check");
  const oc = process.env.LAW_OC;
  if (!fromDir && !oc) {
    console.error("LAW_OC 환경 변수(법제처 OpenAPI 등록 ID)가 필요합니다. 받아 둔 XML 을 쓰려면 --from-dir <폴더>.");
    process.exit(2);
  }

  await mkdir(OUT_DIR, { recursive: true });
  let outdated = 0;
  for (const inst of INSTRUMENTS) {
    const xml = fromDir ? await readFile(join(fromDir, `${inst.id}.xml`), "utf8") : await fetchXml(inst, oc as string);
    const bundle = toBundle(inst, xml);
    const outPath = join(OUT_DIR, `${inst.id}.json`);
    const next = `${JSON.stringify(bundle, null, 1)}\n`;
    const prev = existsSync(outPath) ? await readFile(outPath, "utf8") : "";
    const prevEdition = prev ? editionOf(JSON.parse(prev) as LawBundle) : "(없음)";
    const same = prev === next;
    const stats = `조문 ${bundle.articles.length} · 별표 ${bundle.annexes.filter((a) => a.kind === "별표").length} · 서식 ${bundle.annexes.filter((a) => a.kind === "별지").length}`;
    if (checkOnly) {
      if (!same) outdated += 1;
      console.log(`${same ? "✓" : "✗"} ${inst.name}: 수록 ${prevEdition} / 현행 ${editionOf(bundle)}${same ? "" : " — 내용이 다릅니다"}`);
    } else {
      if (!same) await writeFile(outPath, next, "utf8");
      console.log(`${same ? "=" : "↻"} ${inst.name}: ${editionOf(bundle)} · ${stats}${same ? "" : ` (이전 ${prevEdition})`}`);
    }
    if (!fromDir) await new Promise((r) => setTimeout(r, REQUEST_GAP_MS));
  }
  if (checkOnly && outdated > 0) {
    console.error(`수록본 ${outdated}건이 현행판과 다릅니다. 'npm run sync:laws' 로 갱신한 뒤 관련 자료를 확인하세요.`);
    process.exit(EXIT_OUTDATED);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
