/**
 * Tool 공통 응답 빌더. 감사 증적·책임 고지 강제.
 */

import { randomUUID, createHash } from 'node:crypto';
import type {
  BasisRef,
  HumanCheckpoint,
  NextStepHint,
  SourceStatus,
  SourceStatusSummary,
  ToolResponse,
} from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

export const LEGAL_NOTE =
  '본 서버는 **근거 제공용**이며 최종 판정과 법적 책임은 품질관리자·감리원·발주자에게 있다. Tool 출력을 법적 조언·확정 결과로 취급하지 말 것.';

/** R0-G3: SourceStatus 등급 — 낮을수록 약한 근거. summary.worst 산출에 사용. */
const STATUS_RANK: Record<SourceStatus, number> = {
  verified: 3,
  unknown: 2,
  indirect_source: 1,
  skeleton: 0,
};

function readEntityStatus(meta: unknown): SourceStatus {
  if (!meta || typeof meta !== 'object') return 'unknown';
  const v = (meta as Record<string, unknown>)['sourceStatus'];
  if (v === 'verified' || v === 'indirect_source' || v === 'skeleton') return v;
  return 'unknown';
}

function summarizeStatus(basis: BasisRef[]): SourceStatusSummary {
  const counts: Record<SourceStatus, number> = {
    verified: 0,
    indirect_source: 0,
    skeleton: 0,
    unknown: 0,
  };
  let worst: SourceStatus = 'verified';
  const warnings: string[] = [];
  for (const b of basis) {
    const s: SourceStatus = b.sourceStatus ?? 'unknown';
    counts[s]++;
    if (STATUS_RANK[s] < STATUS_RANK[worst]) worst = s;
    if (s === 'skeleton') warnings.push(`skeleton 근거: ${b.id} — 출처 미확정. 재인용 금지.`);
    else if (s === 'indirect_source')
      warnings.push(`indirect_source 근거: ${b.id} — 호수·발행기관 검증 미완. 인용 시 검증 필요.`);
  }
  return { worst, counts, warnings };
}

export function buildResponse<T>(
  toolName: string,
  ontologyVersion: string,
  result: T,
  basis: BasisRef[] = [],
  humanCheckpoint?: HumanCheckpoint,
  nextSteps?: NextStepHint[],
  /** R0-G3: graph 전달 시 basis의 누락 sourceStatus를 entity meta에서 자동 주입. */
  graph?: OntologyGraph,
): ToolResponse<T> {
  if (!Array.isArray(basis) || basis.length === 0) {
    throw new Error(
      `Tool ${toolName}: basis[]가 비어 있어 응답할 수 없습니다 (환각 방지 규칙).`,
    );
  }
  const toolCallId = randomUUID();
  const generatedAt = new Date().toISOString();
  const hc: HumanCheckpoint = humanCheckpoint ?? { required: false, reason: null };
  const humanCheckpointWithNote: HumanCheckpoint = { ...hc, legalNote: LEGAL_NOTE };

  // korean-law-mcp 패턴 — 응답 끝에 "💡 다음 조회" 자동 hint
  const hints = nextSteps ?? defaultNextSteps(toolName);

  // R0-G3: graph 전달 시 누락 sourceStatus 일괄 주입 → 신뢰 가능한 summary 산출.
  const annotatedBasis = graph ? annotateBasisWithStatus(graph, basis) : basis;
  const sourceStatusSummary = summarizeStatus(annotatedBasis);

  const payload = {
    result,
    basis: annotatedBasis,
    humanCheckpoint: humanCheckpointWithNote,
    nextSteps: hints,
    sourceStatusSummary,
  };
  const canonicalJson = canonicalize(payload);
  const contentHash = createHash('sha256').update(canonicalJson).digest('hex');
  return {
    ...payload,
    lineage: {
      toolName,
      toolCallId,
      ontologyVersion,
      generatedAt,
      contentHashAlgo: 'sha256',
      contentHash,
    },
  };
}

/**
 * Tool별 기본 다음 단계 hint. 명시적 nextSteps 미지정 시 사용.
 */
