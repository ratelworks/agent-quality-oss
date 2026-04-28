# 부족분 분석 — 콘크리트·레미콘 시드 vs SOURCES.md 1차 자료

> 일자: 2026-04-25
> 방법: 시드 JSON 모든 entity의 reference/derivedFrom을 KCS 14 20 시리즈 본문(`evaluation/sources/kcs_14_20_01.txt`)과 1:1 대조

## A. 잘못된 인용 (즉시 정정 — 인용 정정 게이트)

| 시드 ID | 현재 reference | 실제 출처 | 비고 |
|---------|---------------|---------|------|
| `criteria.slump_general_150` | `KCS 14 20 10 §3.2` | **§2.2.7 표 2.2-5 표준값 + §1.7.3 표 1.7-2 허용오차** | §3.2는 운반. 슬럼프 표준값/허용오차는 별도 |
| `criteria.air_content_general` | `KCS 14 20 10 §3.2 표 1.7-3` | **§1.7.4 (1) + §3.5.3.1 표 3.5-2** | **표 1.7-3은 슬럼프 플로 허용오차표** — 완전 오인용 |
| `criteria.air_content_lightweight` | 동일 | 동일 정정 | |
| `criteria.air_content_pavement` | 동일 | 동일 정정 | |
| `criteria.air_content_high_strength` | 동일 | 동일 정정 | |
| `criteria.chloride_limit_030` | `§3.2, KS F 2515` | **§1.8.1 (2) + KS F 4009 부속서 A** | §3.2 아님. KS F 2515는 시험법, 기준 출처 X |
| `criteria.compressive_strength_design` | `§3.3` | **§3.5.3.2 표 3.5-3** | §3.3은 타설. 강도 판정은 §3.5.3.2 |
| `criteria.concrete_temperature_general` | `KCS 14 20 10` | **§·표 번호 본문에서 미발견** | 5~35℃ 범위 출처 검증 필요. 추측 가능성 |
| `criteria.unit_water_content_project` | `업무지침 2024-638호 / KCS 14 20 10` | **§3.5.3.1 표 3.5-2 + 업무지침 호수 검증** | 2024-638호는 검증 미실시. 2025-311호와 다른 개정인지 |
| `ncr.cold_joint` `basisPriority` | `[doc.structural_drawing, kcs_14_20.10]` | **+ §3.3.2(8) 표 3.3-1 이어치기 시간** + §1.4 용어 정의 | 콜드조인트 직접 근거 누락 |
| `ncr.honeycomb` `basisPriority` | 동일 | + §3.3.3 다지기 + §3.5.5.2 표면상태 검사 | |
| `ncr.surface_crack` `basisPriority` | 동일 | + §3.3.4 침하균열 + §3.4 양생 | |

## B. 시드 미반영 핵심 영역 (SOURCES.md A~L + 본문 추가 발견)

