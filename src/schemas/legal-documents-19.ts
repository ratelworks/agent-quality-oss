/**
 * R0+ KPI: 19종 법정·관행 문서 마스터 리스트.
 * measure.ts가 이 리스트를 listSchemaIds()와 매칭해 문서 커버리지 산출.
 *
 * SSoT: feedback_agentquality_14_legal_documents.md (메모리, 2026-04-28 19종 정정).
 * 추가·삭제 시 본 리스트 + 메모리 + dev.md 동기화 필수.
 */

export interface LegalDocSpec {
  /** document-schemas.json의 schema id (등록 전이면 빈 문자열) */
  schemaId: string;
  /** 한글 명칭 */
  title: string;
  /** 카테고리 */
  category: 'plan' | 'daily' | 'cumulative' | 'nonconformance' | 'audit';
  /** 작성 빈도 */
  frequency: string;
  /** 법적 근거 (1줄 요약, 본문 인용은 schema basis 참조) */
  legalBasis: string;
  /** R0 종료 시점 등록 여부 */
  registered: boolean;
}

export const LEGAL_DOCUMENTS_19: LegalDocSpec[] = [
  // A. 사전 계획
  {
    schemaId: '',
    title: '품질관리 계획서',
    category: 'plan',
    frequency: '분기 (변경 시)',
    legalBasis: '건진법 §55 + 시행령 §89 + 시행규칙 §52',
    registered: false,
  },
  {
    schemaId: 'quality_test_plan',
    title: '품질시험 계획서',
    category: 'plan',
    frequency: '분기 (변경 시)',
    legalBasis: '건진법 §55 + 시행령 §90 + 시행규칙 §53',
    registered: true,
  },
  {
    schemaId: 'itp',
    title: '검사 및 시험 계획서 (ITP)',
    category: 'plan',
    frequency: '월 (공종 진입 시)',
    legalBasis: '업무지침 + 발주처 요구',
    registered: true,
  },
  {
    schemaId: 'qc_assignment_notice',
    title: '품질관리자 배치 신고서',
    category: 'plan',
    frequency: '변경 시',
    legalBasis: '건진법 §55 + 시행규칙 §50',
    registered: true,
  },
  // B. 매일/매회
  {
    schemaId: 'concrete_delivery_record',
    title: '콘크리트 받아들이기 기록부',
    category: 'daily',
    frequency: '매회 (트럭별)',
    legalBasis: 'KCS 14 20 10 §3.5.3.1 표 3.5-2',
    registered: true,
  },
  {
    schemaId: 'specimen_record',
    title: '공시체 제작 기록부',
    category: 'daily',
    frequency: '매일',
    legalBasis: 'KS F 2403',
    registered: true,
  },
  {
    schemaId: '',
    title: '시험 의뢰서 (KOLAS)',
    category: 'daily',
    frequency: '매회 (외부 시험)',
    legalBasis: '건진법 §57·§60',
    registered: false,
  },
  {
    schemaId: 'test_report_review',
    title: '시험 성적서 검토 의견서',
    category: 'daily',
    frequency: '매회',
    legalBasis: '업무지침',
    registered: true,
  },
  {
    schemaId: 'inspection_request',
    title: '검측 신청서',
    category: 'daily',
    frequency: '매회',
    legalBasis: '건진법 §55 + 감리계약 + 시행규칙 §51',
    registered: true,
  },
  {
    schemaId: '',
    title: '검측 체크리스트',
    category: 'daily',
    frequency: '매일 (부재별)',
    legalBasis: '업무지침 + 실무',
    registered: false,
  },
  {
    schemaId: '',
    title: '자재 공급원 승인 요청서',
    category: 'daily',
    frequency: '신규 자재',
    legalBasis: '사업관리방식 지침 별지 제37호',
    registered: false,
  },
  {
    schemaId: '',
    title: '시방서(품질관리) 일지',
    category: 'daily',
    frequency: '매일',
    legalBasis: '실무 표준',
    registered: false,
  },
  // C. 누적 기록
  {
    schemaId: 'quality_inspection_register',
    title: '품질검사 실시대장 (별지 제42호)',
    category: 'cumulative',
    frequency: '매일 누적',
    legalBasis: '건진법 §55 + 시행규칙 §51 + 별지 제42호',
    registered: true,
  },
  {
    schemaId: '',
    title: '품질검사 성과 총괄표 (별지 제43호)',
    category: 'cumulative',
    frequency: '월 (분기·연 보고)',
    legalBasis: '시행령 §93 + 별지 제43호',
    registered: false,
  },
  // D. 부적합 (ISO 9001 §8.7)
  {
    schemaId: 'ncr',
    title: '부적합 보고서 (NCR)',
    category: 'nonconformance',
    frequency: '발생 시',
    legalBasis: '업무지침 §7 + ISO 9001 §8.7',
    registered: true,
  },
  {
    schemaId: '',
    title: '시정조치 요구서 (CAR)',
    category: 'nonconformance',
    frequency: 'NCR 후속',
    legalBasis: 'ISO 9001 §8.7',
    registered: false,
  },
  {
    schemaId: '',
    title: '부적합 조치결과 확인서 (별지 제6호)',
    category: 'nonconformance',
    frequency: 'CAR 클로징',
    legalBasis: '업무지침 별지 제6호',
    registered: false,
  },
  // E. 보고·감사
  {
    schemaId: '',
    title: '품질관리 점검 결과 보고서',
    category: 'audit',
    frequency: '월·분기',
    legalBasis: '업무지침 §10',
    registered: false,
  },
  {
    schemaId: '',
    title: '품질감사 보고서',
    category: 'audit',
    frequency: '분기·반기',
    legalBasis: '자체 ISO 절차',
    registered: false,
  },
];

/**
 * 등록된 문서 수 / 전체 19종.
 */
export function computeCoverage(registeredSchemaIds: Set<string>): {
  total: number;
  covered: number;
  rate: number;
  missing: LegalDocSpec[];
  byCategory: Record<string, { total: number; covered: number }>;
} {
  const total = LEGAL_DOCUMENTS_19.length;
  let covered = 0;
  const missing: LegalDocSpec[] = [];
  const byCategory: Record<string, { total: number; covered: number }> = {
    plan: { total: 0, covered: 0 },
    daily: { total: 0, covered: 0 },
    cumulative: { total: 0, covered: 0 },
    nonconformance: { total: 0, covered: 0 },
    audit: { total: 0, covered: 0 },
  };
  for (const doc of LEGAL_DOCUMENTS_19) {
    byCategory[doc.category]!.total++;
    if (doc.schemaId && registeredSchemaIds.has(doc.schemaId)) {
      covered++;
      byCategory[doc.category]!.covered++;
    } else {
      missing.push(doc);
    }
  }
  return {
    total,
    covered,
    rate: total > 0 ? covered / total : 0,
    missing,
    byCategory,
  };
}
