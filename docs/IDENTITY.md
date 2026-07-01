# IDENTITY — agent-quality-oss 는 무엇인가

> 기여자·검토자용 정체성 문서. 사용자 안내는 [README](../README.md), 기술 구조는 [ARCHITECTURE](./ARCHITECTURE.md) 참조.

## 한 문장

**한국 건설 품질관리(QC·감리) 도메인의 전문성을 LLM 에게 공급하는 MCP 서버** — 품질관리자·감리원이 법정 품질문서를 작성·검토할 때 양식 구조·verified 법령 근거·정량 판정·검수 재료를 옆에서 제공한다.

## 최종 엔드유저

**품질관리자(QC) + 감리원** — 모든 설계 판단의 1차 게이트는 "이 변경이 품질관리자·감리원의 어떤 일을 더 빠르고 정확하게 만드는가". 기술 메트릭(노드 수·게이트 통과)은 이 가치의 proxy 일 뿐이다.

| 페르소나 | 대표 사용 흐름 |
|---|---|
| 신입 QC | 자연어 질문 → `chain_quality_inspection` 검측 준비 일습 |
| 경력 QC | NCR 작성 → `chain_nonconformance_report` 원인·조치·증빙·법령 재료 |
| 감리원 | 시험성적서 검토 → `chain_test_report_review` 코드 판정 + custody 확인 |
| 현장 실무자 | 아침 회의 → `chain_daily_quality_briefing` 공종별 리스크·검측·서류 카드 |

## 비-목표 (하지 않는 것)

- ❌ 작성 주체 대체 — 작성은 LLM·사용자, **결재·서명·법적 책임은 사람** (모든 응답에 humanCheckpoint)
- ❌ 판정 수치 창작 — KCS/KS 원문 미확보 수치는 `skeleton` (재인용 금지 신호). 없는 수치를 지어내지 않는다
- ❌ 전자결재·문서번호·보존 이력을 책임지는 QMS
- ❌ 품질 외 도메인 (안전은 자매 [agent-safety-oss](https://github.com/ratelworks/agent-safety-oss) — 같은 IRI 공간·같은 JSON-LD 구조)

## 도구 카탈로그 (52종)

### ① 온톨로지 탐색·프로파일 (6)

| 도구 | 역할 |
|---|---|
| `search_quality_ontology` | 공종·자재·시험·검측·리스크·부적합 노드 검색 (alias·부분 일치) |
| `resolve_worktype` | 자연어 공종 표현 → 표준 공종 id (실패 시 humanCheckpoint) |
| `get_work_quality_profile` | 공종 1건의 자재/시험/검측/리스크/증빙 전체 프로파일 |
| `get_material_quality_profile` | 자재 1건의 시험·증빙·기준·리스크 |
| `discover_relevant_domain` | 상황 서술 → 관련 도메인 노드 발견 |
| `explain_quality_decision_path` | 판정·조치의 그래프 경로 설명 |

### ② 법령·기준·서식 locator (6)

| 도구 | 역할 |
|---|---|
| `list_core_quality_laws` | 핵심 법령(법률·시행령·시행규칙·고시) 목록 |
| `get_quality_law_article` | 조항 요약 + **verified 원문(bodyText)·개정 이력** (법제처 sync 분) |
| `search_quality_management_guideline` | 품질관리 업무지침(2025-311호) 조항 검색 (편 필터) |
| `get_quality_guideline_article` | 지침 특정 조항 조회 |
| `search_construction_standards` | KCS/KDS 섹션 검색 (원문 미포함 — 라이선스) |
| `get_standard_form_locator` | 법정 별지 서식 locator + **공식 HWP/PDF 다운로드 링크** |

### ③ 문서 양식 스키마 (19) — `get_*_schema`

19종 문서 각각의 필수 필드·섹션·근거·보존기간 구조 반환 (법정 16종 + 실무·ISO 관행 3종). 문서를 직접 생성하지 않는다.

### ④ 근거 패키지 조립 (8) — `compile_*`

| 도구 | 역할 |
|---|---|
| `compile_document_references` | **제네릭** — 19종 문서 전부. 양식 + verified 법령 원문 발췌 + 서식 다운로드 링크 + 공종 재료 |
| `compile_ncr_references` | NCR 전용 — 부적합 후보·원인·즉시/시정 조치·증빙 (깊은 그래프 traversal) |
| `compile_concrete_pour_references` | 콘크리트 타설 준비 일습 (납품기록·공시체 연계) |
| `compile_inspection_references` / `compile_inspection_request_references` | 검측·검측신청 재료 |
| `compile_qc_assignment_notice_references` | 품질관리자 배치 신고 (규모별 등급·인원) |
| `compile_quality_test_plan_references` | 품질시험계획 (대상 판정·별표2 연계) |
| `compile_quality_inspection_register_references` | 품질검사 실시대장 (매일 누적) |

### ⑤ 체인 — 원스톱 워크플로우 (5) — `chain_*`

기존 도구들의 코드 오케스트레이션. LLM 왕복 없이 근거 일습을 한 번에.

| 도구 | 흐름 |
|---|---|
| `chain_quality_inspection` | 공종 해석 → 프로파일 → 검측 체크리스트·신청서 패키지 |
| `chain_quality_test_plan` | 공종 목록 → 공종×자재×시험·빈도 매트릭스 → 계획서 패키지 |
| `chain_test_report_review` | 관측값들 → 기준 매핑 → 코드 판정 → 검토 보고서 패키지 |
| `chain_nonconformance_report` | 관측값/공종/시험 → 판정 → NCR 재료 + verified 지침 근거(§39·§41) |
| `chain_daily_quality_briefing` | 오늘 작업 공종들 → 리스크·검측·시험·서류 브리핑 카드 |

### ⑥ 판정·검증 (4)

| 도구 | 역할 |
|---|---|
| `evaluate_observation` | 관측값 1건을 기준과 비교 — **코드 계산** (LLM 추측 아님). 통계 모드(압축강도 n≥3) 지원 |
| `infer_quality_risks` | 공종·자재·관측값 → 리스크·NCR·조치 추론 |
| `map_quality_basis` | 기준 우선순위 (배합설계서 > 시방서 > KCS > 지침 > KS) |
| `verify_quality_basis` · `verify_form_reference` | LLM 작성물의 인용 실존·서식 명칭 검수 (환각 차단) |

### ⑦ 입력 폼·작성 컨텍스트 (4)

| 도구 | 역할 |
|---|---|
| `render_quality_form` | 양식 → A2UI 입력 폼 (브라우저 viewer) |
| `compose_writing_context` | 입력값 + 구조 + 근거 → LLM 작성 컨텍스트 (본문은 생성하지 않음) |
| `get_project_info` | 현장·공사 컨텍스트 |

## 신뢰성 계약 (모든 도구 공통)

1. **basis[] 필수** — 모든 응답에 근거 목록 + `lineage.contentHash` + `sourceStatus` 요약
2. **sourceStatus 3등급** — `verified`(원문 1:1 대조) / `indirect_source`(간접) / `skeleton`(재인용 금지)
3. **humanCheckpoint** — 부적합 판정·기준 충돌·결재 필요 시 명시 + A2UI decision
4. **Code vs LLM 분리** — 그래프 탐색·수치 판정·우선순위 = 코드 / 추출·초안 = LLM