| 영역 | 정확 출처 | 현재 시드 | 갭 |
|------|---------|---------|------|
| **A1** 운반시간 25℃↑ 1.5h | §3.2(3) | X | criterion + TestItem(test.delivery_time) |
| **A2** 운반시간 25℃↓ 2h | §3.2(3) | X | criterion |
| **B** 이어치기 시간 표 3.3-1 (25℃ 2h/2.5h) | §3.3.2(8) | X | criterion |
| **C** 자유낙하 1.5m 이하 | §3.3.2(9) | X | inspection rule |
| **D1** 압축강도 ≤35MPa 연속 3회 평균 | §3.5.3.2 표 3.5-3 | X | criterion + multi-value parser |
| **D2** ≤35MPa 1회 ≥ fcn − 3.5MPa | 동일 | X | criterion |
| **D3** >35MPa 1회 ≥ fcn × 90% | 동일 | X | criterion |
| **D4** 호칭강도품질기준강도 = max(fck, 내구성기준강도) | §2.2.2(3) + §1.4 | X | Glossary 또는 meta 강제 |
| **E1** 슬럼프 표준값 표 2.2-5 (RC 80~150 / 단면큰 60~120 / NRC 50~150 / 단면큰 50~100) | §2.2.7 | △ 단일값(150)만 | 4종 criterion 분리 |
| **E2** 슬럼프 허용오차 표 1.7-2 (호칭 25 ±10 / 50,65 ±15 / 80↑ ±25) | §1.7.3 | △ ±25 단일 | 호칭별 분기 |
| **E3** 슬럼프 플로 허용오차 표 1.7-3 (500/600/700 별 ±75/±100/±100) | §1.7.3 | X | criterion |
| **E4** 공기량 §1.7.4 보통 4.5 / 경량 5.5 / 포장 4.5 / 고강도 3.5↓, ±1.5% | §1.7.4 | △ reference만 잘못 | 정정 |
| **E5** 단위수량 전 배치 검사 | 표 3.5-2 | △ reference만 잘못 | 정정 |
| **E6** 펌퍼빌리티 80% 이하 | 표 3.5-2 | X | criterion + TestItem |
| **E7** 단위용적질량 KS F 2409 | 표 3.5-2 | X | TestItem + 출처 |
| **E8** 슬럼프 플로 시험 KS F 2594 | §3.5.3.1 표 3.5-2 | X | TestItem |
| **F** 현장양생 < 표준양생 × 85% → 양생 개선 | §3.5.5.6(4) | X | criterion + comparison ops |
| **G** 코어 §3.5.5.7 (4) 평균 85% AND 각각 75% | §3.5.5.7 | X | criterion 2종 + multi-value parser |
| **H1** 거푸집 측면 5MPa 이상 | §3.3.1 | X | criterion + 부재 키워드 라우팅 |
| **H2** 슬래브·보 단층 fck×2/3 + 14MPa | §3.3.1 | X | criterion |
| **H3** 슬래브·보 다층 fck 이상 | §3.3.1 | X | criterion |
| **H4** 내구성 중요 거푸집널 10MPa | §3.3.1(3) | X | criterion |
| **H5** 시험 안 할 시 재령 표 (시멘트·기온별) | §3.3.1 | X | reference table |
| **H6** 4일 양생 + 동바리 유지 옵션 | §3.3.1(5) | X | criterion |
| **H7** 최소 3개층 동바리 | §3.3.2(2) | X | inspection rule |
| **I** 한중 적용 하루평균 4℃↓ | KCS 14 20 40 §1.1(2) | X | WorkType + criterion |
| **J1** 한중 양생 5℃ 유지 | §3.4.1(4) | X | criterion |
| **J2** 도달 후 2일간 0℃↑ | 동일 | X | criterion |
| **K** 기온보정 Tn 표 2.2-1 | §2.2.2 | X | reference table (결합재·재령·온도 3D) |

**SOURCES.md K 단순화 발견**: 4~8℃ 6MPa, 8~18℃ 3MPa로 적었으나 실제 표는 **결합재 종류 × 재령(28/42/56/91일) × 예상평균기온** 3차원. 한중 보정값은 재령 28일 경우만 유효. 단순 적용 시 환각.

## C. SOURCES.md에도 빠진 본문 영역 (추가 발견)

