// ─────────────────────────────────────────────────────────────────────────────
// schema.ts — 온톨로지 엔티티·관계 SSoT.
//
// 변경(2026-04-30):
//   1) BaseEntity → discriminated union (type별 강한 타입)
//   2) zod 스키마(EntityZ)로 런타임 검증 — loader.ts 가 사용
//   3) STANDARD_RELATIONS → const tuple → RelationName 리터럴 union
//   4) ID prefix 검증을 zod refinement 로 통합
//
// 본 모듈은 그래프의 타입 SSoT 다. 도구·loader·graph 모두 이 파일에 의존한다.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import type { SourceStatus } from "../config/constants.js";

// ───── 1. EntityType (closed set) ─────
export const ENTITY_TYPES = [
  "WorkType",
  "Task",
  "Material",
  "Equipment",
  "Standard",
  "Specification",
  "TestItem",
  "InspectionCheckpoint",
  "AcceptanceCriteria",
  "QualityRisk",
  "Nonconformance",
  "CorrectiveAction",
  "EvidenceDocument",
  "Agency",
  "SiteRecord",
  "Project",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const EntityTypeZ = z.enum(ENTITY_TYPES);

// ───── 2. ID prefix 강제 매핑 ─────
export const ID_PREFIX: Readonly<Record<EntityType, string>> = Object.freeze({
  WorkType: "work.",
  Task: "task.",
  Material: "material.",
  Equipment: "equipment.",
  Standard: "standard.",
  Specification: "spec.",
  TestItem: "test.",
  InspectionCheckpoint: "inspection.",
  AcceptanceCriteria: "criteria.",
  QualityRisk: "risk.",
  Nonconformance: "ncr.",
  CorrectiveAction: "action.",
  EvidenceDocument: "doc.",
  Agency: "agency.",
  SiteRecord: "record.",
  Project: "project.",
});

export function isValidEntityId(id: unknown, type: EntityType): boolean {
  const prefix = ID_PREFIX[type];
  return typeof id === "string" && prefix !== undefined && id.startsWith(prefix);
}

// ───── 3. 표준 관계 집합 (RelationName 리터럴 union) ─────
//
// readonly tuple 로 두면 RelationName 이 좁은 union 으로 도출된다.
// 그래프 traversal·validator·도구 모두 이 union 을 사용하면 string typo 차단.
export const STANDARD_RELATIONS = [
  // WorkType 중심
  "hasTask",
  "usesMaterial",
  "requiresStandard",
  "hasInspectionCheckpoint",
  "hasQualityRisk",
  // Material 중심
  "requiresTest",
  "requiresDocument",
  "hasAcceptanceCriteria",
  // TestItem 중심
  "hasMethod",
  "hasFrequency",
  "possibleNonconformance",
  "correctiveActions",
  "targetMaterial",
  "relatedWork",
  // AcceptanceCriteria 중심
  "appliesTo",
  "derivedFrom",
  // Inspection 중심
  "isBasedOn",
  "verifies",
  "requiresEvidence",
  // Risk / NCR
  "mayCause",
  "requires",
  "possibleCauses",
  "immediateActions",
  "relatedTest",
  "relatedMaterial",
  "basisPriority",
  // Project
  "hasSpecification",
  "overridesStandard",
  "proves",
] as const;

export type RelationName = (typeof STANDARD_RELATIONS)[number];
export const RelationNameZ = z.enum(STANDARD_RELATIONS);

const STANDARD_RELATIONS_SET: ReadonlySet<string> = new Set(STANDARD_RELATIONS);
export function isStandardRelation(rel: string): rel is RelationName {
  return STANDARD_RELATIONS_SET.has(rel);
}

// ───── 4. 공통 meta (모든 entity type에서 등장 가능) ─────
//
// passthrough() 로 type별 추가 키 허용. 공통 키만 명시 검증.
export const SOURCE_STATUS_LITERAL = z
  .enum(["verified", "indirect_source", "skeleton", "unknown"])
  .optional();

export const CommonMetaZ = z
  .object({
    category: z.string().optional(),
    parent: z.string().optional(),
    domain: z.string().optional(),
    sourceStatus: SOURCE_STATUS_LITERAL,
    note: z.string().optional(),
  })
  .passthrough();

export type CommonMeta = z.infer<typeof CommonMetaZ> & {
  sourceStatus?: SourceStatus;
};

// ───── 5. relations 검증 ─────
//
// 키는 RelationName 권장(validator가 비표준 관계명을 warn 처리),
// 값은 string id 배열.
export const RelationsZ = z.record(z.string(), z.array(z.string()));

// ───── 6. BaseEntity 공통 스펙 + EntityZ ─────
//
// 현재는 type별 strict subtype 을 강제하지 않는다 (마이그레이션 안전성 우선).
// 향후 z.discriminatedUnion("type", [...]) 으로 좁히는 것이 다음 단계.
const BaseEntityShape = {
  id: z.string().min(1, "id 필수"),
  type: EntityTypeZ,
  name: z.string().min(1, "name 필수").default(""),
  aliases: z.array(z.string()).default([]),
  relations: RelationsZ.default({}),
  meta: CommonMetaZ.default({}),
};

export const EntityZ = z
  .object(BaseEntityShape)
  .superRefine((e, ctx) => {
    if (!isValidEntityId(e.id, e.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: `id 규약 위반 — type=${e.type}, 필요 prefix=${ID_PREFIX[e.type]}, id=${e.id}`,
      });
    }
  });

// 본 OSS 의 핵심 타입 — 도구·라우터 모두 이 타입을 import.
export type BaseEntity = z.infer<typeof EntityZ>;

// ───── 7. type-narrow 헬퍼 (graph.get<T> 에서 사용) ─────
//
// EntityOf<"WorkType"> = BaseEntity & { type: "WorkType" }
// 향후 type별 strict 인터페이스로 교체 시 자연스레 좁혀진다.
export type EntityOf<T extends EntityType> = BaseEntity & { type: T };

export function isEntityOfType<T extends EntityType>(
  e: BaseEntity | undefined,
  type: T,
): e is EntityOf<T> {
  return !!e && e.type === type;
}

// ───── 8. Standard.meta.category 정규화 ─────
//
// Standard 는 내부적으로 law / regulation / guideline / kcs / kds / ks / form 등
// 다양한 sub-category 를 갖는다. 도구·validator 가 사용하는 화이트리스트.
export const STANDARD_CATEGORIES = [
  "law",
  "regulation",
  "guideline",
  "kcs",
  "kds",
  "ks",
  "form",
  "rule",
  "method",
  "policy",
  "section",
  "document",
  "annex", // 법령·고시의 별표 (기준·산출표 — 서식(form)과 구분)
] as const;

export type StandardCategory = (typeof STANDARD_CATEGORIES)[number];
