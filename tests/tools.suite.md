# Suite: tools (MCP 도구 회귀 검증 — 행동 계약 정의)

> 이 파일은 agent-quality-oss MCP 도구의 **행동 계약(behavioral contract)** 을 명시적으로 인코딩한 회귀 검증 정의다.
> "무엇이 올바른가"의 단일 진원지(SSoT) — 입력→기대 출력의 누적 계약을 한 곳에 기록한다.
>
> **실행체(runner)는 `scripts/smoke-test.ts`** 이다. 이 파일은 *정의*만 담는다 — 중복 실행 코드를 새로 만들지 않는다.
> 각 케이스의 `smoke_case` 필드가 `scripts/smoke-test.ts` 의 `CASES` 배열 1-based 인덱스에 1:1 대응한다.
> 무결성 게이트는 `tests/suite-coverage.test.mjs` 가 담당한다 (suite ↔ 실제 등록 도구 ↔ smoke 정합).

```yaml
meta:
  suite: tools
  purpose: 46개 MCP 도구가 한국 건설 품질관리 도메인 지식을 올바르게 공급하는가 (입력→기대 출력의 행동 계약)
  module: src/tools/* (LEGACY_MODULES, src/tool-registry.ts 등록)
  runner_impl: scripts/smoke-test.ts   # CASES 배열 = 실행체. 이 suite 는 정의-자산
  total_cases: 87
  tools_registered: 46
  tools_covered: 30                     # 87 케이스가 커버하는 고유 도구 수 (나머지 16개는 점진 확장 대상)
  types: [code]
  shared_contract: |
    모든 도구 응답은 공통 스키마를 만족해야 한다 (smoke-test.ts 의 schemaOk 게이트 = 전 케이스 공통 전제):
      - result 가 존재
      - basis[] 가 비어있지 않음 (lineage 근거)
      - lineage.toolName == 호출 도구명
      - lineage.ontologyVersion == graph.version
      - lineage.contentHash 길이 64 + contentHashAlgo == 'sha256'
      - humanCheckpoint.legalNote 에 "최종 판정과 법적 책임" 포함
    이 공통 계약은 케이스별 contract.then 에 중복 기재하지 않는다 (전제로 간주).
```

---

## 그룹 A — 온톨로지 탐색·공종 해석·프로파일 (discovery)

> search_quality_ontology / resolve_worktype / get_work_quality_profile / get_material_quality_profile
> "자연어 표현 → 표준 도메인 노드" 해석과 공종/자재 프로파일 조회의 올바름.

## TC-tools-001 (type: code)

```yaml
id: TC-tools-001
suite: tools
type: code
tool: search_quality_ontology
intent: 자연어 공종 표현으로 온톨로지를 검색하면 일치 노드가 최상위로 반환되는가
contract:
  given: query="슬래브 타설"
  when: search_quality_ontology 호출
  then: matchCount > 0 이고 matches[0].id == 'work.concrete_placement'
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 1
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-002 (type: code)

```yaml
id: TC-tools-002
suite: tools
type: code
tool: search_quality_ontology
intent: 시험 항목 키워드가 해당 TestItem 노드로 검색되는가
contract:
  given: query="슬럼프"
  when: search_quality_ontology 호출
  then: matches 안에 id == 'test.slump' 인 노드가 존재
severity: P2
origin: spec
status: active
runner: a-qa
smoke_case: 2
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-003 (type: code)

```yaml
id: TC-tools-003
suite: tools
type: code
tool: resolve_worktype
intent: 자재명을 포함한 자연어 입력이 표준 공종으로 해석되고 관련 시험이 연결되는가
contract:
  given: input="레미콘 타설"
  when: resolve_worktype 호출
  then: resolved.id == 'work.concrete_placement' 이고 relatedTests 에 id == 'test.slump' 포함
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 3
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-004 (type: code)

```yaml
id: TC-tools-004
suite: tools
type: code
tool: resolve_worktype
intent: "'콘크리트' 단독 입력이 도로포장이 아닌 구조체 타설로 우선 해석되는가 (alias 우선순위 회귀)"
contract:
  given: input="콘크리트"
  when: resolve_worktype 호출
  then: resolved.id == 'work.concrete_placement' (concrete_pavement 가 아님 — '콘크리트' alias exact 매칭 1.0)
severity: P1
origin: regression   # P4 회귀 보호 (smoke 주석 명시)
status: active
runner: a-qa
smoke_case: 4
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-005 (type: code)

```yaml
id: TC-tools-005
suite: tools
type: code
tool: get_work_quality_profile
intent: 콘크리트 타설 공종의 전체 품질 프로파일(자재/시험/검측/리스크)이 기대 규모로 반환되는가
contract:
  given: workType="콘크리트 타설"
  when: get_work_quality_profile 호출
  then: materials.length > 0 이고 tests.length >= 5 이고 inspectionCheckpoints.length == 3 이고 qualityRisks.length >= 6
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 5
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-006 (type: code)

```yaml
id: TC-tools-006
suite: tools
type: code
tool: get_material_quality_profile
intent: 자재(레미콘)의 시험·관련공종·부적합 프로파일이 올바르게 연결되는가
contract:
  given: material="레미콘"
  when: get_material_quality_profile 호출
  then: tests.length >= 5 이고 relatedWorks 에 id == 'work.concrete_placement' 포함이고 possibleNonconformance.length > 0
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 6
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-026 (type: code)

```yaml
id: TC-tools-026
suite: tools
type: code
tool: search_quality_ontology
intent: 철근 키워드가 철근배근 공종 노드로 검색되는가
contract:
  given: query="철근"
  when: search_quality_ontology 호출
  then: matches 안에 id == 'work.rebar_placement' 포함
severity: P2
origin: spec
status: active
runner: a-qa
smoke_case: 26
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-027 (type: code)

```yaml
id: TC-tools-027
suite: tools
type: code
tool: search_quality_ontology
intent: 철강구조물 키워드가 철골 제작 공종 노드로 검색되는가
contract:
  given: query="철강구조물"
  when: search_quality_ontology 호출
  then: matches 안에 id == 'work.steel_fabrication' 포함
