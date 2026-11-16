// ─────────────────────────────────────────────────────────────────────────────
// sync-docs.ts — 안내문의 수치를 실제 자료에서 다시 적는다.
//
// 안내문에 손으로 적은 수(도구 수·그래프 크기·수록 법령·문서 종수)는 자료가 바뀔 때마다 낡는다.
// 이 스크립트가 자료에서 세어 정해진 자리에 다시 적는다.
//
//   자리 표시 — <!-- stat:이름 -->여기가 바뀐다<!-- /stat:이름 -->   (화면에는 보이지 않는다)
//   그 밖에  — 배지의 버전·도구 수, "도구 N개", "(패키지 버전: X.Y.Z)", 맥락 정의의 버전 표기
//
// 사용:
//   npm run docs:sync    # 다시 적는다
//   npm run docs:check   # 적힌 값이 자료와 다르면 실패 (게시 전 검사·CI)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOntologySync } from "../../src/ontology/loader.js";
import { OntologyGraph } from "../../src/ontology/graph.js";
import { validateOntology } from "../../src/ontology/validator.js";
import { loadLaws } from "../../src/ontology/laws.js";
import { loadTestStandards } from "../../src/knowledge/test-standards.js";
import { loadFieldPhrases } from "../../src/knowledge/field-phrases.js";
import { getSchema, listSchemaIds } from "../../src/schemas/loader.js";
import { documentTitle } from "../../src/lib/document-body.js";
import { TOOL_DEFS } from "../../src/tool-registry.js";

// ───── 상수 ─────
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TARGET_DOCS = [
  "README.md",
  "CONTRIBUTING.md",
  "AGENTS.md",
  "docs/IDENTITY.md",
  "docs/ARCHITECTURE.md",
  "docs/ONTOLOGY.md",
  "docs/SETUP_CLAUDE_DESKTOP.md",
  "examples/README.md",
];
/** 자리 표시만 다시 적는 문서 — 과거 시점 기록이 섞여 있어 "도구 N개" 같은 모양 찾기는 하지 않는다 */
const MARKER_ONLY_DOCS = ["ROADMAP.md"];
const CONTEXT_PATH = "src/ontology/graph/context.jsonld";
const SMOKE_PATH = "scripts/smoke-test.ts";
/** 문서 분류 — 양식 자료의 classification 값과 안내문에 적는 말 */
const FORMAL_CLASSES = ["statutory_form", "statutory_content", "notice_form"];

interface Facts {
  version: string;
  tools: number;
  nodes: number;
  relations: number;
  orphans: number;
  workTypes: number;
  verified: number;
  criteria: number;
  criteriaVerified: number;
  smoke: number;
  articles: number;
  annexTables: number;
  annexForms: number;
  lawNames: string[];
  testRows: number;
  testCategories: number;
  fieldTerms: number;
  fieldPhrases: number;
  formal: string[];
  practice: string[];
}

const thousands = (n: number): string => n.toLocaleString("en-US");

