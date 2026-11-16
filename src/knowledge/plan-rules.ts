// ─────────────────────────────────────────────────────────────────────────────
// plan-rules.ts — 법령이 정한 품질관리계획·품질시험계획 대상과 품질관리 건설기술인 배치기준.
//
//   대상 판정   건설기술 진흥법 시행령 제89조(제1항 품질관리계획, 제2항 품질시험계획, 제3항 제외),
//               시행규칙 제49조(수립할 필요가 없는 건설공사)
//   배치기준    시행규칙 제50조제4항 · 별표 5
//
// 문구와 표는 수록 원문(src/ontology/laws)에서 읽어 그대로 돌려준다. 판정에 쓰는 수치는 아래
// 상수에 있고, 수록 원문에 같은 수치가 있는지를 시험이 본다(법령이 바뀌면 시험이 알려 준다).
// 판정에 필요한 입력이 없으면 짐작하지 않고 "판정 못함"과 필요한 입력을 돌려준다.
// ─────────────────────────────────────────────────────────────────────────────

import { editionLabel, findAnnex, findArticle, findLaw, normalizeLawText } from "../ontology/laws.js";
import type { LawBundle } from "../ontology/laws.js";
import { parseBoxTables } from "../lib/box-table.js";

// ───── 상수 (단위: 원, ㎡) ─────
const EOK = 100_000_000;
/** 영 제89조제1항제1호 — 건설사업관리 대상 + 총공사비 500억원 이상 */
export const QUALITY_PLAN_COST = 500 * EOK;
/** 영 제89조제1항제2호 — 다중이용 건축물 + 연면적 3만㎡ 이상 */
export const QUALITY_PLAN_MULTIUSE_AREA = 30_000;
/** 영 제89조제2항제1호 — 총공사비 5억원 이상 토목공사 */
export const TEST_PLAN_CIVIL_COST = 5 * EOK;
/** 영 제89조제2항제2호 — 연면적 660㎡ 이상 건축공사 */
export const TEST_PLAN_BUILDING_AREA = 660;
/** 영 제89조제2항제3호 — 총공사비 2억원 이상 전문공사 */
export const TEST_PLAN_SPECIALTY_COST = 2 * EOK;
/** 규칙 별표 5 특급 — 총공사비 1,000억원 이상 또는 연면적 5만㎡ 이상 다중이용 건축물 */
export const GRADE_SPECIAL_COST = 1_000 * EOK;
export const GRADE_SPECIAL_MULTIUSE_AREA = 50_000;
/** 규칙 별표 5 중급 — 총공사비 100억원 이상 또는 연면적 5,000㎡ 이상 다중이용 건축물 */
export const GRADE_MID_COST = 100 * EOK;
export const GRADE_MID_MULTIUSE_AREA = 5_000;

const DECREE = "건설기술 진흥법 시행령";
const RULE = "건설기술 진흥법 시행규칙";
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩";

export type WorkKind = "civil" | "building" | "specialty";
export type ExemptKind = "nuclear" | "landscaping" | "demolition";
export type Verdict = "applies" | "not_applies" | "undetermined";
export type GradeKey = "special" | "high" | "mid" | "entry";

export interface ProjectFacts {
  /** 총공사비(원) — 관급자재비 포함, 보상비 제외 */
  totalCost?: number;
  /** 공사 종류 — 토목·건축·전문 */
  workKind?: WorkKind;
  /** 연면적(㎡) */
  floorArea?: number;
  /** 건축법 시행령 제2조제17호의 다중이용 건축물인가 */
  multiUse?: boolean;
  /** 감독 권한대행 등 건설사업관리 대상 공사인가 */
  cmSupervised?: boolean;
  /** 계약에 품질관리계획을 수립하도록 되어 있는가 */
  contractRequiresQualityPlan?: boolean;
  /** 계획을 수립하지 않을 수 있는 공사 — 원자력시설·조경식재·철거 */
  exempt?: ExemptKind;
}