severity: P2
origin: spec
status: active
runner: a-qa
smoke_case: 27
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-028 (type: code)

```yaml
id: TC-tools-028
suite: tools
type: code
tool: get_work_quality_profile
intent: 콘크리트 타설 프로파일의 최소 자재·시험 보장 (경량 회귀)
contract:
  given: workType="콘크리트 타설"
  when: get_work_quality_profile 호출
  then: materials.length > 0 이고 tests.length >= 5
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 28
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-051 (type: code)

```yaml
id: TC-tools-051
suite: tools
type: code
tool: resolve_worktype
intent: 거푸집 입력이 거푸집·동바리 공종으로 해석되는가 (KCS 14 20 12 verified 시드 회귀)
contract:
  given: input="거푸집"
  when: resolve_worktype 호출
  then: resolved.id == 'work.formwork_shoring'
severity: P1
origin: regression
status: active
runner: a-qa
smoke_case: 51
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-055 (type: code)

```yaml
id: TC-tools-055
suite: tools
type: code
tool: resolve_worktype
intent: 철근 입력이 철근배근 공종으로 해석되는가 (KCS 14 20 11 + 별표2 회귀)
contract:
  given: input="철근"
  when: resolve_worktype 호출
  then: resolved.id == 'work.rebar_placement'
severity: P1
origin: regression
status: active
runner: a-qa
smoke_case: 55
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-057 (type: code)

```yaml
id: TC-tools-057
suite: tools
type: code
tool: get_work_quality_profile
intent: 철근 공종 프로파일에 자재·검측 체크포인트가 최소 1건 이상 연결되는가
contract:
  given: workType="철근"
  when: get_work_quality_profile 호출
  then: materials.length >= 1 이고 inspectionCheckpoints.length >= 1
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 57
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-058 (type: code)

```yaml
id: TC-tools-058
suite: tools
type: code
tool: resolve_worktype
intent: 토공 입력이 토공사 공종으로 해석되는가 (별표2 시험종목 커버리지 회귀)
contract:
  given: input="토공"
  when: resolve_worktype 호출
  then: resolved.id == 'work.earthwork'
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 58
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-059 (type: code)

```yaml
id: TC-tools-059
suite: tools
type: code
tool: get_work_quality_profile
intent: 토공사 프로파일에 시험·검측 체크포인트가 충분히 연결되는가
contract:
  given: workType="토공사"
  when: get_work_quality_profile 호출
  then: tests.length >= 4 이고 inspectionCheckpoints.length >= 1
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 59
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-060 (type: code)

```yaml
id: TC-tools-060
suite: tools
type: code
tool: search_quality_ontology
intent: 다짐 키워드가 흙다짐 시험 노드로 검색되는가
contract:
  given: query="다짐"
  when: search_quality_ontology 호출
  then: matches 안에 id == 'test.soil_compaction' 포함
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 60
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-061 (type: code)

```yaml
id: TC-tools-061
suite: tools
type: code
tool: resolve_worktype
intent: 철골 입력이 철강구조물 공종으로 해석되는가 (KCS 14 31 skeleton 회귀)
contract:
  given: input="철골"
  when: resolve_worktype 호출
  then: resolved.id == 'work.steel_fabrication'
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 61
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-062 (type: code)

```yaml
id: TC-tools-062
suite: tools
type: code
tool: search_quality_ontology
intent: 용접 키워드가 철골 용접부 검사 시험 노드로 검색되는가
contract:
  given: query="용접"
  when: search_quality_ontology 호출
  then: matches 안에 id == 'test.steel_weld_inspection' 포함
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 62
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-063 (type: code)

```yaml
id: TC-tools-063
suite: tools
type: code
tool: resolve_worktype
intent: 가설기자재 입력이 해당 공종으로 해석되는가 (안전인증기준 skeleton 회귀)
contract:
  given: input="가설기자재"
  when: resolve_worktype 호출
  then: resolved.id == 'work.temporary_equipment'
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 63
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-064 (type: code)

```yaml
id: TC-tools-064
suite: tools
type: code
tool: get_work_quality_profile
intent: 가설기자재 프로파일에 시험이 최소 1건 연결되는가
contract:
  given: workType="가설기자재"
  when: get_work_quality_profile 호출
  then: tests.length >= 1
severity: P3
origin: regression
status: active
runner: a-qa
smoke_case: 64
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-065 (type: code)

```yaml
id: TC-tools-065
suite: tools
type: code
tool: resolve_worktype
intent: 아스팔트 포장 입력이 도로포장 공종으로 해석되는가 (KCS 44 skeleton 회귀)
contract:
  given: input="아스팔트 포장"
  when: resolve_worktype 호출
  then: resolved.id == 'work.road_pavement'
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 65
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-066 (type: code)

```yaml
id: TC-tools-066
suite: tools
type: code
tool: search_quality_ontology
intent: 마샬 키워드가 아스팔트 마샬 안정도 시험 노드로 검색되는가
contract:
  given: query="마샬"
  when: search_quality_ontology 호출
  then: matches 안에 id == 'test.asphalt_marshall' 포함
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 66
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-067 (type: code)

```yaml
id: TC-tools-067
suite: tools
type: code
tool: resolve_worktype
intent: 흙댐 입력이 수공구조물 공종으로 해석되는가 (KCS skeleton 회귀)
contract:
  given: input="흙댐"
  when: resolve_worktype 호출
  then: resolved.id == 'work.hydraulic_structure'
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 67
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-068 (type: code)

