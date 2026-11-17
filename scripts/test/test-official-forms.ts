// ─────────────────────────────────────────────────────────────────────────────
// test-official-forms.ts — 법정 서식 원본에 값을 채운 한글 파일의 회귀 시험.
//
//   1) 서식 원본 — 칸 지도의 파일이 있고, 받은 그대로 넣은 HWPX 는 기록한 해시와 같고, 문서 종류가 실재한다
//   2) 빈 입력 — 서식이 원본 그대로다(줄 배치 캐시만 빠진다), 본문 밖의 항목은 바이트까지 같다
//   3) 짜임 — 채운 뒤에도 모든 표의 칸이 행×열 격자를 빈틈·겹침 없이 덮고, 용지 방향이 그대로다
//   4) 자리 — 값이 서식의 정해진 칸에 들어가고, 서명·결과 칸은 입력이 없으면 비어 있다
//   5) 행 — 빈 줄이 모자라면 행을 늘리고(입력을 버리지 않는다), 행 이름 표는 이름·기타·묶음으로 찾아 넣는다
//   6) 잃지 않음 — 모든 입력값이 한글 파일에 있거나 notInForm 으로 알린다
//   7) 정본에서 내보내기 — 정본(.dclx)에서 만든 한글 파일이 생성 때 만든 것과 같다
//
// 한글 프로그램에서 실제로 열리는지는 이 시험이 확인하지 않는다(프로그램이 있어야 한다).
// 표 읽기는 엔진과 따로 짠 작은 읽개로 한다 — 엔진의 표 훑기를 그대로 믿지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ───── 상수 ─────
process.env["QUALITY_LOCAL_DIR"] = mkdtempSync(join(tmpdir(), "quality-official-forms-test-"));
const SECTION = "Contents/section0.xml";
const LINESEG = /<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g;
const XML_ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;
const PARTICIPANT_ROW_HEIGHT = 34192;

const { loadOntologySync } = await import("../../src/ontology/loader.js");
const { OntologyGraph } = await import("../../src/ontology/graph.js");
const { getSchema } = await import("../../src/schemas/loader.js");
const { enumValues, fieldKind } = await import("../../src/schemas/fields.js");
const { buildDocumentBody } = await import("../../src/lib/document-body.js");
const { unzip } = await import("../../src/lib/zip.js");
const { fillOfficialForm, officialFormDocIds, officialFormMap } = await import("../../src/lib/official-form.js");
const { officialFormPath } = await import("../../src/lib/official-form-map.js");
const { callTool } = await import("../../src/tool-registry.js");

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

// ───── 작은 표 읽개 (엔진과 별도) ─────
interface Cell { row: number; col: number; rowSpan: number; colSpan: number; height: number; text: string }
interface Table { rowCnt: number; colCnt: number; pageBreak: string; height: number; cells: Cell[] }

const unescape = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** 본문 XML 의 모든 표(중첩 포함, 문서 순서) — 칸의 글자는 그 칸 자신의 글자(안쪽 표의 글자 제외) */
function readTables(xml: string): Table[] {
  const tables: Table[] = [];
  const stack: Array<{ table: Table; cell: Cell | null; sizeSeen: boolean }> = [];
  const token = /<hp:tbl\b([^>]*)>|<\/hp:tbl>|<hp:tc\b[^>]*>|<\/hp:tc>|<hp:sz [^>]*height="(\d+)"[^>]*\/>|<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"\/>|<hp:cellSpan colSpan="(\d+)" rowSpan="(\d+)"\/>|<hp:cellSz width="\d+" height="(\d+)"\/>|<hp:t>([\s\S]*?)<\/hp:t>/g;
  for (const m of xml.matchAll(token)) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith("<hp:tbl")) {
      const attrs = m[1] ?? "";
      const table: Table = {
        rowCnt: Number(/rowCnt="(\d+)"/.exec(attrs)?.[1]),
        colCnt: Number(/colCnt="(\d+)"/.exec(attrs)?.[1]),
        pageBreak: /pageBreak="(\w+)"/.exec(attrs)?.[1] ?? "",
        height: 0,
        cells: [],
      };
      tables.push(table);
      stack.push({ table, cell: null, sizeSeen: false });
    } else if (m[0] === "</hp:tbl>") stack.pop();
    else if (!top) continue;
    else if (m[0].startsWith("<hp:tc")) {
      top.cell = { row: -1, col: -1, rowSpan: 1, colSpan: 1, height: 0, text: "" };
      top.table.cells.push(top.cell);
    } else if (m[0] === "</hp:tc>") top.cell = null;
    else if (m[2] !== undefined && !top.sizeSeen) {
      top.table.height = Number(m[2]);
      top.sizeSeen = true;
    } else if (m[3] !== undefined && top.cell) {
      top.cell.col = Number(m[3]);
      top.cell.row = Number(m[4]);
    } else if (m[5] !== undefined && top.cell) {
      top.cell.colSpan = Number(m[5]);
      top.cell.rowSpan = Number(m[6]);
    } else if (m[7] !== undefined && top.cell) top.cell.height = Number(m[7]);
    else if (m[8] !== undefined && top.cell) top.cell.text += unescape(m[8].replace(/<hp:lineBreak\/>/g, "\n").replace(/<[^>]+>/g, ""));
  }
  return tables;
}

