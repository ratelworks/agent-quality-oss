// ─────────────────────────────────────────────────────────────────────────────
// test-documents.ts — 문서 본문 생성 → 검토 → 한글(HWPX)·DocLang 내보내기의 회귀 시험.
//
//   1) 한글 파일의 패키지 구성 — ZIP 을 직접 읽어 항목 순서·mimetype 무압축·CRC·XML 짜임 확인
//   2) 문서 전부: 빈 입력과 채운 입력으로 생성 → 검토 → 한글 파일 → DocLang
//   3) 빈 입력 — 본문에 값이 아니라 빈칸과 안내만 나온다(지어낸 내용 없음)
//   4) 검토 — 빈 필수 항목·형식·달력에 없는 날짜·없는 조문·직접 쓴 본문
//   5) 내보내기 — 작성 안내 제외, 소유자만 읽는 파일, 같은 시각에 덮어쓰지 않음
//   6) 정본(.dclx) — 기본 산출이 DocLang 아카이브(규격 부록 B 의 세 부분)이고, 한글 파일은 그 정본에서 내보낸다
//   법정 서식 원본이 있는 문서의 한글 파일은 그 서식의 패키지 그대로다 — 서식 채움 자체는 test-official-forms.ts
//
// 한글 프로그램에서 실제로 열리는지는 이 시험이 확인하지 않는다(프로그램이 있어야 한다).
// DocLang 은 구조만 본다 — 공식 검증 도구(doclang validate)는 따로 돌린다.
// ─────────────────────────────────────────────────────────────────────────────

import { crc32, inflateRawSync } from "node:zlib";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ───── 상수 ─────
// 저장 폴더는 도구를 불러오기 전에 임시 폴더로 돌린다(사용자 자료를 건드리지 않는다)
process.env["QUALITY_LOCAL_DIR"] = mkdtempSync(join(tmpdir(), "quality-documents-test-"));
const EXPECTED_ENTRIES = ["mimetype", "version.xml", "META-INF/container.xml", "Contents/content.hpf", "Contents/header.xml", "Contents/section0.xml", "Preview/PrvText.txt"];
const OWNER_ONLY_MODE = 0o600;
const EXPECTED_DOCS = 23;
/** DocLang 규격 부록 B 의 필수 세 부분 */
const DCLX_ENTRIES = ["[Content_Types].xml", "_rels/.rels", "document.xml"];
const GUIDE = "[작성 안내]";
const XML_ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;

const { loadOntologySync } = await import("../../src/ontology/loader.js");
const { OntologyGraph } = await import("../../src/ontology/graph.js");
const { getSchema, listSchemaIds } = await import("../../src/schemas/loader.js");
const { enumValues, fieldKind } = await import("../../src/schemas/fields.js");
const { HWPX_MIME_TYPE, markdownToHwpx } = await import("../../src/lib/hwpx-writer.js");
const { toApprovalCopy } = await import("../../src/lib/document-body.js");
const { DOCLANG_NAMESPACE, DOCLANG_VERSION } = await import("../../src/lib/doclang-serializer.js");
const { callTool, findTool } = await import("../../src/tool-registry.js");
const { officialFormMap } = await import("../../src/lib/official-form.js");
const { officialFormPath } = await import("../../src/lib/official-form-map.js");

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

interface Entry {
  name: string;
  method: number;
  data: Buffer;
  crcOk: boolean;
}

/** ZIP 을 직접 읽는다 — 중앙 목록을 따라가며 항목을 풀고 CRC 를 대조 */
function readZip(buffer: Buffer): Entry[] {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("ZIP 끝 표지 없음");
  const count = buffer.readUInt16LE(end + 10);
  let pos = buffer.readUInt32LE(end + 16);
  const entries: Entry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error("중앙 목록 표지 오류");
    const method = buffer.readUInt16LE(pos + 10);
    const expectedCrc = buffer.readUInt32LE(pos + 16);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLength).toString("utf8");
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    entries.push({ name, method, data, crcOk: crc32(data) === expectedCrc });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
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
      const name = inner.slice(1).trim();
      if (stack.pop() !== name) return `닫는 요소가 맞지 않음: ${name}`;
      continue;
    }
    if (XML_ENTITY.test(inner)) return `속성에 바꾸지 않은 & — ${inner.slice(0, 40)}`;
    if (inner.endsWith("/")) continue;
    stack.push(inner.split(/\s/)[0] ?? "");
  }
  if (xml.slice(last).includes("<")) return "닫히지 않은 <";
  return stack.length === 0 ? null : `닫히지 않은 요소: ${stack.join(" > ")}`;
}

