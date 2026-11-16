// ─────────────────────────────────────────────────────────────────────────────
// generate-shapes.ts — 그래프의 형태 정의(SHACL, Turtle)를 코드의 정의에서 만든다.
//
//   노드 종류·주소 규칙   ← src/ontology/schema.ts (ENTITY_TYPES · ID_PREFIX)
//   관계의 출발·도착 종류 ← src/ontology/relations.ts (RELATION_SPECS)
//   용어의 IRI            ← src/ontology/graph/context.jsonld
//   종류별 필수 관계      ← 이 파일의 REQUIRED_RELATIONS
//
// 사용:
//   npm run generate:shapes            # src/ontology/shapes/quality-shapes.ttl 을 다시 쓴다
//   npm run generate:shapes -- --check # 파일이 지금 정의와 다르면 실패
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { ENTITY_TYPES, ID_PREFIX, type EntityType, type RelationName } from "../../src/ontology/schema.js";
import { RELATION_SPECS } from "../../src/ontology/relations.js";
import { readContext, SHAPES_PATH } from "./rdf-graph.js";

// ───── 상수 ─────
const SHAPE_NAMESPACE = "https://quality.ratelworks.org/shapes/v1/";
const STANDARD_PREFIXES: Readonly<Record<string, string>> = {
  sh: "http://www.w3.org/ns/shacl#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  qsh: SHAPE_NAMESPACE,
};
const LOCAL_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * 종류별 필수 관계 — 이것이 없으면 그 노드로는 판정도 근거 제시도 할 수 없다.
 * 한 줄에 여러 관계를 적으면 그 가운데 하나만 있어도 된다.
 */
const REQUIRED_RELATIONS: ReadonlyArray<{ type: EntityType; anyOf: RelationName[]; message: string }> = [
  { type: "WorkType", anyOf: ["requiresStandard"], message: "공종에는 근거 기준이 하나 이상 있어야 합니다" },
  { type: "Material", anyOf: ["requiresTest", "requiresStandard"], message: "자재에는 시험이나 근거 기준이 하나 이상 있어야 합니다" },
  { type: "TestItem", anyOf: ["requiresStandard"], message: "시험에는 근거 기준이 하나 이상 있어야 합니다" },
  { type: "AcceptanceCriteria", anyOf: ["derivedFrom"], message: "판정 기준에는 그 기준이 나온 표준이 하나 이상 있어야 합니다" },
  { type: "AcceptanceCriteria", anyOf: ["appliesTo"], message: "판정 기준에는 적용 대상이 하나 이상 있어야 합니다" },
  { type: "InspectionCheckpoint", anyOf: ["relatedWork"], message: "검측에는 관련 공종이 하나 이상 있어야 합니다" },
  { type: "InspectionCheckpoint", anyOf: ["isBasedOn"], message: "검측에는 근거 기준이 하나 이상 있어야 합니다" },
  { type: "Nonconformance", anyOf: ["immediateActions"], message: "부적합에는 즉시 조치가 하나 이상 있어야 합니다" },
  { type: "Nonconformance", anyOf: ["correctiveActions"], message: "부적합에는 시정 조치가 하나 이상 있어야 합니다" },
  { type: "Nonconformance", anyOf: ["basisPriority"], message: "부적합에는 근거 우선순위가 하나 이상 있어야 합니다" },
];

type TermDefinition = string | { "@id"?: string; "@type"?: string; "@container"?: string };

