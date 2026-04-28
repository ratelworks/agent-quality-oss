# Round 02 Baseline (r0) — 콘크리트·레미콘 dogfooding 시드 개선 전

> 일자: 2026-04-25
> 시나리오: `evaluation/round-02-scenarios.md` C01~C13
> 채점 기준: SOURCES.md A~L 영역 정확성

## 점수표

| ID | 시나리오 | verdict | observed | 채점 근거 | 점수 |
|----|---------|---------|---------|----------|:----:|
| C01 | 슬럼프 175mm = 150+25 | PASS marginal | 175 | 정확. comparison "허용치 경계 ±2.5mm 이내" | **4.5** |
| C02 | 7일 18MPa, 호칭 24 | UNDETERMINED | 18 | threshold null. **재령 7일 인식 X, "호칭 24" 자연어 추출 X** | 2.0 |
| C03 | 1회 21MPa, 호칭 24 | UNDETERMINED | 21 | **1회 -3.5MPa 룰 (≥20.5) 미적용** | 2.0 |
| C04 | 기둥 측면 해체 7MPa | UNDETERMINED | 7 | **기둥 측면 5MPa 시드 X** | 1.5 |
| C05 | 외기 3℃, 한중 적용? | (domain 0) | - | **한중 키워드·시드 X**. domainPackage 전부 빈 배열 | 1.0 |
| C06 | 외기 28℃ 운반 95분 | PASS in_range | 28 | "외기 환기" 메시지는 OK. **운반시간 95분 자체 평가는 없음, 28℃를 콘크리트 온도로 단순 매칭** | 2.0 |
| C07 | 슬래브 16MPa, fck 24 | UNDETERMINED | 16 | **슬래브 fck×2/3 + 14MPa 시드 X** | 1.5 |
| C08 | 코어 평균 22, 최저 17, fck 24 | UNDETERMINED | 22 | **§3.5.5.7 코어 평균 85% AND 각각 75% 시드 X. 멀티값 인식 X** | 1.0 |
| C09 | 강우 빗물 고임 처리 | (domain 0) | - | **강우 시공 시드 X**. domainPackage 빈 배열 | 1.0 |
| C10 | 기온보정 Tn 검색 | (search 0) | - | **표 2.2-1 시드 X** | 1.0 |
| C11 | 콜드조인트 NCR | OK | - | NCR cold_joint 풀 패키지 + 양식 스키마 정상 | **4.5** |
| C12 | fck/fcn/fcr/fcm 용어 | 환각 | - | **"광역자치단체"가 0.413 score로 매칭** — substring가 "fc"의 일부 노이즈 매칭. 용어 노드 X + search threshold 부재 | 1.0 |
| C13 | 한중 양생온도 정의 | (domain 부분) | - | "콘크리트 타설"만 잡힘. **한중 양생온도 정의(콘크리트 온도, 5℃, 0℃ 2일) X** | 2.0 |

**Round 02 r0 평균: 25 / 13 ≈ 1.92 / 5.0**
- PASS (4.0↑): 2건 (C01, C11)
- 실무 갭: 11건 (84.6%)

## 갭 분류 (P0)

| 코드 | 영역 | 영향 시나리오 | 작업 |
|------|------|-------------|------|
| **P0-D1** | 압축강도 통계 판정 (KS F 4009 §7 = KCS 14 20 10 §3.5.3.2) | C02·C03·C07 (3건) | criterion 신규 + evaluator "fck/호칭 자연어 추출" + 1회/3회 룰 + 35MPa 분기 |
| **P0-D2** | 거푸집 해체 강도 (KCS 14 20 12 §3.3.1) | C04·C07 (2건) | criterion 4종 + evaluator 부재 키워드 라우팅 (기둥/슬래브/측면/내구성) |
| **P0-D3** | 한중 콘크리트 (KCS 14 20 40) | C05·C13 (2건) | WorkType + Standard 4종 + criterion 3종 (4℃ 적용/5℃ 양생/0℃ 2일) + alias 보강 |
| **P0-D4** | 코어 §3.5.5.7 평가 | C08 (1건) | criterion 2종 (avg85/each75) + multi-value 파서 |
| **P0-D5** | 운반시간 (KCS 14 20 10 §3.2(3)) | C06 (1건) | TestItem `test.delivery_time` + criterion 2종 (25℃↑ 90분 / 25℃↓ 120분) + 자연어 "운반시간 N분" 추출 |
| **P0-D6** | 기온보정 Tn 표 2.2-1 | C10 (1건) | Standard `standard.kcs_14_20.10.2_2` + reference 표 본문 |
| **P0-D7** | 강우 시공 (§3.3.2(10)) | C09 (1건) | inspection·NCR·corrective-action 시드 |
| **P0-D8** | 강도 용어 (fck/fcn/fcr/fcm) | C12 (1건) | Glossary 4종 + search 매칭 score threshold 강화 |

## 작업 우선순위

```
1차 시드 (이번 라운드): D1 → D2 → D3 → D8 (= 기존 Task 9·12·11·10 / ⭐⭐⭐)
2차 시드 (다음 라운드): D5 → D4 → D6 → D7
```

D1·D2·D3·D8 4영역만 처리해도 **C02·C03·C04·C05·C07·C12·C13** 7건이 개선 → 점수 1.92 → 추정 3.0+

## 실패 케이스 깊이 분석 (대표 C04)

**입력**: `"기둥 거푸집 해체 시점 압축강도 7MPa"`

**현재 실행 흐름**:
1. testId=`test.compressive_strength` → criterion=`criteria.compressive_strength_design`
2. operator=`ge`, threshold=null → UNDETERMINED
3. 응답: "threshold가 프로젝트 주입 대기"

**기대 흐름**:
1. observation에서 "기둥", "거푸집 해체" 키워드 인식
2. testId 또는 criterion을 `criteria.formwork_removal_side`로 라우팅 (5MPa 기준)
3. 7MPa ≥ 5MPa → PASS
4. expertContext: "기둥 측면 거푸집 해체 가능 (KCS 14 20 12 §3.3.1)"

**시드 부재 + 라우팅 부재** 두 갭 모두 채워야 4점 이상.

## 다음 단계

1. Task 9 (D1 압축강도 통계 판정) 진입 — 가장 큰 영향
2. 시드+evaluator 코드 동시 작업
3. 작업 후 Round 02-r1 측정 → 점수 비교
4. D2·D3·D8 순차 진행
