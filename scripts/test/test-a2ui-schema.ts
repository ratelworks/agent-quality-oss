#!/usr/bin/env tsx
/**
 * test-a2ui-schema.ts — 입력 폼 출력이 A2UI 1.0 공식 스키마·기본 카탈로그를 통과하는지 검증 (네트워크 없음)
 *
 *   1. 검증기 자체 확인: 공식 예제는 통과, 잘못된 입력(대조군)은 실패
 *   2. 문서 양식 전 종류 × render_quality_form 출력 — 스키마·트리·바인딩·필수 표시·선택지
 *   3. 표시 이름: 모든 필드·하위 항목·선택지에 한글 이름이 있고, 한 문서 안에서 겹치지 않는다
 *   4. 버튼 이벤트로 입력값이 전달되고, 그 값이 작성 컨텍스트에 그대로 반영된다
 *   5. 입력값 정리(여러 모양의 입력 → 한 가지 모양)
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { callTool } from "../../src/tool-registry.js";
import { loadOntologySync } from "../../src/ontology/loader.js";
import { OntologyGraph } from "../../src/ontology/graph.js";
import { getSchema, listSchemaIds } from "../../src/schemas/loader.js";
import {
  enumValues,
  fieldKind,
  findEnumLabel,
  findFieldLabel,
  findSubFieldLabel,
} from "../../src/schemas/fields.js";
import { A2UI_VERSION, A2UI_BASIC_CATALOG_ID, draftPath } from "../../src/lib/a2ui.js";
import { normalizeDraft, displayText } from "../../src/lib/draft.js";
import {
  validateA2uiJsonl,
  validateA2uiMessage,
  A2UI_VERSION as SCHEMA_VERSION,
  BASIC_CATALOG_ID,
} from "./a2ui-schema-validator.js";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const OFFICIAL_EXAMPLE = resolve(__dirname, "fixtures/a2ui-1.0/contact_form_example.jsonl");
/** 묶음·표·선택형·날짜·숫자가 모두 있는 문서 */
const SAMPLE_DOC_ID = "qc_assignment_notice";
const HANGUL = /[가-힣]/;

const graph = new OntologyGraph(loadOntologySync());

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

interface Component {
  id: string;
  component: string;
  [key: string]: unknown;
}
interface Message {
  version?: string;
  createSurface?: { surfaceId: string; catalogId: string; sendDataModel?: boolean; dataModel?: { draft: Record<string, unknown> } };
  updateComponents?: { surfaceId: string; components: Component[] };
}
interface FormResult {
  messages: Message[];
  fieldPathMap: Record<string, string>;
  requiredPaths: string[];
  fieldCount: number;
}

async function renderForm(docId: string): Promise<FormResult> {
  const response = await callTool("render_quality_form", { docId }, { graph });
  return response.result as FormResult;
}

function componentsOf(messages: Message[]): Component[] {
  return messages.flatMap((m) => m.updateComponents?.components ?? []);
}

/** 뿌리(root)에서 자식 참조를 따라 닿는 컴포넌트 id 집합 */
function reachableFromRoot(components: Component[]): Set<string> {
  const byId = new Map(components.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (seen.has(id)) return;
    const c = byId.get(id);
    if (!c) return;
    seen.add(id);
    if (typeof c.child === "string") walk(c.child);
    if (Array.isArray(c.children)) for (const ch of c.children) if (typeof ch === "string") walk(ch);
  };
  walk("root");
  return seen;
}