```yaml
id: TC-tools-068
suite: tools
type: code
tool: search_quality_ontology
intent: 투수 키워드가 흙 투수 시험 노드로 검색되는가
contract:
  given: query="투수"
  when: search_quality_ontology 호출
  then: matches 안에 id == 'test.soil_permeability' 포함
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 68
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-069 (type: code)

```yaml
id: TC-tools-069
suite: tools
type: code
tool: resolve_worktype
intent: 방수 입력이 방수 공종으로 해석되는가 (건축 마감 별표2 회귀)
contract:
  given: input="방수"
  when: resolve_worktype 호출
  then: resolved.id == 'work.waterproofing'
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 69
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-070 (type: code)

```yaml
id: TC-tools-070
suite: tools
type: code
tool: search_quality_ontology
intent: 열전도율 키워드가 단열재 열전도율 시험 노드로 검색되는가
contract:
  given: query="열전도율"
  when: search_quality_ontology 호출
  then: matches 안에 id == 'test.thermal_conductivity' 포함
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 70
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-071 (type: code)

```yaml
id: TC-tools-071
suite: tools
type: code
tool: resolve_worktype
intent: 도장 입력이 도장 공종으로 해석되는가
contract:
  given: input="도장"
  when: resolve_worktype 호출
  then: resolved.id == 'work.painting'
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 71
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-072 (type: code)

```yaml
id: TC-tools-072
suite: tools
type: code
tool: resolve_worktype
intent: 조적 입력이 조적 공종으로 해석되는가 (리뷰 보강 공종 회귀)
contract:
  given: input="조적"
  when: resolve_worktype 호출
  then: resolved.id == 'work.masonry'
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 72
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-073 (type: code)

```yaml
id: TC-tools-073
suite: tools
type: code
tool: resolve_worktype
intent: 창호 입력이 창호 공종으로 해석되는가
contract:
  given: input="창호"
  when: resolve_worktype 호출
  then: resolved.id == 'work.window'
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 73
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-074 (type: code)

```yaml
id: TC-tools-074
suite: tools
type: code
tool: resolve_worktype
intent: "'콘크리트 포장' 입력이 도로포장(콘크리트) 공종으로 해석되는가 (단독 '콘크리트' 와 구분)"
contract:
  given: input="콘크리트 포장"
  when: resolve_worktype 호출
  then: resolved.id == 'work.concrete_pavement'
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 74
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-075 (type: code)

```yaml
id: TC-tools-075
suite: tools
type: code
tool: search_quality_ontology
intent: 벽돌 키워드가 벽돌 강도 시험 노드로 검색되는가
contract:
  given: query="벽돌"
  when: search_quality_ontology 호출
  then: matches 안에 id == 'test.brick_strength' 포함
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 75
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-076 (type: code)

```yaml
id: TC-tools-076
suite: tools
type: code
tool: search_quality_ontology
intent: 토목섬유 키워드가 토목섬유 강도 시험 노드로 검색되는가
contract:
  given: query="토목섬유"
  when: search_quality_ontology 호출
  then: matches 안에 id == 'test.geotextile_strength' 포함
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 76
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-077 (type: code)

```yaml
id: TC-tools-077
suite: tools
type: code
tool: resolve_worktype
intent: 상수도관 입력이 관 부설 공종으로 해석되는가 (상하수도 별표2 회귀)
contract:
  given: input="상수도관"
  when: resolve_worktype 호출
  then: resolved.id == 'work.pipe_laying'
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 77
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-078 (type: code)

```yaml
id: TC-tools-078
suite: tools
type: code
tool: get_work_quality_profile
intent: 상수도관 프로파일에 관 강도 시험이 연결되는가 (usesMaterial→material→requiresTest 경로 회귀)
contract:
  given: workType="상수도관"
  when: get_work_quality_profile 호출
  then: tests 안에 id == 'test.pipe_strength' 포함
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 78
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-079 (type: code)

```yaml
id: TC-tools-079
suite: tools
type: code
tool: resolve_worktype
intent: 화장판 입력이 기타 마감 공종으로 해석되는가 (건축 기타 별표2 회귀)
contract:
  given: input="화장판"
  when: resolve_worktype 호출
  then: resolved.id == 'work.misc_finishing'
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 79
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-080 (type: code)

```yaml
id: TC-tools-080
suite: tools
type: code
tool: get_work_quality_profile
intent: 화장판 프로파일에 화장판 시험이 연결되는가
contract:
  given: workType="화장판"
  when: get_work_quality_profile 호출
  then: tests 안에 id == 'test.deco_panel' 포함
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 80
created_at: 2026-06-20T00:00:00+09:00
```

---

## 그룹 B — 수치 판정·리스크 추론 (inference)

> infer_quality_risks / evaluate_observation
> 관측값을 AcceptanceCriteria 로 판정(PASS/FAIL/MARGINAL/UNDETERMINED)하고, 환각을 차단하는 핵심 로직.
> 수치 경계 처리·환각 방지가 이 그룹의 가장 중요한 검증 지점이다.

## TC-tools-007 (type: code)

```yaml
id: TC-tools-007
suite: tools
type: code
tool: infer_quality_risks
intent: 슬럼프 초과 관측값이 단일 FAIL 리스크로 판정되고 즉시조치·휴먼체크포인트가 연결되는가
contract:
  given: workType="콘크리트 타설", observations=["슬럼프 210mm"]
  when: infer_quality_risks 호출
  then: inferredRisks.length == 1 이고 risk.id == 'risk.slump_out_of_range' 이고 summary.fail == 1
        이고 nonconformance 에 'ncr.slump_too_high' 포함 + 'ncr.slump_too_low' 미포함
        이고 첫 NCR 에 owner·approver 존재 이고 immediateActions 에 'action.hold_delivery' 포함
        이고 humanCheckpoint.required == true
severity: P0
origin: spec
status: active
runner: a-qa
smoke_case: 7
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-008 (type: code)

```yaml
id: TC-tools-008
suite: tools
type: code
tool: infer_quality_risks
intent: 슬럼프 미달 관측값이 too_low 방향 FAIL 로 정확히 판정되는가 (방향 구분)
contract:
  given: workType="콘크리트 타설", observations=["슬럼프 50mm"]
  when: infer_quality_risks 호출
  then: summary.fail == 1 이고 nonconformance 에 'ncr.slump_too_low' 포함 + 'ncr.slump_too_high' 미포함
