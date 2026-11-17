// ─────────────────────────────────────────────────────────────────────────────
// test-plan-frequency.ts — 품질시험계획서의 시험 빈도 채우기를 실무자 말투의 줄로 채점한다.
//
//   묶음: scripts/test/fixtures/plan-frequency.json (고칠 때 보는 묶음)
//         scripts/test/fixtures/plan-frequency-holdout.json (보지 않는 묶음 — --holdout, 전체 수치만)
//   줄마다 (공종, 시험종목) 과 기대:
//     fill — 업무지침 별표 2 의 그 행 빈도를 채워야 한다
//     ask  — 원문이 정말로 갈린다: 칸을 비우고 include 행을 후보로 보여야 한다
//   잰 것: 맞게 채움 · 맞게 물음 · 틀리게 채움(다른 빈도를 채움, 또는 물어야 할 줄을 채움) · 못 채움
//   통과 조건: 틀리게 채움 0, 맞음(채움+물음) 비율이 --min 이상
//
//   묶음 자체도 검사한다 — fill 의 정답 행은 빈도가 한 가지, ask 의 include 행은 빈도가 두 가지 이상이어야 한다
//   (원문이 바뀌어 정답이 흔들리면 도구가 아니라 묶음을 다시 봐야 한다).
//
// 사용:
//   tsx scripts/test/test-plan-frequency.ts --min 90
//   tsx scripts/test/test-plan-frequency.ts --holdout --min 85
//   tsx scripts/test/test-plan-frequency.ts --detail        줄마다 결과
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { join } from "node:path";

// ───── 상수 ─────
const FIXTURES = join(import.meta.dirname, "fixtures");
const TUNING = "plan-frequency.json";
const HOLDOUT = "plan-frequency-holdout.json";
const args = process.argv.slice(2);
const holdout = args.includes("--holdout");
const detail = args.includes("--detail") && !holdout;
const minIndex = args.indexOf("--min");
const MIN = minIndex >= 0 ? Number(args[minIndex + 1]) : 0;

const { loadTestStandards } = await import("../../src/knowledge/test-standards.js");
const { getSchema } = await import("../../src/schemas/loader.js");
const { buildDocumentBody } = await import("../../src/lib/document-body.js");
const { fillTestPlanFrequencies, linkedRows, testStandardLinks } = await import("../../src/lib/test-plan-fill.js");

interface RowRef { category: string; item: string; section?: string }
interface Case { workType: string; testItem: string; expect: "fill" | "ask"; row?: RowRef; include?: RowRef[] }

const squash = (s: string): string => s.replace(/\s+/g, "").toLowerCase();
const tidy = (s: string): string => s.replace(/\s+/g, " ").trim();
const { rows } = loadTestStandards();

/** 종별·시험종목·구분의 글자를 포함하는 별표 2 행 */
function rowsOf(ref: RowRef): typeof rows {
  return rows.filter((r) => squash(r.category).includes(squash(ref.category)) && squash(r.item).includes(squash(ref.item)) && (!ref.section || squash(r.section).includes(squash(ref.section))));
}
/** 빈도 글 — 띄어쓰기만 다른 글("숫자 중"·"숫자중")은 같은 빈도로 본다 */
const frequenciesOf = (list: typeof rows): string[] => [...new Set(list.map((r) => squash(r.frequency)))];

const cases = (JSON.parse(readFileSync(join(FIXTURES, holdout ? HOLDOUT : TUNING), "utf8")) as { cases: Case[] }).cases;

