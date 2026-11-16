// ─────────────────────────────────────────────────────────────────────────────
// test-citations.ts — 법령 인용 3분류(확인됨·없는 조문·확인 불가)의 회귀 시험.
// 표기별(제○조·§·가지 조문·별표·별지 서식), 법령별(수록한 다섯 법령과 다른 이름),
// 범위·항호, 수록하지 않은 법령, 문장 속 인용을 본다.
// ─────────────────────────────────────────────────────────────────────────────

import { loadOntologySync } from "../../src/ontology/loader.js";
import { OntologyGraph } from "../../src/ontology/graph.js";
import { loadLaws } from "../../src/ontology/laws.js";
import { resolveReference, scanCitations } from "../../src/lib/citation-resolver.js";
import type { CitationOutcome } from "../../src/lib/citation-resolver.js";
import { callTool } from "../../src/tool-registry.js";

const graph = new OntologyGraph(loadOntologySync());
let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) passed += 1;
  else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function expectRef(reference: string, outcome: CitationOutcome, more?: { law?: string; ref?: string; note?: string; title?: string }): void {
  const r = resolveReference(reference);
  const ok =
    r.outcome === outcome &&
    (more?.law === undefined || r.law === more.law) &&
    (more?.ref === undefined || r.ref === more.ref) &&
    (more?.title === undefined || (r.title ?? "").includes(more.title)) &&
    (more?.note === undefined || (r.detailNote ?? "").includes(more.note));
  check(`"${reference}" → ${outcome}`, ok, JSON.stringify(r));
}

const ACT = "건설기술 진흥법";
const DECREE = "건설기술 진흥법 시행령";
const RULE = "건설기술 진흥법 시행규칙";
const QG = "건설공사 품질관리 업무지침";
const CM = "건설공사 사업관리방식 검토기준 및 업무수행지침";

