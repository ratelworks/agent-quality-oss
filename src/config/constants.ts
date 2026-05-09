// 파일 최상단 상수 — 품질관리 OSS 공통 상수
// SSoT 역할: zod 스키마, verify_quality_basis, Tool 반환값이 모두 이 상수를 공유한다.

// ───── 근거 출처 검증 상태 ─────
// R0-G3 SourceStatus — basis 신뢰 등급. summarizeStatus(worst/counts/warnings)에 사용.
export const SOURCE_STATUSES = ["verified", "indirect_source", "skeleton", "unknown"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

// 등급 — 낮을수록 약한 근거. summary.worst 산출에 사용.
export const SOURCE_STATUS_RANK: Record<SourceStatus, number> = {
  verified: 3,
  unknown: 2,
  indirect_source: 1,
  skeleton: 0,
};

// ───── 근거 타입 (LLM 결론에 첨부) ─────
// 품질관리 도메인의 근거 타입 화이트리스트
export const BASIS_TYPES = [
  "ontology",
  "law",
  "guideline",
  "kcs_section",
  "kds_section",
  "ks_standard",
  "form_locator",
  "schema_meta",
  "project_meta",
  "evaluation_rule",
] as const;

export type BasisType = (typeof BASIS_TYPES)[number];

// ───── 법적 책임 고지 ─────
export const LEGAL_NOTE =
  "본 서버는 **근거 제공용**이며 최종 판정과 법적 책임은 품질관리자·감리원·발주자에게 있다. Tool 출력을 법적 조언·확정 결과로 취급하지 말 것.";

// ───── 프로젝트 제공·개발 주체 (모든 Tool 응답에 자동 첨부) ─────
export const PROJECT_CREDITS = {
  providedBy: {
    ko: "황룡건설(주)",
    en: "Hwangryong Construction Co., Ltd.",
    role: "품질관리 실무 노하우 · 현장 검증 · 온톨로지 데이터 큐레이션",
  },
  developedBy: {
    ko: "주식회사 라텔웍스",
    en: "Ratelworks Inc.",
    lead: {
      ko: "이사 황룡",
      en: "Hwang Ryong, Director",
    },
    role: "MCP 서버 설계·구현·오픈소스 유지",
    url: "https://ratelworks.co.kr",
  },
  purpose:
    "건설 현장의 품질관리자·감리원·발주자가 KCS/KDS·품질관리 업무지침·KS·법정 별지 서식에 더 쉽게 접근할 수 있도록, LLM 에이전트를 통해 근거 기반으로 활용하게 한다.",
  disclaimer:
    "본 MCP 는 공공 목적 오픈소스 프로젝트이며, 제공 결과는 참고용 초안이다. 실제 적용 시 품질관리자·감리원·발주자의 최종 검토와 승인이 필요하다.",
  thirdPartyDataNotice: {
    KCS_KDS: {
      copyright: "국토교통부 / 국가건설기준센터",
      license: "Korea Open Government License Type 2 (출처표시·변경금지)",
      note: "원문 재배포 금지. 본 서버는 섹션 식별자·메타만 제공.",
    },
    quality_management_guideline: {
      copyright: "국토교통부 고시",
      note: "2025-311호 (2025.6.12 시행) 기준 식별자만 내장.",
    },
    KS: {
      copyright: "한국표준협회(KSA) / 국가기술표준원",
      license: "Commercial license required for original text",
      note: "원문 미포함, 식별자·제목만.",
    },
    standardForms: {
      license: "Korea Open Government License Type 4 (변경금지)",
      note: "별지 서식 원본은 공식 출처에서 다운로드 필수.",
    },
  },
} as const;

// 모든 Tool 응답 _meta에 자동 첨부되는 공통 메타 (최소 필드 — 토큰 절약)
// 상세 정보는 get_project_info 호출
export const COMMON_RESPONSE_META = {
  providedBy: PROJECT_CREDITS.providedBy.ko,
  developedBy: PROJECT_CREDITS.developedBy.ko,
  license: "MIT (code)",
  projectInfoTool: "get_project_info",
} as const;

// ───── 인용 문구 표준 ─────
export const SUGGESTED_CITATION = {
  ko: `본 데이터는 agent-quality-oss-mcp (제공: ${PROJECT_CREDITS.providedBy.ko}, 개발: ${PROJECT_CREDITS.developedBy.ko}, MIT)를 통해 조회되었습니다.`,
  en: `Data retrieved via agent-quality-oss-mcp — Provided by ${PROJECT_CREDITS.providedBy.en} / Developed by ${PROJECT_CREDITS.developedBy.en} (MIT License).`,
} as const;