severity: P0
origin: spec
status: active
runner: a-qa
smoke_case: 8
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-009 (type: code)

```yaml
id: TC-tools-009
suite: tools
type: code
tool: infer_quality_risks
intent: 기준 내 슬럼프(160mm)가 PASS 로 판정되고 리스크·휴먼체크포인트가 없는가
contract:
  given: workType="콘크리트 타설", observations=["슬럼프 160mm"]
  when: infer_quality_risks 호출
  then: summary.pass == 1 이고 summary.fail == 0 이고 inferredRisks.length == 0 이고 humanCheckpoint.required == false
severity: P0
origin: spec
status: active
runner: a-qa
smoke_case: 9
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-010 (type: code)

```yaml
id: TC-tools-010
suite: tools
type: code
tool: infer_quality_risks
intent: 경계값 근처 슬럼프(174mm)가 MARGINAL 로 분류되고 휴먼체크포인트가 발동되는가 (경계 처리)
contract:
  given: workType="콘크리트 타설", observations=["슬럼프 174mm"]
  when: infer_quality_risks 호출
  then: summary.marginal == 1 이고 humanCheckpoint.required == true
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 10
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-011 (type: code)

```yaml
id: TC-tools-011
suite: tools
type: code
tool: infer_quality_risks
intent: 복수 관측값(염화물 FAIL + 공기량 PASS)이 각각 독립적으로 판정되는가
contract:
  given: workType="콘크리트 타설", observations=["염화물 0.45 kg/㎥", "공기량 4.2%"]
  when: infer_quality_risks 호출
  then: summary.fail == 1 이고 summary.pass == 1 이고 inferredRisks 중 nonconformance 에 'ncr.chloride_excess' 포함하는 항목 존재
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 11
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-012 (type: code)

```yaml
id: TC-tools-012
suite: tools
type: code
tool: infer_quality_risks
intent: 관측값 없이 호출 시 baseline 모드로 전체 잠재 리스크 목록을 반환하는가 (판정 단언 없음)
contract:
  given: workType="콘크리트 타설" (observations 미제공)
  when: infer_quality_risks 호출
  then: result.mode == 'baseline' 이고 inferredRisks.length == 9 이고 humanCheckpoint.required == false
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 12
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-038 (type: code)

```yaml
id: TC-tools-038
suite: tools
type: code
tool: evaluate_observation
intent: 슬럼프 초과 관측이 FAIL(too_high) expertAssessment 로 반환되고 적용기준·법적근거·다음단계가 포함되는가
contract:
  given: observation="슬럼프 210mm", criterionId="criteria.slump_general_150"
  when: evaluate_observation 호출
  then: expertAssessment.verdict == 'FAIL' 이고 direction == 'too_high'
        이고 applicableCriterion 에 "150 ± 25" 포함 이고 expertContext 에 "베테랑" 포함
        이고 candidateNonconformance.length > 0 이고 suggestedNextSteps.length >= 2
        이고 legalBasis 에 'standard.kcs_14_20.10.1_7_3' 포함
severity: P0
origin: spec
status: active
runner: a-qa
smoke_case: 38
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-039 (type: code)

```yaml
id: TC-tools-039
suite: tools
type: code
tool: evaluate_observation
intent: 기준 내 슬럼프(160mm)가 PASS 로 평가되고 경계경고·후보NCR 가 없는가
contract:
  given: observation="슬럼프 160mm", criterionId="criteria.slump_general_150"
  when: evaluate_observation 호출
  then: expertAssessment.verdict == 'PASS' 이고 marginalWarning == null 이고 candidateNonconformance.length == 0
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 39
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-040 (type: code)

```yaml
id: TC-tools-040
suite: tools
type: code
tool: evaluate_observation
intent: 경계값 슬럼프(174mm)가 PASS 이면서 marginalWarning.flagged 가 켜지는가
contract:
  given: observation="슬럼프 174mm", criterionId="criteria.slump_general_150"
  when: evaluate_observation 호출
  then: expertAssessment.verdict == 'PASS' 이고 marginalWarning.flagged == true
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 40
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-041 (type: code)

```yaml
id: TC-tools-041
suite: tools
type: code
tool: evaluate_observation
intent: 수치로 환원 불가한 정성 관측(곰보)이 UNDETERMINED 로 반환되고 휴먼체크포인트가 발동되는가 (환각 방지)
contract:
  given: observation="곰보 발견", criterionId="criteria.slump_general_150"
  when: evaluate_observation 호출
  then: expertAssessment.verdict == 'UNDETERMINED' 이고 humanCheckpoint.required == true
severity: P0
origin: spec
status: active
runner: a-qa
smoke_case: 41
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-052 (type: code)

```yaml
id: TC-tools-052
suite: tools
type: code
tool: infer_quality_risks
intent: 거푸집 해체강도 미달(4MPa)이 조기탈형 부적합 FAIL 로 판정되는가 (KCS 14 20 12 회귀)
contract:
  given: workType="거푸집 및 동바리", observations=["거푸집 해체강도 4MPa"]
  when: infer_quality_risks 호출
  then: summary.fail == 1 이고 inferredRisks 중 nonconformance 에 'ncr.formwork_premature_stripping' 포함하는 항목 존재
severity: P1
origin: regression
status: active
runner: a-qa
smoke_case: 52
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-053 (type: code)

```yaml
id: TC-tools-053
suite: tools
type: code
tool: infer_quality_risks
intent: 거푸집 해체강도 충족(6MPa)이 PASS 로 판정되는가
contract:
  given: workType="거푸집 및 동바리", observations=["거푸집 해체강도 6MPa"]
  when: infer_quality_risks 호출
  then: summary.pass == 1 이고 summary.fail == 0