type Tri = boolean | null;
const and3 = (a: Tri, b: Tri): Tri => (a === false || b === false ? false : a === null || b === null ? null : true);
const or3 = (a: Tri, b: Tri): Tri => (a === true || b === true ? true : a === null || b === null ? null : false);
const atLeast = (value: number | undefined, threshold: number): Tri => (value === undefined ? null : value >= threshold);
const flag = (value: boolean | undefined): Tri => (value === undefined ? null : value);
const toVerdict = (t: Tri): Verdict => (t === true ? "applies" : t === false ? "not_applies" : "undetermined");

function law(name: string): LawBundle {
  const found = findLaw(name);
  if (!found) throw new Error(`수록 원문이 없습니다: ${name}`);
  return found;
}

/** 조문에서 한 항의 본문과 그 아래 호를 뽑는다 (paragraph: 1 = ①) */
export function paragraphOf(lawName: string, articleNo: string, paragraph: number): { text: string; items: string[] } {
  const article = findArticle(law(lawName), articleNo);
  if (!article) throw new Error(`${lawName} 제${articleNo}조가 수록본에 없습니다`);
  const mark = CIRCLED[paragraph - 1] ?? "";
  const lines = article.text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(mark));
  // 항 번호가 없는 조문(본문 한 문단 + 각 호)은 첫 줄을 본문으로 본다
  const from = start >= 0 ? start : 0;
  const items: string[] = [];
  for (const line of lines.slice(from + 1)) {
    if (!/^\s/.test(line)) break;
    if (/^ {2}\S/.test(line)) items.push(line.trim());
  }
  return { text: (lines[from] ?? "").trim(), items };
}

export interface PlanTargetJudgement {
  qualityPlan: Verdict;
  testPlan: Verdict;
  /** 한 줄 결론 */
  conclusion: string;
  /** 판정에 쓴 근거(조문 문구) */
  grounds: string[];
  /** 판정을 가를 수 있는데 받지 못한 입력 */
  missingInputs: string[];
  /** 입력과 무관하게 따로 확인할 것 */
  caveats: string[];
  /** 제1항 제1호·제2호에 해당하는지 — 배치기준 판정에 쓴다 */
  byQualityPlanItems12: Tri;
}