const cellAt = (t: Table | undefined, row: number, col: number): string => (t?.cells.find((c) => c.row === row && c.col === col)?.text ?? "∅").trim();

/** 표의 칸이 행×열 격자를 빈틈·겹침 없이 덮는가 — 문제가 있으면 설명 */
function gridProblem(t: Table): string | null {
  const grid = Array.from({ length: t.rowCnt }, () => new Array<number>(t.colCnt).fill(0));
  for (const c of t.cells) {
    for (let r = c.row; r < c.row + c.rowSpan; r += 1) {
      for (let k = c.col; k < c.col + c.colSpan; k += 1) {
        if (r >= t.rowCnt || k >= t.colCnt) return `(${c.row},${c.col}) 칸이 표 밖으로 나감`;
        (grid[r] as number[])[k] = ((grid[r] as number[])[k] ?? 0) + 1;
      }
    }
  }
  for (let r = 0; r < t.rowCnt; r += 1) {
    for (let k = 0; k < t.colCnt; k += 1) {
      const n = (grid[r] as number[])[k];
      if (n !== 1) return `(${r},${k}) 를 덮는 칸 ${n}개`;
    }
  }
  return null;
}

function visibleText(xml: string): string {
  return [...xml.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)].map((m) => unescape((m[1] ?? "").replace(/<hp:lineBreak\/>/g, "\n").replace(/<[^>]+>/g, ""))).join("\n");
}

function paragraphs(xml: string): string[] {
  return [...xml.matchAll(/<hp:p\b[^>]*>((?:(?!<hp:p\b)[\s\S])*?)<\/hp:p>/g)].map((m) => visibleText(m[1] ?? "").trim());
}

/** XML 짜임 — 여닫는 요소가 맞고, 글자에 날것의 < 나 & 가 없다 */
function wellFormed(xml: string): string | null {
  const stack: string[] = [];
  let last = 0;
  for (const m of xml.matchAll(/<([^>]*)>/g)) {
    const between = xml.slice(last, m.index);
    if (XML_ENTITY.test(between)) return `바꾸지 않은 & — ${between.slice(0, 40)}`;
    last = (m.index ?? 0) + m[0].length;
    const inner = m[1] ?? "";
    if (inner.startsWith("?") || inner.startsWith("!")) continue;
    if (inner.startsWith("/")) {
      if (stack.pop() !== inner.slice(1).trim()) return `닫는 요소가 맞지 않음: ${inner}`;
      continue;
    }
    if (inner.endsWith("/")) continue;
    stack.push(inner.split(/\s/)[0] ?? "");
  }
  return stack.length === 0 ? null : `닫히지 않은 요소: ${stack.slice(-3).join(" > ")}`;
}

const landscape = (xml: string): string => /<hp:pagePr [^>]*landscape="(\w+)"/.exec(xml)?.[1] ?? "";

