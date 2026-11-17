/**
 * 문서 목록(23종) — 이름·작성 시점·근거 한 줄.
 * 법령과의 관계(법령 서식·고시 서식·내용을 법령이 정함·실무 문서)는 document-schemas.json 의 classification 이 정본이다.
 *
 * R0+ KPI: 문서 마스터 리스트.
 * measure.ts가 이 리스트를 listSchemaIds()와 매칭해 문서 커버리지 산출.
 *
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

export const LEGAL_DOCUMENTS: LegalDocSpec[] = [
  // A. 사전 계획
  {
    schemaId: 'quality_plan',
    title: '품질관리계획서',
    category: 'plan',
    frequency: '착공 전 1회 + 변경 시',
    legalBasis: '건설기술 진흥법 제55조 + 시행령 제89조·제90조 + 업무지침 별표 1',
    registered: true,
  },
  {
    schemaId: 'quality_test_plan',
    title: '품질시험계획서',
    category: 'plan',
    frequency: '착공 전 1회 + 변경 시',
    legalBasis: '건설기술 진흥법 제55조 + 시행령 제89조제2항·별표 9·제90조',
    registered: true,
  },
  {
    schemaId: 'itp',
    title: '검사 및 시험 계획 (ITP)',
    category: 'plan',
    frequency: '공종 착수 전',
    legalBasis: '실무 서식 — 업무지침 별표 1 의 8.11',
    registered: true,
  },
  {
    schemaId: 'qc_assignment_notice',
    title: '품질관리 건설기술인 배치 내역서',
    category: 'plan',
    frequency: '착공 때 + 변경 시',
    legalBasis: '실무 서식 — 배치기준은 시행규칙 제50조제4항·별표 5',
    registered: true,
  },
  // B. 매일/매회
  {
    schemaId: 'concrete_delivery_record',
    title: '레미콘 차량별 입회시험 기록지',
    category: 'daily',
    frequency: '매회 (차량별)',
    legalBasis: '실무 서식 — 업무지침 제38조 + KCS 14 20 10',
    registered: true,
  },
  {
    schemaId: 'specimen_record',
    title: '공시체 제작·관리 기록지',
    category: 'daily',
    frequency: '제작할 때마다',
    legalBasis: '실무 서식 — KS F 2403',
    registered: true,
  },
  {
    schemaId: 'test_request',
    title: '품질검사 대행 의뢰서',
    category: 'daily',
    frequency: '매회 (대행 의뢰)',
    legalBasis: '실무 서식 — 건설기술 진흥법 제60조 + 시행규칙 제56조(정보망 입력)',
    registered: true,
  },
  {
    schemaId: 'test_report_review',
    title: '시험성적서 검토 보고서',
    category: 'daily',
    frequency: '매회',
    legalBasis: '실무 서식 — 건설기술 진흥법 제60조 + 업무지침 제8조',
    registered: true,
  },
  {
    schemaId: 'inspection_request',
    title: '검측요청서',
    category: 'daily',
    frequency: '매회',
    legalBasis: '사업관리방식 지침 제86조 + 별지 제36호',
    registered: true,
  },
  {
    schemaId: 'inspection_checklist',
    title: '검측 체크리스트',
    category: 'daily',
    frequency: '매회 (부위별)',
    legalBasis: '사업관리방식 지침 제86조 + 별지 제36호',
    registered: true,
  },
  {
    schemaId: 'material_source_approval',
    title: '자재 공급원 승인 요청서',
    category: 'daily',
    frequency: '자재 반입 전',
    legalBasis: '건설기술 진흥법 제57조제1항 + 사업관리방식 지침 제87조·별지 제37호',
    registered: true,
  },
  {
    schemaId: 'quality_daily_log',
    title: '품질관리 일지',
    category: 'daily',
    frequency: '매일',
    legalBasis: '실무 서식 (법정 의무 아님)',
    registered: true,
  },
  {
    schemaId: 'ready_mixed_placement_check',
    title: '레미콘 시공품질관리 점검표',
    category: 'daily',
    frequency: '레미콘 반입부터 시공완료까지 기록·비치',
    legalBasis: '업무지침 제38조제4항·별지 제11호서식',
    registered: true,
  },
  {
    schemaId: 'asphalt_placement_check',
    title: '아스콘 시공품질관리 점검표',
    category: 'daily',
    frequency: '아스콘 반입부터 시공완료까지 기록·비치',
    legalBasis: '업무지침 제38조제4항·별지 제12호서식',
    registered: true,
  },
  // C. 누적 기록
  {
    schemaId: 'quality_inspection_register',
    title: '품질검사 실시대장 (시행규칙 별지 제42호)',
    category: 'cumulative',
    frequency: '검사할 때마다',
    legalBasis: '건설기술 진흥법 제55조제3항 + 시행규칙 제50조제1항·별지 제42호',
    registered: true,
  },
  {
    schemaId: 'quality_inspection_summary',
    title: '품질검사 성과 총괄표 (시행규칙 별지 제43호)',
    category: 'cumulative',
    frequency: '기성부분검사·예비준공검사·준공검사 신청 때',
    legalBasis: '시행령 제93조 + 시행규칙 제51조·별지 제43호',
    registered: true,
  },
  {
    schemaId: 'monthly_test_report',
    title: '품질시험·검사실적 보고서',
    category: 'cumulative',
    frequency: '매월',
    legalBasis: '사업관리방식 지침 제60조제10항·제90조제15항·별지 제18호 서식',
    registered: true,
  },
  // D. 부적합 (ISO 9001 §8.7)
  {
    schemaId: 'ncr',
    title: '부적합 보고서 (NCR)',
    category: 'nonconformance',
    frequency: '발생 시',
    legalBasis: '실무 서식 — 업무지침 별표 1 의 8.12',
    registered: true,
  },
  {
    schemaId: 'corrective_action_request',
    title: '시정조치 요구서 (CAR)',
    category: 'nonconformance',
    frequency: '부적합 보고 뒤',
    legalBasis: '실무 서식 — 업무지침 별표 1 의 10.1',
    registered: true,
  },
  {
    schemaId: 'nc_corrective_result',
    title: '부적합 조치결과 확인서',
    category: 'nonconformance',
    frequency: '시정조치 종결 때',
    legalBasis: '실무 서식 — 업무지침 별표 1 의 8.12·10.1',
    registered: true,
  },
  {
    schemaId: 'defective_material_disposal_pledge',
    title: '불량자재폐기 확약서',
    category: 'nonconformance',
    frequency: '불량자재 반품 때 (생산자에게 받아 준공까지 보관)',
    legalBasis: '업무지침 제41조제2항·별지 제13호서식',
    registered: true,
  },
  // E. 보고·감사
  {
    schemaId: 'quality_inspection_report',
    title: '자체 품질점검 결과 보고서',
    category: 'audit',
    frequency: '현장 계획에 따름',
    legalBasis: '실무 서식 — 시행령 제91조제3항제5호',
    registered: true,
  },
  {
    schemaId: 'quality_audit_report',
    title: '내부심사(품질감사) 보고서',
    category: 'audit',
    frequency: '년 1회 이상 (품질관리계획 대상 공사)',
    legalBasis: '실무 서식 — 업무지침 별표 1 의 9.3',
    registered: true,
  },
];

/**
 * 등록된 문서 수 / 전체 문서 수.
 */
export function computeCoverage(registeredSchemaIds: Set<string>): {
  total: number;
  covered: number;
  rate: number;
  missing: LegalDocSpec[];
  byCategory: Record<string, { total: number; covered: number }>;
} {
  const total = LEGAL_DOCUMENTS.length;
  let covered = 0;
  const missing: LegalDocSpec[] = [];
  const byCategory: Record<string, { total: number; covered: number }> = {
    plan: { total: 0, covered: 0 },
    daily: { total: 0, covered: 0 },
    cumulative: { total: 0, covered: 0 },
    nonconformance: { total: 0, covered: 0 },
    audit: { total: 0, covered: 0 },
  };
  for (const doc of LEGAL_DOCUMENTS) {
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