severity: P1
origin: regression
status: active
runner: a-qa
smoke_case: 53
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-054 (type: code)

```yaml
id: TC-tools-054
suite: tools
type: code
tool: evaluate_observation
intent: 거푸집 측면 강도 미달(4MPa)이 too_low FAIL 로 평가되고 KCS 14 20 12 근거가 인용되는가
contract:
  given: observation="거푸집 측면 강도 4MPa", criterionId="criteria.formwork_strip_side"
  when: evaluate_observation 호출
  then: expertAssessment.verdict == 'FAIL' 이고 direction == 'too_low'
        이고 applicableCriterion 에 "5 MPa" 포함 이고 legalBasis 에 'standard.kcs_14_20.12.3_3' 포함
severity: P1
origin: regression
status: active
runner: a-qa
smoke_case: 54
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-056 (type: code)

```yaml
id: TC-tools-056
suite: tools
type: code
tool: infer_quality_risks
intent: 철근 항복강도 관측이 시험항목은 식별하되 수치 미확보 시 UNDETERMINED 로 남는가 (환각 방지 — KS D 3504 미확보)
contract:
  given: workType="철근 배근", observations=["철근 항복강도 350MPa"]
  when: infer_quality_risks 호출
  then: judgments[0].matched == true 이고 judgments[0].verdict == 'UNDETERMINED' 이고 summary.undetermined == 1
severity: P0
origin: regression
status: active
runner: a-qa
smoke_case: 56
created_at: 2026-06-20T00:00:00+09:00
```

---

## 그룹 C — 근거 매핑·법령·환각 검증 (basis & verification)

> map_quality_basis / list_core_quality_laws / get_quality_law_article / search_quality_management_guideline
> get_quality_guideline_article / search_construction_standards / get_standard_form_locator
> verify_quality_basis / verify_form_reference / explain_quality_decision_path / discover_relevant_domain / get_project_info
> 근거의 출처 분리(확인됨 vs 검토후보), 법령 조회, LLM 생성 문장의 근거 검증(환각 게이트)이 이 도메인 검증의 핵심이다.

## TC-tools-013 (type: code)

```yaml
id: TC-tools-013
suite: tools
type: code
tool: map_quality_basis
intent: 공종·자재·시험 입력 시 확인된 근거(공개표준)와 검토후보 근거가 분리 반환되는가
contract:
  given: workType="콘크리트 타설", material="레미콘", testItem="슬럼프"
  when: map_quality_basis 호출
  then: factualBasis·applicableBasis 가 배열이고 factualBasis 의 모든 source == 'ontology_public_standard'
        이고 applicableBasis 에 id == 'doc.mix_design' 포함 이고 humanCheckpoint.required == true
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 13
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-014 (type: code)

```yaml
id: TC-tools-014
suite: tools
type: code
tool: map_quality_basis
intent: projectContext 제공 시 보유 문서가 factualBasis(source=project, priority=1)로 승격되는가 (기준 우선순위)
contract:
  given: workType="콘크리트 타설", material="레미콘", testItem="슬럼프", projectContext={projectId:"P001", availableDocuments:["doc.mix_design"]}
  when: map_quality_basis 호출
  then: factualBasis 의 doc.mix_design 이 source=='project' priority==1 이고 applicableBasis 에 doc.project_specification 존재 이고 humanCheckpoint.required == true
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 14
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-015 (type: code)

```yaml
id: TC-tools-015
suite: tools
type: code
tool: map_quality_basis
intent: 부적합 id 입력 시 해당 NCR 의 판정 근거 표준이 factualBasis 로 반환되는가
contract:
  given: nonconformance="ncr.low_compressive_strength"
  when: map_quality_basis 호출
  then: factualBasis 의 id 집합에 'standard.kcs_14_20.10.3_3' 와 'standard.ks_f_2405' 모두 포함
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 15
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-016 (type: code)

```yaml
id: TC-tools-016
suite: tools
type: code
tool: list_core_quality_laws
intent: 핵심 품질 법령 목록이 최소 규모로 반환되고 건진법 제55조가 포함되는가
contract:
  given: 인자 없음
  when: list_core_quality_laws 호출
  then: count >= 13 이고 items 에 id == 'standard.law.btia_55' 포함
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 16
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-017 (type: code)

```yaml
id: TC-tools-017
suite: tools
type: code
tool: list_core_quality_laws
intent: category 필터(rule)가 해당 분류 항목만 반환하는가
contract:
  given: category="rule"
  when: list_core_quality_laws 호출
  then: items.length >= 3 이고 모든 항목의 category == 'rule'
severity: P2
origin: spec
status: active
runner: a-qa
smoke_case: 17
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-018 (type: code)

```yaml
id: TC-tools-018
suite: tools
type: code
tool: get_quality_law_article
intent: 법령 조항 id 조회 시 조문번호·법적구속력이 정확히 반환되는가
contract:
  given: articleId="standard.law.btia_55"
  when: get_quality_law_article 호출
  then: article.articleNo == '55' 이고 article.legalWeight == 'mandatory'
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 18
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-019 (type: code)

```yaml
id: TC-tools-019
suite: tools
type: code
tool: get_quality_law_article
intent: 존재하지 않는 조항 id 조회 시 null 반환 + 휴먼체크포인트 발동되는가 (환각 방지)
contract:
  given: articleId="standard.law.nonexistent"
  when: get_quality_law_article 호출
  then: article == null 이고 humanCheckpoint.required == true