function collectFacts(): Facts {
  const graph = new OntologyGraph(loadOntologySync());
  const report = validateOntology(graph);
  const laws = loadLaws();
  const standards = loadTestStandards();
  const phrases = loadFieldPhrases();
  const formal: string[] = [];
  const practice: string[] = [];
  for (const id of listSchemaIds()) {
    const schema = getSchema(id);
    if (!schema) continue;
    const classification = (schema as { classification?: string }).classification ?? "";
    (FORMAL_CLASSES.includes(classification) ? formal : practice).push(documentTitle(schema));
  }
  const smokeSource = readFileSync(join(ROOT, SMOKE_PATH), "utf8");
  return {
    version: (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version,
    tools: TOOL_DEFS.length,
    nodes: graph.entities.size,
    relations: graph.stats().relations,
    orphans: report.issues.filter((i) => i.code === "ORPHAN_NODE").length,
    workTypes: [...graph.entities.values()].filter((e) => e.type === "WorkType").length,
    verified: [...graph.entities.values()].filter((e) => e.meta.sourceStatus === "verified").length,
    criteria: [...graph.entities.values()].filter((e) => e.type === "AcceptanceCriteria").length,
    criteriaVerified: [...graph.entities.values()].filter((e) => e.type === "AcceptanceCriteria" && e.meta.sourceStatus === "verified").length,
    // 회귀 사례 수 — 사례마다 네 칸 들여 쓴 "tool:" 줄이 하나씩 있다(문서 정합 검사와 같은 방식으로 센다)
    smoke: (smokeSource.match(/^ {4}tool:\s*['"]/gm) ?? []).length,
    articles: laws.reduce((sum, l) => sum + l.articles.filter((a) => !a.deleted).length, 0),
    annexTables: laws.reduce((sum, l) => sum + l.annexes.filter((x) => x.kind === "별표").length, 0),
    annexForms: laws.reduce((sum, l) => sum + l.annexes.filter((x) => x.kind === "별지").length, 0),
    lawNames: laws.map((l) => l.name),
    testRows: standards.rows.length,
    testCategories: new Set(standards.rows.map((r) => r.category)).size,
    fieldTerms: Object.keys(phrases.terms).length + Object.keys(phrases.rowTerms).length,
    fieldPhrases: Object.values(phrases.phrases).reduce((sum, list) => sum + list.length, 0),
    formal,
    practice,
  };
}

/** 자리 표시 이름 → 그 자리에 적을 글 */
const MARKERS: Record<string, (f: Facts) => string> = {
  graph: (f) => `그래프 노드 **${f.nodes}개** · 관계 **${f.relations}개**`,
  "work-types": (f) => `${f.workTypes}종`,
  laws: (f) =>
    `${f.lawNames.join(" · ")} — 다섯 법령·고시의 **조문 ${thousands(f.articles)}개 · 별표 ${f.annexTables}개 · 별지 서식 ${f.annexForms}개**`,
  "test-rows": (f) => `시험종목 **${thousands(f.testRows)}행**(자재·공종 ${f.testCategories}종)`,
  forms: (f) =>
    `법령·고시가 서식이나 기재 내용을 정한 문서 ${f.formal.length}종(${f.formal.join(" · ")}) + 실무 서식 ${f.practice.length}종(${f.practice.join(" · ")})`,
  integrity: (f) => `통과 (노드 ${f.nodes} · 관계 ${f.relations} · orphan ${f.orphans})`,
  verified: (f) => `${f.verified}/${f.nodes} 노드 (${Math.round((f.verified / f.nodes) * 100)}%)`,
  smoke: (f) => `${f.smoke}/${f.smoke} 통과`,
  tools: (f) => `${f.tools}개`,
  criteria: (f) => `${f.criteriaVerified}/${f.criteria} (${Math.round((f.criteriaVerified / f.criteria) * 100)}%)`,
  "field-data": (f) => `현장 용어 ${f.fieldTerms}개 · 현장 표현 ${f.fieldPhrases}문장`,
};

/** 자리 표시 없이 모양으로 찾아 바꾸는 것 — [찾을 모양, 바꿀 글] */
function patternRules(f: Facts): Array<[RegExp, string]> {
  return [
    [/release-v\d+\.\d+\.\d+(-[\w.]+)?-blue/g, `release-v${f.version}-blue`],
    [/MCP%20tools-\d+-orange/g, `MCP%20tools-${f.tools}-orange`],
    [/((?:MCP )?도구\s*\*{0,2})\d+(\*{0,2}개)/g, `$1${f.tools}$2`],
    [/\(패키지 버전: \d+\.\d+\.\d+(-[\w.]+)?\)/g, `(패키지 버전: ${f.version})`],
  ];
}

function syncText(text: string, facts: Facts, unknown: Set<string>, markersOnly = false): string {
  let next = text.replace(/<!-- stat:([\w-]+) -->[\s\S]*?<!-- \/stat:\1 -->/g, (whole, key: string) => {
    const render = MARKERS[key];
    if (!render) {
      unknown.add(key);
      return whole;
    }
    return `<!-- stat:${key} -->${render(facts)}<!-- /stat:${key} -->`;
  });
  if (markersOnly) return next;
  for (const [pattern, replacement] of patternRules(facts)) next = next.replace(pattern, replacement);
  return next;
}

function main(): void {
  const check = process.argv.includes("--check");
  const facts = collectFacts();
  const unknown = new Set<string>();
  const stale: string[] = [];

  const apply = (file: string, next: string, current: string): void => {
    if (next === current) return;
    stale.push(file);
    if (!check) writeFileSync(join(ROOT, file), next, "utf8");
  };

  for (const file of TARGET_DOCS) {
    const current = readFileSync(join(ROOT, file), "utf8");
    apply(file, syncText(current, facts, unknown), current);
  }
  for (const file of MARKER_ONLY_DOCS) {
    const current = readFileSync(join(ROOT, file), "utf8");
    apply(file, syncText(current, facts, unknown, true), current);
  }
  // 맥락 정의 머리의 버전 표기
  const context = readFileSync(join(ROOT, CONTEXT_PATH), "utf8");
  apply(CONTEXT_PATH, context.replace(/("owl:versionInfo":\s*")[^"]*(")/, `$1${facts.version}$2`), context);

  if (unknown.size > 0) {
    console.error(`[docs] 모르는 자리 표시: ${[...unknown].join(", ")} — MARKERS 에 더하거나 문서에서 지우세요.`);
    process.exit(1);
  }
  if (check && stale.length > 0) {
    console.error(`[docs] 자료와 다른 수치가 있습니다 — \`npm run docs:sync\` 로 다시 적으세요: ${stale.join(", ")}`);
    process.exit(1);
  }
  console.log(check ? "[docs] 안내문의 수치가 자료와 같습니다." : stale.length > 0 ? `[docs] 다시 적음: ${stale.join(", ")}` : "[docs] 바꿀 것이 없습니다.");
}

main();
