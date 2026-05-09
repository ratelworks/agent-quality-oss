// ─────────────────────────────────────────────────────────────────────────────
// loader.ts — 온톨로지 데이터 로더.
//
// 변경(2026-04-30):
//   1) 모든 entity raw → EntityZ.parse 로 zod 검증
//   2) ZodError 메시지를 파일·인덱스 포함 사람 친화 에러로 변환
//   3) 환경변수 QUALITY_DATA_DIR 로 dataDir 오버라이드 (테스트·배포 유연성)
//   4) 의도적으로 sync — 서버 기동 시 1회만 실행
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ZodError } from "zod";
import { EntityZ, type BaseEntity, type EntityType } from "./schema.js";
import { QualityMcpError, ERROR_CODES } from "../lib/errors.js";

const DEFAULT_DATA_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "data",
);

/** JSON 파일명 → 기본 EntityType (해당 파일에 type 미지정 시 사용) */
const FILE_TYPE_MAP: Readonly<Record<string, EntityType>> = Object.freeze({
  "worktypes.json": "WorkType",
  "tasks.json": "Task",
  "materials.json": "Material",
  "equipment.json": "Equipment",
  "test-items.json": "TestItem",
  "inspections.json": "InspectionCheckpoint",
  "acceptance-criteria.json": "AcceptanceCriteria",
  "quality-risks.json": "QualityRisk",
  "nonconformance.json": "Nonconformance",
  "corrective-actions.json": "CorrectiveAction",
  "evidence-documents.json": "EvidenceDocument",
  "standards-map.json": "Standard",
  "laws.json": "Standard",
  "guideline-articles.json": "Standard",
  "standard-forms.json": "Standard",
  "agencies.json": "Agency",
  "specifications.json": "Specification",
});

export interface OntologyData {
  entities: Map<string, BaseEntity>;
  aliasIndex: Map<string, string[]>;
  version: string;
  /** 진단용 — 로더가 처리한 파일 수, 엔티티 수 등 */
  loadStats: {
    files: number;
    entities: number;
    aliases: number;
  };
}

export interface LoadOptions {
  /** dataDir 명시 — 없으면 QUALITY_DATA_DIR env 또는 DEFAULT_DATA_DIR */
  dataDir?: string;
  /** strict=true 이면 zod 검증 실패 시 throw, false 이면 warn 후 skip */
  strict?: boolean;
}

/**
 * 동기 로더 — 서버 기동 시 1회.
 */
export function loadOntologySync(options: LoadOptions = {}): OntologyData {
  const dataDir =
    options.dataDir ?? process.env["QUALITY_DATA_DIR"] ?? DEFAULT_DATA_DIR;
  const strict = options.strict ?? true;

  const entities = new Map<string, BaseEntity>();
  const aliasIndex = new Map<string, string[]>();

  let files: string[];
  try {
    files = readdirSync(dataDir).filter((f) => f.endsWith(".json"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new QualityMcpError(
      ERROR_CODES.ONTOLOGY_INVALID,
      `온톨로지 데이터 디렉터리를 열 수 없습니다: ${dataDir}`,
      { cause: msg },
    );
  }
  files.sort(); // 결정론적 로드 순서

  for (const file of files) {
    const defaultType = FILE_TYPE_MAP[file];
    const full = path.join(dataDir, file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(full, "utf8"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new QualityMcpError(
        ERROR_CODES.ONTOLOGY_INVALID,
        `JSON 파싱 실패: ${file}`,
        { cause: msg },
      );
    }
    const list = extractEntities(parsed);
    if (!Array.isArray(list)) {
      throw new QualityMcpError(
        ERROR_CODES.ONTOLOGY_INVALID,
        `${file}: 배열 또는 { entities: [...] } 형식이어야 합니다`,
      );
    }
    for (let i = 0; i < list.length; i += 1) {
      const raw = list[i];
      const entity = parseEntity(raw, defaultType, file, i, strict);
      if (!entity) continue; // strict=false 인 경우 zod 실패 시 skip
      if (entities.has(entity.id)) {
        throw new QualityMcpError(
          ERROR_CODES.ONTOLOGY_INVALID,
          `중복 엔티티 id: ${entity.id} (파일: ${file}#${i})`,
        );
      }
      entities.set(entity.id, entity);
      indexAliases(entity, aliasIndex);
    }
  }

  const loadStats = {
    files: files.length,
    entities: entities.size,
    aliases: aliasIndex.size,
  };

  return { entities, aliasIndex, version: readVersion(), loadStats };
}

// ───── 내부 헬퍼 ─────

function extractEntities(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && "entities" in parsed) {
    const val = (parsed as { entities?: unknown }).entities;
    return Array.isArray(val) ? val : null;
  }
  return null;
}

function parseEntity(
  raw: unknown,
  defaultType: EntityType | undefined,
  file: string,
  index: number,
  strict: boolean,
): BaseEntity | null {
  // type 보정 — 일부 파일(laws.json 등)은 entity별 type 명시,
  // 일부(materials.json)는 파일 단위 default 사용.
  let augmented: unknown = raw;
  if (raw && typeof raw === "object" && !("type" in raw) && defaultType) {
    augmented = { ...(raw as Record<string, unknown>), type: defaultType };
  }
  try {
    return EntityZ.parse(augmented);
  } catch (err) {
    if (err instanceof ZodError) {
      const detail = err.issues
        .map((i) => `    · ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      const id =
        raw && typeof raw === "object" && "id" in raw
          ? String((raw as { id: unknown }).id)
          : "<no id>";
      const message = `${file}#${index} (id=${id}) 검증 실패\n${detail}`;
      if (strict) {
        throw new QualityMcpError(ERROR_CODES.ONTOLOGY_INVALID, message, {
          file,
          index,
          issues: err.issues,
        });
      }
      // strict=false: warn 후 skip — 부분 손상된 데이터 허용
      process.stderr.write(`[ontology/loader] ${message}\n`);
      return null;
    }
    throw err;
  }
}

function indexAliases(entity: BaseEntity, index: Map<string, string[]>): void {
  const keys = new Set<string>([entity.name, ...(entity.aliases ?? [])]);
  for (const key of keys) {
    if (typeof key !== "string" || !key.trim()) continue;
    const norm = key.trim().toLowerCase();
    const bucket = index.get(norm);
    if (bucket) {
      if (!bucket.includes(entity.id)) bucket.push(entity.id);
    } else {
      index.set(norm, [entity.id]);
    }
  }
}

function readVersion(): string {
  // build/src/ontology/loader.js 와 src/ontology/loader.ts 양쪽에서 동작.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", "..", "..", "package.json"), // build 출력에서 src 기준
    path.join(here, "..", "..", "package.json"), // build/ 직접 출력 기준
  ];
  for (const pkgPath of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        version?: string;
      };
      if (pkg.version) return pkg.version;
    } catch {
      // try next
    }
  }
  return "0.0.0";
}