severity: P0
origin: spec
status: active
runner: a-qa
smoke_case: 19
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-020 (type: code)

```yaml
id: TC-tools-020
suite: tools
type: code
tool: search_quality_management_guideline
intent: 품질관리 업무지침을 편(part) 번호로 검색하면 해당 편 조항만 반환되는가
contract:
  given: part="제2편"
  when: search_quality_management_guideline 호출
  then: count >= 5 이고 모든 항목의 part 에 "제2편" 포함
severity: P2
origin: spec
status: active
runner: a-qa
smoke_case: 20
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-021 (type: code)

```yaml
id: TC-tools-021
suite: tools
type: code
tool: get_quality_guideline_article
intent: 업무지침 조항 id 조회 시 조문번호가 정확히 반환되는가
contract:
  given: articleId="standard.guideline.part2_art7"
  when: get_quality_guideline_article 호출
  then: article.articleNo == '7'
severity: P2
origin: spec
status: active
runner: a-qa
smoke_case: 21
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-022 (type: code)

```yaml
id: TC-tools-022
suite: tools
type: code
tool: search_construction_standards
intent: 국가건설기준을 시리즈(KCS)로 검색하면 해당 시리즈 섹션만 반환되는가
contract:
  given: series="KCS"
  when: search_construction_standards 호출
  then: count >= 4 이고 모든 항목 id 가 'standard.kcs_' 로 시작
severity: P2
origin: spec
status: active
runner: a-qa
smoke_case: 22
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-023 (type: code)

```yaml
id: TC-tools-023
suite: tools
type: code
tool: get_standard_form_locator
intent: 법정 별지 서식 locator 가 라이선스·재배포 주의 문구와 함께 반환되는가 (원본 미포함 명시)
contract:
  given: formId="standard.form.rule_no42_quality_inspection_register"
  when: get_standard_form_locator 호출
  then: form.license 에 "Type 4" 포함 이고 form.redistributionNote 에 "포함되지 않는다" 포함
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 23
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-024 (type: code)

```yaml
id: TC-tools-024
suite: tools
type: code
tool: get_standard_form_locator
intent: 자연어 query 로 서식을 검색하면 표준 서식 id 목록이 반환되는가
contract:
  given: query="품질관리계획"
  when: get_standard_form_locator 호출
  then: forms.length >= 1 이고 forms[0].id 가 'standard.form.' 로 시작
severity: P2
origin: spec
status: active
runner: a-qa
smoke_case: 24
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-025 (type: code)

```yaml
id: TC-tools-025
suite: tools
type: code
tool: map_quality_basis
intent: 발주기관(agencyId) 제공 시 기관 기준이 우선순위 1의 근거로 반영되는가
contract:
  given: workType="콘크리트 타설", agencyId="agency.lh"
  when: map_quality_basis 호출
  then: result.agency.id == 'agency.lh' 이고 factualBasis 의 agency.lh 가 priority==1 이고 approverRole 에 "LH" 포함
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 25
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-042 (type: code)

```yaml
id: TC-tools-042
suite: tools
type: code
tool: verify_quality_basis
intent: 강한 단정 표현("반드시")이 근거 불충분 시 unsupported_strong_claim 으로 차단되는가 (환각 게이트)
contract:
  given: statement="콘크리트 공사는 반드시 KCS 14 20에 따라 수행해야 한다.", claimedBasisIds=["standard.kcs_14_20"]
  when: verify_quality_basis 호출
  then: triggeredStrongTerms 에 "반드시" 포함 이고 verification == 'unsupported_strong_claim' 이고 humanCheckpoint.required == true
severity: P0
origin: spec
status: active
runner: a-qa
smoke_case: 42
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-043 (type: code)

```yaml
id: TC-tools-043
suite: tools
type: code
tool: verify_quality_basis
intent: 의무 법령 근거가 뒷받침된 문장이 supported 로 통과되는가
contract:
  given: statement="품질관리계획서는 법령상 의무이다.", claimedBasisIds=["standard.law.btia_55", "standard.law.btia_decree_89"]
  when: verify_quality_basis 호출
  then: verification == 'supported' 이고 hasMandatoryBasis == true
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 43
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-044 (type: code)

```yaml
id: TC-tools-044
suite: tools
type: code
tool: verify_quality_basis
intent: 존재하지 않는 근거 id 가 섞이면 partial_hallucination 으로 탐지되고 무효 개수가 집계되는가
contract:
  given: statement="슬럼프 기준은 일반적으로 150±25mm 범위에서 관리된다.", claimedBasisIds=["standard.nonexistent_fake_id", "standard.kcs_14_20"]
  when: verify_quality_basis 호출
  then: verification == 'partial_hallucination' 이고 invalidCount == 1
severity: P0
origin: spec
status: active
runner: a-qa
smoke_case: 44
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-045 (type: code)

```yaml
id: TC-tools-045
suite: tools
type: code
tool: get_project_info
intent: 프로젝트 공식 크레딧·라이선스·법적 면책 문구가 정확히 반환되는가 (출처 표기 정합)
contract:
  given: 인자 없음
  when: get_project_info 호출
  then: license == 'MIT' 이고 providedBy.nameKo 와 developedBy.nameKo 가 공식 크레딧과 일치
        이고 legalDisclaimer 에 "법적 책임은 품질관리자" 포함
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 45
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-046 (type: code)

