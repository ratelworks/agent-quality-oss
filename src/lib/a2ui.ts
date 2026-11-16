// ─────────────────────────────────────────────────────────────────────────────
// a2ui.ts — A2UI 1.0 메시지·컴포넌트 조립 (기본 카탈로그만 사용)
//
// 규격: https://a2ui.org/specification/v1.0-a2ui/ (github.com/a2ui-project/a2ui, specification/v1_0)
//   - 모든 메시지에 version "1.0"
//   - 컴포넌트는 기본 카탈로그(Text·TextField·DateTimeInput·ChoicePicker·Button·Card·Column)만
//   - 입력값은 데이터 모델 경로({"@path": "/draft/<키>"})에 바인딩
//   - 기본 카탈로그에 없는 정보(양식 필드 키·입력 종류·표의 열)는 `@metadata.extensions` 에 싣는다
// ─────────────────────────────────────────────────────────────────────────────

// ───── 상수 ─────
export const A2UI_VERSION = "1.0";
export const A2UI_BASIC_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";
/** 입력값이 놓이는 데이터 모델 뿌리 */
export const DRAFT_ROOT = "draft";
/** 폼 뿌리 컴포넌트 id — 1.0 에서 뿌리는 id 가 "root" 인 컴포넌트다 */
export const ROOT_ID = "root";
const HEADING_PREFIX = { h1: "# ", h2: "## " } as const;
const DATE_KINDS: Record<string, { enableDate: boolean; enableTime: boolean }> = {
  date: { enableDate: true, enableTime: false },
  datetime: { enableDate: true, enableTime: true },
};
const REQUIRED_MESSAGE = "필수 입력 항목입니다.";

// ───── 타입 ─────
export interface A2UIComponent {
  id: string;
  component: string;
  [key: string]: unknown;
}

export interface A2UIMessage {
  version: typeof A2UI_VERSION;
  createSurface?: {
    surfaceId: string;
    catalogId: string;
    sendDataModel?: boolean;
    dataModel?: Record<string, unknown>;
  };
  updateComponents?: { surfaceId: string; components: A2UIComponent[] };
  updateDataModel?: { surfaceId: string; path?: string; value: unknown };
}

export type TextKind = "h1" | "h2" | "body" | "caption";

export interface ChoiceOption {
  label: string;
  value: string;
}

export interface FieldSpec {
  id: string;
  /** 데이터 모델 경로의 마디 — 예: ["reportedBy", "name"] → /draft/reportedBy/name */
  path: string[];
  label: string;
  /** 입력 종류 — shortText·longText·number·date·datetime·choice·list·rows */
  inputKind: string;
  required?: boolean;
  placeholder?: string;
  /** 선택형의 선택지 */
  options?: ChoiceOption[];
  /** 표(rows)의 열 — 표준 렌더러는 여러 줄 입력으로, 내장 화면은 표 입력으로 그린다 */
  columns?: Array<{ key: string; label: string }>;
}

// ───── 메시지 ─────
/** surface 생성 — 초기 입력값은 데이터 모델로 함께 보내고, 사용자 동작 때 데이터 모델을 돌려받는다 */
export function createSurfaceMessage(surfaceId: string, draft: Record<string, unknown> = {}): A2UIMessage {
  return {
    version: A2UI_VERSION,
    createSurface: {
      surfaceId,
      catalogId: A2UI_BASIC_CATALOG_ID,
      sendDataModel: true,
      dataModel: { [DRAFT_ROOT]: draft },
    },
  };
}

export function updateComponentsMessage(surfaceId: string, components: A2UIComponent[]): A2UIMessage {
  return { version: A2UI_VERSION, updateComponents: { surfaceId, components } };
}

export function toJsonl(messages: A2UIMessage[]): string {
  return messages.map((m) => JSON.stringify(m)).join("\n");
}

// ───── 컴포넌트 ─────
/** 제목은 Markdown 머리표, 본문·주석은 variant 로 표현한다 */
export function textComponent(id: string, text: string, kind: TextKind = "body"): A2UIComponent {
  if (kind === "h1" || kind === "h2") {
    return { id, component: "Text", text: `${HEADING_PREFIX[kind]}${text}` };
  }
  return { id, component: "Text", text, variant: kind };
}

/** JSON Pointer(RFC 6901) 마디 이스케이프 */
function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function draftPath(segments: string[]): string {
  return `/${DRAFT_ROOT}/${segments.map(escapePointerSegment).join("/")}`;
}

/** 입력 컴포넌트 — 종류에 따라 TextField·DateTimeInput·ChoicePicker 를 고른다 */
export function fieldComponent(spec: FieldSpec): A2UIComponent {
  const pointer = draftPath(spec.path);
  const extensions: Record<string, unknown> = { fieldKey: spec.path.join("."), inputKind: spec.inputKind };
  if (spec.columns) extensions["columns"] = spec.columns;
  const base = {
    id: spec.id,
    label: spec.label,
    value: { "@path": pointer },
    "@metadata": { extensions },
    ...(spec.required
      ? { "@checks": [{ condition: { "@call": "required", args: { value: { "@path": pointer } } }, message: REQUIRED_MESSAGE }] }
      : {}),
  };
  const dateKind = DATE_KINDS[spec.inputKind];
  if (dateKind) return { ...base, component: "DateTimeInput", ...dateKind };
  if (spec.inputKind === "choice") {
    return { ...base, component: "ChoicePicker", variant: "mutuallyExclusive", options: spec.options ?? [] };
  }
  const multiLine = spec.inputKind === "longText" || spec.inputKind === "list" || spec.inputKind === "rows";
  const variant = multiLine ? "longText" : spec.inputKind === "number" ? "number" : "shortText";
  return {
    ...base,
    component: "TextField",
    variant,
    ...(spec.placeholder ? { placeholder: spec.placeholder } : {}),
  };
}

/** 버튼 — 누르면 이름 붙은 이벤트와 문맥을 내보낸다 */
export function buttonComponent(
  id: string,
  childId: string,
  eventName: string,
  context: Record<string, unknown> = {},
  variant: "default" | "primary" | "borderless" = "default",
): A2UIComponent {
  return { id, component: "Button", child: childId, variant, action: { event: { name: eventName, context } } };
}

/** 이벤트 문맥에 싣는 입력값 묶음 바인딩 — 렌더러가 버튼을 누를 때 현재 입력값으로 풀어 보낸다 */
export const DRAFT_BINDING = { "@path": `/${DRAFT_ROOT}` } as const;

/** 입력 종류에 맞는 빈 초기값 (선택형은 빈 목록, 그 밖은 빈 문자열) */
export function emptyValue(inputKind: string): unknown {
  return inputKind === "choice" ? [] : "";
}