function sectionOf(buffer: Buffer): string {
  const entry = readZip(buffer).find((e) => e.name === "Contents/section0.xml");
  if (!entry) throw new Error("본문 항목 없음");
  return entry.data.toString("utf8");
}

async function call<T>(name: string, input: Record<string, unknown>): Promise<T> {
  return (await callTool(name, input, { graph })).result as T;
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

interface Generated {
  docId: string;
  title: string;
  format?: string;
  dclxSaved?: boolean;
  dclxPath?: string;
  markdown?: string;
  doclang?: string;
  hwpxPath?: string;
  hwpxBytes?: number;
  hwpxLayout?: string;
  requiredTotal: number;
  requiredFilled: number;
  missingRequired: string[];
  problems: string[];
  unknownKeys: string[];
  remaining: string;
}

interface Review {
  verdict: string;
  summary: { errors: number; warnings: number; infos: number };
  findings: Array<{ severity: string; code: string; where: string; message: string }>;
  citations: Array<{ reference: string; outcome: string }>;
  remaining: string;
}

// ── 1. 한글 파일의 패키지 구성 ─────────────────────────────────────
function testPackage(): void {
  const sample = "# 제목 문서\n\n본문 **굵게** 와 A & B <C>.\n\n## 1. 절\n\n- 항목\n- [x] 확인함\n1. 첫째\n\n| 역할 | 성명 |\n|---|---|\n| 품질관리자 | 홍길동 |\n\n> 인용\n";
  const file = markdownToHwpx(sample, { title: "시험 & <문서>" });
  const entries = readZip(file);
  check("한글 파일: 항목 구성과 순서", JSON.stringify(entries.map((e) => e.name)) === JSON.stringify(EXPECTED_ENTRIES), entries.map((e) => e.name).join(","));
  check("한글 파일: mimetype 이 첫 항목·무압축·정해진 값", entries[0]?.method === 0 && entries[0]?.data.toString("utf8") === HWPX_MIME_TYPE);
  check("한글 파일: 모든 항목의 CRC 일치", entries.every((e) => e.crcOk));
  for (const e of entries.filter((x) => x.name.endsWith(".xml") || x.name.endsWith(".hpf"))) {
    const problem = wellFormed(e.data.toString("utf8"));
    check(`한글 파일: XML 짜임 ${e.name}`, problem === null, problem ?? "");
  }
  check("한글 파일: 같은 입력이면 같은 파일", markdownToHwpx(sample, { title: "시험 & <문서>" }).equals(file));
  const section = sectionOf(file);
  check("한글 파일: 제목·굵게·특수 문자", section.includes("<hp:t>제목 문서</hp:t>") && /charPrIDRef="1"><hp:t>굵게<\/hp:t>/.test(section) && section.includes("A &amp; B &lt;C&gt;."));
  check("한글 파일: 표 2행 2열", section.includes('rowCnt="2" colCnt="2"') && (section.match(/<hp:tc /g) ?? []).length === 4);
  check("한글 파일: 목록·체크 상자·번호", section.includes("<hp:t>- 항목</hp:t>") && section.includes("<hp:t>■ 확인함</hp:t>") && section.includes("<hp:t>1. 첫째</hp:t>"));
  check("짜임 검사기 대조군: 닫히지 않은 요소를 잡음", wellFormed("<a><b></a>") !== null && wellFormed("<a>x & y</a>") !== null && wellFormed("<a>x &amp; y</a>") === null);
}

// ── 2·3. 문서 전부 ─────────────────────────────────────────────────
async function testAllDocuments(): Promise<void> {
  const ids = listSchemaIds();
  check(`문서 ${EXPECTED_DOCS}종`, ids.length === EXPECTED_DOCS, String(ids.length));
  const failures: string[] = [];
  const note = (docId: string, what: string): void => {
    failures.push(`${docId}: ${what}`);
  };

  for (const docId of ids) {
    const schema = getSchema(docId);
    if (!schema) continue;
    const labelsOnly = new Set<string>();
    // 서식에 인쇄된 문장(확약 문구 등)은 입력값이 아니라 본문에 그대로 들어간다
    const statements = new Set(schema.sections.map((s) => s.statement ?? "").filter(Boolean));

    // 빈 입력 — 값이 아니라 빈칸과 안내
    const empty = await call<Generated>("generate_quality_document", { docId, formValues: {} });
    const emptyBody = empty.markdown ?? "";
    if (!emptyBody.startsWith(`# ${empty.title}\n`)) note(docId, "빈 입력: 제목 줄");
    if (empty.requiredFilled !== 0 || empty.missingRequired.length !== empty.requiredTotal) note(docId, "빈 입력: 필수 항목 집계");
    for (const line of emptyBody.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(`> ${GUIDE}`) || /^\|[\s:|-]+\|$/.test(trimmed) || statements.has(trimmed)) continue;
      if (!trimmed.startsWith("|")) {
        note(docId, `빈 입력: 표·제목·안내가 아닌 줄 — ${trimmed.slice(0, 40)}`);
        continue;
      }
      const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const isPairRow = cells.length === 2 && cells[0] !== "항목";
      const isHeader = cells.every((c) => c !== "") && !isPairRow;
      if (isPairRow) {
        labelsOnly.add(cells[0] ?? "");
        if (cells[1] !== "") note(docId, `빈 입력: 값이 들어간 칸 — ${trimmed.slice(0, 60)}`);
      } else if (!isHeader && cells.some((c) => c !== "")) note(docId, `빈 입력: 값이 들어간 표 줄 — ${trimmed.slice(0, 60)}`);
    }
    // 필수 항목마다 무엇이 비었는지 알린다
    const guideCount = emptyBody.split("\n").filter((l) => l.includes("(필수) — 비어 있습니다")).length;
    if (guideCount !== empty.requiredTotal) note(docId, `빈 입력: 필수 항목 안내 ${guideCount}/${empty.requiredTotal}`);
    if (!empty.remaining.includes("서명")) note(docId, "빈 입력: 남은 일 안내");

    // 채운 입력
    const values = sampleValues(docId);
    const filled = await call<Generated>("generate_quality_document", { docId, formValues: values });
    const body = filled.markdown ?? "";
    if (filled.missingRequired.length !== 0 || filled.problems.length !== 0 || filled.unknownKeys.length !== 0) {
      note(docId, `채운 입력: 빈 항목 ${filled.missingRequired.length} · 문제 ${filled.problems.join(",")} · 모르는 키 ${filled.unknownKeys.join(",")}`);
    }
    if (body.includes("비어 있습니다") && !/· [^|]* — 비어/.test(body) && filled.requiredFilled !== filled.requiredTotal) note(docId, "채운 입력: 필수 항목이 비었다고 나옴");
    for (const section of schema.sections) {
      for (const field of section.fields) {
        const kind = fieldKind(field);
        const expected = kind === "date" ? "2026-03-15" : kind === "number" ? "12.5" : kind === "list" ? "첫째 항목" : kind === "longText" ? "첫 줄 내용" : kind === "shortText" ? `${field.name} 값` : null;
        if (expected !== null && !body.includes(expected)) note(docId, `채운 입력: ${field.name} 값이 본문에 없음`);
      }
    }

    // 검토 — 채운 입력은 사람 검토 단계로, 빈 본문은 고칠 점으로
    const review = await call<Review>("review_quality_document", { docId, formValues: values });
    if (review.verdict !== "ready_for_human_review" || review.summary.errors !== 0) note(docId, `검토: 채운 입력이 통과하지 않음 — ${review.findings.map((f) => f.message).slice(0, 2).join(" / ")}`);
    if (!review.remaining.includes("담당자 검토와 서명")) note(docId, "검토: 남은 일 안내");
    const reviewEmpty = await call<Review>("review_quality_document", { docId, markdown: emptyBody });
    if (empty.requiredTotal > 0 && reviewEmpty.verdict !== "needs_revision") note(docId, "검토: 빈 본문을 통과시킴");

    // 한글 파일 — 저장하고 내용 확인
    const saved = await call<Generated>("generate_quality_document", { docId, formValues: values, format: "hwpx" });
    if (!saved.hwpxPath || !saved.hwpxPath.endsWith(".hwpx")) {
      note(docId, "한글: 경로 없음");
      continue;
    }
    const file = readFileSync(saved.hwpxPath);
    const entries = readZip(file);
    // 법정 서식 원본이 있으면 그 서식의 패키지 그대로, 없으면 항목 구조 패키지
    const form = officialFormMap(docId);
    if ((saved.hwpxLayout === "official_form") !== (form !== null)) note(docId, `한글: 짜임 표시 ${saved.hwpxLayout}`);
    // 원본의 폴더 항목("Contents/" 등)은 내용이 없어 다시 묶을 때 넣지 않는다
    const expectedEntries = form ? readZip(readFileSync(officialFormPath(form))).map((e) => e.name).filter((n) => !n.endsWith("/")) : EXPECTED_ENTRIES;
    if (JSON.stringify(entries.map((e) => e.name)) !== JSON.stringify(expectedEntries) || !entries.every((e) => e.crcOk)) note(docId, "한글: 패키지 구성");
    const section = sectionOf(file);
    const problem = wellFormed(section);
    if (problem !== null) note(docId, `한글: 본문 XML — ${problem}`);
    // 서식은 제목을 서식의 글자로 갖는다 — 제목 확인은 항목 구조만
    if (!form && !section.includes(`<hp:t>${filled.title.replace(/&/g, "&amp;")}</hp:t>`)) note(docId, "한글: 제목 없음");
    if (section.includes("작성 안내")) note(docId, "한글: 작성 안내가 들어감");
    if ((statSync(saved.hwpxPath).mode & 0o777) !== OWNER_ONLY_MODE) note(docId, "한글: 파일 권한");
    // 서식 채움의 표 내용(행 이름 표에 맞는 이름이 없으면 넣지 않고 알림)은 test-official-forms.ts 가 본다
    if (!form && section.includes("세로줄") !== Object.values(values).some((v) => Array.isArray(v) && typeof v[0] === "object")) note(docId, "한글: 표 내용");
    // 한글 파일은 정본(.dclx)과 함께 만든다
    if (!saved.dclxPath || !saved.dclxPath.endsWith(".dclx")) note(docId, "한글: 정본(.dclx) 경로 없음");
    else if (JSON.stringify(readZip(readFileSync(saved.dclxPath)).map((e) => e.name)) !== JSON.stringify(DCLX_ENTRIES)) note(docId, "정본: 아카이브 구성");

    // DocLang
    for (const [label, formValues] of [["빈 입력", {}], ["채운 입력", values]] as const) {
      const xml = (await call<Generated>("generate_quality_document", { docId, formValues, format: "doclang" })).doclang ?? "";
      if (!xml.startsWith(`<doclang xmlns="${DOCLANG_NAMESPACE}" version="${DOCLANG_VERSION}">`)) note(docId, `DocLang ${label}: 뿌리 요소`);
      const xmlProblem = wellFormed(xml);
      if (xmlProblem !== null) note(docId, `DocLang ${label}: ${xmlProblem}`);
      if (/<text>[^<]*\n[^<]*<\/text>/.test(xml)) note(docId, `DocLang ${label}: <text> 안 줄바꿈`);
      const fillable = (xml.match(/<value class="fillable"><\/value>/g) ?? []).length;
      if (label === "빈 입력" && fillable < empty.requiredTotal) note(docId, `DocLang 빈 입력: 빈칸 표시 ${fillable} < 필수 ${empty.requiredTotal}`);
      if (label === "채운 입력" && xml.includes("&lt;A&amp;B&gt;") !== body.includes("<A&B>")) note(docId, "DocLang 채운 입력: 특수 문자");
      if (!xml.includes(`<doc_id>${docId}</doc_id>`)) note(docId, `DocLang ${label}: 문서 종류 표시`);
    }
  }
  check(`문서 ${ids.length}종: 생성 → 검토 → 한글 파일 → DocLang`, failures.length === 0, failures.slice(0, 8).join(" ‖ "));
}