```yaml
id: TC-tools-046
suite: tools
type: code
tool: discover_relevant_domain
intent: 자연어 상황 입력이 주공종·전문가 가이드·도메인 패키지로 묶여 반환되는가 (길잡이)
contract:
  given: situation="오늘 슬래브 콘크리트 타설"
  when: discover_relevant_domain 호출
  then: primaryWorkType.id == 'work.concrete_placement' 이고 expertGuidance.length > 0 이고 domainPackage.WorkType.length > 0
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 46
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-047 (type: code)

```yaml
id: TC-tools-047
suite: tools
type: code
tool: explain_quality_decision_path
intent: 엔티티 id 입력 시 결정 추론 경로(TestItem→AcceptanceCriteria 등)가 단계로 반환되는가 (why 설명)
contract:
  given: entityId="ncr.slump_too_high"
  when: explain_quality_decision_path 호출
  then: path 가 배열이고 length >= 3 이며 type 에 'TestItem' 과 'AcceptanceCriteria' 가 각각 포함
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 47
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-048 (type: code)

```yaml
id: TC-tools-048
suite: tools
type: code
tool: verify_form_reference
intent: 잘못된 별지 명칭 인용이 name_mismatch 로 탐지되고 올바른 명칭이 제시되는가 (환각 방지)
contract:
  given: claim="시행규칙 별지 제42호 점검결과 통보서"
  when: verify_form_reference 호출
  then: verification.status == 'name_mismatch' 이고 matchedForm.correctName 에 "품질검사 실시대장" 포함
severity: P0
origin: spec
status: active
runner: a-qa
smoke_case: 48
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-049 (type: code)

```yaml
id: TC-tools-049
suite: tools
type: code
tool: verify_form_reference
intent: 올바른 form id 인용이 verified 로 통과되는가
contract:
  given: formId="standard.form.rule_no42_quality_inspection_register"
  when: verify_form_reference 호출
  then: verification.status == 'verified' 이고 matchedForm.correctName 에 "품질검사 실시대장" 포함
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 49
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-050 (type: code)

```yaml
id: TC-tools-050
suite: tools
type: code
tool: list_core_quality_laws
intent: 모든 도구 응답에 nextSteps 데코레이터가 자동 첨부되고 후속 도구를 제안하는가 (공통 데코레이터)
contract:
  given: 인자 없음 (대표로 list_core_quality_laws 사용)
  when: list_core_quality_laws 호출
  then: nextSteps 가 배열이고 length > 0 이며 nextSteps[0].tool == 'get_quality_law_article'
severity: P2
origin: spec
status: active
runner: a-qa
smoke_case: 50
created_at: 2026-06-20T00:00:00+09:00
```

---

## 그룹 D — 양식 스키마·근거 컴파일·A2UI 렌더 (forms & compile)

> get_*_schema / compile_*_references / render_quality_form / compose_writing_context
> 법정문서 양식의 필수 필드 구조, 작업 1회분 근거 패키지 묶음, A2UI 입력폼 렌더의 올바름.

## TC-tools-029 (type: code)

```yaml
id: TC-tools-029
suite: tools
type: code
tool: get_ncr_schema
intent: NCR 양식 스키마에 승인(approval) 섹션과 approver·effectivenessCheck 필드가 포함되는가
contract:
  given: 인자 없음
  when: get_ncr_schema 호출
  then: schemaId == 'ncr' 이고 approval 섹션의 fields 에 'approver' 와 'effectivenessCheck' 가 각각 존재
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 29
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-030 (type: code)

```yaml
id: TC-tools-030
suite: tools
type: code
tool: get_concrete_delivery_record_schema
intent: sectionKey 필터로 특정 섹션만 반환되고 해당 필드(slumpMm)가 포함되는가
contract:
  given: sectionKey="tests"
  when: get_concrete_delivery_record_schema 호출
  then: sections.length == 1 이고 sections[0].fields 에 name == 'slumpMm' 필드 존재
severity: P2
origin: spec
status: active
runner: a-qa
smoke_case: 30
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-031 (type: code)

```yaml
id: TC-tools-031
suite: tools
type: code
tool: get_itp_schema
intent: ITP 스키마의 pointType 필드가 Hold/Witness 점검 유형 체계를 포함하는가
contract:
  given: 인자 없음
  when: get_itp_schema 호출
  then: activities 섹션의 pointType 필드 type 에 'H'(Hold)와 'W'(Witness)가 포함
severity: P2
origin: spec
status: active
runner: a-qa
smoke_case: 31
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-032 (type: code)

```yaml
id: TC-tools-032
suite: tools
type: code
tool: get_specimen_record_schema
intent: 공시체 기록지 스키마에 specimens 섹션이 존재하는가
contract:
  given: 인자 없음
  when: get_specimen_record_schema 호출
  then: sections 에 key == 'specimens' 섹션 존재
severity: P2
origin: spec
status: active
runner: a-qa
smoke_case: 32
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-033 (type: code)

```yaml
id: TC-tools-033
suite: tools
type: code
tool: get_test_report_review_schema
intent: 시험성적서 검토 스키마에 보관연속성(custody) 섹션이 존재하는가
contract:
  given: 인자 없음
  when: get_test_report_review_schema 호출
  then: sections 에 key == 'custody' 섹션 존재
severity: P2
origin: spec
status: active
runner: a-qa
smoke_case: 33
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-034 (type: code)

```yaml
id: TC-tools-034
suite: tools
type: code
tool: compile_concrete_pour_references
intent: 콘크리트 타설 1회 근거 패키지에 합격기준·법령·양식 스키마가 모두 묶여 반환되는가
contract:
  given: 인자 없음
  when: compile_concrete_pour_references 호출
  then: acceptanceCriteria.length >= 5 이고 legalReferences 에 'standard.guideline.part3' 포함
        이고 forms.deliveryRecord.schemaId == 'concrete_delivery_record' 이고 forms.specimenRecord.schemaId == 'specimen_record'
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 34
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-035 (type: code)