function readPointer(model: unknown, pointer: string): unknown {
  let cur: unknown = model;
  for (const raw of pointer.split("/").slice(1)) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[raw.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return cur;
}

function hasRequiredCheck(c: Component | undefined): boolean {
  const checks = (c?.["@checks"] as Array<{ condition?: { "@call"?: string } }> | undefined) ?? [];
  return checks.some((r) => r.condition?.["@call"] === "required");
}

// ── 1. 검증기 자체 ──────────────────────────────────────────────────
function testValidatorItself(): void {
  check("상수 일치(version)", A2UI_VERSION === SCHEMA_VERSION);
  check("상수 일치(catalogId)", A2UI_BASIC_CATALOG_ID === BASIC_CATALOG_ID);
  check("공식 예제 통과", validateA2uiJsonl(readFileSync(OFFICIAL_EXAMPLE, "utf8")).valid);

  const text = (extra: Record<string, unknown>) => ({
    version: "1.0",
    updateComponents: { surfaceId: "s", components: [{ id: "root", component: "Text", text: "x", ...extra }] },
  });
  check("정상 Text 통과", validateA2uiMessage(text({ variant: "caption" })).valid);
  // 대조군 — 아래는 모두 실패해야 한다 (이전 판의 폼 구조 포함)
  check("대조군: version 없음", !validateA2uiMessage({ createSurface: { surfaceId: "s", catalogId: "a2ui-basic" } }).valid);
  check("대조군: 제목 variant", !validateA2uiMessage(text({ variant: "h1" })).valid);
  check(
    "대조군: updateComponents.root",
    !validateA2uiMessage({ version: "1.0", updateComponents: { surfaceId: "s", root: "root", components: [] } }).valid,
  );
  check(
    "대조군: TextField 에 값 바인딩 없음(fieldType·required 속성)",
    !validateA2uiMessage({
      version: "1.0",
      updateComponents: {
        surfaceId: "s",
        components: [{ id: "root", component: "TextField", label: "x", fieldType: "text", required: true }],
      },
    }).valid,
  );
  check(
    "대조군: Card 에 title·children",
    !validateA2uiMessage({
      version: "1.0",
      updateComponents: { surfaceId: "s", components: [{ id: "root", component: "Card", title: "x", children: [] }] },
    }).valid,
  );
  check(
    "대조군: 없는 검사 함수",
    !validateA2uiMessage({
      version: "1.0",
      updateComponents: {
        surfaceId: "s",
        components: [{ id: "root", component: "TextField", label: "x", value: { "@path": "/draft/x" }, "@checks": [{ condition: { "@call": "noSuchCheck", args: {} } }] }],
      },
    }).valid,
  );
  check("대조군: 빈 JSONL", !validateA2uiJsonl("").valid);
}

// ── 2. 문서 양식 전 종류 ────────────────────────────────────────────
async function testAllDocumentForms(): Promise<void> {
  const ids = listSchemaIds();
  let ok = 0;
  let requiredTotal = 0;
  let inputTotal = 0;
  for (const docId of ids) {
    const schema = getSchema(docId);
    if (!schema) throw new Error(`양식 없음: ${docId}`);
    const form = await renderForm(docId);
    const errors = form.messages.flatMap((m) => validateA2uiMessage(m).errors);
    const comps = componentsOf(form.messages);
    const byId = new Map(comps.map((c) => [c.id, c]));
    const reachable = reachableFromRoot(comps);
    const orphans = comps.filter((c) => !reachable.has(c.id)).map((c) => c.id);
    const duplicateIds = comps.length - byId.size;
    const model = form.messages[0]?.createSurface?.dataModel;

    // 모든 입력 컴포넌트가 데이터 모델 경로에 묶이고, 그 경로가 초기 데이터 모델에 있어야 한다
    const unbound = Object.entries(form.fieldPathMap).filter(([inputId, pointer]) => {
      const bound = (byId.get(inputId)?.value as { "@path"?: string } | undefined)?.["@path"];
      return bound !== pointer || readPointer(model, pointer) === undefined;
    });

    // 양식 정의와 직접 대조 — 필드마다 입력 칸·필수 표시·선택지가 맞는지
    const mismatches: string[] = [];
    const expectedRequiredPaths: string[] = [];
    let expectedInputs = 0;
    for (const section of schema.sections) {
      for (const field of section.fields) {
        const kind = fieldKind(field);
        const id = `f_${section.key}_${field.name}`;
        if (field.required) expectedRequiredPaths.push(draftPath([field.name]));
        if (kind === "group") {
          for (const sub of field.fields ?? []) {
            expectedInputs += 1;
            if (form.fieldPathMap[`${id}_${sub}`] !== draftPath([field.name, sub])) mismatches.push(`${field.name}.${sub} 경로`);
          }
          continue;
        }
        expectedInputs += 1;
        const c = byId.get(id);
        if (form.fieldPathMap[id] !== draftPath([field.name])) mismatches.push(`${field.name} 경로`);
        if (hasRequiredCheck(c) !== Boolean(field.required)) mismatches.push(`${field.name} 필수 표시`);
        if (kind === "choice") {
          const options = ((c?.options as Array<{ value: string }> | undefined) ?? []).map((o) => o.value);
          if (c?.component !== "ChoicePicker" || options.join("|") !== enumValues(field).join("|")) mismatches.push(`${field.name} 선택지`);
        }
        if ((kind === "date" || kind === "datetime") && c?.component !== "DateTimeInput") mismatches.push(`${field.name} 날짜 입력`);
        if (kind === "rows") {
          const columns = ((c?.["@metadata"] as { extensions?: { columns?: Array<{ key: string }> } } | undefined)?.extensions?.columns ?? []).map((x) => x.key);
          if (columns.join("|") !== (field.fields ?? []).join("|")) mismatches.push(`${field.name} 표의 열`);
        }
      }
    }
    if (Object.keys(form.fieldPathMap).length !== expectedInputs) mismatches.push(`입력 칸 수 ${Object.keys(form.fieldPathMap).length}≠${expectedInputs}`);
    if (form.requiredPaths.join("|") !== expectedRequiredPaths.join("|")) mismatches.push("필수 경로 목록");
    requiredTotal += expectedRequiredPaths.length;
    inputTotal += expectedInputs;

    const good =
      form.messages.length === 2 &&
      errors.length === 0 &&
      orphans.length === 0 &&
      duplicateIds === 0 &&
      unbound.length === 0 &&
      mismatches.length === 0 &&
      form.messages[0]?.createSurface?.sendDataModel === true;
    if (good) ok += 1;
    check(
      `${docId}: 1.0 스키마·트리·바인딩·양식 대조`,
      good,
      [
        ...errors.slice(0, 3),
        orphans.length ? `트리 밖 ${orphans.slice(0, 3).join(",")}` : "",
        duplicateIds ? `id 중복 ${duplicateIds}` : "",
        unbound.length ? `바인딩 누락 ${unbound.length}` : "",
        ...mismatches.slice(0, 4),
      ]
        .filter(Boolean)
        .join(" | "),
    );
  }
  console.log(`[a2ui-schema] 문서 ${ids.length}종 · 통과 ${ok} · 입력 칸 ${inputTotal}개 · 필수 ${requiredTotal}개`);
  check("문서가 한 종 이상이고 검사가 비어 있지 않음", ids.length > 0 && requiredTotal > 0 && inputTotal > requiredTotal);
}

// ── 3. 표시 이름 ────────────────────────────────────────────────────
function testLabels(): void {
  const missing: string[] = [];
  const duplicated: string[] = [];
  for (const docId of listSchemaIds()) {
    const schema = getSchema(docId);
    if (!schema) continue;
    const seen = new Map<string, string>();
    for (const section of schema.sections) {
      for (const field of section.fields) {
        const label = findFieldLabel(docId, field.name);
        if (!label || !HANGUL.test(label)) missing.push(`${docId}.${field.name}`);
        else if (seen.has(label)) duplicated.push(`${docId}: ${seen.get(label)}·${field.name} → ${label}`);
        else seen.set(label, field.name);
        for (const sub of field.fields ?? []) {
          const subLabel = findSubFieldLabel(sub);
          if (!subLabel || !HANGUL.test(subLabel)) missing.push(`${docId}.${field.name}.${sub}`);
        }
        for (const value of enumValues(field)) {
          if (!findEnumLabel(value)) missing.push(`${docId}.${field.name}=${value}`);
        }
      }
    }
  }
  check("모든 필드·하위 항목·선택지에 한글 표시 이름이 있음", missing.length === 0, missing.slice(0, 8).join(", "));
  check("한 문서 안에서 표시 이름이 겹치지 않음", duplicated.length === 0, duplicated.slice(0, 5).join(" / "));
}

// ── 4. 버튼 이벤트로 입력값 전달 ────────────────────────────────────
async function testEventCarriesInput(): Promise<void> {
  const form = await renderForm(SAMPLE_DOC_ID);
  const comps = componentsOf(form.messages);
  const model = form.messages[0]?.createSurface?.dataModel;
  if (!model) throw new Error("초기 데이터 모델 없음");
  const submit = comps.find(
    (c) => c.component === "Button" && (c.action as { event?: { name?: string } } | undefined)?.event?.name === "submit_document",
  );
  check("작성 완료 버튼이 있음", !!submit);
  const context = (submit?.action as { event: { context: Record<string, unknown> } } | undefined)?.event.context ?? {};
  check("이벤트 문맥이 입력값 묶음을 가리킴", (context.draft as { "@path"?: string } | undefined)?.["@path"] === "/draft");

  // 사용자가 입력한 뒤 작성 완료를 누른 상황 — 렌더러가 하는 일을 대신한다(선택형은 목록, 목록은 여러 줄 글자)
  model.draft.projectName = "○○ 신축공사";
  model.draft.noticeType = ["change"];
  model.draft.contractor = { companyName: "가나건설", businessNo: "", license: "" };
  model.draft.workTypes = "토공\n철근콘크리트공사";
  const resolvedDraft = readPointer(model, "/draft");
  const composed = await callTool("compose_writing_context", { docId: context.docId, formValues: resolvedDraft }, { graph });
  const result = composed.result as { markdown: string; unknownKeys: string[]; problems: string[] };
  check("입력한 글자가 작성 컨텍스트에 들어감", result.markdown.includes("○○ 신축공사"));
  check("선택형 값이 한글 이름으로 들어감", result.markdown.includes("**구분** *(필수)*: 변경"), result.markdown.split("\n").find((l) => l.includes("**구분**")) ?? "");
  check("묶음 값이 항목 이름과 함께 들어감", result.markdown.includes("상호 가나건설"));
  check("목록 값이 줄마다 한 건으로 들어감", result.markdown.includes("토공, 철근콘크리트공사"));
  check("폼이 준 데이터 모델에는 양식에 없는 키가 없음", result.unknownKeys.length === 0, result.unknownKeys.join(","));
  check("빈 폼의 값은 형식 문제로 잡히지 않음", result.problems.length === 0, result.problems.join(" / "));
}

// ── 5. 입력값 정리 ──────────────────────────────────────────────────
function testNormalizeDraft(): void {
  const plan = getSchema("quality_test_plan");
  const staffing = getSchema(SAMPLE_DOC_ID);
  if (!plan || !staffing) throw new Error("시험에 쓰는 양식이 없음");
  const field = (draft: ReturnType<typeof normalizeDraft>, name: string) => {
    const f = draft.fields.find((x) => x.name === name);
    if (!f) throw new Error(`필드 없음: ${name}`);
    return f;
  };

  const fromText = normalizeDraft(plan, { testItems: "콘크리트공사 | 슬럼프 | 1,200㎥ | 120㎥마다 | 10\n콘크리트공사 | 공기량" });
  const rows = field(fromText, "testItems").value as Array<Record<string, string>>;
  check("표: 여러 줄 글자를 행으로", rows.length === 2 && rows[0]?.testFrequency === "120㎥마다" && rows[1]?.testItem === "공기량");

  const fromObjects = normalizeDraft(plan, { testItems: [{ workType: "콘크리트공사", 시험종목: "슬럼프", 없는열: "x" }], 공사명: "○○ 신축공사", 없는키: "값" });
  const objectRows = field(fromObjects, "testItems");
  check("표: 객체 목록(한글 키 포함)을 행으로", (objectRows.value as Array<Record<string, string>>)[0]?.testItem === "슬럼프");
  check("표: 양식에 없는 열을 알림", objectRows.problems.some((p) => p.includes("없는열")));
  check("한글 표시 이름을 키로 받음", field(fromObjects, "projectName").value === "○○ 신축공사");
  check("양식에 없는 키를 알림", fromObjects.unknownKeys.join(",") === "없는키", fromObjects.unknownKeys.join(","));

  const numbers = normalizeDraft(staffing, { totalContractValue: "1,250,000,000", requiredHeadcount: "약 3명", "contractor.companyName": "가나건설" });
  check("숫자: 쉼표를 뺀 숫자로", field(numbers, "totalContractValue").value === "1250000000" && field(numbers, "totalContractValue").problems.length === 0);
  check("숫자 칸의 글자를 알림", field(numbers, "requiredHeadcount").problems.length === 1);
  check("묶음: 점으로 이은 키를 받음", (field(numbers, "contractor").value as Record<string, string>).companyName === "가나건설");

  const empty = normalizeDraft(plan, {});
  const requiredCount = plan.sections.flatMap((s) => s.fields).filter((f) => f.required).length;
  check("빈 입력: 필수 항목이 모두 비어 있다고 나옴", empty.missingRequired.length === requiredCount && requiredCount > 0);

  const byLabel = normalizeDraft(staffing, { noticeType: "변경", complianceCheck: ["compliant"], targetGrade: "최고급" });
  check("선택형: 한글 이름을 코드로", field(byLabel, "noticeType").value === "change");
  check("선택형: 한 원소 목록을 값으로", field(byLabel, "complianceCheck").value === "compliant" && displayText(field(byLabel, "complianceCheck")) === "충족");
  check("선택형: 선택지에 없는 값을 알림", field(byLabel, "targetGrade").problems.length === 1);
}

async function main(): Promise<void> {
  testValidatorItself();
  await testAllDocumentForms();
  testLabels();
  await testEventCarriesInput();
  testNormalizeDraft();
  console.log(`[a2ui-schema] ${pass} 통과 / ${fail} 실패`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
