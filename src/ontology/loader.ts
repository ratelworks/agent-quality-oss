// ─────────────────────────────────────────────────────────────────────────────
// loader.ts — 온톨로지 데이터 로더 (JSON-LD).
//
// Phase 3 (2026-06-16): agent-safety-oss 와 동일한 JSON-LD 노드 구조를 SSoT 로 채택.
//   - 데이터 소스: src/ontology/graph/nodes/{type}/{id}.jsonld (이전 data/*.json 대체)
//   - JSON-LD(@id IRI·@type·관계 IRI 참조·_meta) → BaseEntity 역변환
//     · @id "work:concrete"  →  id "work.concrete"  (콜론→점, 도구 호환 유지)
//     · @type                →  type
//     · _meta                →  meta
//     · 관계 값 IRI           →  단축 id
//   - 역변환 후 EntityZ(zod) 검증은 기존과 동일 — OntologyGraph·도구·검증 API 무변경.
//   - 의도적으로 sync — 서버 기동 시 1회. graphology 미도입(330노드엔 OntologyGraph 인접
//     리스트가 동일 그래프 의미 + 의존성 0 + sync 로 더 적합).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ZodError } from "zod";
import { EntityZ, type BaseEntity } from "./schema.js";
import { QualityMcpError, ERROR_CODES } from "../lib/errors.js";

const DEFAULT_NODES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "graph",
  "nodes",
);

export interface OntologyData {
  entities: Map<string, BaseEntity>;
  aliasIndex: Map<string, string[]>;
  version: string;
  /** 진단용 — 로더가 처리한 노드 파일 수, 엔티티 수 등 */
  loadStats: {
    files: number;
    entities: number;
    aliases: number;
  };
}

export interface LoadOptions {
  /** nodesDir 명시 — 없으면 QUALITY_NODES_DIR env 또는 DEFAULT_NODES_DIR */
  nodesDir?: string;
  /** strict=true 이면 zod 검증 실패 시 throw, false 이면 warn 후 skip */
  strict?: boolean;
}

// JSON-LD 노드에서 BaseEntity 로 옮기지 않는 예약 키 (관계 키와 구분).
const RESERVED_KEYS = new Set(["@context", "@id", "@type", "name", "aliases", "_meta"]);

/**
 * 동기 로더 — 서버 기동 시 1회. graph/nodes/ 하위 .jsonld 전체를 로드.
 */
export function loadOntologySync(options: LoadOptions = {}): OntologyData {
  const nodesDir =
    options.nodesDir ?? process.env["QUALITY_NODES_DIR"] ?? DEFAULT_NODES_DIR;
  const strict = options.strict ?? true;

  const entities = new Map<string, BaseEntity>();
  const aliasIndex = new Map<string, string[]>();

  let files: string[];
  try {
    files = readdirSync(nodesDir, { recursive: true })
      .map((f) => String(f))
      .filter((f) => f.endsWith(".jsonld"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new QualityMcpError(
      ERROR_CODES.ONTOLOGY_INVALID,
      `온톨로지 노드 디렉터리를 열 수 없습니다: ${nodesDir}`,
      { cause: msg },
    );
  }
  files.sort(); // 결정론적 로드 순서

  let fileCount = 0;
  for (const rel of files) {
    const full = path.join(nodesDir, rel);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(full, "utf8"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new QualityMcpError(
        ERROR_CODES.ONTOLOGY_INVALID,
        `JSON-LD 파싱 실패: ${rel}`,
        { cause: msg },
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new QualityMcpError(
        ERROR_CODES.ONTOLOGY_INVALID,
        `${rel}: JSON-LD 노드(객체) 형식이어야 합니다`,
      );
    }
    fileCount += 1;

    const raw = jsonldToEntityRaw(parsed as Record<string, unknown>);
    const entity = parseEntity(raw, rel, strict);
    if (!entity) continue; // strict=false 인 경우 zod 실패 시 skip
    if (entities.has(entity.id)) {
      throw new QualityMcpError(
        ERROR_CODES.ONTOLOGY_INVALID,
        `중복 엔티티 id: ${entity.id} (파일: ${rel})`,
      );
    }
    entities.set(entity.id, entity);
    indexAliases(entity, aliasIndex);
  }

  const loadStats = {
    files: fileCount,
    entities: entities.size,
    aliases: aliasIndex.size,
  };

  return { entities, aliasIndex, version: readVersion(), loadStats };
}

// ───── 내부 헬퍼 ─────

/** IRI(work:concrete) → 단축 id(work.concrete). 첫 콜론만 점으로. */
function fromIri(value: unknown): string {
  if (typeof value !== "string") return String(value);
  const i = value.indexOf(":");
  return i < 0 ? value : value.slice(0, i) + "." + value.slice(i + 1);
}

/** JSON-LD 노드 → EntityZ 가 검증할 raw 엔티티(단축 id·meta·relations). */
function jsonldToEntityRaw(node: Record<string, unknown>): unknown {
  const relations: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(node)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (Array.isArray(val)) {
      relations[key] = val.map((x) => fromIri(x));
    }
  }
  return {
    id: fromIri(node["@id"]),
    type: node["@type"],
    name: node["name"] ?? "",
    aliases: Array.isArray(node["aliases"]) ? node["aliases"] : [],
    meta: node["_meta"] ?? {},
    relations,
  };
}

function parseEntity(
  raw: unknown,
  file: string,
  strict: boolean,
): BaseEntity | null {
  try {
    return EntityZ.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const detail = err.issues
        .map((i) => `    · ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      const id =
        raw && typeof raw === "object" && "id" in raw
          ? String((raw as { id: unknown }).id)
          : "<no id>";
      const message = `${file} (id=${id}) 검증 실패\n${detail}`;
      if (strict) {
        throw new QualityMcpError(ERROR_CODES.ONTOLOGY_INVALID, message, {
          file,
          issues: err.issues,
        });
      }
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