// ── 4. 검토 ────────────────────────────────────────────────────────
async function testReview(): Promise<void> {
  const base = sampleValues("ncr");
  const missing = await call<Review>("review_quality_document", { docId: "ncr", formValues: { ...base, projectName: "" } });
  check("검토: 빈 필수 항목을 알림", missing.verdict === "needs_revision" && missing.findings.some((f) => f.code === "missing_required" && f.where.includes("공사명")));

  const badDate = await call<Review>("review_quality_document", { docId: "ncr", formValues: { ...base, reportDate: "2026-02-30" } });
  check("검토: 달력에 없는 날짜", badDate.verdict === "needs_revision" && badDate.findings.some((f) => f.code === "format" && f.message.includes("달력에 없는")), JSON.stringify(badDate.findings.slice(0, 3)));
  const badFormat = await call<Review>("review_quality_document", { docId: "ncr", formValues: { ...base, reportDate: "내일" } });
  check("검토: 날짜 형식", badFormat.findings.some((f) => f.code === "format" && f.message.includes("날짜 형식")));
  const leap = await call<Review>("review_quality_document", { docId: "ncr", formValues: { ...base, reportDate: "2028-02-29" } });
  check("검토: 윤년의 2월 29일은 통과", leap.verdict === "ready_for_human_review");
  const unknown = await call<Review>("review_quality_document", { docId: "ncr", formValues: { ...base, 없는칸: "값" } });
  check("검토: 양식에 없는 키는 경고", unknown.findings.some((f) => f.code === "unknown_key" && f.severity === "warning") && unknown.verdict === "ready_for_human_review");

  // 직접 쓴 본문
  const written = "# 부적합 보고서\n\n콘크리트 타설 중 슬럼프가 기준을 벗어났다. 건설기술 진흥법 제55조와 같은 법 시행령 제155조에 따라 조치한다. 산업안전보건법 제36조도 참고했다. 작성일 2026-13-01.\n";
  const reviewWritten = await call<Review>("review_quality_document", { docId: "ncr", markdown: written });
  check("검토: 본문의 없는 조문", reviewWritten.findings.some((f) => f.code === "citation_not_found" && f.where.includes("제155조")), JSON.stringify(reviewWritten.citations));
  check("검토: 수록하지 않은 법령은 틀렸다고 하지 않음", reviewWritten.findings.some((f) => f.code === "citation_unverifiable" && f.severity === "info" && f.message.includes("틀렸다는 뜻이 아님")));
  check("검토: 확인된 조문을 밝힘", reviewWritten.citations.some((c) => c.outcome === "confirmed" && c.reference.includes("제55조")));
  check("검토: 본문의 달력에 없는 날짜", reviewWritten.findings.some((f) => f.code === "invalid_date" && f.where === "2026-13-01"));
  check("검토: 본문에 없는 필수 항목은 경고", reviewWritten.findings.some((f) => f.code === "not_in_body" && f.severity === "warning"));

  const generated = (await call<Generated>("generate_quality_document", { docId: "ncr", formValues: base })).markdown ?? "";
  const reviewGenerated = await call<Review>("review_quality_document", { docId: "ncr", markdown: generated });
  check("검토: 만든 본문을 그대로 넣으면 통과하고 남은 안내 줄을 알림", reviewGenerated.verdict === "ready_for_human_review" && reviewGenerated.findings.some((f) => f.code === "guide_left"), JSON.stringify(reviewGenerated.findings.slice(0, 3)));
  const blanked = generated.replace(/\| 공사명 \| [^|]* \|/, "| 공사명 |  |");
  const reviewBlanked = await call<Review>("review_quality_document", { docId: "ncr", markdown: blanked });
  check("검토: 본문에서 내용이 빈 필수 항목", reviewBlanked.verdict === "needs_revision" && reviewBlanked.findings.some((f) => f.code === "empty_in_body" && f.where.includes("공사명")));

  let rejected = 0;
  for (const input of [{ docId: "ncr" }, { docId: "ncr", formValues: {} }, { docId: "없는문서", formValues: base }]) {
    try {
      await callTool("review_quality_document", input, { graph });
    } catch {
      rejected += 1;
    }
  }
  check("검토: 볼 것이 없거나 없는 문서 종류면 거절", rejected === 3, String(rejected));
}