| 영역 | 출처 | 비고 |
|------|------|------|
| **§1.4 용어 정의 50+개** | KCS 14 20 10 §1.4 | 배합강도(fcr) / 품질기준강도 / 호칭강도(fcn) / 콜드조인트 / 보온양생 / 블리딩 / 잔골재율 등 — Glossary entity 신설 필요 |
| **§1.7.1 표 1.7-1** 레디믹스트 종류 매트릭스 | KCS 14 20 10 | 호칭강도·굵은골재·슬럼프 조합 |
| **§1.8.1(3) 0.60 kg/㎥ 예외** | 염화물 | 책임기술자 승인 시 상향 가능 — 시드 누락 |
| **§2.2.2 식 2.2-2/2.2-3 배합강도** | KCS 14 20 10 | 35MPa 분기 (D 영역과 동일 룰을 배합강도에도 적용) |
| **§2.2.4 굵은 골재 최대치수 표 2.2-4** | KCS 14 20 10 | Material 영역 |
| **§2.2.8 잔골재율 ±0.20** | KCS 14 20 10 | 배합 보완 트리거 |
| **§3.4.2 습윤 양생 / §3.4.3 온도제어** | KCS 14 20 10 | 양생 시드 부재 |
| **§3.5.5.6** 현장양생 공시체 제작 (실험실과 동일 시간·시료) | KCS 14 20 10 | 시드 부재 |
| **§3.5.5.8 재하시험** | KCS 14 20 10, KDS 14 20 90 | 시드 부재 |
| **§3.6 이음** (수평·연직·신축·균열유발) | KCS 14 20 10 | 시드 부재 — 콜드조인트와 직결 |
| **§3.3.3 다지기·진동기 간격** | KCS 14 20 10 | inspection 부재 |

## D. NCR 미커버 영역

| NCR | 사유 | 우선도 |
|-----|------|:----:|
| **`ncr.water_added_on_site`** (가수) | 위반 행위. 운반시간·슬럼프 NCR과 연결 | ⭐⭐⭐ |
| **`ncr.delivery_time_exceeded`** (운반시간 초과) | §3.2(3) 직접 근거 | ⭐⭐⭐ |
| **`ncr.material_segregation`** (재료분리) | §3.3.2(4) | ⭐⭐ |
| **`ncr.frost_damage`** (동결피해) | 한중 §3.4.1 | ⭐⭐ |
| **`ncr.specimen_curing_invalid`** (공시체 양생 부적합) | KS F 2403 / §3.5.5.6 | ⭐⭐ |
| **`ncr.fine_aggregate_ratio_drift`** (잔골재율 ±0.20 초과) | §2.2.8(3) | ⭐ |
| **`ncr.compressive_strength_statistical_fail`** (통계 판정 불합격) | §3.5.3.2 (D 영역과 직결) | ⭐⭐⭐ |
| **`ncr.formwork_premature_removal`** (조기 거푸집 해체) | §3.3.1 | ⭐⭐⭐ |
| **`ncr.core_strength_fail`** (코어 평가 불합격) | §3.5.5.7(4) | ⭐⭐ |

## E. Material 시드 부족 (NCR 원인 분석 사슬 단절)

현재: `material.ready_mixed_concrete` 1종

빠진 핵심:
- **시멘트** 6종 (포틀랜드 1·2·5종, 조강, 고로슬래그 1·2종, 플라이애시 1·2종, 포졸란 A·B종) — H5 표·표 2.2-1 Tn 표가 시멘트 종류 분기
- **잔골재** (Fine aggregate)
- **굵은골재** (Coarse aggregate, 최대치수 §2.2.4)
- **혼화재**: AE제, 감수제, 유동화제, 플라이애시, 고로슬래그, 실리카퓸, 분리저감제 (§1.4 정의)
- **배합수** (§1.4 정의)
- **방청제** (§1.4 정의)

→ NCR 가수, 슬럼프 변동, 강도 부족 등의 `possibleCauses`가 자재 노드를 가리켜야 추론 사슬이 의미 있음.

## F. WorkType 분기 부족

현재: `work.concrete_placement` 1종

KCS 14 20 시리즈 기준 빠진 것:
- `work.cold_weather_concrete` (KCS 14 20 40)
- `work.hot_weather_concrete` (KCS 14 20 41)
- `work.high_strength_concrete` (KCS 14 20 42, 40MPa↑)
- `work.mass_concrete` (KCS 14 20 43)
- `work.watertight_concrete` (KCS 14 20 44 수밀)
- `work.formwork_falsework` (KCS 14 20 12 거푸집·동바리 — 별도 공종)
- `work.curing` (KCS 14 20 10 §3.4 양생)
- `work.expansion_joint` (§3.6.7 신축이음)