// ───── 채우기 ─────
function fill(docId: string, values: Record<string, unknown>): { section: string; notInForm: string[]; entries: Map<string, Buffer> } {
  const schema = getSchema(docId);
  if (!schema) throw new Error(`양식 없음: ${docId}`);
  const form = fillOfficialForm(docId, buildDocumentBody(schema, values).draft);
  if (!form) throw new Error(`서식 원본 없음: ${docId}`);
  const entries = unzip(form.data);
  return { section: (entries.get(SECTION) ?? Buffer.alloc(0)).toString("utf8"), notInForm: form.notInForm, entries };
}

function original(docId: string): Map<string, Buffer> {
  const map = officialFormMap(docId);
  if (!map) throw new Error(`서식 원본 없음: ${docId}`);
  return unzip(readFileSync(officialFormPath(map)));
}

/** 양식의 모든 칸을 종류에 맞는 값으로 채운다 — 특수 문자를 일부러 넣는다 */
function sampleValues(docId: string): Record<string, unknown> {
  const schema = getSchema(docId);
  if (!schema) throw new Error(`양식 없음: ${docId}`);
  const values: Record<string, unknown> = {};
  for (const section of schema.sections) {
    for (const field of section.fields) {
      const kind = fieldKind(field);
      const subs = field.fields ?? [];
      if (kind === "number") values[field.name] = 12.5;
      else if (kind === "date") values[field.name] = "2026-03-15";
      else if (kind === "datetime") values[field.name] = "2026-03-15 09:30";
      else if (kind === "choice") values[field.name] = enumValues(field)[0];
      else if (kind === "group") values[field.name] = Object.fromEntries(subs.map((k) => [k, `${k} 값 <A&B>`]));
      else if (kind === "list") values[field.name] = ["첫째 항목", '둘째 "항목"'];
      else if (kind === "rows") values[field.name] = [Object.fromEntries(subs.map((k) => [k, `${k} 1`])), Object.fromEntries(subs.map((k) => [k, `${k} 2 | 세로줄`]))];
      else if (kind === "longText") values[field.name] = "첫 줄 내용\n둘째 줄 내용 & 기호 <태그>";
      else values[field.name] = `${field.name} 값`;
    }
  }
  return values;
}

// ── 1. 서식 원본 ───────────────────────────────────────────────────
function testSources(): void {
  const ids = officialFormDocIds();
  check("서식 원본: 10종 문서에 칸 지도가 있다", ids.length === 10, ids.join(","));
  for (const docId of ids) {
    const map = officialFormMap(docId);
    if (!map) continue;
    const path = officialFormPath(map);
    check(`서식 원본: ${docId} 파일과 문서 종류가 있다`, existsSync(path) && getSchema(docId) !== null);
    check(`서식 원본: ${docId} 출처(법령·서식·주소·받은 날·해시)`, Boolean(map.source.law && map.source.form && map.source.url.startsWith("https://www.law.go.kr/") && map.source.fetched && /^[0-9a-f]{64}$/.test(map.source.sha256)));
    if (!map.source.converted) {
      const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
      check(`서식 원본: ${docId} 받은 그대로 넣은 파일의 해시가 기록과 같다`, hash === map.source.sha256, hash);
    }
  }
}

// ── 2. 빈 입력 · 3. 짜임 ───────────────────────────────────────────
function testUntouchedAndStructure(): void {
  for (const docId of officialFormDocIds()) {
    const orig = original(docId);
    const origSection = (orig.get(SECTION) ?? Buffer.alloc(0)).toString("utf8");
    const empty = fill(docId, {});
    check(`빈 입력: ${docId} 서식이 원본 그대로(줄 배치 캐시만 빠짐)`, empty.section === origSection.replace(LINESEG, ""));
    const others = [...orig.keys()].filter((k) => k !== SECTION);
    check(
      `빈 입력: ${docId} 본문 밖 항목은 같은 순서·같은 바이트`,
      JSON.stringify([...empty.entries.keys()]) === JSON.stringify([...orig.keys()]) && others.every((k) => empty.entries.get(k)?.equals(orig.get(k) as Buffer)),
    );
    check(`빈 입력: ${docId} 서식에 칸이 없다는 알림 없음`, empty.notInForm.length === 0, empty.notInForm.join(" / "));

    const filled = fill(docId, sampleValues(docId));
    check(`짜임: ${docId} 본문 XML`, wellFormed(filled.section) === null, wellFormed(filled.section) ?? "");
    check(`짜임: ${docId} 용지 방향 그대로`, landscape(filled.section) === landscape(origSection) && landscape(origSection) !== "");
    const before = readTables(origSection);
    const after = readTables(filled.section);
    check(`짜임: ${docId} 표 수·열 수 그대로`, before.length === after.length && before.every((t, i) => t.colCnt === after[i]?.colCnt));
    const problems = after.map((t, i) => (gridProblem(t) ? `표${i} ${gridProblem(t)}` : null)).filter(Boolean);
    check(`짜임: ${docId} 모든 표의 칸이 격자를 빈틈·겹침 없이 덮는다`, problems.length === 0, problems.join(" / "));
    check(`짜임: ${docId} 특수 문자를 바꿔 넣는다`, !filled.section.includes("<A&B>"));
  }
}