/** 영 제89조에 따른 품질관리계획·품질시험계획 대상 판정 */
export function judgePlanTarget(f: ProjectFacts): PlanTargetJudgement {
  const p1 = paragraphOf(DECREE, "89", 1);
  const p2 = paragraphOf(DECREE, "89", 2);
  const grounds: string[] = [];
  const missing = new Set<string>();
  const caveats = [
    "설계도서에서 품질관리계획 또는 품질시험계획을 수립하도록 되어 있으면, 수립하지 않을 수 있는 공사라도 수립해야 합니다(시행령 제89조제3항 단서).",
  ];

  if (f.exempt) {
    const exemptText =
      f.exempt === "nuclear"
        ? "원자력시설공사 (시행령 제89조제3항)"
        : `${paragraphOf(RULE, "49", 1).items.find((i) => i.includes(f.exempt === "landscaping" ? "조경식재" : "철거")) ?? ""} (시행규칙 제49조)`;
    return {
      qualityPlan: "not_applies",
      testPlan: "not_applies",
      conclusion: "품질관리계획·품질시험계획을 수립하지 않을 수 있는 공사입니다.",
      grounds: [exemptText],
      missingInputs: [],
      caveats,
      byQualityPlanItems12: false,
    };
  }

  // 제1항 — 품질관리계획
  const item1 = and3(flag(f.cmSupervised), atLeast(f.totalCost, QUALITY_PLAN_COST));
  const item2 = and3(flag(f.multiUse), atLeast(f.floorArea, QUALITY_PLAN_MULTIUSE_AREA));
  const item3 = flag(f.contractRequiresQualityPlan);
  if (item1 === true) grounds.push(`시행령 제89조제1항 ${p1.items[0] ?? ""}`);
  if (item2 === true) grounds.push(`시행령 제89조제1항 ${p1.items[1] ?? ""}`);
  if (item3 === true) grounds.push(`시행령 제89조제1항 ${p1.items[2] ?? ""}`);
  if (item1 === null) {
    if (f.totalCost === undefined) missing.add("총공사비");
    else missing.add("건설사업관리(감독 권한대행 등) 대상 여부");
  }
  if (item2 === null) {
    if (f.multiUse === undefined) missing.add("다중이용 건축물 여부");
    else missing.add("연면적");
  }
  const items12 = or3(item1, item2);
  // 제3호(계약)는 입력이 없으면 판정을 막지 않고 따로 확인하게 한다
  const qualityPlanTri: Tri = item3 === true ? true : items12;
  if (item3 === null) caveats.push("계약에 품질관리계획을 수립하도록 되어 있으면 금액·면적과 관계없이 품질관리계획 대상입니다(시행령 제89조제1항제3호).");

  // 제2항 — 품질시험계획 (품질관리계획 대상이 아닌 공사)
  const byKind: Record<WorkKind, Tri> = {
    civil: atLeast(f.totalCost, TEST_PLAN_CIVIL_COST),
    building: atLeast(f.floorArea, TEST_PLAN_BUILDING_AREA),
    specialty: atLeast(f.totalCost, TEST_PLAN_SPECIALTY_COST),
  };
  let sizeTri: Tri;
  if (f.workKind) {
    sizeTri = byKind[f.workKind];
    if (sizeTri === null) missing.add(f.workKind === "building" ? "연면적" : "총공사비");
    if (sizeTri === true) grounds.push(`시행령 제89조제2항 ${p2.items[{ civil: 0, building: 1, specialty: 2 }[f.workKind]] ?? ""}`);
  } else {
    const all = Object.values(byKind);
    sizeTri = all.every((t) => t === true) ? true : all.every((t) => t === false) ? false : null;
    if (sizeTri === null) missing.add("공사 종류(토목·건축·전문)");
    if (sizeTri === true) grounds.push(`시행령 제89조제2항 각 호 — ${p2.items.join(" / ")}`);
  }
  const testPlanTri: Tri = qualityPlanTri === true ? false : qualityPlanTri === null && sizeTri === true ? null : sizeTri;

  const qualityPlan = toVerdict(qualityPlanTri);
  const testPlan = toVerdict(testPlanTri);
  let conclusion: string;
  if (qualityPlan === "applies") conclusion = "품질관리계획 수립 대상입니다.";
  else if (qualityPlan === "not_applies" && testPlan === "applies") conclusion = "품질시험계획 수립 대상입니다.";
  else if (qualityPlan === "not_applies" && testPlan === "not_applies") conclusion = "금액·면적 기준으로는 품질관리계획·품질시험계획 수립 대상이 아닙니다.";
  else if (qualityPlan === "undetermined" && sizeTri === true) conclusion = "품질관리계획 또는 품질시험계획 가운데 하나의 수립 대상입니다. 어느 쪽인지는 아래 입력이 있어야 가릴 수 있습니다.";
  else conclusion = "받은 입력만으로는 대상 여부를 가릴 수 없습니다. 아래 입력을 주십시오.";

  return { qualityPlan, testPlan, conclusion, grounds, missingInputs: [...missing], caveats, byQualityPlanItems12: items12 };
}

export interface StaffingRow {
  grade: GradeKey;
  /** 대상공사 구분 — "특급 품질관리 대상공사" 등 */
  name: string;
  scope: string;
  equipment: string;
  labSize: string;
  staff: string;
}

export interface StaffingStandard {
  source: string;
  edition: string;
  title: string;
  rows: StaffingRow[];
  /** 표 아래 비고 */
  notes: string[];
  /** 옮겨 적은 방식에 대한 안내 */
  textNote: string;
}

const GRADE_KEYS: Array<{ key: GradeKey; word: string }> = [
  { key: "special", word: "특급" },
  { key: "high", word: "고급" },
  { key: "mid", word: "중급" },
  { key: "entry", word: "초급" },
];

