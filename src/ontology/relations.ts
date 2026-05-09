// ─────────────────────────────────────────────────────────────────────────────
// relations.ts — 관계 메타 SSoT.
//
// 각 관계명별로:
//   - src / dst 허용 타입 (도메인 검증)
//   - inverse 관계명 (역방향 traversal 헬퍼)
//   - cardinality 제약 (validator 사용)
//
// 본 메타는 advisory 다. 마이그레이션 안전성을 위해 위반은 validator 의 warn 으로
// 처리되며 로딩을 막지 않는다. 의도적으로 strict 하지 않다.
// ─────────────────────────────────────────────────────────────────────────────

import type { EntityType, RelationName } from "./schema.js";
import { STANDARD_RELATIONS } from "./schema.js";

export type Cardinality = "one" | "many";

export interface RelationSpec {
  /** 본 관계의 출발 entity 허용 타입 ('*' = any) */
  src: readonly EntityType[] | "*";
  /** 본 관계의 도착 entity 허용 타입 ('*' = any) */
  dst: readonly EntityType[] | "*";
  /** 도착 측 카디널리티 (default: many) */
  cardinality?: Cardinality;
  /** 역방향 관계명 (정의된 경우 양방향 traversal 가능) */
  inverse?: RelationName;
  /** 짧은 설명 */
  doc?: string;
}

// 모든 RelationName 에 대해 spec 매핑.
// 'any' 는 마이그레이션 도중 자유로운 영역. 점진적으로 좁힐 수 있다.
export const RELATION_SPECS: Readonly<Record<RelationName, RelationSpec>> = Object.freeze({
  // ── WorkType 중심 ──
  hasTask: {
    src: ["WorkType"],
    dst: ["Task"],
    inverse: undefined,
    doc: "공종 → 세부 작업",
  },
  usesMaterial: {
    src: ["WorkType"],
    dst: ["Material"],
    doc: "공종 → 사용 자재",
  },
  requiresStandard: {
    src: ["WorkType", "Material", "TestItem"],
    dst: ["Standard"],
    doc: "공종/자재/시험 → 적용 표준 (KCS·KS 등)",
  },
  hasInspectionCheckpoint: {
    src: ["WorkType"],
    dst: ["InspectionCheckpoint"],
    doc: "공종 → 검측 체크포인트",
  },
  hasQualityRisk: {
    src: ["WorkType", "Material"],
    dst: ["QualityRisk"],
    doc: "공종/자재 → 잠재 품질 리스크",
  },

  // ── Material 중심 ──
  requiresTest: {
    src: ["Material"],
    dst: ["TestItem"],
    doc: "자재 → 요구 시험 항목",
  },
  requiresDocument: {
    src: ["Material", "WorkType", "InspectionCheckpoint"],
    dst: ["EvidenceDocument"],
    doc: "자재/공종 → 요구 증빙 서류",
  },
  hasAcceptanceCriteria: {
    src: ["TestItem", "Material"],
    dst: ["AcceptanceCriteria"],
    doc: "시험/자재 → 합부 판정 기준",
  },

  // ── TestItem 중심 ──
  hasMethod: {
    src: ["TestItem"],
    dst: "*",
    doc: "시험 항목 → 시험 방법 (free-form)",
  },
  hasFrequency: {
    src: ["TestItem"],
    dst: "*",
    doc: "시험 항목 → 빈도 (free-form)",
  },
  possibleNonconformance: {
    src: ["TestItem", "InspectionCheckpoint"],
    dst: ["Nonconformance"],
    doc: "시험/검측 → 발생 가능 NCR",
  },
  correctiveActions: {
    src: ["TestItem", "Nonconformance"],
    dst: ["CorrectiveAction"],
    doc: "시험/NCR → 시정 조치",
  },
  targetMaterial: {
    src: ["TestItem"],
    dst: ["Material"],
    inverse: "requiresTest",
    doc: "시험 항목 → 대상 자재 (requiresTest 의 inverse)",
  },
  relatedWork: {
    src: ["TestItem", "InspectionCheckpoint"],
    dst: ["WorkType"],
    doc: "시험/검측 → 관련 공종",
  },

  // ── AcceptanceCriteria 중심 ──
  appliesTo: {
    src: ["AcceptanceCriteria"],
    dst: ["TestItem", "Material", "WorkType"],
    doc: "기준 → 적용 대상",
  },
  derivedFrom: {
    src: ["AcceptanceCriteria", "Standard"],
    dst: ["Standard"],
    doc: "기준/표준 → 상위 근거 표준",
  },

  // ── Inspection 중심 ──
  isBasedOn: {
    src: "*",
    dst: ["Standard", "AcceptanceCriteria"],
    doc: "임의 → 근거 표준/기준",
  },
  verifies: {
    src: ["InspectionCheckpoint"],
    dst: ["AcceptanceCriteria", "TestItem", "QualityRisk"],
    doc: "검측 → 검증 대상 (기준·시험·리스크)",
  },
  requiresEvidence: {
    src: ["InspectionCheckpoint", "TestItem", "Nonconformance"],
    dst: ["EvidenceDocument"],
    doc: "검측/시험/NCR → 요구 증빙",
  },

  // ── Risk / NCR ──
  mayCause: {
    src: ["QualityRisk"],
    dst: ["Nonconformance"],
    doc: "리스크 → 야기 가능 NCR",
  },
  requires: {
    src: "*",
    dst: "*",
    doc: "general dependency",
  },
  possibleCauses: {
    src: ["Nonconformance"],
    dst: "*",
    doc: "NCR → 가능 원인 (free-form)",
  },
  immediateActions: {
    src: ["Nonconformance"],
    dst: ["CorrectiveAction"],
    doc: "NCR → 즉시 조치",
  },
  relatedTest: {
    src: ["Nonconformance", "QualityRisk"],
    dst: ["TestItem"],
    doc: "NCR/Risk → 관련 시험",
  },
  relatedMaterial: {
    src: ["Nonconformance", "QualityRisk"],
    dst: ["Material"],
    doc: "NCR/Risk → 관련 자재",
  },
  basisPriority: {
    src: "*",
    dst: ["Standard", "EvidenceDocument", "AcceptanceCriteria"],
    doc: "근거 우선순위 표시 (표준·증빙·기준)",
  },

  // ── Project ──
  hasSpecification: {
    src: ["Project"],
    dst: ["Specification"],
    doc: "프로젝트 → 시방서",
  },
  overridesStandard: {
    src: ["Specification"],
    dst: ["Standard"],
    doc: "시방서 → 상위 표준 우선 적용",
  },
  proves: {
    src: ["EvidenceDocument"],
    dst: "*",
    doc: "증빙 → 입증 대상",
  },
});

// ───── 헬퍼 ─────

export function getRelationSpec(rel: string): RelationSpec | undefined {
  return (RELATION_SPECS as Record<string, RelationSpec | undefined>)[rel];
}

export function isAllowedSrc(rel: RelationName, srcType: EntityType): boolean {
  const spec = RELATION_SPECS[rel];
  if (spec.src === "*") return true;
  return spec.src.includes(srcType);
}

export function isAllowedDst(rel: RelationName, dstType: EntityType): boolean {
  const spec = RELATION_SPECS[rel];
  if (spec.dst === "*") return true;
  return spec.dst.includes(dstType);
}

export function inverseOf(rel: RelationName): RelationName | undefined {
  return RELATION_SPECS[rel].inverse;
}

// 디버깅·tooling 용 — 모든 관계명 dump
export const ALL_RELATION_NAMES: readonly RelationName[] = STANDARD_RELATIONS;
