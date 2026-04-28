# Dogfooding Round 01 — QC 페르소나 18 시나리오

> 일자: 2026-04-25
> 평가자 관점: 황룡건설 현장 품질관리자(김신입/박경력)·감리원(이감리)
> 기준: 응답이 **베테랑 옆에서 알려주는 수준**으로 실용적인가, 환각·누락·오인 유도가 있는가
> 베이스라인 smoke: 49/49 PASS

## 채점 (5점 척도, QC 실용 관점)

| ID | 페르소나 | 시나리오 | Tool | 점수 | 핵심 평가 |
|----|---------|--------|------|------|----------|
| S01 | 김신입 | 슬래브 타설 첫 검측 길잡이 | discover_relevant_domain | 3.0 | 공종은 잡지만 domainPackage Material/Test/Risk가 0건. 1차 키워드 매칭만 하고 graph neighbor expansion 안 함. expertGuidance 1줄 generic |
| S02 | 김신입 | 슬럼프 200mm 즉시 평가 | evaluate_observation | 4.5 | 정량 비교+가수의심+NCR id+nextSteps 모두 정확. legalVerdict/qualitySignal 분리 우수 |
| S03 | 김신입 | 공기량 7.5% | evaluate_observation | 4.5 | AE제 의심·KS F 2421 인용 정확 |
| S04 | 김신입 | 공시체 양식 | get_specimen_record_schema | 4.0 | KS F 2403 몰드·KOLAS 시험실 명시 우수. 공시체 개수(반입차당 3개씩, 28일+7일+1예비) 같은 빈도 가이드 누락 |
| S05 | 김신입 | NCR 패키지 일괄 | compile_ncr_references | 4.5 | NCR meta + 양식 스키마 + basisPriority 풀세트. 압권 |
| S06 | 박경력 | 시방서 vs KCS 우선순위 | map_quality_basis | 4.5 | factualBasis/applicableBasis 분리, projectContext 미주입 시 humanCheckpoint 정확 |
| S07 | 박경력 | 레미콘 시험 빈도 | get_material_quality_profile | 5.0 | 120㎥/회 빈도, 단위수량(2024-638호 신설) 정확. 베테랑 수준 |
| S08 | 박경력 | 압축강도 28일 26MPa | evaluate_observation | **1.5** | **P0 BUG**: observedValue=28(재령) 추출. 26 못 잡음. applicableCriterion="≥ null MPa" |
| S09 | 박경력 | NCR 결정경로 | explain_quality_decision_path | 4.5 | 7단계 사슬 명확. 마지막 step 6-7이 step 4와 중복(KCS 14 20 10 §3.2 두 번 등장) |
| S10 | 박경력 | LLM 환각 검증 | verify_quality_basis | 5.0 | "반드시" 강한표현 검출 + 미존재 id 즉시 차단. 핵심 가드 |
| S11 | 이감리 | ITP 양식 | get_itp_schema | 4.0 | H/W/S/R/E pointType, contractor/supervisor/owner 책임 분리 명확 |
| S12 | 이감리 | 시험성적서 검토 | get_test_report_review_schema | 4.5 | KOLAS·sealId(§60 봉인)·chain of custody 정확 |
| S13 | 이감리 | 부적합 발주청 보고 | search_quality_management_guideline | **2.0** | 0건. 검색 알고리즘이 정확 일치만 하는 듯. "발주청·부적합" 분리 매칭 안 됨 |
| S14 | 이감리 | 별지 환각 검증 | verify_form_reference | 4.0 | not_found 정확. claimedName 파싱이 "건설공사 품질관리 업무지침  시정조치 요구서"(이중공백) — 정규화 미흡 |
| S15 | 이감리 | 핵심 법률 카탈로그 | list_core_quality_laws | 5.0 | 6개 법률 + scope 한 줄씩 정확 |
| S16 | 김신입 | "방수" 모호 입력 | resolve_worktype | **2.5** | resolved=null인데 nextSteps가 `compile_concrete_pour_references`(콘크리트 타설) 잘못 추천 |
| S17 | 박경력 | "도장공사" 미커버 | discover_relevant_domain | **2.0** | 0매칭 + 또 콘크리트 패키지 잘못 추천. "이 도메인은 MVP 미커버" 명시해야 |
| S18 | 이감리 | 외기온도 33°C | evaluate_observation | 3.5 | marginal 정확. 그러나 입력은 외기온도, testId는 콘크리트 온도 측정 — 단서 환기 없음 |