/** 형태 정의(Turtle) 전문을 만든다 — 같은 정의면 같은 글자열 */
export function buildShapesTurtle(): string {
  const context = readContext() as Record<string, TermDefinition>;
  const namespaces = new Map<string, string>(Object.entries(STANDARD_PREFIXES));
  for (const [term, value] of Object.entries(context)) {
    if (typeof value === "string" && /^https?:\/\//.test(value)) namespaces.set(term, value);
  }
  const usedPrefixes = new Set<string>(["sh", "rdf", "xsd", "qsh"]);

  /** "quality:WorkType" 같은 줄임 표기를 온전한 IRI 로 */
  const expand = (compact: string): string => {
    const colon = compact.indexOf(":");
    const namespace = colon > 0 ? namespaces.get(compact.slice(0, colon)) : undefined;
    if (!namespace) throw new Error(`맥락 정의로 풀 수 없는 용어: ${compact}`);
    return namespace + compact.slice(colon + 1);
  };
  /** Turtle 에 적을 이름 — 맥락 정의의 접두어로 줄일 수 있으면 줄인다 */
  const turtleName = (iri: string): string => {
    let best: [string, string] | undefined;
    for (const [prefix, namespace] of namespaces) {
      if (!iri.startsWith(namespace) || !LOCAL_NAME.test(iri.slice(namespace.length))) continue;
      if (!best || namespace.length > best[1].length) best = [prefix, namespace];
    }
    if (!best) return `<${iri}>`;
    usedPrefixes.add(best[0]);
    return `${best[0]}:${iri.slice(best[1].length)}`;
  };
  const text = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

  const classOf = (type: EntityType): string => {
    const definition = context[type];
    if (typeof definition !== "string") throw new Error(`맥락 정의에 노드 종류가 없습니다: ${type}`);
    return turtleName(expand(definition));
  };
  const relation = (name: RelationName): { property: string; isList: boolean } => {
    const definition = context[name];
    const id = typeof definition === "string" ? definition : definition?.["@id"];
    if (!id) throw new Error(`맥락 정의에 관계가 없습니다: ${name}`);
    const isList = typeof definition === "object" && definition["@container"] === "@list";
    return { property: turtleName(expand(id)), isList };
  };
  /** 값이 하나 이상 있는지 볼 때의 경로 — 목록은 첫 값이 있어야 비어 있지 않다 */
  const valuePath = (name: RelationName): string => {
    const { property, isList } = relation(name);
    return isList ? `( ${property} rdf:first )` : property;
  };
  /** 종류 제약 — 하나면 sh:class, 여럿이면 sh:or */
  const classConstraint = (types: readonly EntityType[]): string =>
    types.length === 1
      ? `sh:class ${classOf(types[0] as EntityType)}`
      : `sh:or ( ${types.map((t) => `[ sh:class ${classOf(t)} ]`).join(" ")} )`;

  const name = turtleName(expand("schema:name"));
  const alias = turtleName(expand("skos:altLabel"));
  const meta = turtleName(expand("quality:meta"));
  const blocks: string[] = [];

  // 제약마다 이름을 붙인다 — 위반 보고서가 어느 제약인지 짚을 수 있게

  // 1) 모든 노드 — 종류 · 이름 · 별칭 · 부가 정보
  blocks.push(
    [
      "qsh:AnyNodeShape a sh:NodeShape ;",
      `  sh:targetSubjectsOf rdf:type, ${name}, ${meta} ;`,
      "  sh:property qsh:AnyNode-type, qsh:AnyNode-name, qsh:AnyNode-alias, qsh:AnyNode-meta .",
    ].join("\n"),
    [
      "qsh:AnyNode-type a sh:PropertyShape ;",
      "  sh:path rdf:type ; sh:minCount 1 ; sh:maxCount 1 ;",
      `  sh:in ( ${ENTITY_TYPES.map(classOf).join(" ")} ) ;`,
      `  sh:message ${text(`노드 종류는 정해진 ${ENTITY_TYPES.length}가지 가운데 하나여야 합니다`)} .`,
    ].join("\n"),
    [
      "qsh:AnyNode-name a sh:PropertyShape ;",
      `  sh:path ${name} ; sh:minCount 1 ; sh:maxCount 1 ; sh:datatype xsd:string ; sh:minLength 1 ;`,
      `  sh:message ${text("이름이 하나 있어야 합니다")} .`,
    ].join("\n"),
    [
      "qsh:AnyNode-alias a sh:PropertyShape ;",
      `  sh:path ${alias} ; sh:datatype xsd:string ; sh:minLength 1 ;`,
      `  sh:message ${text("별칭은 빈 값이 아닌 글자열이어야 합니다")} .`,
    ].join("\n"),
    [
      "qsh:AnyNode-meta a sh:PropertyShape ;",
      `  sh:path ${meta} ; sh:maxCount 1 ; sh:datatype rdf:JSON ;`,
      `  sh:message ${text("부가 정보는 JSON 값 하나여야 합니다")} .`,
    ].join("\n"),
  );

  // 2) 종류별 — 주소 규칙
  for (const type of ENTITY_TYPES) {
    const prefix = ID_PREFIX[type].replace(/\.$/, "");
    const base = namespaces.get(prefix);
    if (!base) throw new Error(`맥락 정의에 주소 접두어가 없습니다: ${prefix}`);
    const pattern = `^${base.replace(/[.]/g, "\\.")}`;
    blocks.push(
      [
        `qsh:${type}Shape a sh:NodeShape ;`,
        `  sh:targetClass ${classOf(type)} ;`,
        "  sh:nodeKind sh:IRI ;",
        `  sh:pattern ${text(pattern)} ;`,
        `  sh:message ${text(`${type} 노드의 주소는 ${base} 로 시작해야 합니다`)} .`,
      ].join("\n"),
    );
  }

  // 3) 종류별 필수 관계
  for (const rule of REQUIRED_RELATIONS) {
    const id = `qsh:${rule.type}-needs-${rule.anyOf.join("-or-")}`;
    if (rule.anyOf.length === 1) {
      blocks.push(
        [
          `${id} a sh:PropertyShape ;`,
          `  sh:targetClass ${classOf(rule.type)} ;`,
          `  sh:path ${valuePath(rule.anyOf[0] as RelationName)} ; sh:minCount 1 ;`,
          `  sh:message ${text(rule.message)} .`,
        ].join("\n"),
      );
    } else {
      blocks.push(
        [
          `${id} a sh:NodeShape ;`,
          `  sh:targetClass ${classOf(rule.type)} ;`,
          `  sh:or ( ${rule.anyOf.map((r) => `[ sh:path ${valuePath(r)} ; sh:minCount 1 ]`).join(" ")} ) ;`,
          `  sh:message ${text(rule.message)} .`,
        ].join("\n"),
      );
    }
  }

  // 4) 관계별 — 출발 종류 · 도착 종류
  for (const [relationName, spec] of Object.entries(RELATION_SPECS) as Array<[RelationName, (typeof RELATION_SPECS)[RelationName]]>) {
    const { property, isList } = relation(relationName);
    if (spec.src !== "*") {
      blocks.push(
        [
          `qsh:${relationName}-domain a sh:NodeShape ;`,
          `  sh:targetSubjectsOf ${property} ;`,
          `  ${classConstraint(spec.src)} ;`,
          `  sh:message ${text(`${relationName} 은(는) ${spec.src.join(" · ")} 에서만 출발합니다`)} .`,
        ].join("\n"),
      );
    }
    const range = spec.dst === "*" ? "" : ` ${classConstraint(spec.dst)} ;`;
    const rangeMessage =
      spec.dst === "*"
        ? `${relationName} 의 값은 노드 주소여야 합니다`
        : `${relationName} 은(는) ${spec.dst.join(" · ")} 노드를 가리켜야 합니다`;
    if (isList) {
      // 목록 — 목록의 값 하나하나를 본다
      blocks.push(
        [
          `qsh:${relationName}-range a sh:PropertyShape ;`,
          `  sh:targetSubjectsOf ${property} ;`,
          `  sh:path ( ${property} [ sh:zeroOrMorePath rdf:rest ] rdf:first ) ;`,
          `  sh:nodeKind sh:IRI ;${range}`,
          `  sh:message ${text(rangeMessage)} .`,
        ].join("\n"),
      );
    } else {
      blocks.push(
        [
          `qsh:${relationName}-range a sh:NodeShape ;`,
          `  sh:targetObjectsOf ${property} ;`,
          `  sh:nodeKind sh:IRI ;${range}`,
          `  sh:message ${text(rangeMessage)} .`,
        ].join("\n"),
      );
    }
  }

  const header = [
    "# 한국 건설 품질관리 그래프의 형태 정의 (SHACL).",
    "# 이 파일은 코드의 정의에서 만든다 — 직접 고치지 말고 `npm run generate:shapes` 로 다시 만든다.",
    "# 검증: `npm run validate:shapes` (표준 SHACL 엔진으로 그래프 전체를 본다)",
    "",
    ...[...namespaces]
      .filter(([prefix]) => usedPrefixes.has(prefix))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([prefix, namespace]) => `@prefix ${prefix}: <${namespace}> .`),
  ];
  return `${header.join("\n")}\n\n${blocks.join("\n\n")}\n`;
}

function main(): void {
  const next = buildShapesTurtle();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(SHAPES_PATH, "utf8");
    } catch {
      // 파일이 없으면 아래에서 다르다고 알린다
    }
    if (current !== next) {
      console.error("[shapes] 형태 정의 파일이 지금 정의와 다릅니다 — `npm run generate:shapes` 로 다시 만드세요.");
      process.exit(1);
    }
    console.log("[shapes] 형태 정의 파일이 최신입니다.");
    return;
  }
  mkdirSync(dirname(SHAPES_PATH), { recursive: true });
  writeFileSync(SHAPES_PATH, next, "utf8");
  console.log(`[shapes] ${SHAPES_PATH} 을 다시 썼습니다 (${next.split("\n").length}줄).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