// ── 4·5. 자리와 행 ──────────────────────────────────────────────────
function testPlacement(): void {
  // 별지 18 — 빈 줄 12개보다 많은 14줄: 행을 늘리고 누계를 계산해 넣는다
  const items = Array.from({ length: 14 }, (_, i) => ({ workType: "토공", testKind: `종목${i + 1}`, planned: 20, prevExecuted: 5, prevPassed: 5, prevFailed: 0, prevRetest: 0, monthExecuted: 4, monthPassed: 3, monthFailed: 1, monthRetest: 1 }));
  const monthly = readTables(fill("monthly_test_report", { items }).section)[0];
  check("별지18: 줄이 모자라면 행을 늘린다(14줄 → 16행)", monthly?.rowCnt === 16 && cellAt(monthly, 15, 1) === "종목14" && cellAt(monthly, 2, 1) === "종목1");
  check("별지18: 열 순서 — 계획·전월·금월·누계", cellAt(monthly, 2, 2) === "20" && cellAt(monthly, 2, 3) === "5" && cellAt(monthly, 2, 7) === "4" && cellAt(monthly, 2, 11) === "9" && cellAt(monthly, 2, 14) === "1");
  check("별지18: 늘린 표는 쪽에서 나뉠 수 있다", monthly?.pageBreak === "CELL");
  const short = readTables(fill("monthly_test_report", { items: items.slice(0, 2) }).section)[0];
  check("별지18: 줄이 남으면 행 수 그대로, 빈 줄은 비어 있다", short?.rowCnt === 14 && cellAt(short, 4, 0) === "" && cellAt(short, 13, 14) === "");

  // 별지 42 — 서명 칸은 입력이 없으면 비어 있다
  const register = readTables(
    fill("quality_inspection_register", { entries: [{ seq: 1, inspectionDate: "2026-11-14", material: "레미콘", inspectionPlace: "No.3+20", testResult: "165mm", resultVerdict: "적합", qcEngineerName: "서지안" }] }).section,
  )[0];
  check("별지42: 결과·판정은 그 칸에, 서명 칸은 비어 있다", cellAt(register, 4, 9) === "165mm" && cellAt(register, 4, 10) === "적합" && cellAt(register, 4, 11) === "서지안" && cellAt(register, 4, 12) === "" && cellAt(register, 4, 14) === "");

  // 별지 43 — 머리 문단과 작성자 문단
  const summary = fill("quality_inspection_summary", { projectName: "가람지구 정비공사", constructionPeriod: { startDate: "2026-03-02", endDate: "2027-12-31" }, progressPercent: 37 });
  const summaryParas = paragraphs(summary.section);
  check("별지43: 공사명·공사기간·공정 문단", summaryParas.some((p) => p.includes("공사명: 가람지구 정비공사") && p.includes("2026. 3. 2. ~ 2027. 12. 31.") && p.includes("37 %")));
  check("별지43: 작성일시를 넣지 않으면 서식의 틀 글자 그대로", summaryParas.some((p) => /^작성일시:\s+년\s+월\s+일$/.test(p)));

  // 별지 37 — 체크 상자
  const approval = readTables(fill("material_source_approval", { workCategory: "토목", ksGreen: "KS", attachments: ["인증서", "시험성적서", "납품실적", "시험성과 대비표"] }).section);
  const category = cellAt(approval[0], 1, 3);
  check("별지37: 고른 공종만 ■", category.includes("토목■") && category.includes("건축□") && category.includes("기계□") && category.includes("기타□"), category);
  const attached = cellAt(approval[0], 5, 1);
  check("별지37: 첨부 여러 개 ■, 서식에 없는 첨부는 기타 뒤에", attached.includes("인증서■") && attached.includes("시험성적서■") && attached.includes("납품실적■") && attached.includes("사업자등록증□") && attached.includes("기타■(시험성과 대비표)"), attached);
  check("별지37: 판정을 넣지 않으면 체크 상자가 모두 빈칸", !cellAt(approval[1], 3, 1).includes("■") && cellAt(approval[1], 3, 1).includes("적합□"));

  // 별지 11 — 행 이름 표: 이름이 맞는 행 · 기타 행 · 행 늘리기
  const readyMixed = fill("ready_mixed_placement_check", {
    equipment: [
      { equipmentName: "진동기", spec: "Φ45", unitsUsed: "3" },
      { equipmentName: "살수차", spec: "5톤" },
      { equipmentName: "발전기", spec: "50kW" },
    ],
    materials: [{ checkItem: "콘크리트의 종류", checkResult: "보통 25-24-150" }],
    tests: [{ testKind: "슬럼프시험", specCriterion: "150±25mm", totalCount: 2, passCount: 1, failCount: 1 }],
  });
  const rm = readTables(readyMixed.section)[1];
  const rowOf = (t: Table | undefined, col: number, label: string): number => t?.cells.find((c) => c.col === col && c.text.replace(/\s/g, "").includes(label))?.row ?? -1;
  const vib = rowOf(rm, 0, "진동기");
  check("별지11: 이름이 맞는 행(2. 진동기)에 넣는다", vib === 3 && cellAt(rm, vib, 1) === "Φ45" && cellAt(rm, vib, 3) === "3");
  check("별지11: 맞는 행이 없으면 기타 행에 이름을 붙여 넣는다", cellAt(rm, 5, 0).replace(/\s/g, "") === "4.기타(살수차)" && cellAt(rm, 5, 1) === "5톤");
  check("별지11: 기타 행도 차 있으면 행을 늘린다", rm?.rowCnt === 21 && cellAt(rm, 6, 0) === "발전기" && cellAt(rm, 6, 1) === "50kW");
  const mat = rowOf(rm, 0, "콘크리트의종류");
  const slump = rowOf(rm, 0, "슬럼프시험");
  check("별지11: 위에서 행을 늘려도 아래 묶음은 제 이름 행에", mat === 9 && cellAt(rm, mat, 2) === "보통 25-24-150" && slump === 16 && cellAt(rm, slump, 2) === "150±25mm" && cellAt(rm, slump, 7) === "1");
  check("별지11: 넣은 입력은 모두 자리를 찾았다", readyMixed.notInForm.length === 0, readyMixed.notInForm.join(" / "));

  // 별지 12 — 점검 구분(플랜트 혼합물 / 포설시 품질관리)으로 묶인 기타 행
  const asphalt = fill("asphalt_placement_check", {
    tests: [
      { stage: "플랜트 혼합물", testKind: "안정도", specCriterion: "7,500N" },
      { stage: "포설시 품질관리", testKind: "평탄성", specCriterion: "3mm" },
      { stage: "포설시 품질관리", testKind: "다짐도", specCriterion: "96%" },
    ],
  });
  const as = readTables(asphalt.section)[1];
  const flat = rowOf(as, 1, "기타(평탄성)");
  const dense = rowOf(as, 1, "다짐도");
  const pave = as?.cells.find((c) => c.col === 0 && c.text.replace(/\s/g, "").startsWith("포설시"));
  const plant = as?.cells.find((c) => c.col === 0 && c.text.replace(/\s/g, "").startsWith("플랜트"));
  check("별지12: 평탄성은 포설시 품질관리의 기타 행에(플랜트 혼합물의 기타 아님)", flat === 20 && cellAt(as, 20, 3) === "3mm" && cellAt(as, 15, 1).replace(/\s/g, "") === "7.기타");
  check("별지12: 묶음 안에서 행을 늘리면 묶음 칸도 함께 늘어난다", dense === 21 && pave?.row === 16 && pave.rowSpan === 6 && plant?.rowSpan === 7 && cellAt(as, 9, 3) === "7,500N");

  // 별지 13 — 확인자 표와 날짜 문단
  const pledge = fill("defective_material_disposal_pledge", { pledgeDate: "2026-11-14", confirmers: [{ role: "운전기사", name: "도윤석" }, { role: "공장 품질관리책임자", name: "하은별" }], attachments: ["레미콘 납품서(구입자용)"] });
  const pt = readTables(pledge.section)[1];
  check("별지13: 확인자는 서식의 역할 행에, 서명 칸은 비어 있다", cellAt(pt, 1, 1) === "도윤석" && cellAt(pt, 2, 1) === "하은별" && cellAt(pt, 1, 4) === "" && cellAt(pt, 2, 4) === "");
  check("별지13: 확약 날짜 문단", paragraphs(pledge.section).some((p) => /^2026년\s+11월\s+14일$/.test(p)));
  check("별지13: 첨부는 서식의 첨부 문단에", paragraphs(pledge.section).some((p) => p.includes("※ 첨부 : 레미콘 납품서(구입자용)")) && pledge.notInForm.length === 0, pledge.notInForm.join(" / "));

  // 별지 36 — 실명부는 크게 비운 한 행을 같은 높이 안에서 나눠 한 사람씩
  const request = fill("inspection_request", { reinspection: "재검측", participants: [{ workDate: "2026-11-13", position: "철근공", name: "문태건" }, { workDate: "2026-11-13", position: "철근공", name: "길도현" }] });
  const reg = readTables(request.section)[2];
  const origReg = readTables((original("inspection_request").get(SECTION) ?? Buffer.alloc(0)).toString("utf8"))[2];
  const dataHeight = (reg?.cells ?? []).filter((c) => c.col === 0 && c.row >= 1 && c.row <= 8).reduce((n, c) => n + c.height, 0);
  check("별지36 실명부: 한 행을 8줄로 나눠 한 사람씩", reg?.rowCnt === 10 && cellAt(reg, 1, 4) === "문태건" && cellAt(reg, 2, 4) === "길도현" && cellAt(reg, 3, 4) === "" && cellAt(reg, 1, 7) === "");
  check("별지36 실명부: 나눈 줄의 높이 합과 표 높이가 원본과 같다", Math.abs(dataHeight - PARTICIPANT_ROW_HEIGHT) < 8 && Math.abs((reg?.height ?? 0) - (origReg?.height ?? 0)) < 8, `${dataHeight} / ${reg?.height} vs ${origReg?.height}`);
  check("별지36: 재검측이면 우측 상단에 (재)", paragraphs(request.section).includes("(재)   (제 1 쪽)"));
  const first = fill("inspection_request", { reinspection: "최초" });
  check("별지36: 최초 검측이면 표시하지 않고 알리지도 않는다", paragraphs(first.section).includes("(제 1 쪽)") && first.notInForm.length === 0, first.notInForm.join(" / "));

  // 행을 늘리거나 나눈 서식도 모든 표의 칸이 격자를 빈틈·겹침 없이 덮는다
  const grown: Array<[string, string]> = [
    ["별지18", fill("monthly_test_report", { items }).section],
    ["별지11", readyMixed.section],
    ["별지12", asphalt.section],
    ["별지36", request.section],
  ];
  const broken = grown.flatMap(([name, section]) => readTables(section).flatMap((t, i) => (gridProblem(t) ? [`${name} 표${i} ${gridProblem(t)}`] : [])));
  check("행 늘리기·나누기 뒤에도 칸이 격자를 빈틈·겹침 없이 덮는다", broken.length === 0, broken.join(" / "));

  // 별지 36 제3쪽 — 결과는 판정에 맞는 칸(합격·불합격)에, 판정이 없으면 넣지 않고 알린다
  const checklist = fill("inspection_checklist", { items: [{ checkItem: "피복두께", criterion: "75mm 이상", contractorResult: "78mm", engineerResult: "77mm", verdict: "합격" }, { checkItem: "철근 간격", contractorResult: "205mm" }] });
  const cl = readTables(checklist.section)[4];
  check("별지36 체크리스트: 합격이면 합격 칸 — 위 시공자, 아래 건설사업관리기술인", cellAt(cl, 2, 0) === "피복두께" && cellAt(cl, 2, 2) === "78mm" && cellAt(cl, 3, 2) === "77mm" && cellAt(cl, 2, 3) === "" && cellAt(cl, 3, 3) === "");
  check("별지36 체크리스트: 판정이 없으면 결과를 어느 칸에도 넣지 않고 알린다", cellAt(cl, 4, 2) === "" && cellAt(cl, 4, 3) === "" && checklist.notInForm.some((n) => n.includes("205mm")), checklist.notInForm.join(" / "));
}

