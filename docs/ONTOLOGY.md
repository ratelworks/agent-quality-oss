# 온톨로지 가이드 (Ontology Guide)

`agent-quality-oss` 의 품질관리 온톨로지 구조와 확장 방법입니다. 기여(공종·자재·시험·검측 추가)를 시작하기 전에 읽어 주세요.

## 설계 원칙

- **그래프가 SSoT** — 모든 도구 응답의 근거(`basis[]`)는 그래프 노드(IRI)에서 나옵니다. 코드가 그래프를 우회해 사실을 만들지 않습니다.
- **정확성 > 양** — 출처가 확인되지 않은 값은 지어내지 않고 `skeleton`(미확정)으로 둡니다. 별표2로 확인되는 시험종목·방법·빈도는 `verified`.
- **공공 표준 코드로 만난다** — 노드 id·관계명은 이 저장소의 `quality:` 접두를 쓰고, 다른 건설 도메인(안전·환경)과는 국토교통부 건설정보분류체계 공종(W) 코드 대응(`src/ontology/standard-bridge.json`)으로 잇습니다. 따로 공유하는 메타 온톨로지 주소는 두지 않습니다.

## 노드 타입

| 타입 | 의미 | 예시 id |
|---|---|---|
| `WorkType` | 공종 | `work.concrete_pour` · `work.rebar` |
| `Material` | 자재 | `material.concrete` · `material.rebar` |
| `TestItem` | 시험종목 | `test.slump` · `test.compressive_strength` |
| `AcceptanceCriteria` | 판정기준 (operator·threshold·condition) | `criteria.slump` |
| `QualityRisk` | 품질 리스크 | `risk.cold_joint` |
| `Nonconformance` | 부적합(NCR) | `ncr.low_compressive_strength` |
| `CorrectiveAction` | 시정조치 | `action.refinish` |
| `InspectionCheckpoint` | 검측 체크포인트 | `inspection.before_concrete_placement` |
| `Standard` | 표준·법령·지침·서식 (인용 위치) | `standard.kcs_14_20.10` · `standard.law.btia_rule_53` |
| `EvidenceDocument` | 증빙 문서 | `doc.test_certificate` |

전체 통계는 `npm run validate:ontology` 출력의 `byType` 으로 확인합니다.

## 핵심 관계

```text
WorkType  --usesMaterial-->        Material   --requiresTest-->  TestItem
WorkType  --hasQualityRisk-->      QualityRisk --mayCause-->     Nonconformance
WorkType  --hasInspectionCheckpoint--> InspectionCheckpoint
TestItem  --hasAcceptanceCriteria/appliesTo--> AcceptanceCriteria
Nonconformance --correctiveActions--> CorrectiveAction
Nonconformance --requiresEvidence-->  EvidenceDocument
* --derivedFrom/basisPriority/requiresStandard--> Standard
```

`get_work_quality_profile` 은 `usesMaterial → material → requiresTest` 경로로 시험을 탐색합니다(리스크 경로 아님). 새 공종을 추가할 때 이 사슬이 끊기지 않도록 자재·시험을 함께 연결해야 합니다.

## 데이터 위치

온톨로지 노드는 **JSON-LD** 형식으로 타입별 디렉토리에 **1노드 = 1파일**로 저장됩니다 (자매 프로젝트 agent-safety-oss 와 동일 구조).

```text
src/ontology/graph/
├── context.jsonld                    @context (IRI 프리픽스·타입·관계 정의)
└── nodes/
    ├── work_types/*.jsonld           WorkType
    ├── materials/*.jsonld            Material
    ├── tests/*.jsonld                TestItem
    ├── criteria/*.jsonld             AcceptanceCriteria
    ├── risks/*.jsonld                QualityRisk
    ├── nonconformances/*.jsonld      Nonconformance
    ├── corrective_actions/*.jsonld   CorrectiveAction
    ├── inspections/*.jsonld          InspectionCheckpoint
    ├── standards/*.jsonld            Standard
    └── ...                           (14개 타입 폴더)
```

각 노드 파일: `@id`(IRI, 예 `work:concrete_placement`) · `@type` · 관계(IRI 참조 배열, 예 `usesMaterial: ["material:ready_mixed_concrete"]`) · `_meta`. 로더가 IRI 를 단축 id(`work.concrete_placement`)로 역변환해 in-memory 그래프를 구성합니다. 문서 양식 구조는 `src/schemas/document-schemas.json` 에 별도로 있습니다.

## 근거 등급 (sourceStatus)

| 값 | 의미 |
|---|---|
| `verified` | 별표2·법령 본문과 1:1 대조 완료 |
| `indirect_source` | 간접 인용 — 호수·발행기관 검증 미완 |
| `skeleton` | 출처 미확정 — 재인용 금지 (예: KCS/KS 원문 미확보 판정 수치) |

노드의 `_meta.sourceStatus` 로 표기하며, 판정 수치(`AcceptanceCriteria.threshold`)가 원문 미확보면 `threshold: null` + `sourceStatus: "skeleton"` 으로 둡니다.

## 새 공종 추가 절차

