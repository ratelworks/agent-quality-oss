/**
 * 온톨로지 데이터 로더. JSON 14종을 읽어 단일 엔티티 맵 + alias index로 병합.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ID_PREFIX, isValidEntityId, type BaseEntity, type EntityType } from './schema.js';

const DATA_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'data',
);

/** JSON 파일명 → 기본 EntityType 매핑 */
const FILE_TYPE_MAP: Readonly<Record<string, EntityType>> = Object.freeze({
  'worktypes.json': 'WorkType',
  'tasks.json': 'Task',
  'materials.json': 'Material',
  'equipment.json': 'Equipment',
  'test-items.json': 'TestItem',
  'inspections.json': 'InspectionCheckpoint',
  'acceptance-criteria.json': 'AcceptanceCriteria',
  'quality-risks.json': 'QualityRisk',
  'nonconformance.json': 'Nonconformance',
  'corrective-actions.json': 'CorrectiveAction',
  'evidence-documents.json': 'EvidenceDocument',
  'standards-map.json': 'Standard',
  'laws.json': 'Standard',
  'guideline-articles.json': 'Standard',
  'standard-forms.json': 'Standard',
  'agencies.json': 'Agency',
  'specifications.json': 'Specification',
});

export interface OntologyData {
  entities: Map<string, BaseEntity>;
  aliasIndex: Map<string, string[]>;
  version: string;
}

/**
 * 동기 로더 — 서버 기동 시 1회.
 */
export function loadOntologySync(dataDir: string = DATA_DIR): OntologyData {
  const entities = new Map<string, BaseEntity>();
  const aliasIndex = new Map<string, string[]>();

  let files: string[];
  try {
    files = readdirSync(dataDir).filter((f) => f.endsWith('.json'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`온톨로지 데이터 디렉터리를 열 수 없습니다: ${dataDir} (${msg})`);
  }

  for (const file of files) {
    const defaultType = FILE_TYPE_MAP[file];
    const full = path.join(dataDir, file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(full, 'utf8'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`JSON 파싱 실패: ${file} — ${msg}`);
    }
    const list = extractEntities(parsed);
    if (!Array.isArray(list)) {
      throw new Error(`${file}: 배열 또는 { entities: [...] } 형식이어야 합니다`);
    }
    for (const raw of list) {
      const entity = normalizeEntity(raw, defaultType, file);
      if (entities.has(entity.id)) {
        throw new Error(`중복 엔티티 id: ${entity.id} (파일: ${file})`);
      }
      entities.set(entity.id, entity);
      indexAliases(entity, aliasIndex);
    }
  }

  return { entities, aliasIndex, version: readVersion() };
}

function extractEntities(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && 'entities' in parsed) {
    const val = (parsed as { entities?: unknown }).entities;
    return Array.isArray(val) ? val : null;
  }
  return null;
}

function normalizeEntity(
  raw: unknown,
  defaultType: EntityType | undefined,
  file: string,
): BaseEntity {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${file}: 엔티티가 객체가 아닙니다`);
  }
  const r = raw as Record<string, unknown>;
  const type = (r['type'] as EntityType | undefined) ?? defaultType;
  if (!type) {
    throw new Error(`${file}: 엔티티 type이 없습니다 (id=${String(r['id'])})`);
  }
  const id = r['id'];
  if (!isValidEntityId(id, type)) {
    throw new Error(
      `${file}: 엔티티 id 규약 위반 — type=${type}, prefix=${ID_PREFIX[type]}, id=${String(id)}`,
    );
  }
  const name = (r['name'] as string | undefined) ?? (id as string);
  const aliases = Array.isArray(r['aliases']) ? (r['aliases'] as string[]) : [];
  const relations =
    r['relations'] && typeof r['relations'] === 'object'
      ? (r['relations'] as Record<string, string[]>)
      : {};
  const meta = (r['meta'] as Record<string, unknown> | undefined) ?? {};
  return { id: id as string, type, name, aliases, relations, meta };
}

function indexAliases(entity: BaseEntity, index: Map<string, string[]>): void {
  const keys = new Set<string>([entity.name, ...(entity.aliases ?? [])]);
  for (const key of keys) {
    if (typeof key !== 'string' || !key.trim()) continue;
    const norm = key.trim().toLowerCase();
    const bucket = index.get(norm);
    if (bucket) bucket.push(entity.id);
    else index.set(norm, [entity.id]);
  }
}

function readVersion(): string {
  try {
    const pkgPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      'package.json',
    );
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    // build/src/ontology 에서 실행될 때는 경로가 다름. fallback으로 한 번 더 시도.
    try {
      const pkgPath = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        'package.json',
      );
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
      return pkg.version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }
}