// ── 5. 내보내기 ────────────────────────────────────────────────────
async function testExport(): Promise<void> {
  type Exported = { hwpxPath?: string; fileName: string; bytes: number; title: string; removedGuideLines: number; contentBase64?: string; mimeType: string };
  const body = "# 시정조치 결과\n\n> [작성 안내] 이 줄은 저장하지 않는다.\n\n조치를 마쳤다.\n\n| 항목 | 내용 |\n|---|---|\n| 확인자 | 홍길동 |\n";
  const first = await call<Exported>("export_quality_document", { markdown: body, docId: "ncr" });
  const second = await call<Exported>("export_quality_document", { markdown: body, docId: "ncr" });
  check("내보내기: 파일을 저장하고 경로를 줌", typeof first.hwpxPath === "string" && first.hwpxPath.includes("/documents/ncr/") && first.fileName.startsWith("ncr-") && first.bytes > 1000);
  check("내보내기: 같은 시각에 다시 저장해도 덮어쓰지 않음", first.hwpxPath !== second.hwpxPath);
  check("내보내기: 제목은 본문의 첫 제목 줄", first.title === "시정조치 결과");
  const section = sectionOf(readFileSync(first.hwpxPath ?? ""));
  check("내보내기: 작성 안내 줄은 빼고 저장", first.removedGuideLines === 1 && !section.includes("저장하지 않는다") && section.includes("조치를 마쳤다."));
  check("내보내기: 소유자만 읽고 쓰는 파일", (statSync(first.hwpxPath ?? "").mode & 0o777) === OWNER_ONLY_MODE);

  const inline = await call<Exported>("export_quality_document", { markdown: body, returnContent: true });
  const decoded = Buffer.from(inline.contentBase64 ?? "", "base64");
  check("내보내기: 내용을 돌려받기(저장 안 함)", inline.hwpxPath === undefined && inline.mimeType === HWPX_MIME_TYPE && readZip(decoded).length === EXPECTED_ENTRIES.length && inline.fileName === "document.hwpx");
  check("결재·제출용 사본: 작성 안내만 빠지고 나머지는 그대로", toApprovalCopy(body) === "# 시정조치 결과\n\n조치를 마쳤다.\n\n| 항목 | 내용 |\n|---|---|\n| 확인자 | 홍길동 |\n");

  let rejected = 0;
  for (const input of [{ markdown: "" }, { markdown: "본문", docId: "없는문서" }, {}]) {
    try {
      await callTool("export_quality_document", input, { graph });
    } catch {
      rejected += 1;
    }
  }
  check("내보내기: 빈 본문·없는 문서 종류는 거절", rejected === 3, String(rejected));

  // 파일을 쓰는 도구는 읽기 전용이 아니라고 밝힌다
  check("주의 표시: 생성·내보내기는 파일을 쓸 수 있음", findTool("generate_quality_document")?.annotations.readOnlyHint === false && findTool("export_quality_document")?.annotations.readOnlyHint === false);
  check("주의 표시: 검토는 읽기 전용", findTool("review_quality_document")?.annotations.readOnlyHint === true);
  let unknownDoc = false;
  try {
    await callTool("generate_quality_document", { docId: "없는문서" }, { graph });
  } catch {
    unknownDoc = true;
  }
  check("생성: 없는 문서 종류는 거절", unknownDoc);
}

