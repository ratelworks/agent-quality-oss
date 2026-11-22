# ROADMAP — agent-quality-oss

> **프로젝트 목적**
> 온톨로지 그래프를 이용해 **건설 품질관리 분야의 도메인 전문성을 LLM에게 가이드**한다.
> 데이터 수집 자체가 목적이 아니다. 모든 sync·정량 추출·관계 정의는 LLM이 graph traversal로
> 베테랑 품질관리자처럼 응답하도록 만들기 위한 수단이다.

> **갱신 주기**: 라운드 종료 시. 현황과 6절의 수치는 `npm run docs:sync` 가 자료에서 다시 적는다.
> **함께 볼 문서**: [정체성·도구 목록](./docs/IDENTITY.md) · [기술 구조](./docs/ARCHITECTURE.md) · [온톨로지 가이드](./docs/ONTOLOGY.md)

> **📍 현황 (2026-11-16)**: 문서 23종의 양식 구조와 본문 생성(Markdown · 한글 파일 · DocLang) · MCP 도구 <!-- stat:tools -->62개<!-- /stat:tools --> · <!-- stat:graph -->그래프 노드 **414개** · 관계 **1004개**<!-- /stat:graph --> · <!-- stat:laws -->건설기술 진흥법 · 건설기술 진흥법 시행령 · 건설기술 진흥법 시행규칙 · 건설공사 사업관리방식 검토기준 및 업무수행지침 · 건설공사 품질관리 업무지침 — 다섯 법령·고시의 **조문 566개 · 별표 37개 · 별지 서식 134개**<!-- /stat:laws --> 본문 수록 · 건설공사 품질관리 업무지침 별표 2 의 <!-- stat:test-rows -->시험종목 **1,959행**(자재·공종 244종)<!-- /stat:test-rows --> · 현장 말로 쓴 문장에서 시험·기준·조문 찾기 · 그래프 표준 검증(SHACL · RDF 왕복). 아래 「1. 초기 상태 (2026-04-29)」 이하의 수치(36 도구·9/19·data/*.json 등)는 **초기 라운드 시점 기록**이다. 최신 수치는 README·CHANGELOG 를 본다.

---

## 0. 그래프 = 도메인 전문성의 형태

LLM에게 공급할 지식은 6가지 형태로 그래프에 매핑된다.

| 지식 유형 | 그래프 표현 | LLM 활용 |
|---------|------------|---------|
| ① 도메인 관계망 | Article·Annex·Activity·Material·Test 노드 + `requires`·`verifies` 관계 | "콘크리트 받아들이기 시 무엇을 검사?" → 1-hop traversal |
| ② 정량 기준 | Criterion 노드 (수치·단위·허용오차) | "슬럼프 150±25 위반인가?" → 코드 판정 + LLM 해석 |
| ③ 의사결정 트리 | Nonconformance·CorrectiveAction·ifFails 관계 | "공시체 강도 미달 시 절차?" → graph 경로 추론 |
| ④ 법령·기준 인용 위치 | Article·Annex의 `_meta.sourceUrl`·`legalBasis` | "이 응답의 근거 §은?" → basis[] 자동 |
| ⑤ 양식 구조 | Annex(서식) 노드의 description + HWP/PDF locator | "별지 제42호 컬럼 구조?" → 노드 description |
| ⑥ 환각 방지 | verificationStatus + amendmentHistory + sourceUrl 3중 검증 | `verify_quality_basis` 도구 |

→ **그래프 보강 = 위 6 형태 중 어느 하나가 LLM에게 더 잘 전달되도록 노드/관계가 늘어나는 것**.
"노드 N개 추가" 자체는 가치가 아님. "어떤 LLM 질문에 더 정확히 답할 수 있게 됐는가"가 가치.

---

## 1. 초기 상태 (2026-04-29)

### 1.1 그래프 노드 (`src/taxonomy/graph/nodes/`)

| 디렉토리 | 노드 | 출처 |
|---------|----:|------|
| acts/ | 4 | 건진법·시행령·시행규칙·품질지침 |
| articles/ | 18 | 어제 sync (critical 4+5+4+5) |
| annexes/ | 81 | 오늘 sync (시행규칙 69 + 시행령 12) |
| documents/ activities/ controls/ corrective_actions/ criteria/ cycles/ material_standards/ materials/ nonconformances/ specifications/ tests/ applicabilities/ | 0 × 13 | **전부 비어있음** |
| **합계** | **103** | |

### 1.2 레거시 ontology data (병존 시스템)

`src/ontology/data/*.json` 17개 파일 = **141 entity** (worktypes 4 / materials 1 / test-items 6 / inspections 3 / quality-risks 9 / nonconformance 10 / corrective-actions 11 / acceptance-criteria 11 / standards-map 23 / laws 14 / standard-forms 9 / evidence-documents 10 / guideline-articles 9 / agencies 5 / equipment 9 / tasks 6 / specifications 1).

→ **graph/nodes로 마이그레이션 필요** (Round 7).

### 1.3 19종 법정문서 schema 등록

**9/19 (47%)** — `master-index.json` `documents19.registered` 기준.

| 카테고리 | 등록 / 총 | 미등록 |
|---------|:---------:|-------|
| plan (사전계획) | 3 / 4 | quality_management_plan |
| **daily (매일/매회)** | 4 / 8 | test_request_kolas, inspection_checklist, material_supplier_approval, specification_daily_log |
| cumulative (누적) | 1 / 2 | quality_inspection_summary |
| nonconformance (부적합) | 1 / 3 | car, nonconformance_closure |
| **audit (보고감사)** | **0 / 2** | quality_inspection_report, quality_audit_report |

가장 빈도 높은 daily 카테고리 절반 미달, audit 0% — 라운드 우선순위 결정 1차 게이트.

### 1.4 MCP 도구 36개 (목표 54). master-index 도메인 9개 (건진법·시행령·시행규칙·품질지침·KCS 14 20·KCS 21·KCS 24·KS F 4009·KS F 2403).

---

## 2. 19종 문서 × 데이터 의존 매트릭스

✅=데이터 sync 완료 / 🟡=같은 인프라로 즉시 가능 / 🔲=별도 트랙 필요

| # | 문서 | 1차 데이터 의존 | 데이터 상태 | schema |
|--|------|---------------|:-----------:|:------:|
| 1 | quality_management_plan | 시행령 §89, 별표 9 | ✅ | ❌ |
| 2 | quality_test_plan | 시행령 §90, 별표 9 | ✅ | ✅ |
| 3 | itp | 품질지침 §6 | ✅ | ✅ |
| 4 | qc_assignment_notice | 시행규칙 §50, 별표 6 | ✅ | ✅ |
| 5 | concrete_delivery_record | KCS 14 20 §3.5 + KS F 4009 | 🔲 | ✅ |
| 6 | specimen_record | KCS 14 20 §3.7 + KS F 2403 | 🔲 | ✅ |
| 7 | test_request_kolas | KS 시험방법 + KOLAS | 🔲 | ❌ |
| 8 | test_report_review | KS + KCS 받아들이기 | 🔲 | ✅ |
| 9 | inspection_request | 품질지침 §6 + KCS | 🔲 | ✅ |
| 10 | inspection_checklist | 품질지침 §6 + KCS | 🔲 | ❌ |
| 11 | material_supplier_approval | 품질지침 §8 + 사업관리지침 별지 37 | 🟡 | ❌ |
| 12 | specification_daily_log | 시방서 + KCS | 🔲 | ❌ |
| 13 | quality_inspection_register | 시행규칙 별지 42 | ✅ | ✅ |
| 14 | quality_inspection_summary | 시행규칙 별지 43, 시행령 §93 | ✅ | ❌ |
| 15 | ncr | 품질지침 §7 + ISO 9001 | ✅ | ✅ |
| 16 | car | 품질지침 §7 | ✅ | ❌ |
| 17 | nonconformance_closure | ISO 9001 §8.7 관행 + 업무지침 §39 (법정 전용 서식 없음 — 구 '별지 6' 인용은 오류로 정정됨 2026-07-02) | ✅ | ❌ |
| 18 | quality_inspection_report | 품질지침 §10 | ✅ | ❌ |
| 19 | quality_audit_report | ISO 19011 + 품질지침 §10 | ✅ | ❌ |

**해석**:
- 데이터 ✅ 11종 vs schema ✅ 9종 → **데이터 있는데 schema 미작성 = 즉시 추가 가능 6종** (quality_management_plan / quality_inspection_summary / car / quality_inspection_report / quality_audit_report — 또한 일부 데이터는 부족하지만 1차 작성은 가능)
- 🟡 2종 = Round 1.3(품질지침 별표) 후 즉시 가능
- 🔲 6종 = KCS·KS·KOLAS 트랙 종료 후

---

## 3. 8 라운드 로드맵

### Round 1 — 법제처 OC API (`OC=YOUR_LAW_OC`, 신청 0)

| 단계 | 작업 | 예상 산출 | 상태 |
|------|------|----------|:---:|
| 1.1 | 4법령 critical 조문 sync | articles +18 | ✅ |
| 1.2 | 시행규칙·시행령 별표 sync | annexes +81 | ✅ |
| 1.3 | 품질지침 별표·별지 sync + 현행 조문 29개 원문 (2025-311호) | annexes +15, articles +29 | ✅ |
| 1.4 | 행정규칙 2건 본문 sync: 시공평가지침(2100000093486) + 하자심사규칙(2100000078829) | acts +2, articles +N, annexes +N | 🔲 |
| 1.5 | 사업관리지침 품질·검측·자재 별지 15종 (별지 37 포함) | annexes +15 | ✅ |

**Round 1 종료 KPI**: articles ~30, annexes ~120, schema 9 → **14**.

### Round 2 — KCS 본문 (KCSC 자체 키)

| 시리즈 | 조 | critical | 19종 영향 |
|-------|---:|---------|----------|
| KCS 14 20 콘크리트 | 60 | 4 | concrete_delivery_record · specimen_record · test_report_review |
| KCS 21 가설 | 30 | 0 (high 1) | inspection_checklist (가설) |
| KCS 24 철근 | 25 | 0 | inspection_checklist (철근) |

**Round 2 종료 KPI**: criteria 노드 +50 (정량 기준), schema 14 → 17.

### Round 3 — KS 메타 (data.go.kr 15058715)

| KS | 매핑 | 본문 |
|----|------|------|
| KS F 4009 | material.ready_mixed_concrete | 유료(KSA) → 메타만 |
| KS F 2402 | test.slump | 유료 |
| KS F 2403/2405/2408 | test.compressive_strength | 유료 |
| KS F 2421/2449 | test.air_content | 유료 |
| KS D 3504 | material.rebar | 유료 |
| 외 ~45개 | — | 메타+locator |

**Round 3 종료 KPI**: material_standards 노드 +50, tests 노드 시험방법 링크 100%.

### Round 4 — KOLAS 시험기관 (knab.go.kr 크롤링)

Agent_Safety_Relay 패턴(Cloud Run 중계 + Redis 캐시) 차용. **agencies 노드 1,000+, schema 17 → 18** (test_request_kolas).

### Round 5 — 공공데이터포털 R5 (data.go.kr serviceKey)

| 데이터셋 | 활용 | 승인 |
|---------|-----|:----:|
| 15125666 하자심사 처리현황 | nonconformances 빈도 라벨 | 자동 |
| 15094885 시공평가 접수 | quality_audit_report 보강 | 자동 |
| 15094883 평가위원 | agencies 보강 | 자동 |
| 15061362 키스콘 건설업체 | 시공자 SSoT | 자동 |

### Round 6 — 19종 schema 미등록 작성

Round 1~5 진행 흐름에 맞춰 분산.
- Round 1 직후: quality_management_plan / quality_inspection_summary / car / quality_inspection_report / quality_audit_report (5종)
- Round 1.3 후: nonconformance_closure / material_supplier_approval (2종)
- Round 2 후: inspection_checklist / inspection_request / specification_daily_log (3종)
- Round 4 후: test_request_kolas (1종)

**최종**: 19/19 = 100%.

### Round 7 ✅ 완료 (2026-06-16) — legacy ontology/data → graph/nodes 마이그레이션

`src/ontology/data/*.json` → `graph/nodes/{type}/*.jsonld` 변환 **완료** (330노드, 커밋 `ef134f4`). 1회용 변환 스크립트 사용 후 옛 `data/*.json` 폐기 → JSON-LD 단독 SSoT. 로더는 IRI 역변환으로 in-memory 그래프 구성(graphology 미도입, 도구 무영향).

### Round 8 ✅ 완료 (2026-07-02) — 도구 46 → 52 (제네릭 설계 채택)

~~19종 × 2 (`get_*_schema` + `compile_*_references`) 신설~~ → **설계 변경 (2026-07-02)**: 문서별 bespoke compile 12종 추가 대신 **제네릭 `compile_document_references(docId)` 1종**으로 19종 문서 전부의 근거 패키지를 커버 (MCP 도구 폭증은 LLM 도구 선택 정확도를 떨어뜨림 — 자매 safety-oss 의 assemble_doc_context 패턴 정합). 그래프 traversal 이 깊은 전용 compile 7종은 유지. chain 도구 5종(검측·시험계획·성적서검토·부적합·일일브리핑) 신설 완료. 전 compile·chain 의 basis 에 verified 법령 근거 포함 → 응답 신뢰도 any 62.5% · ratio 35.9% 달성 (측정 러너의 annotate 누락 결함도 함께 수정 — 서버 경로와 동일 측정).

---

## 4. 의존성 그래프

```
Round 1 (OC, 즉시) ─┬─► Round 6 partial (5+2 schema)
                    └─► Round 7 (article·annex 마이그레이션 동시)
Round 2 (KCSC 키)   ──► Round 6 (+3 schema)
Round 3 (KS API)    ──┬─► Round 6 (+1 schema)
                      └─► Round 4 (KOLAS 매핑 데이터로 활용)
Round 5 (data.go.kr) ──► 도메인 보강 (병렬, 19종에 직접 영향 적음)
Round 6 완료 ──► Round 8 (도구 확장)
```

---

## 5. 외부 신청 게이트 (사용자 결정)

| # | 게이트 | 신청처 | 시간 | 결정 시점 |
|---|--------|-------|------|----------|
| G1 | KCSC 인증키 | kcsc.re.kr/support/api | 즉시~수시간 | Round 1 완료 후 |
| G2 | data.go.kr serviceKey (KS) | data.go.kr — 자동 | 즉시 | Round 3 진입 전 |
| G3 | data.go.kr serviceKey (R5 4개) | data.go.kr — 자동 | 즉시 | Round 5 진입 전 |
| G4 (옵션) | LH 품질시험인정 | pumjil.lh.or.kr | 미공개 | Round 4 후 검토 |

OC API(Round 1) 외에는 모두 외부 신청 의존.

---

## 6. 측정 메트릭 (KPI)

진척은 다음 지표로 본다. 그래프·도구 수치는 `npm run docs:sync` 가 자료에서 다시 적고, 응답 지표는 평가 시나리오를 돌려 잰다.

| KPI | 현 | 목표 |
|-----|---:|----:|
| 19종 문서 schema 커버리지 | 23/23 = 100% | 100% (달성) |
| 출처를 원문과 대조한(verified) 노드 | <!-- stat:verified -->173/414 노드 (42%)<!-- /stat:verified --> | 판정에 쓰는 노드 전부 |
| 원문과 대조한 판정기준 | <!-- stat:criteria -->22/47 (47%)<!-- /stat:criteria --> (콘크리트 공종 중심) | 전 공종 (KCS·KS 원문 확보 후) |
| 평가 시나리오 (2026-11-16 측정) | 기대와 같은 판정 15/16 · 틀린 합격 0/16 · 금지 근거 등장 1/16 | 틀린 합격 0 유지 |
| 응답 근거의 verified 비중 (2026-11-16 측정) | 모든 근거 verified 0/16 · 하나 이상 verified 15/16 · 평균 비중 58% | 판정기준 원문 확보에 따라 상승 |
| AI 비서 연결 실사용 (2026-11-16) | 설치본에 AI 비서를 붙여 현장 질문 24회 — 드러난 문제는 회귀 시험 113건으로 고정 | 실제 사용자의 질문으로 넓힌다 |
| 현장 문장 판정 (2026-11-17 측정) | 처음 보는 묶음(120문장씩) 첫 실행: 문장 그대로 넣으면 최근 열 묶음 틀린 판정 0~3건 / AI 비서를 거치면 실질 틀린 판정 0(묶음 넷). 다 돌린 2,430문장 틀린 판정 0, 잡수 변형 14,580건 틀린 판정 0 | 문장 그대로 넣는 길의 남은 틀린 판정(누구의 값·언제의 값·가정)을 줄이기 |
| 현장 말투 질문 (2026-11-16 측정) | 맞춰 보는 묶음 31/32 · 보지 않는 묶음 21/22 · 고정한 뒤에 쓴 묶음 15/20 | 실제 현장 질문으로 다시 잰다 |
| MCP 도구 | <!-- stat:tools -->62개<!-- /stat:tools --> — 문서 23종의 근거 패키지·본문 생성·검토 전부 | 도구 수 자체는 KPI 아님 |

- **평가 시나리오**: 16개 상황을 도구에 넣어 판정·근거를 기대값과 견준다. 기대와 다른 1건(C06 — 운반시간 95분을 콘크리트 온도 기준으로 답함)은 운반시간 판정기준이 아직 없어서 생기는 한계다. 틀린 합격을 막는 함정 시나리오로 남겨 둔다.
- **응답 근거의 verified 비중**: 응답에 실린 근거 가운데 원문과 대조한 것의 비중이다. 그래프 노드의 verified 비율과는 다른 지표다(노드 자산 ≠ 응답 신뢰도).
- **현장 말투 질문**: 세 묶음 모두 질문과 현장 표현을 같은 사람이 썼다. 독립된 잣대가 아니므로 실제 현장 질문을 모아 다시 재야 한다.

---


## 7. 다음 1번

- **실제 현장 질문으로 검색 성능 재기** — 품질관리자·감리원이 실제로 한 질문을 모아 별도 묶음으로 잰다(지금 묶음은 독립된 잣대가 아니다).
- **콘크리트 밖 공종의 판정 수치** — 토공·철근·포장·방수 등은 시험종목·빈도까지만 안내한다. KCS·KS 원문을 확보하는 대로 판정기준을 원문과 대조해 채운다.
- **운반시간 등 빠진 판정기준** — 평가 시나리오 C06 이 가리키는 빈칸.
- **공식 서식의 칸 배치** — 지금은 기재 항목만 옮긴다. 법령·고시 서식의 칸 배치까지 맞춘 한글 파일은 다음 과제다.
- **발주처 특기시방·프로젝트 문서 반영** — 일반 기준보다 우선하는 현장 문서를 넣어 판정에 쓰는 길.