// ── 묶음 검사 ──
const broken: string[] = [];
for (const c of cases) {
  if (c.expect === "fill") {
    const found = c.row ? rowsOf(c.row) : [];
    if (found.length === 0 || frequenciesOf(found).length !== 1) broken.push(`${c.workType}/${c.testItem}: 정답 행 ${found.length}개, 빈도 ${frequenciesOf(found).length}가지`);
  } else {
    const found = (c.include ?? []).flatMap((ref) => rowsOf(ref));
    if ((c.include ?? []).some((ref) => rowsOf(ref).length === 0) || frequenciesOf(found).length < 2) broken.push(`${c.workType}/${c.testItem}: 후보 행의 빈도가 한 가지뿐이거나 없는 행`);
  }
}
// ── 온톨로지 연결 검사 — 시험 노드가 잇는 별표 2 행이 원문에 있고, 노드의 기본 행은 빈도가 한 가지다 ──
const links = testStandardLinks();
const byNode = new Map<string, typeof rows>();
for (const { id, link } of links) {
  const found = linkedRows(link);
  if (found.length === 0) broken.push(`${id}: 잇는 행이 별표 2 에 없음 — ${link.category} · ${link.item}`);
  if (link.default) byNode.set(id, [...(byNode.get(id) ?? []), ...found]);
}
for (const [id, list] of byNode) if (frequenciesOf(list).length !== 1) broken.push(`${id}: 기본 행의 빈도가 ${frequenciesOf(list).length}가지`);
if (links.length === 0) broken.push("시험 노드의 별표 2 연결이 하나도 없음");
// 모든 시험 노드는 별표 2 행을 잇거나, 별표 2 에 없는 시험이라는 까닭(testStandardNote)을 적는다
const { loadOntologySync } = await import("../../src/ontology/loader.js");
for (const e of loadOntologySync().entities.values()) {
  if (e.type !== "TestItem") continue;
  const meta = e.meta as Record<string, unknown>;
  const has = Array.isArray(meta["testStandardRows"]) && (meta["testStandardRows"] as unknown[]).length > 0;
  if (!has && typeof meta["testStandardNote"] !== "string") broken.push(`${e.id}: 별표 2 연결도, 없는 까닭도 없음`);
}

if (broken.length > 0) {
  console.error(`[plan-frequency] 묶음 오류 ${broken.length}건 — 별표 2 원문과 맞지 않는다:\n  ${broken.join("\n  ")}`);
  process.exit(1);
}

// ── 채우기 ──
const schema = getSchema("quality_test_plan");
if (!schema) throw new Error("양식 없음: quality_test_plan");
const body = buildDocumentBody(schema, { testItems: cases.map((c) => ({ workType: c.workType, testItem: c.testItem })) });
const { filled, candidates } = fillTestPlanFrequencies(body);

let fillOk = 0;
let askOk = 0;
let wrong = 0;
let missed = 0;
const lines: string[] = [];
cases.forEach((c, i) => {
  const got = filled.find((f) => f.row === i + 1);
  const offered = candidates.find((x) => x.row === i + 1);
  const label = `${c.workType} / ${c.testItem}`;
  if (c.expect === "fill") {
    const want = frequenciesOf(rowsOf(c.row as RowRef))[0];
    if (got && squash(got.frequency) === want) {
      fillOk += 1;
      lines.push(`  ✓ 채움  ${label}`);
    } else if (got) {
      wrong += 1;
      lines.push(`  ✗ 틀림  ${label} — 채운 빈도: ${got.frequency.slice(0, 60)} (행: ${got.from.join(" / ").slice(0, 80)})`);
    } else {
      missed += 1;
      lines.push(`  · 못 채움 ${label} — ${offered ? `후보 ${offered.candidates.length}개` : "후보 없음"}`);
    }
  } else if (got) {
    wrong += 1;
    lines.push(`  ✗ 틀림  ${label} — 물어야 할 줄을 채움: ${got.frequency.slice(0, 60)}`);
  } else {
    const want = (c.include ?? []).every((ref) => (offered?.candidates ?? []).some((x) => squash(x.category).includes(squash(ref.category)) && squash(x.item).includes(squash(ref.item))));
    if (want) {
      askOk += 1;
      lines.push(`  ✓ 물음  ${label}`);
    } else {
      missed += 1;
      lines.push(`  · 못 물음 ${label} — ${offered ? `후보 ${offered.candidates.map((x) => `${x.category}·${x.item}`).join(", ").slice(0, 100)}` : "후보 없음"}`);
    }
  }
});

const total = cases.length;
const rate = Math.round(((fillOk + askOk) / total) * 1000) / 10;
if (detail) console.log(lines.join("\n"));
console.log(
  `[plan-frequency${holdout ? " · 보지 않는 묶음" : ""}] ${total}줄 — 맞게 채움 ${fillOk} · 맞게 물음 ${askOk} · 못 채움 ${missed} · 틀리게 채움 ${wrong} → 맞음 ${rate}%`,
);
if (wrong > 0 || rate < MIN) {
  console.error(`[plan-frequency] 실패 — 틀리게 채움 ${wrong} (0 이어야 함), 맞음 ${rate}% (바닥 ${MIN}%)`);
  process.exit(1);
}