async function testDclx(): Promise<void> {
  const values = { projectName: "정본 시험 현장", entries: [{ seq: 1, inspectionDate: "2026-11-14", inspectionKind: "현장시험", material: "레미콘", inspectionItem: "슬럼프", testResult: "163mm", resultVerdict: "적합", qcEngineerName: "정본이름" }] };
  const made = await call<Generated>("generate_quality_document", { docId: "quality_inspection_register", formValues: values });
  check("정본: 형식을 정하지 않으면 .dclx 를 저장한다", made.format === "dclx" && made.dclxSaved === true && (made.dclxPath ?? "").endsWith(".dclx"));
  const file = readFileSync(made.dclxPath ?? "");
  const parts = readZip(file);
  check("정본: 규격의 세 부분(콘텐츠 형식·관계·문서)과 CRC", JSON.stringify(parts.map((e) => e.name)) === JSON.stringify(DCLX_ENTRIES) && parts.every((e) => e.crcOk), parts.map((e) => e.name).join(","));
  const part = (name: string): string => parts.find((e) => e.name === name)?.data.toString("utf8") ?? "";
  check(
    "정본: document.xml 의 내용 형식과 본문 관계가 규격대로",
    part("[Content_Types].xml").includes('<Override PartName="/document.xml" ContentType="application/vnd.doclang.document+xml"/>') &&
      (part("_rels/.rels").match(/Type="http:\/\/doclang\.ai\/ns\/package\/2026\/relationships\/document"/g) ?? []).length === 1,
  );
  const doclang = (await call<Generated>("generate_quality_document", { docId: "quality_inspection_register", formValues: values, format: "doclang" })).doclang ?? "";
  check("정본: 아카이브의 문서가 DocLang 형식 출력과 같다", part("document.xml") === doclang && doclang.includes("정본이름") && !doclang.includes(GUIDE));
  check("정본: 소유자만 읽는 파일", (statSync(made.dclxPath ?? "").mode & 0o777) === OWNER_ONLY_MODE);
  check("정본: 미리보기 본문(작성 안내 포함)을 함께 준다", (made.markdown ?? "").includes(GUIDE) && (made.markdown ?? "").includes("정본이름"));

  // 정본에서 한글 파일
  const fromPath = await call<{ hwpxPath?: string; from?: string; title?: string }>("export_quality_document", { dclxPath: made.dclxPath });
  const hwpxSection = sectionOf(readFileSync(fromPath.hwpxPath ?? ""));
  check(
    "내보내기: 정본 경로에서 한글 파일 — 값·제목은 들어가고 작성 안내는 없다",
    fromPath.from === "dclxPath" && hwpxSection.includes("정본이름") && hwpxSection.includes("163mm") && hwpxSection.includes("<hp:t>품질검사 실시대장</hp:t>") && !hwpxSection.includes("작성 안내"),
  );
  const fromBase64 = await call<{ contentBase64?: string; from?: string }>("export_quality_document", { dclxBase64: file.toString("base64"), returnContent: true });
  const fromXml = await call<{ contentBase64?: string; from?: string }>("export_quality_document", { doclang, returnContent: true });
  check(
    "내보내기: 정본 내용(base64)과 DocLang 글에서 같은 한글 파일",
    fromBase64.from === "dclxBase64" && fromXml.from === "doclang" && fromBase64.contentBase64 === fromXml.contentBase64 && Buffer.from(fromBase64.contentBase64 ?? "", "base64").equals(readFileSync(fromPath.hwpxPath ?? "")),
  );

  // 받지 않는 정본
  const outside = join(mkdtempSync(join(tmpdir(), "quality-dclx-outside-")), "밖.dclx");
  writeFileSync(outside, file);
  const notDclx = join(process.env["QUALITY_LOCAL_DIR"] ?? "", "documents", "quality_inspection_register", "본문.txt");
  writeFileSync(notDclx, "글");
  const broken = parts.filter((e) => e.name !== "_rels/.rels");
  let refused = 0;
  for (const input of [{ dclxPath: outside }, { dclxPath: notDclx }, { dclxBase64: Buffer.from("ZIP 아님").toString("base64") }, { dclxBase64: zipOf(broken).toString("base64") }, { doclang: "<html/>" }]) {
    try {
      await callTool("export_quality_document", input, { graph });
    } catch {
      refused += 1;
    }
  }
  check("내보내기: 저장 폴더 밖 경로·.dclx 아닌 파일·ZIP 아님·관계 없는 아카이브·DocLang 아님은 거절", refused === 5, String(refused));

  // 고칠 점이 있으면 정본도 만들지 않는다
  const bad = await call<Generated>("generate_quality_document", { docId: "quality_inspection_register", formValues: { projectName: "현장", registerPeriod: { start: "2026-13-45" } } });
  check("정본: 입력에 고칠 점이 있으면 파일을 만들지 않는다", bad.problems.length > 0 && bad.dclxSaved === false && !bad.dclxPath, `problems ${bad.problems.length}`);
}

/** 시험용 — 항목들을 저장 방식 ZIP 으로 (거절 시험에 쓸 망가진 아카이브) */
function zipOf(entries: Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc32(e.data), 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc32(e.data), 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, e.data);
    centrals.push(central, name);
    offset += 30 + name.length + e.data.length;
  }
  const size = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

async function main(): Promise<void> {
  testPackage();
  await testAllDocuments();
  await testReview();
  await testExport();
  await testDclx();
  console.log(`[documents] ${passed} 통과 / ${failed} 실패`);
  if (failed > 0) process.exit(1);
}

await main();
