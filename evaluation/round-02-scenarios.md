# Round 02 — 콘크리트·레미콘 실무 dogfooding 시나리오

> 일자: 2026-04-25
> 페르소나 4명 / 시나리오 13개 / 채점은 SOURCES.md A~L 영역 정확성 기준
> 목적: **현재 시드의 실무 갭을 정량화** → 개선 → 재측정 루프

## 페르소나

| 코드 | 이름 | 역할 |
|------|------|------|
| 신입 | 김신입 | 현장 QC 1년차 — 받아쓰기·시험 입회 첫 경험 |
| 경력 | 박경력 | 현장 QC 7년차 — 통계 판정·해체 강도·NCR 판단 |
| 감리 | 이감리 | 책임감리원 — 검토·승인·발주청 보고 |
| 공장 | 정공장 | 레미콘 공장 품질기술자 — 호칭강도·기온보정·납품 책임 |

## 시나리오

| ID | 페르소나 | 상황 | 기대 SOURCES 인용 | 채점 핵심 |
|----|---------|------|-------------------|----------|
| **C01** | 신입 | "오늘 슬래브 타설. 첫 차 슬럼프 175mm 측정됨 (호칭 150). 그대로 받나요?" | E (KS F 4009 허용오차 ±25) | 175 = 150+25 = 경계. PASS marginal |
| **C02** | 신입 | "공시체 7일 강도 18MPa, 호칭 24MPa 콘크리트. 합격?" | D (35MPa↓ 분기), §3.5.3.2 | 7일은 28일 판정 대상 X. 통계 판정으로 결론 못 내림 환기 |
| **C03** | 경력 | "어제 1회 시험값 21MPa, 호칭 24MPa. 1회 -3.5MPa 룰 통과 (24-3.5=20.5)? 보고 필요?" | D 표 3.5-3 (≤35MPa: 1회 ≥ fcn-3.5) | 21 ≥ 20.5 → 1회 기준 통과. 그러나 연속 3회 평균은 별도 |
| **C04** | 경력 | "기둥 거푸집 해체. 압축강도 7MPa 나왔는데 가능?" | H §3.3.1 (측면 5MPa) | 기둥 측면 5MPa 이상 → 가능. 슬래브 밑면 아님 환기 |
| **C05** | 경력 | "내일 외기온도 3℃ 예보. 일반 콘크리트로 시공 가능?" | I (KCS 14 20 40 §1.1(2): 4℃↓) | 3℃ < 4℃ → 한중 적용 필수 |
| **C06** | 경력 | "외기 28℃, 트럭 도착까지 1시간 35분. 받을 수 있나?" | A §3.2(3) (25℃↑ 1.5h=90분) | 95분 > 90분 → 운반시간 초과. 반송 |
| **C07** | 감리 | "시공사가 슬래브 거푸집 해체 신청. 압축강도 16MPa, fck 24MPa. 승인?" | H (슬래브 단층: fck×2/3 그리고 14MPa↑) | 24×2/3=16 정확. 14MPa↑ 모두 만족 → 승인 가능 |
| **C08** | 감리 | "코어 4개 결과: 평균 22MPa, 최저 17MPa, fck 24MPa. 합격?" | G §3.5.5.7(4) (평균 85% AND 각각 75%) | 평균 22 > 24×0.85=20.4 OK. 최저 17 < 24×0.75=18 → 불합격 |
| **C09** | 감리 | "타설 중 비. 표면 빗물 고임. 처리?" | KCS 14 20 10 §3.3.2(10), cak Q&A | 빗물 고임 제거 후 타설. 홈으로 흘리면 안 됨 |
| **C10** | 공장 | "Tn=6 적용 시기?" | K 표 2.2-1 | 28일간 예상평균기온 4~8℃. 한중(4℃↓)과 별도 |
| **C11** | 신입 | "콜드조인트 발생. NCR 작성하려는데 양식?" | get_ncr_schema + compile_ncr_references | 현재 ncr.cold_joint 없음 — 갭 |
| **C12** | 경력 | "fcr 25.5MPa, fck 24MPa, fcn은 뭐죠?" | KCS 14 20 10 §1.4 표 1.4-1 | fck/fcn/fcr/fcm 정의. 현재 시드 부재 — 환각 가드 부재 |
| **C13** | 신입 | "한중 시공. 양생온도가 콘크리트 온도? 외기?" | J §3.4.1(4) cak Q&A 4번 | 콘크리트 온도. 5℃↑ 유지, 0℃↑ 2일간 |

## 채점 룰 (5점 척도, SOURCES 기준)

| 점수 | 기준 |
|:----:|------|
| 5 | SOURCES 정확 인용 + 정량 비교 + 베테랑 시각 + nextSteps + basis 적정 |
| 4 | 정량 비교 정확 / 인용 §·표 1개 누락 |
| 3 | 도메인 노드는 반환하나 정량 판정 없음 / 일반 가이드 수준 |
| 2 | 응답은 있으나 인용 부정확 또는 잘못된 nextSteps |
| **1** | **응답 없음 / 환각 / 잘못된 판정** |

평균 4.0 이상 = 실무 활용 가능 수준 진입.

## 목표 흐름

```
1차 실행 (현재 시드) → 점수 X.X
P0/P1 식별 → 시드·코드 개선 →
2차 실행 → 점수 Y.Y (Y - X = 개선폭)
P0 잔여 시 → 3차 → ...
평균 4.0 도달 시 종료
```

## 시나리오 → Tool 매핑

| ID | 1차 호출 Tool | 입력 |
|----|-------------|------|
| C01 | evaluate_observation | observation="슬럼프 175mm", testId="test.slump" |
| C02 | evaluate_observation | observation="7일 압축강도 18MPa, 호칭 24MPa", testId="test.compressive_strength" |
| C03 | evaluate_observation | observation="압축강도 1회 시험값 21MPa, 호칭 24MPa", testId="test.compressive_strength" |
| C04 | evaluate_observation | observation="기둥 거푸집 해체용 압축강도 7MPa", criterionId(기대)="criteria.formwork_removal_column_5mpa" |
| C05 | evaluate_observation OR discover_relevant_domain | observation="외기온도 3℃" / situation="내일 외기 3℃ 시공" |
| C06 | evaluate_observation | observation="외기 28℃ 운반시간 95분" |
| C07 | evaluate_observation | observation="슬래브 거푸집 해체용 압축강도 16MPa, fck 24MPa" |
| C08 | evaluate_observation OR analyze_nonconformance(없음) | "코어 4개 평균 22 최저 17, fck 24" |
| C09 | discover_relevant_domain | "타설 중 비. 표면 고인 물 처리" |
| C10 | search_construction_standards | query="기온보정값 Tn 표 2.2-1" |
| C11 | compile_ncr_references | ncrId="ncr.cold_joint" workType="work.concrete_placement" |
| C12 | search_quality_ontology + verify_quality_basis | query="fcn fcr fck fcm" |
| C13 | discover_relevant_domain | "한중 양생온도가 콘크리트 온도인지 외기인지" |