```yaml
id: TC-tools-035
suite: tools
type: code
tool: compile_inspection_references
intent: 검측 입회 근거 패키지가 단계(during) 필터로 체크포인트·ITP·입회 법령을 묶어 반환되는가
contract:
  given: workType="콘크리트 타설", stage="during"
  when: compile_inspection_references 호출
  then: checkpoints.length == 1 이고 checkpoints[0].stage == 'during' 이고 forms.itp.schemaId == 'itp'
        이고 legalReferences 에 'standard.law.btia_55' 포함
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 35
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-036 (type: code)

```yaml
id: TC-tools-036
suite: tools
type: code
tool: compile_ncr_references
intent: NCR id 기반 근거 패키지에 owner·approver·즉시조치·양식이 묶이고 휴먼체크포인트가 발동되는가
contract:
  given: ncrId="ncr.slump_too_high"
  when: compile_ncr_references 호출
  then: ncrs[0].owner 에 "품질관리자" 포함 이고 approver 에 "감리원" 포함 이고 immediateActions.length >= 3
        이고 formSchema.schemaId == 'ncr' 이고 humanCheckpoint.required == true
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 36
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-037 (type: code)

```yaml
id: TC-tools-037
suite: tools
type: code
tool: compile_ncr_references
intent: 시험 id 입력 시 해당 시험에서 발생 가능한 NCR 이 패키지에 포함되는가
contract:
  given: testId="test.compressive_strength"
  when: compile_ncr_references 호출
  then: ncrs 에 id == 'ncr.low_compressive_strength' 인 항목 포함
severity: P1
origin: spec
status: active
runner: a-qa
smoke_case: 37
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-081 (type: code)

```yaml
id: TC-tools-081
suite: tools
type: code
tool: render_quality_form
intent: 문서 양식(itp)이 A2UI 입력폼(JSONL 메시지 2개)으로 렌더되는가
contract:
  given: docId="itp"
  when: render_quality_form 호출
  then: fieldCount >= 1 이고 messages.length == 2 이고 surfaceId == 'quality_form_itp'
severity: P1
origin: regression
status: active
runner: a-qa
smoke_case: 81
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-082 (type: code)

```yaml
id: TC-tools-082
suite: tools
type: code
tool: compose_writing_context
intent: 빈 입력값으로 작성 컨텍스트 생성 시 Markdown 이 나오고 필수 누락이 검출되는가 (완성 여부 판정)
contract:
  given: docId="ncr", formValues={}
  when: compose_writing_context 호출
  then: markdown 이 문자열이고 missingRequired.length > 0 이고 complete == false
severity: P1
origin: regression
status: active
runner: a-qa
smoke_case: 82
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-083 (type: code)

```yaml
id: TC-tools-083
suite: tools
type: code
tool: get_quality_plan_schema
intent: 품질관리 계획서 스키마가 정상 반환되는가 (법정문서 커버리지 회귀)
contract:
  given: 인자 없음
  when: get_quality_plan_schema 호출
  then: schemaId == 'quality_plan' 이고 sections.length >= 1
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 83
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-084 (type: code)

```yaml
id: TC-tools-084
suite: tools
type: code
tool: render_quality_form
intent: 부적합 조치결과 확인서가 A2UI 폼으로 렌더되는가
contract:
  given: docId="nc_corrective_result"
  when: render_quality_form 호출
  then: fieldCount >= 1 이고 surfaceId == 'quality_form_nc_corrective_result'
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 84
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-085 (type: code)

```yaml
id: TC-tools-085
suite: tools
type: code
tool: compose_writing_context
intent: 품질검사 성과 총괄표의 작성 컨텍스트가 Markdown 으로 생성되고 필수 누락이 검출되는가
contract:
  given: docId="quality_inspection_summary", formValues={}
  when: compose_writing_context 호출
  then: markdown 이 문자열이고 missingRequired.length > 0
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 85
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-086 (type: code)

```yaml
id: TC-tools-086
suite: tools
type: code
tool: render_quality_form
intent: 시정조치 요구서(CAR)가 A2UI 폼으로 렌더되는가 (커버리지 19/19 완성 회귀)
contract:
  given: docId="corrective_action_request"
  when: render_quality_form 호출
  then: fieldCount >= 1 이고 surfaceId == 'quality_form_corrective_action_request'
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 86
created_at: 2026-06-20T00:00:00+09:00
```

## TC-tools-087 (type: code)

```yaml
id: TC-tools-087
suite: tools
type: code
tool: get_quality_audit_report_schema
intent: 품질감사 보고서 스키마가 정상 반환되는가 (커버리지 19/19 완성 회귀)
contract:
  given: 인자 없음
  when: get_quality_audit_report_schema 호출
  then: schemaId == 'quality_audit_report' 이고 sections.length >= 1
severity: P2
origin: regression
status: active
runner: a-qa
smoke_case: 87
created_at: 2026-06-20T00:00:00+09:00
```

---

## 미커버 도구 (점진 확장 대상)

> 아래 16개 도구는 현재 smoke-test.ts(이 suite)에 회귀 케이스가 없다. silent 누락 방지를 위해 명시한다.
> `tests/suite-coverage.test.mjs` 가 이 목록을 자동 집계·출력한다 (커버리지 부재 자체는 fail 아님 — 확장 대상).
> 신규 케이스 추가 시 위 그룹 D(스키마·컴파일)에 TC-tools-{nnn} 으로 등록하고 smoke-test.ts 에도 실행체를 추가한다.

```yaml
uncovered_tools:
  # 양식 스키마 (12)
  - get_qc_assignment_notice_schema
  - get_quality_test_plan_schema
  - get_quality_inspection_register_schema
  - get_inspection_request_schema
  - get_quality_inspection_summary_schema
  - get_nc_corrective_result_schema
  - get_quality_inspection_report_schema
  - get_test_request_schema
  - get_inspection_checklist_schema
  - get_material_source_approval_schema
  - get_quality_daily_log_schema
  - get_corrective_action_request_schema
  # 근거 컴파일 (4)
  - compile_qc_assignment_notice_references
  - compile_quality_test_plan_references
  - compile_quality_inspection_register_references
  - compile_inspection_request_references
```