**평균 점수: 3.83 / 5.0**

---

## 발견 이슈 우선순위

### P0 — 즉시 수정 (잘못된 정보)

#### P0-1. evaluate_observation 단위 파싱 버그 (S08)
- **증상**: "28일 압축강도 26MPa" → `observedValue: 28`, `observedUnit: "mm"`(?)... 첫 숫자만 추출.
- **영향**: 압축강도/시간 정보가 동시 들어간 모든 자연어가 오판정.
- **원인 추정**: 정규식이 첫 매칭 숫자를 잡고, 단위와 매칭하지 않음.
- **수정**: 값-단위 페어 매칭. "26MPa" 패턴 우선, "28일"은 age 토큰으로 분리.

#### P0-2. applicableCriterion 출력에 "null" 문자열 노출 (S08)
- **증상**: `"applicableCriterion": "≥ null MPa (KCS 14 20 10 §3.3)"` — 사용자 노출 텍스트에 "null" 누출.
- **수정**: threshold 미주입 시 `"프로젝트 설계기준강도 fck 주입 대기 (예: ≥ 24 MPa)"` 형태로 가공.

### P1 — UX/완성도 (오인 유도)

#### P1-1. discover_relevant_domain / resolve_worktype의 잘못된 nextSteps (S16, S17)
- **증상**: 미커버 도메인(방수, 도장)에서도 `compile_concrete_pour_references`를 default로 추천.
- **수정**: primaryWorkType=null 또는 도메인 매칭 실패 시 nextSteps는 일반 가이드(`list_core_quality_laws`, `get_standard_form_locator`)로만 한정.

#### P1-2. discover_relevant_domain neighborhood이 domainPackage에 누락 (S01)
- **증상**: primaryWorkType은 발견했는데 그 neighborhood의 Material/TestItem/InspectionCheckpoint/QualityRisk를 domainPackage에는 채우지 않음. 사용자가 보는 1차 결과는 비어 있고 neighborhood만 풍성함.
- **수정**: primaryWorkType 발견 시 1-hop neighbor를 domainPackage에 자동 채움(중복 제거).

#### P1-3. search_quality_management_guideline 검색 알고리즘 약함 (S13)
- **증상**: "부적합 발주청 보고" → 0건.
- **수정**: 토큰 분할 후 OR 매칭. 또는 가이드라인 데이터 자체가 5건뿐 (`guideline-articles.json`의 `_freq_update_note`만 있고 entity 미탑재) 가능성도 점검.

### P2 — 권장 (사용자 안전망)

#### P2-1. evaluate_observation 외기온도/콘크리트 온도 단서 환기 (S18)
- 입력에 "외기온도" 단어가 있는데 testId가 `test.concrete_temperature`이면 expertContext에 "외기온도≠콘크리트온도. 콘크리트 자체 온도 시험인지 확인 필요" 환기.

#### P2-2. explain_quality_decision_path 결정경로 중복 (S09)
- step 4와 step 6이 동일 노드(`standard.kcs_14_20.10.3_2`). dedupe 필요.

#### P2-3. verify_form_reference claimedName 정규화 (S14)
- 이중공백("업무지침  시정조치") 발생. 사용자 노출 전 trim+collapse.

---

## 강점 (유지)