/** 규칙 별표 5 — 표와 비고를 원문에서 읽는다 */
export function staffingStandard(): StaffingStandard {
  const rule = law(RULE);
  const annex = findAnnex(rule, "별표 5");
  if (!annex) throw new Error("시행규칙 별표 5가 수록본에 없습니다");
  const table = parseBoxTables(annex.text)[0];
  if (!table) throw new Error("시행규칙 별표 5의 표를 읽지 못했습니다");
  const rows: StaffingRow[] = [];
  for (const { key, word } of GRADE_KEYS) {
    const row = table.rows.find((r) => normalizeLawText(r[0] ?? "").startsWith(word));
    if (!row) throw new Error(`시행규칙 별표 5에서 ${word} 행을 찾지 못했습니다`);
    rows.push({ grade: key, name: row[0] ?? "", scope: row[1] ?? "", equipment: row[2] ?? "", labSize: row[3] ?? "", staff: row[4] ?? "" });
  }
  // 비고 — 표 뒤의 글을 번호별로 이어 붙인다
  const after = annex.text.slice(annex.text.lastIndexOf("┘") + 1);
  const notes: string[] = [];
  for (const line of after.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (line === "비고") continue;
    if (/^\d+\./.test(line) || notes.length === 0) notes.push(line);
    else notes[notes.length - 1] += line;
  }
  return {
    source: `${RULE} 제50조제4항 · 별표 5`,
    edition: editionLabel(rule),
    title: annex.title,
    rows,
    notes,
    textNote: "원문 표의 칸 안 글자를 그대로 이어 붙였습니다. 줄이 바뀐 자리의 띄어쓰기는 원문과 다를 수 있습니다.",
  };
}

export interface GradeJudgement {
  grade: GradeKey | null;
  /** 판정이 갈리는 후보 (판정 못함일 때) */
  candidates: GradeKey[];
  conclusion: string;
  row: StaffingRow | null;
  missingInputs: string[];
}

/** 규칙 별표 5 에 따른 품질관리 대상공사 구분 */
export function judgeStaffingGrade(f: ProjectFacts): GradeJudgement {
  const target = judgePlanTarget(f);
  const standard = staffingStandard();
  const rowOf = (g: GradeKey): StaffingRow => standard.rows.find((r) => r.grade === g) as StaffingRow;
  const done = (grade: GradeKey): GradeJudgement => ({
    grade,
    candidates: [grade],
    conclusion: `${rowOf(grade).name}에 해당합니다.`,
    row: rowOf(grade),
    missingInputs: [],
  });
  const open = (candidates: GradeKey[], missing: string[]): GradeJudgement => ({
    grade: null,
    candidates,
    conclusion: `받은 입력만으로는 구분을 가릴 수 없습니다(후보: ${candidates.map((g) => rowOf(g).name).join(", ") || "없음"}).`,
    row: null,
    missingInputs: missing,
  });

  if (f.exempt) {
    return { grade: null, candidates: [], conclusion: "품질관리계획·품질시험계획을 수립하지 않을 수 있는 공사라 배치기준의 대상공사 구분에 들지 않습니다.", row: null, missingInputs: [] };
  }
  const items12 = target.byQualityPlanItems12;
  if (items12 === true) {
    const special = or3(atLeast(f.totalCost, GRADE_SPECIAL_COST), and3(flag(f.multiUse), atLeast(f.floorArea, GRADE_SPECIAL_MULTIUSE_AREA)));
    if (special === true) return done("special");
    if (special === false) return done("high");
    return open(["special", "high"], [f.totalCost === undefined ? "총공사비" : "", f.multiUse === undefined ? "다중이용 건축물 여부" : f.floorArea === undefined ? "연면적" : ""].filter(Boolean));
  }
  if (items12 === null) return open(["special", "high", "mid", "entry"], target.missingInputs);
  const mid = or3(atLeast(f.totalCost, GRADE_MID_COST), and3(flag(f.multiUse), atLeast(f.floorArea, GRADE_MID_MULTIUSE_AREA)));
  if (mid === true) return done("mid");
  if (mid === null) return open(["mid", "entry"], [f.totalCost === undefined ? "총공사비" : "", f.multiUse === undefined ? "다중이용 건축물 여부" : f.floorArea === undefined ? "연면적" : ""].filter(Boolean));
  if (target.testPlan === "applies") return done("entry");
  if (target.testPlan === "not_applies") {
    return { grade: null, candidates: [], conclusion: "품질시험계획 수립 대상이 아니어서 배치기준의 대상공사 구분에 들지 않습니다.", row: null, missingInputs: [] };
  }
  return open(["entry"], target.missingInputs);
}