function testNotation(): void {
  // 표기
  expectRef("건설기술 진흥법 제55조", "confirmed", { law: ACT, ref: "제55조", title: "품질관리" });
  expectRef("건설기술진흥법 §55", "confirmed", { law: ACT, ref: "제55조" });
  expectRef("「건설기술 진흥법」 제55조", "confirmed", { law: ACT });
  expectRef("건진법 제60조", "confirmed", { law: ACT, ref: "제60조" });
  expectRef("건설기술 진흥법 제55조 건설공사의 품질관리", "confirmed", { law: ACT });
  expectRef("건설기술 진흥법 제55조(건설공사의 품질관리)", "confirmed", { law: ACT });

  // 법령별
  expectRef("건설기술 진흥법 시행령 제89조", "confirmed", { law: DECREE, ref: "제89조" });
  expectRef("건진법 시행령 §91", "confirmed", { law: DECREE });
  expectRef("건설기술 진흥법 시행규칙 제50조", "confirmed", { law: RULE });
  expectRef("건설공사 품질관리 업무지침 제8조", "confirmed", { law: QG, title: "품질시험기준" });
  expectRef("품질관리 업무지침 제38조", "confirmed", { law: QG });
  expectRef("건설공사 사업관리방식 검토기준 및 업무수행지침 제86조", "confirmed", { law: CM });
  // 한 낱말 이름은 이 서버가 다루는 법령으로 읽고, 그렇게 읽었다고 알린다
  expectRef("시행령 제89조", "confirmed", { law: DECREE, note: "읽음" });
  expectRef("시행규칙 제50조", "confirmed", { law: RULE, note: "읽음" });

  // 가지 조문 — 그 조문이 있을 때만 확인됨
  const branch = loadLaws().find((l) => l.id === "btia")?.articles.find((a) => a.branch > 0 && !a.deleted);
  if (!branch) throw new Error("가지 조문 표본이 없음");
  expectRef(`건설기술 진흥법 제${branch.number}조의${branch.branch}`, "confirmed", { ref: `제${branch.number}조의${branch.branch}` });
  expectRef(`건설기술 진흥법 §${branch.number}의${branch.branch}`, "confirmed");
  expectRef("건설기술 진흥법 제55조의9", "not_found", { ref: "제55조의9" });

  // 없는 조문 — 전 조문을 수록한 법령에서만 단정한다
  expectRef("건설기술 진흥법 제999조", "not_found", { law: ACT });
  expectRef("건설기술 진흥법 시행령 제500조", "not_found", { law: DECREE });
  expectRef("건설공사 품질관리 업무지침 제300조", "not_found", { law: QG });
  const deleted = loadLaws().flatMap((l) => l.articles.filter((a) => a.deleted).map((a) => ({ l, a })))[0];
  if (deleted) {
    const label = `제${deleted.a.number}조${deleted.a.branch ? `의${deleted.a.branch}` : ""}`;
    const r = resolveReference(`${deleted.l.name} ${label}`);
    check(`삭제된 조문(${deleted.l.name} ${label})은 확인됨으로 내지 않음`, r.outcome === "not_found" && (r.reason ?? "").includes("삭제"), JSON.stringify(r));
  }

  // 별표·별지 서식
  expectRef("건설기술 진흥법 시행규칙 별표 5", "confirmed", { law: RULE, ref: "별표 5" });
  expectRef("건설기술 진흥법 시행령 별표 9", "confirmed", { law: DECREE });
  expectRef("건설공사 품질관리 업무지침 별표 2", "confirmed", { law: QG, title: "품질시험기준" });
  expectRef("건설기술 진흥법 시행규칙 별지 제42호서식", "confirmed", { law: RULE, ref: "별지 제42호", title: "품질검사" });
  expectRef("시행규칙 별지 제43호 서식", "confirmed", { law: RULE });
  expectRef("건설공사 사업관리방식 검토기준 및 업무수행지침 별지 제36호", "confirmed", { law: CM });
  expectRef("건설기술 진흥법 시행규칙 별표 99", "not_found", { law: RULE });
  expectRef("건설기술 진흥법 시행규칙 별지 제999호서식", "not_found", { law: RULE });

  // 범위·항호 — 대조하지 않은 부분을 알린다
  expectRef("건설기술 진흥법 시행령 제89조부터 제93조까지", "confirmed", { law: DECREE, note: "범위" });
  expectRef("건설기술 진흥법 시행령 제89조~제93조", "confirmed", { note: "범위" });
  expectRef("건설기술 진흥법 시행령 제89조 내지 제500조", "not_found");
  expectRef("건설기술 진흥법 제55조제3항", "confirmed", { law: ACT, note: "항·호" });
  expectRef("건설기술 진흥법 시행령 제89조제1항제1호", "confirmed", { note: "항·호" });
  expectRef("건설기술 진흥법 제55조 및 제60조", "confirmed", { law: ACT });
  expectRef("건설기술 진흥법 제55조 및 제999조", "not_found");

  // 수록하지 않은 법령 — 틀렸다고 하지 않는다
  expectRef("산업안전보건법 제36조", "unverifiable");
  expectRef("주택법 제33조", "unverifiable");
  // 다른 법령의 시행령을 수록한 시행령으로 읽지 않는다 (제30조는 건설기술 진흥법 시행령에도 있다)
  expectRef("건설산업기본법 시행령 제30조", "unverifiable");
  expectRef("건설산업기본법 제28조 및 같은 법 시행령 제30조", "unverifiable");
  expectRef("제55조", "unverifiable");
  expectRef("건설기술 진흥법", "unverifiable");
  expectRef("건설기술 진흥법 제55조 알수없는꼬리말", "unverifiable");
}

