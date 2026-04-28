/**
 * 온톨로지 엔티티·관계·ID 규약.
 * 전체 설계: plan.md §6.
 */

export type EntityType =
  | 'WorkType'
  | 'Task'
  | 'Material'
  | 'Equipment'
  | 'Standard'
  | 'Specification'
  | 'TestItem'
  | 'InspectionCheckpoint'
  | 'AcceptanceCriteria'
  | 'QualityRisk'
  | 'Nonconformance'
  | 'CorrectiveAction'
  | 'EvidenceDocument'
  | 'Agency'
  | 'SiteRecord'
  | 'Project';

export interface BaseEntity {
  id: string;
  type: EntityType;
  name: string;
  aliases?: string[];
  /** 관계명 → 대상 엔티티 id 배열 */
  relations?: Record<string, string[]>;
  /** 타입별 자유 메타. schema.ts는 범위를 고정하지 않는다. */
  meta?: Record<string, unknown>;
}

/**
 * 표준 관계 집합. validator가 이외 관계를 warn 처리.
 */
export const STANDARD_RELATIONS: readonly string[] = Object.freeze([
  // WorkType 중심
  'hasTask',
  'usesMaterial',
  'requiresStandard',
  'hasInspectionCheckpoint',
  'hasQualityRisk',
  // Material 중심
  'requiresTest',
  'requiresDocument',
  'hasAcceptanceCriteria',
  // TestItem 중심
  'hasMethod',
  'hasFrequency',
  'possibleNonconformance',
  'correctiveActions',
  'targetMaterial',
  'relatedWork',
  // AcceptanceCriteria 중심
  'appliesTo',
  'derivedFrom',
  // Inspection 중심
  'isBasedOn',
  'verifies',
  'requiresEvidence',
  // Risk / NCR
  'mayCause',
  'requires',
  'possibleCauses',
  'immediateActions',
  'relatedTest',
  'relatedMaterial',
  'basisPriority',
  // Project
  'hasSpecification',
  'overridesStandard',
  'proves',
]);

/**
 * 엔티티 id prefix 강제 매핑. 로더가 위반 시 기동 거부.
 */
export const ID_PREFIX: Readonly<Record<EntityType, string>> = Object.freeze({
  WorkType: 'work.',
  Task: 'task.',
  Material: 'material.',
  Equipment: 'equipment.',
  Standard: 'standard.',
  Specification: 'spec.',
  TestItem: 'test.',
  InspectionCheckpoint: 'inspection.',
  AcceptanceCriteria: 'criteria.',
  QualityRisk: 'risk.',
  Nonconformance: 'ncr.',
  CorrectiveAction: 'action.',
  EvidenceDocument: 'doc.',
  Agency: 'agency.',
  SiteRecord: 'record.',
  Project: 'project.',
});

export function isValidEntityId(id: unknown, type: EntityType): boolean {
  const prefix = ID_PREFIX[type];
  return typeof id === 'string' && prefix !== undefined && id.startsWith(prefix);
}