// ── 6. 잃지 않음 ───────────────────────────────────────────────────
function testNothingLost(): void {
  for (const docId of officialFormDocIds()) {
    const map = officialFormMap(docId);
    const values = sampleValues(docId);
    const filled = fill(docId, values);
    const text = visibleText(filled.section);
    const notes = filled.notInForm.join("\n");
    const whenKeys = new Set([...(map?.cells ?? []), ...(map?.paragraphs ?? [])].flatMap((s) => (s.when ? [s.when.key] : [])));
    const rowWhenKeys = new Set([...(map?.rows ?? []), ...(map?.namedRows ?? [])].flatMap((r) => r.cells.flatMap((c) => (c.when ? [c.when.key] : []))));
    const lost: string[] = [];
    const found = (v: string): boolean => {
      if (text.includes(v) || notes.includes(v)) return true;
      // 날짜는 서식 틀에 연·월·일로 나눠 넣는다
      const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
      return d !== null && text.includes(d[1] as string) && (text.includes(`${Number(d[2])}월`) || text.includes(`${Number(d[2])}.`) || notes.includes(v));
    };
    for (const [name, value] of Object.entries(values)) {
      if (whenKeys.has(name)) continue;
      const strings: string[] =
        Array.isArray(value) && typeof value[0] === "object"
          ? (value as Array<Record<string, string>>).flatMap((row) => Object.entries(row).filter(([k]) => !rowWhenKeys.has(k)).map(([, v]) => v))
          : Array.isArray(value)
            ? (value as string[])
            : typeof value === "object" && value !== null
              ? Object.values(value as Record<string, string>)
              : [String(value)];
      for (const v of strings) if (!found(v.trim())) lost.push(`${name}=${v}`);
    }
    check(`잃지 않음: ${docId} 입력값은 한글 파일에 있거나 notInForm 으로 알린다`, lost.length === 0, lost.slice(0, 5).join(" / "));
  }
}

