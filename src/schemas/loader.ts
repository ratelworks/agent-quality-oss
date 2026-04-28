/**
 * 문서 양식 스키마 로더.
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
  fields: SchemaField[];
}

export interface DocumentSchema {
  id: string;
  title: string;
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
