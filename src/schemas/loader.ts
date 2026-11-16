/**
 * 문서 양식 스키마 로더.
 *
 * 양식마다 법령과의 관계(classification)와 따르는 서식(officialForm), 근거 구절(citations)을 갖는다.
 * citations 의 구절이 수록 법령 원문에 있는지는 시험이 확인한다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'document-schemas.json',
);

export interface SchemaField {
  name: string;
  type: string;
  required?: boolean;
  note?: string;
  source?: string;
  criterion?: string;
  fields?: string[];
}

export interface SchemaSection {
  key: string;
  title: string;
  /** legal = 서식·법령이 정한 항목, practice = 실무 항목 */
  origin?: "legal" | "practice";
  note?: string;
  fields: SchemaField[];
}

/** 문서와 법령의 관계 */
export type DocumentClassification =
  /** 법령 서식 (시행규칙 별지) */
  | "statutory_form"
  /** 법령·고시가 내용을 정함 */
  | "statutory_content"
  /** 고시 서식 */
  | "notice_form"
  /** 실무 문서 — 법정 서식 없음 */
  | "practice";

export interface SchemaCitation {
  law: string;
  article?: string;
  annex?: string;
  quote: string;
}

export interface DocumentSchema {
  id: string;
  title: string;
  classification?: DocumentClassification;
  /** 이 문서가 따르는 법령·고시의 서식 또는 작성기준 */
  officialForm?: { law: string; annex: string; title: string; note?: string };
  /** 근거 구절 — 수록 원문에서 확인할 수 있는 것만 */
  citations?: SchemaCitation[];
  /** 작성할 때 알아야 할 것 — 법령 조건에 따라 덧붙는 절차·주의(예: 사전점검 대상) */
  guidance?: string;
  basis?: string[];
  reference?: string;
  referenceStandard?: string;
  retention?: string;
  sections: SchemaSection[];
}

export interface SchemaBundle {
  schemas: Record<string, DocumentSchema>;
}

let cache: SchemaBundle | null = null;

export function loadSchemas(): SchemaBundle {
  if (!cache) {
    cache = JSON.parse(readFileSync(PATH, 'utf8')) as SchemaBundle;
  }
  return cache;
}

export function getSchema(id: string): DocumentSchema | null {
  return loadSchemas().schemas[id] ?? null;
}

export function listSchemaIds(): string[] {
  return Object.keys(loadSchemas().schemas);
}