// ── 7. 정본에서 내보내기 ───────────────────────────────────────────
async function testExport(): Promise<void> {
  type Out = { hwpxPath?: string; dclxPath?: string; hwpxLayout?: string; notInForm?: string[]; hwpxForm?: string };
  for (const docId of officialFormDocIds()) {
    const made = (await callTool("generate_quality_document", { docId, formValues: sampleValues(docId), format: "hwpx" }, { graph })).result as Out;
    const back = (await callTool("export_quality_document", { dclxPath: made.dclxPath }, { graph })).result as Out;
    const a = unzip(readFileSync(made.hwpxPath ?? "")).get(SECTION)?.toString("utf8");
    const b = unzip(readFileSync(back.hwpxPath ?? "")).get(SECTION)?.toString("utf8");
    check(
      `내보내기: ${docId} 생성과 정본 내보내기가 같은 서식 채움`,
      made.hwpxLayout === "official_form" && back.hwpxLayout === "official_form" && a !== undefined && a === b && JSON.stringify(made.notInForm) === JSON.stringify(back.notInForm) && Boolean(made.hwpxForm),
    );
  }
  const plain = (await callTool("generate_quality_document", { docId: "ncr", formValues: sampleValues("ncr"), format: "hwpx" }, { graph })).result as Out;
  check("내보내기: 서식 원본이 없는 문서는 항목 구조", plain.hwpxLayout === "item_structure" && plain.notInForm === undefined);
}

async function main(): Promise<void> {
  testSources();
  testUntouchedAndStructure();
  testPlacement();
  testNothingLost();
  await testExport();
  console.log(`[official-forms] ${passed} 통과 / ${failed} 실패`);
  if (failed > 0) process.exit(1);
}

await main();