1. **법적 verdict / 도메인 signal 분리**: legalVerdict vs qualitySignal 구분이 베테랑 사고와 일치
2. **factualBasis vs applicableBasis 분리**: projectContext로 승격하는 패턴이 환각 차단의 핵심
3. **basis[] / lineage / contentHash**: 모든 응답에 근거 추적 — 감리 영역에서 강력
4. **suggestedNextSteps + nextSteps tool 호출 가이드**: 체인 호출이 자연스러움
5. **humanCheckpoint legalNote**: 매 응답마다 "최종 판정은 품질관리자·감리원·발주자" 환기

## Round 02 진입 조건

- P0 2건 수정 → S08 재실행하여 PASS
- P1-1 수정 → S16/S17 nextSteps에서 콘크리트 추천 제거
- P1-2 수정 → S01 domainPackage 채워짐
- 그 후 베테랑 휴리스틱(공종별 "타설 전날 점검 체크리스트") 같은 데이터 영역으로 진행

---

## Round 01 수정 결과 (2026-04-25)

| 이슈 | 파일·라인 | 검증 |
|------|----------|------|
| **P0-1** 단위 파싱 | `src/judgment/parse-observation.ts` (SCALAR 글로벌 매칭, 단위 명시 페어 우선) | S08: `observedValue: 28` → **`26`** |
| **P0-2** "≥ null MPa" 누출 | `src/tools/evaluate-observation.ts` `formatCriterion` (threshold null 가드) | S08: `"≥ null MPa"` → **`"≥ <프로젝트 주입 대기> MPa"`** |
| **P1-1** 잘못된 nextSteps | `src/tools/_response.ts` defaultNextSteps + discover_relevant_domain dynamic | S16/S17: 콘크리트 패키지 추천 **제거**. S01: primaryWork=콘크리트일 때만 추천 |
| **P1-2** domainPackage 빈약 | `src/tools/discover-relevant-domain.ts` (1-hop neighbor + 2-hop 시험·기준 자동 채움) | S01: TestItem `0→6`, AcceptanceCriteria `0→8`, Material `0→1`, Risk `0→9` |
| **P1-3** 가이드라인 0건 | `src/tools/search-quality-management-guideline.ts` (토큰 분할 OR fallback) | S13 "부적합 발주청 보고": **0건 → 1건** (§7 부적합 발생 시 조치 매칭) |

**smoke**: 49/49 PASS (회귀 없음)
**평균 점수**: 3.83 → **4.39 추정** (P0/P1-1/P1-2/P1-3 5개 시나리오에서 +0.56 평균 상승)

## P2 수정 결과 (2026-04-25, 즉시 수정 라운드)

| 이슈 | 파일·라인 | 검증 |
|------|----------|------|
| **P2-1** 외기온도/콘크리트온도 단서 환기 | `src/tools/evaluate-observation.ts` `detectSemanticMismatch()` 신설 + expertContext prepend | S18: `expertContext`가 `"[주의] 입력에 \"외기/기온\"이 포함됨 — 본 기준은 콘크리트 자체 온도(KCS 14 20 10). 외기온도 한도는 한중(<4℃)·서중(>30℃) 별도 규정. 측정 대상 재확인 필요."`로 시작 |
| **P2-2** decision path 노드 중복 | `src/tools/explain-quality-decision-path.ts` (path id 기반 dedupe + role merge) | S09: path 7개 → **6개**. step 4 role이 `"기준의 법적·기술적 출처 · 판정 우선 근거 (basisPriority)"`로 합쳐짐 (의미 보존) |
| **P2-3** claimedName 이중공백 | `src/tools/verify-form-reference.ts` (별지 패턴 제거 후 `\s+` collapse) | S14: `"건설공사 품질관리 업무지침  시정조치 요구서"` → **`"건설공사 품질관리 업무지침 시정조치 요구서"`** |

**smoke**: 49/49 PASS (회귀 없음)

남은 항목 (Round 02+):
- 신규: 베테랑 휴리스틱 (공종별 "전날 점검 체크리스트") — 데이터 영역
- 신규: get_specimen_record_schema 공시체 개수 가이드 (반입차당 3개씩) — 데이터 영역
- 공종 시드 확장 (현재 4종 → MVP 목표 10종)
