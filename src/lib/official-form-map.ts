// ─────────────────────────────────────────────────────────────────────────────
// official-form-map.ts — 법정 서식 원본 파일과 칸 지도(src/schemas/official-forms/forms.json)를 읽는다.
// 채우기는 official-form.ts. 문서 본문 안내(document-body)가 서식 원본의 유무를 묻는 데도 쓴다.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ───── 상수 ─────
const FORMS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../schemas/official-forms");
const MAP_FILE = "forms.json";

// ───── 칸 지도 형식 ─────
export interface FormSource {
  law: string;
  form: string;
  url: string;
  fetched: string;
  sha256: string;
  /** 구형 HWP 를 바꿔 넣었으면 그 기록 */
  converted?: string;
}
/** 입력값이 이 가운데 하나일 때만 적용한다(선택형 값에 따라 표시를 더하는 칸 — 재검측 "(재)" 등) */
export interface When { key: string; in: string[] }
export interface CellSpec { table: number; row: number; col: number; template: string; when?: When }
export interface ParagraphSpec { match: string; nth?: number; template: string; when?: When }
export interface CheckSpec { table: number; row: number; col: number; field: string; other?: string }
export interface RowCell { offset?: number; col: number; template: string; when?: When }
export interface RowsSpec {
  field: string;
  table: number;
  firstRow: number;
  lastRow: number;
  step?: number;
  /** 손으로 여러 줄을 적도록 한 행을 크게 비워 둔 서식 — 입력이 있으면 그 행을 같은 높이 안에서 이 수만큼 나눈다 */
  divide?: number;
  cells: RowCell[];
}
export interface NamedRowsSpec {
  field: string;
  table: number;
  key: string;
  labelCol: number;
  firstRow: number;
  lastRow: number;
  /** 맞는 이름이 없을 때 넣는 행의 이름(예: 기타) — 없으면 넣지 않고 알린다 */
  other?: string;
  /** 여러 행에 걸친 묶음 칸(점검 구분 등)이 있는 열과 그 값을 담은 입력 열 */
  groupCol?: number;
  groupKey?: string;
  cells: RowCell[];
}
export interface FormMap {
  file: string;
  source: FormSource;
  cells?: CellSpec[];
  paragraphs?: ParagraphSpec[];
  checks?: CheckSpec[];
  rows?: RowsSpec[];
  namedRows?: NamedRowsSpec[];
}

let mapsCache: Record<string, FormMap> | null = null;

function maps(): Record<string, FormMap> {
  if (!mapsCache) {
    const raw = JSON.parse(readFileSync(path.join(FORMS_DIR, MAP_FILE), "utf8")) as { forms: Record<string, FormMap> };
    mapsCache = raw.forms;
  }
  return mapsCache;
}

/** 이 문서 종류에 채울 법정 서식 원본이 있는가 */
export function officialFormMap(docId: string): FormMap | null {
  return maps()[docId] ?? null;
}

export function officialFormDocIds(): string[] {
  return Object.keys(maps());
}

/** 서식 원본 파일의 경로 */
export function officialFormPath(map: FormMap): string {
  return path.join(FORMS_DIR, map.file);
}