function testInline(): void {
  const a = scanCitations("품질관리계획은 건설기술 진흥법 제55조와 같은 법 시행령 제89조에 따라 수립하고, 시행규칙 별지 제42호서식의 대장에 적는다.");
  check("문장: 세 인용을 모두 읽음", a.length === 3, JSON.stringify(a.map((x) => x.reference)));
  check("문장: 법 제55조 확인됨", a[0]?.outcome === "confirmed" && a[0]?.law === ACT);
  check("문장: '같은 법 시행령'을 앞 법령의 시행령으로 읽음", a[1]?.outcome === "confirmed" && a[1]?.law === DECREE);
  check("문장: 시행규칙 별지 제42호 확인됨", a[2]?.outcome === "confirmed" && a[2]?.law === RULE && a[2]?.ref === "별지 제42호");

  const b = scanCitations("건설기술 진흥법 제55조, 제56조 및 제60조에 따른다.");
  check("문장: 법령명 없이 이어 적은 조문은 앞 법령을 물려받음", b.length === 3 && b.every((x) => x.outcome === "confirmed" && x.law === ACT), JSON.stringify(b));

  const c = scanCitations("산업안전보건법 제36조의 위험성평가와 같은 법 시행규칙 제4조, 그리고 건설기술 진흥법 제62조를 따른다.");
  check("문장: 다른 법령과 그 '같은 법 시행규칙'은 확인 불가", c[0]?.outcome === "unverifiable" && c[1]?.outcome === "unverifiable" && (c[1]?.reason ?? "").includes("산업안전보건법"), JSON.stringify(c));
  check("문장: 뒤에 나온 수록 법령은 다시 확인됨", c[2]?.outcome === "confirmed" && c[2]?.law === ACT);

  const d = scanCitations("산업안전보건법 제36조 및 시행규칙 제50조에 따라");
  check("문장: 다른 법령 뒤의 '시행규칙'을 수록한 시행규칙으로 읽지 않음", d[1]?.outcome === "unverifiable", JSON.stringify(d[1]));

  const e = scanCitations("같은 법 제55조에 따라 수립한다.");
  check("문장: 가리키는 법령이 없는 '같은 법'은 확인 불가", e[0]?.outcome === "unverifiable" && (e[0]?.reason ?? "").includes("같은 법"), JSON.stringify(e[0]));

  check("인용이 없는 문장은 빈 목록", scanCitations("슬럼프는 150 mm 이다.").length === 0);
}

async function testTool(): Promise<void> {
  const run = async (input: Record<string, unknown>) =>
    (await callTool("verify_quality_basis", input, { graph })).result as {
      verification: string;
      citations: Array<{ reference: string; outcome: string; source: string; detailNote?: string }>;
      citationSummary: { confirmed: number; notFound: number; unverifiable: number };
      recommendation: string;
      hasMandatoryBasis: boolean;
    };

  const ok = await run({ statement: "품질관리계획은 건설기술 진흥법 제55조에 따라 반드시 수립해야 한다." });
  check("도구: 확인된 법 조문이 있으면 강한 표현을 받아들임", ok.verification === "supported" && ok.hasMandatoryBasis && ok.citationSummary.confirmed === 1, JSON.stringify(ok.citations));

  const wrong = await run({ statement: "품질관리계획은 건설기술 진흥법 제155조에 따라 반드시 수립해야 한다." });
  check("도구: 없는 조문을 인용하면 알림", wrong.verification === "nonexistent_citation" && wrong.citationSummary.notFound === 1 && wrong.recommendation.includes("제155조"), wrong.recommendation);

  const other = await run({ statement: "위험성평가는 산업안전보건법 제36조에 따른다." });
  check("도구: 수록하지 않은 법령은 틀렸다고 하지 않음", other.verification !== "nonexistent_citation" && other.citationSummary.unverifiable === 1 && other.recommendation.includes("틀렸다는 뜻이 아니라"), other.recommendation);

  const claimed = await run({ statement: "검측요청서를 제출한다.", citations: ["건설공사 사업관리방식 검토기준 및 업무수행지침 별지 제36호", "건설기술 진흥법 시행령 제89조제1항"] });
  check("도구: 따로 준 인용도 판정함", claimed.citations.filter((c) => c.source === "claimed" && c.outcome === "confirmed").length === 2, JSON.stringify(claimed.citations));
  check("도구: 항·호는 대조하지 않았음을 밝힘", claimed.citations.some((c) => (c.detailNote ?? "").includes("항·호")));

  const strong = await run({ statement: "슬럼프 시험은 반드시 해야 한다." });
  check("도구: 근거 없는 강한 표현은 그대로 걸러 냄", strong.verification === "unsupported_strong_claim");
  const notice = await run({ statement: "시험 빈도는 품질관리 업무지침 제8조에 따라 반드시 지킨다." });
  check("도구: 고시 조문만으로는 '반드시'의 법적 근거로 보지 않음", notice.verification === "unsupported_strong_claim" && notice.citationSummary.confirmed === 1);
}

async function main(): Promise<void> {
  testNotation();
  testInline();
  await testTool();
  console.log(`[citations] ${passed} 통과 / ${failed} 실패`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
