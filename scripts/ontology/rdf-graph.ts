// ─────────────────────────────────────────────────────────────────────────────
// rdf-graph.ts — 그래프 노드(JSON-LD)를 RDF 로 옮기고, 되돌리고, SHACL 로 검증하는 공용 함수.
//
// 표준 도구만 쓴다: JSON-LD 처리기(jsonld) · RDF 자료 구조(@zazuko/env-node) · SHACL 엔진(rdf-validate-shacl).
// 모두 개발 의존성이며 게시 패키지에는 들어가지 않는다.
// 맥락 정의는 파일에서 읽어 직접 넣는다 — 원격 문서를 읽으려 하면 오류로 멈춘다(네트워크 없이 같은 결과).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import jsonld from "jsonld";
import rdf from "@zazuko/env-node";
import SHACLValidator from "rdf-validate-shacl";

// ───── 상수 ─────
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const NODES_DIR = join(REPO_ROOT, "src/ontology/graph/nodes");
export const CONTEXT_PATH = join(REPO_ROOT, "src/ontology/graph/context.jsonld");
export const SHAPES_PATH = join(REPO_ROOT, "src/ontology/shapes/quality-shapes.ttl");
const N_QUADS = "application/n-quads";
const TURTLE = "text/turtle";
/** 값의 순서가 뜻을 가지는 속성 — 나머지 배열은 순서 없는 집합으로 견준다 */
const ORDERED_KEYS: ReadonlySet<string> = new Set(["basisPriority"]);

export type NodeDoc = Record<string, unknown>;
type Context = Record<string, unknown>;

export interface ShapeViolation {
  focusNode: string;
  path: string;
  message: string;
  shape: string;
}

/** 원격 문서를 읽지 않는다 — 맥락 정의는 항상 직접 넣는다 */
const refuseRemote = async (url: string): Promise<never> => {
  throw new Error(`원격 문서를 읽으려 했습니다: ${url}`);
};

export function readContext(): Context {
  return (JSON.parse(readFileSync(CONTEXT_PATH, "utf8")) as { "@context": Context })["@context"];
}

/** 노드 파일 전부 — 파일 이름순. 파일 안의 맥락 참조("@context")는 뺀다 */
export function readNodeDocs(dir: string = NODES_DIR): NodeDoc[] {
  const files = (readdirSync(dir, { recursive: true }) as string[])
    .map(String)
    .filter((f) => f.endsWith(".jsonld"))
    .sort();
  return files.map((f) => {
    const { "@context": _context, ...node } = JSON.parse(readFileSync(join(dir, f), "utf8")) as NodeDoc;
    return node;
  });
}

/** 노드 묶음 → N-Quads */
export async function toNQuads(nodes: NodeDoc[], context: Context = readContext()): Promise<string> {
  const doc = { "@context": context, "@graph": nodes };
  return (await jsonld.toRDF(doc as never, { format: N_QUADS, documentLoader: refuseRemote as never })) as unknown as string;
}

/** N-Quads → 노드 묶음 (같은 맥락 정의로 줄여 적는다) */
export async function fromNQuads(nquads: string, context: Context = readContext()): Promise<NodeDoc[]> {
  const expanded = await jsonld.fromRDF(nquads as never, { format: N_QUADS });
  const compacted = (await jsonld.compact(expanded as never, { "@context": context } as never, {
    documentLoader: refuseRemote as never,
  })) as NodeDoc;
  const graph = compacted["@graph"];
  if (Array.isArray(graph)) return graph as NodeDoc[];
  // 노드가 하나뿐이면 @graph 없이 돌아온다
  const { "@context": _context, ...single } = compacted;
  return Object.keys(single).length > 0 ? [single] : [];
}

async function parseDataset(text: string, mediaType: string) {
  const stream = rdf.formats.parsers.import(mediaType, Readable.from([text]));
  if (!stream) throw new Error(`읽을 수 없는 형식: ${mediaType}`);
  return rdf.dataset().import(stream);
}

/** SHACL 검증 — 위반 목록을 돌려준다(없으면 빈 배열) */
export async function validateShapes(nquads: string, shapesTurtle: string = readFileSync(SHAPES_PATH, "utf8")): Promise<ShapeViolation[]> {
  const shapes = await parseDataset(shapesTurtle, TURTLE);
  const data = await parseDataset(nquads, N_QUADS);
  const validator = new SHACLValidator(shapes, { factory: rdf as never });
  const report = await validator.validate(data);
  return report.results.map((r) => {
    const message = r.message[0];
    return {
      focusNode: r.focusNode?.value ?? "",
      path: r.path?.value ?? "",
      message: message ? message.value : "",
      shape: r.sourceShape?.value ?? "",
    };
  });
}

// ───── 원본 대조 ─────

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${sortedJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 견주기 좋게 고른 모양 — 값 하나와 값 하나짜리 배열을 같게 보고, 순서 없는 배열은 정렬한다 */
function normalizeNode(node: NodeDoc): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "@context") continue;
    if (key === "_meta") {
      out[key] = sortedJson(value);
      continue;
    }
    const list = (Array.isArray(value) ? value : [value]).map((v) => (typeof v === "string" ? v : sortedJson(v)));
    if (list.length === 0) continue; // 빈 배열은 RDF 에 남지 않는다
    out[key] = JSON.stringify(ORDERED_KEYS.has(key) ? list : [...list].sort());
  }
  return out;
}

/**
 * 원본 노드와 RDF 를 거쳐 돌아온 노드를 견준다 — 달라진 것을 사람이 읽는 줄로 돌려준다.
 * 맥락 정의에 없는 속성은 RDF 로 옮길 때 조용히 사라지므로 여기서 드러난다.
 */
export function diffNodes(original: NodeDoc[], roundTripped: NodeDoc[]): string[] {
  const problems: string[] = [];
  const back = new Map(roundTripped.map((n) => [String(n["@id"]), normalizeNode(n)]));
  for (const node of original) {
    const id = String(node["@id"]);
    const before = normalizeNode(node);
    const after = back.get(id);
    if (!after) {
      problems.push(`${id}: RDF 에서 사라짐`);
      continue;
    }
    back.delete(id);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[key] === after[key]) continue;
      if (after[key] === undefined) problems.push(`${id}: ${key} 가 RDF 에서 사라짐`);
      else if (before[key] === undefined) problems.push(`${id}: ${key} 가 원본에 없는데 생김`);
      else problems.push(`${id}: ${key} 값이 달라짐`);
    }
  }
  for (const id of back.keys()) problems.push(`${id}: 원본에 없는 노드가 생김`);
  return problems;
}