1. `src/ontology/graph/nodes/work_types/{id}.jsonld` 에 `WorkType` 노드 추가 — `@id`(예 `work:새공종`) · `@type: "WorkType"` · 관계(`usesMaterial` · `hasInspectionCheckpoint` · `hasQualityRisk`, IRI 참조 배열) 연결.
2. 연결 대상(`Material` · `TestItem` · `AcceptanceCriteria` · `QualityRisk` · `Nonconformance` · `InspectionCheckpoint`)을 각 타입 폴더에 `.jsonld` 노드로 추가.
3. 시험종목·방법·빈도는 출처(별표2 등)를 `_meta.verifiedAgainst` 에 명시하고 `_meta.sourceStatus: "verified"`. 판정 수치 원문이 없으면 `skeleton`.
4. `nodes/standards/{id}.jsonld` 에 인용할 표준(KCS/KS/법령) 식별자 노드를 추가 (원문 텍스트 금지 — 식별자·제목만).
5. 검증:
   ```bash
   npm run build
   npm run validate:ontology   # orphan/dangling 0 확인
   npm run validate:shapes     # 형태 정의(SHACL) · RDF 대조 · 역관계
   npm run smoke               # 회귀 케이스
   ```
6. `scripts/smoke-test.ts` 에 회귀 케이스(`resolve_worktype` · `get_work_quality_profile` 경로)를 추가.

## 검증 게이트

- **무결성**: `validate:ontology` — 깨진 참조(dangling)·고립 노드(orphan)를 0 으로 유지.
- **표준 표현**: `validate:shapes` — 아래 "표준 검증" 절의 세 가지를 0 으로 유지.
- **회귀**: `smoke` — 공종·시험·양식 경로가 깨지지 않는지.
- **공개 위생**: `check:oss-hygiene` — 내부 용어·경로·PII 차단.

PR 은 위 네 게이트를 통과해야 합니다.

## 현장 표현

현장 말("레미콘이 질다")과 자료의 말("슬럼프 기준 초과")은 낱말이 다릅니다. 이 둘을 잇는 자료가 `src/ontology/field-phrases.json` 입니다.

| 항목 | 내용 | 예 |
|---|---|---|
| `terms` | 현장 말 → 표준 말. 찾을 때 문장에 덧붙입니다 | `들밀도` → `현장밀도` |
| `rowTerms` | 품질시험기준(업무지침 별표 2)에서만 쓰는 표기. 그 표의 행을 찾을 때만 덧붙입니다 | `철근` → `철근콘크리트용봉강` |
| `phrases` | 노드·조문이 걸리는 상황을 현장 말로 적은 글. 키는 노드 id 또는 `법령 id:조문` | `ncr.honeycomb` → "거푸집을 떼니 곰보가 났다" |

- 현장 표현은 찾는 데만 쓰고 답에는 내보내지 않습니다. 노드와 조문의 내용을 읽고 쓴 편집 글이며, 법령의 뜻을 풀이한 글이 아닙니다.
- 새 노드를 넣을 때 현장에서 부르는 말이 이름과 다르면 `phrases` 에 두세 문장을 더합니다. 노드 이름과 같은 말은 넣지 않습니다(이름은 이미 찾는 글에 들어 있습니다).
- 고친 뒤에는 `npm run test:field-questions` 로 확인합니다 — 자료가 가리키는 노드·조문이 있는지, 품질과 상관없는 문장에 엉뚱한 답이 나오지 않는지, 질문 묶음의 적중률이 내려가지 않았는지 봅니다.
- 질문 묶음은 `scripts/test/fixtures/field-questions*.json` 입니다. 현장에서 실제로 받은 질문을 정답(노드·조문·시험기준 행)과 함께 보내 주시면 가장 큰 도움이 됩니다.

## 표준 검증

그래프는 JSON-LD 로 적혀 있어 다른 RDF 도구에서 그대로 읽을 수 있습니다. 그 약속이 지켜지는지 `npm run validate:shapes` 가 표준 도구로 확인합니다.

| 확인 | 무엇을 보나 |
|---|---|
| 형태 정의 (SHACL) | 표준 SHACL 엔진으로 노드 전체를 검증 — 노드 종류·주소 규칙·이름, 관계의 출발·도착 종류, 종류별 필수 관계(공종의 근거 기준, 판정 기준이 나온 표준, 부적합의 조치·근거 우선순위 등) |
| RDF 대조 | 그래프를 RDF 로 옮겼다가 되돌려 원본과 견줌 — 맥락 정의에 없는 속성, 주소가 아닌 관계 값, 겹친 별칭처럼 옮기다 사라지는 값을 찾음 |
| 역관계 | 짝을 이루는 관계가 양쪽에 다 적혀 있는지 — `requiresTest`↔`targetMaterial`, `hasAcceptanceCriteria`↔`appliesTo`, `hasInspectionCheckpoint`↔`relatedWork`(검측), `possibleNonconformance`↔`relatedTest`(시험·부적합) |

- 형태 정의 파일은 `src/ontology/shapes/quality-shapes.ttl` 입니다. 코드의 정의(노드 종류·관계의 출발·도착 종류)에서 만들므로 직접 고치지 않고 `npm run generate:shapes` 로 다시 만듭니다.
- 이름은 `schema:name`, 별칭은 `skos:altLabel`, `_meta` 는 JSON 값(`rdf:JSON`), 근거 우선순위(`basisPriority`)는 순서가 있는 목록으로 옮겨집니다.
- 그래프 전체를 RDF(N-Quads)로 받으려면 `npm run -s export:rdf > quality-graph.nq`.
- 직접 고친 노드 폴더를 볼 때는 `QUALITY_NODES_DIR=<폴더> npm run validate:shapes`.