→ 한중·서중·고강도·매스는 별도 공종. work.concrete_placement 하위 task로만 두면 시험·검측·NCR이 본 공종에 묶이지 않음.

## G. 코드 레벨 부족 (a-codex 지적 + 추가)

| 코드 | 부족분 |
|------|--------|
| `parse-observation.ts` | 멀티값 인식 X (예: "평균 22 최저 17"). 호칭/fck 자연어 추출 X. 시간(95분) 단위 추출 X |
| `evaluate.ts` | 통계 판정 (n≥3 평균/단봉) 모드 부재. 부재 키워드 라우팅 부재 |
| `tools/evaluate-observation.ts` | criterion 자동 선택 시 부재(기둥/슬래브/측면) 키워드로 라우팅 안 함 |
| `ontology/resolver.ts` | search threshold 부재 — "fcn fcr fck"가 "광역자치단체"와 매칭(score 0.413)되는 환각 |
| `tools/_response.ts` | `sourceStatus: skeleton/indirect_source` 라벨 노출 메커니즘 X |
| `tools/discover-relevant-domain.ts` | 한중·서중·강우 등 알림성 키워드 인식 X (도메인 노드 0건 시 안내 부재) |
| `tools/verify-quality-basis.ts` | 의미 검증 X (id 실존만). reference 문자열의 §·표 번호 정확성 검증 X |

## H. 메트릭/시나리오 부족 (a-codex 지적 보강)

| 항목 | 현재 | 보강 |
|------|------|------|
| 채점 기준 | 5점 평균 | + PASS율 / **false PASS율** / 근거 오인용률 / no_match 적절 차단률 |
| 시나리오 수 | 13개 | + 30~50개 + 갭 1개씩 처리 시 인과 추적 가능 |
| 자동 채점 | 없음 (수동) | `expectedBasisIds[]`·`expectedVerdict` 필드로 자동 채점 |
| 환각 검증 | verify_quality_basis | + reference 문자열 자체의 §·표 정확성 게이트 |

## 종합 — 시드 작업 진입 전 의무 게이트 3개

a-codex 권고 그대로:

### 게이트 1 — 인용 정정 (Section A 11건)
- 9개 criteria + 3개 NCR의 reference/derivedFrom을 §·표 번호 정확하게 정정
- §3.2 → §2.2.7 표 2.2-5 / §3.5.3.1 표 3.5-2 / §1.7.3 표 1.7-2 등 분리
- §1.4 용어 정의에 근거하지 않은 reference는 `meta.referenceVerified: false` 표시 → verify_quality_basis가 차단

### 게이트 2 — 메트릭 보강
- `_dogfood-r02.mjs`에 `expectedBasisIds[]`·`expectedVerdict` 추가
- 자동 채점 함수: PASS율 / false PASS율 / 근거 오인용률(시드 reference vs 출력 basis) / no_match 적절 차단률

### 게이트 3 — sourceStatus 라벨 노출
- `_response.ts` 또는 각 Tool에서 `meta.sourceStatus`(verified/skeleton/indirect_source)을 응답 visible 영역에 강제 출력
- 사용자가 "왜 이거 안 잡혀요" 항의를 사전 차단

## I. 1차 작업 후 점진 개입 순서 (a-codex 권고 반영)

```
게이트 1·2·3
        ↓
D1 (압축강도 통계, 표 3.5-3 주2 max(fck, 내구성기준강도) 포함)
        ↓ Round 02-r1 측정 (false PASS=0 확인)
D5 (운반시간) — C06 false PASS 직격
        ↓ Round 02-r2
D2 (거푸집 해체)
        ↓ Round 02-r3
D8-threshold (search 매칭 score threshold)
        ↓ Round 02-r4
D3 (한중, indirect_source 라벨)
        ↓ Round 02-r5
D4·D6·D7 (코어·Tn·강우)
        ↓ Round 02-r6
용어 정의 Glossary (Section C §1.4)
        ↓ Round 02-r7
Material 6종·WorkType 변종 (§2.2.4·§3.4·§3.6)
```