function defaultNextSteps(toolName: string): NextStepHint[] {
  const map: Record<string, NextStepHint[]> = {
    search_quality_ontology: [
      { tool: 'get_work_quality_profile', reason: '특정 공종을 선택해 도메인 프로파일 전체 조회' },
    ],
    resolve_worktype: [
      { tool: 'get_work_quality_profile', reason: '해석된 공종의 자재·시험·검측·리스크 프로파일' },
    ],
    list_core_quality_laws: [
      { tool: 'get_quality_law_article', reason: '특정 조항의 적용 범위 조회' },
    ],
    search_construction_standards: [
      { tool: 'verify_form_reference', reason: '특정 KCS 섹션 인용 명칭 검증' },
    ],
    get_standard_form_locator: [
      { tool: 'verify_form_reference', reason: '서식 명칭·시행일 정확성 교차 검증' },
    ],
    evaluate_observation: [
      { tool: 'compile_ncr_references', reason: 'FAIL 판정 시 NCR 작성 재료 수집' },
    ],
    infer_quality_risks: [
      { tool: 'compile_concrete_pour_references', reason: '도메인 재료 종합 수집' },
    ],
    map_quality_basis: [
      { tool: 'verify_quality_basis', reason: 'LLM 생성문 근거 인용 검증' },
    ],
    compile_concrete_pour_references: [
      { tool: 'evaluate_observation', reason: '시험 관측값 들어오면 expert assessment' },
    ],
    compile_inspection_references: [
      { tool: 'get_itp_schema', reason: 'ITP 양식 필드 조회' },
    ],
    compile_ncr_references: [
      { tool: 'verify_quality_basis', reason: 'NCR 초안 인용 검증' },
    ],
    // 미커버 도메인일 때 콘크리트 패키지를 잘못 추천하지 않도록 default는 일반 가이드만.
    // 콘크리트가 실제 매칭되면 tool 본체가 dynamic nextSteps로 보강한다.
    discover_relevant_domain: [
      { tool: 'list_core_quality_laws', reason: '관련 법령 목록' },
      { tool: 'get_standard_form_locator', reason: '관련 법정 별지·서식 카탈로그' },
    ],
    explain_quality_decision_path: [
      { tool: 'verify_quality_basis', reason: '결정 경로의 인용 근거 검증' },
    ],
  };
  return map[toolName] ?? [];
}

/**
 * Stable stringify — 키 정렬로 같은 내용은 항상 같은 hash.
 *
 * undefined 처리는 JSON.stringify 의미를 따른다:
 *  - 객체 키 값이 undefined·function·symbol → 키 자체 omit
 *  - 배열 요소가 undefined·function·symbol → null로 직렬화
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') {
      return 'null';
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const parts = value.map((v) =>
      v === undefined || typeof v === 'function' || typeof v === 'symbol' ? 'null' : canonicalize(v),
    );
    return '[' + parts.join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => {
      const val = obj[k];
      return val !== undefined && typeof val !== 'function' && typeof val !== 'symbol';
    })
    .sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

export function entityBasis(entityIds: string[], priority = 2): BasisRef[] {
  return entityIds.map((id) => ({ type: 'ontology', id, priority }));
}

/**
 * R0-G3: graph 인자를 받아 entity meta.sourceStatus를 자동 주입한다.
 * 점진 마이그레이션 — 신규 호출은 이 함수를 사용 권장.
 */
export function entityBasisWithStatus(
  graph: OntologyGraph,
  entityIds: string[],
  priority = 2,
): BasisRef[] {
  return entityIds.map((id) => {
    const e = graph.get(id);
    return {
      type: 'ontology',
      id,
      priority,
      sourceStatus: readEntityStatus(e?.meta),
    };
  });
}

/**
 * R0-G3: 외부 호출자가 임의 BasisRef[]를 만든 뒤 graph에서 sourceStatus를
 * 일괄 주입할 때 사용. id 기반 entity만 보강하고, 사용자 지정 sourceStatus는 보존.
 */
export function annotateBasisWithStatus(graph: OntologyGraph, basis: BasisRef[]): BasisRef[] {
  return basis.map((b) => {
    if (b.sourceStatus) return b;
    const e = graph.get(b.id);
    if (!e) return b;
    return { ...b, sourceStatus: readEntityStatus(e.meta) };
  });
}

/**
 * R0-G3: 라우터 후처리 — 도구가 반환한 응답의 basis를 graph로 일괄 annotate하고
 * sourceStatusSummary 및 contentHash를 재계산한다. http/stdio 라우터에서 사용.
 *
 * 도구 본체가 buildResponse 호출 시 graph 미전달이어도(현재 26개 도구 다수)
 * 라우터 단계에서 누락 sourceStatus가 자동 채워져 외부 응답은 항상 일관됨.
 */
export function annotateResponse<T>(
  graph: OntologyGraph,
  response: ToolResponse<T>,
): ToolResponse<T> {
  const annotatedBasis = annotateBasisWithStatus(graph, response.basis);
  const sourceStatusSummary = summarizeStatus(annotatedBasis);
  const basisChanged = annotatedBasis.some((b, i) => b !== response.basis[i]);
  const summaryChanged =
    JSON.stringify(sourceStatusSummary) !== JSON.stringify(response.sourceStatusSummary);
  if (!basisChanged && !summaryChanged) return response;
  const payload = {
    result: response.result,
    basis: annotatedBasis,
    humanCheckpoint: response.humanCheckpoint,
    nextSteps: response.nextSteps,
    sourceStatusSummary,
  };
  const contentHash = createHash('sha256').update(canonicalize(payload)).digest('hex');
  return {
    ...payload,
    lineage: { ...response.lineage, contentHash },
  };
}

export interface ToolErrorShape {
  ok: false;
  toolName: string;
  code: string;
  message: string;
  details?: unknown;
}

export function toolError(
  toolName: string,
  code: string,
  message: string,
  details?: unknown,
): ToolErrorShape {
  return { ok: false, toolName, code, message, details };
}
