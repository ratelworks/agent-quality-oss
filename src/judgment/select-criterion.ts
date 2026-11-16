// ─────────────────────────────────────────────────────────────────────────────
// select-criterion.ts — 시험의 기준 후보 가운데 관측값 문장에 맞는 것을 골라 판정한다.
//
// 한 시험에 기준이 여럿인 경우가 있다(압축강도: 공시체 종류별 / 거푸집 해체 강도: 부재별 /
// 콘크리트 온도: 한중·서중). 문장이 조건을 말하면 그 기준으로 판정하고, 말하지 않으면
// 후보 모두로 견주어 결론이 같을 때만 합격·불합격을 낸다.
// ─────────────────────────────────────────────────────────────────────────────

import { evaluate } from "./evaluate.js";
import type { Judgment } from "./evaluate.js";
import { parseContext } from "./parse-observation.js";
import type { OntologyGraph } from "../ontology/graph.js";
import type { BaseEntity } from "../ontology/schema.js";

// ───── 상수 ─────
/** 기준 강도 범위를 나누는 경계 (KCS 14 20 10 표 3.5-3) */
const RANGE_SPLIT_MPA = 35;

type Meta = Record<string, unknown>;
const metaOf = (e: BaseEntity): Meta => (e.meta ?? {}) as Meta;
const keywordsOf = (e: BaseEntity): string[] => {
  const k = metaOf(e)["selectKeywords"];
  return Array.isArray(k) ? (k as string[]) : [];
};
const matchesKeyword = (e: BaseEntity, observation: string): boolean =>
  keywordsOf(e).some((k) => observation.includes(k));

export interface SelectedJudgment {
  criterion: BaseEntity | null;
  judgment: Judgment;
  /** 조건을 말하지 않아 어떻게 보았는지 — 알릴 것이 없으면 null */
  selectionNote: string | null;
}

/**
 * 시험의 기준 후보 가운데 관측값 문장에 맞는 것을 고른다.
 *
 *  1. 압축강도 — 공시체·생산 방식(코어·현장양생·현장 배치플랜트·레디믹스트)에 맞는 기준.
 *     레디믹스트는 알려 준 강도가 35 MPa 를 넘는지로 범위를 고른다.
 *  2. 조건으로 갈리는 기준(selectKeywords) — 문장에 조건이 나오면 그 기준, 안 나오면 기본 기준(selectDefault)
 *  3. 그 밖에는 폐기 표시가 없는 첫 번째
 */
export function pickBestCriterion(graph: OntologyGraph, cids: string[], observation: string): BaseEntity | null {
  if (cids.length === 0) return null;
  const ctx = parseContext(observation);
  const candidates = cids.map((id) => graph.get(id)).filter((e): e is BaseEntity => e != null);

  const strength = candidates.filter((c) => metaOf(c)["operator"] === "statistical_threshold");
  if (strength.length > 0) {
    const kind = ctx.strengthCase ?? "ready_mixed";
    const ofKind = strength.filter((c) => (metaOf(c)["strengthCase"] ?? "ready_mixed") === kind);
    if (ofKind.length > 0) {
      const known = ctx.fcn ?? ctx.fcq ?? ctx.fck;
      if (known !== undefined) {
        const wanted = known <= RANGE_SPLIT_MPA ? "le35" : "gt35";
        const match = ofKind.find((c) => metaOf(c)["statisticalRule"] === wanted);
        if (match) return match;
      }
      return ofKind[0]!;
    }
    return strength[0]!;
  }

  const conditional = candidates.filter((c) => keywordsOf(c).length > 0);
  if (conditional.length > 0) {
    const hit = conditional.find((c) => matchesKeyword(c, observation));
    if (hit) return hit;
    const fallback = candidates.find((c) => metaOf(c)["selectDefault"] === true);
    if (fallback) return fallback;
  }

  const live = candidates.filter((c) => metaOf(c)["deprecated"] !== true);
  return live[0] ?? candidates[0] ?? null;
}

/** 합격·경계 근접은 "충족", 불합격은 "미달", 그 밖은 "정하지 못함"으로 묶는다 */
function outcome(j: Judgment): "pass" | "fail" | "open" {
  if (j.verdict === "PASS" || j.verdict === "MARGINAL") return "pass";
  if (j.verdict === "FAIL") return "fail";
  return "open";
}

/**
 * 기준을 골라 판정한다.
 * 조건(부재·시공 조건)을 말하지 않아 기본 기준으로 본 경우에는 조건별 기준 모두로 견주어,
 * 어느 조건이든 결론이 같을 때만 그 결론을 내고 아니면 판정하지 않는다.
 */
export function judgeBestCriterion(graph: OntologyGraph, cids: string[], observation: string): SelectedJudgment {
  const criterion = pickBestCriterion(graph, cids, observation);
  const judgment = evaluate(observation, criterion);
  if (!criterion) return { criterion, judgment, selectionNote: null };

  const meta = metaOf(criterion);
  const isDefaulted = meta["selectDefault"] === true && !matchesKeyword(criterion, observation);
  if (!isDefaulted) return { criterion, judgment, selectionNote: null };

  const note = typeof meta["selectDefaultNote"] === "string" ? (meta["selectDefaultNote"] as string) : null;
  const candidates = cids
    .map((id) => graph.get(id))
    .filter((e): e is BaseEntity => e != null)
    .filter((c) => c.id === criterion.id || keywordsOf(c).length > 0);
  if (candidates.length < 2) return { criterion, judgment, selectionNote: note };

  const all = candidates.map((c) => ({ criterion: c, judgment: c.id === criterion.id ? judgment : evaluate(observation, c) }));
  const outcomes = new Set(all.map((x) => outcome(x.judgment)));
  if (outcomes.size === 1 && !outcomes.has("open")) {
    // 조건이 무엇이든 결론이 같다 — 기본 기준의 판정을 그대로 낸다
    const agreed = outcomes.has("fail") ? "어느 조건의 기준으로도 미달입니다" : "어느 조건의 기준으로도 충족입니다";
    return { criterion, judgment, selectionNote: `조건을 알려 주지 않았지만 ${agreed}.` };
  }
  if (outcome(judgment) === "open") return { criterion, judgment, selectionNote: note };

  // 기본 기준으로는 결론이 나지만 다른 조건에서는 달라진다 — 판정하지 않는다
  const summary = all.map((x) => `${x.criterion.name}: ${outcome(x.judgment) === "pass" ? "충족" : outcome(x.judgment) === "fail" ? "미달" : "정하지 못함"}`).join(" / ");
  return {
    criterion,
    judgment: {
      ...judgment,
      verdict: "UNDETERMINED",
      direction: "n/a",
      reasoning: `조건에 따라 결과가 달라 판정하지 않습니다 — ${summary}.`,
      neededInputs: ["어느 조건(부재·시공 조건)인지"],
    },
    selectionNote: note,
  };
}
