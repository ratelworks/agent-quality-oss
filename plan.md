# Agent_Quality_OSS_MCP — 개발 계획서

> **정식 명칭**: `Agent_Quality_OSS_MCP`
> **패키지/리포/서비스명**: `agent-quality-oss-mcp`
> **라이선스 트랙**: 오픈소스 (Agent_HQ 사내 제품과 분리, `dev/oss/` 하위 관리)

> **한 줄 정의 (2026-04-25 정정)**
> 한국 건설 품질관리 **도메인 전문성을 LLM에 연결**하는 MCP 서버.
> agent-safety-oss-mcp의 "전문가 레이어" 패턴을 품질 도메인에 적용.
> korean-law-mcp의 "locator·verify" 패턴을 법령·서식 인용에 차용.

> **MCP의 역할**
> LLM이 베테랑 품질관리자처럼 답할 수 있도록 도메인 지식을 6가지 형태로 공급:
> ① 도메인 관계망 ② 정량 기준 ③ 의사결정 트리 ④ 법령·기준 인용 위치 ⑤ 양식 구조 ⑥ 환각 방지.
> 답변 생성은 LLM·사용자의 책임.

---

## 0. 상위 제약 (최우선)

- **오픈소스 프로젝트**: `dev/oss/` 루트 관리. Agent_HQ 사내 제품(`Agent_*` / `agent*`) 네이밍 규칙 예외 — **kebab-case 통일** (폴더/npm/리포/서비스명 동일)
- 상위 철학 참조: [`../../Agent_HQ/PHILOSOPHY.md`](../../Agent_HQ/PHILOSOPHY.md) — Agent-first, Protocol-first, 4층 구조, A2UI, §9 체크리스트 (오픈소스라도 설계 원칙으로 차용)
- 상위 목표(사내 맥락): **건설회사 모든 직원의 에이전트화** (→ MEMORY: agenthq_ultimate_goal.md). 본 제품은 "품질관리자" 직무의 에이전트화 인프라이자, 외부에도 공개하는 오픈소스 MCP
- 개발 원칙: CLAUDE.md §0 Code-Agent 상호보완 — 기준 매핑·관계 추론=코드, 상황 판단·문서 초안=LLM
- 배포/경로: `dev/oss/agent-quality-oss-mcp/`, Cloud Run 서비스명 `agent-quality-oss-mcp`, region `asia-northeast3`, runtime `nodejs22`
- Agent_HQ 내부 에이전트는 본 MCP를 **외부 오픈소스 의존**처럼 소비 (독립 리포·독립 버저닝)

---

## 1. 제품 검증 6질문 (Agent_HQ §9 차용)

| # | 질문 | 답 |
|---|------|---|
| 1 | 누구의 어떤 일을 대체·보조하는가? | 현장 품질관리자(QC)·감리원의 **검측 계획 수립 → 체크리스트 → 시험 입회 → 성적서 검토 → 부적합 처리** 일련의 문서/판단 업무 |
| 2 | 에이전트가 이 기능을 호출·조합할 수 있는가? | MCP Tool 20종으로 노출. Claude Desktop, Agent_HQ 내부 에이전트, Agent_GitOps 의사결정 흐름 모두 소비 |
| 3 | 인간 개입(Human fallback)은 언제 왜? | (a) 부적합 판정의 **서명·승인**, (b) 시방서·설계도서 해석 충돌 시, (c) 감리/발주처 협의 필요 시. 상시 개입 아님 |
| 4 | 데이터 SSoT는? | ① 공식 기준 = 국토부 KCS/KDS, 품질관리 업무지침, KS (정적 데이터 + 주기 동기화)  ② 현장 기준 = 프로젝트별 공사시방서·설계도서·배합설계서·승인문서 (프로젝트별 스코프) |
| 5 | 경쟁/선행 제품과의 차별점은? | 기존 "시방서 검색기"는 키워드 검색 수준. 본 제품은 **온톨로지 그래프**로 공종→자재→시험→검측→리스크→부적합→시정조치→증빙을 추론 |
| 6 | 실패 조건(Kill criteria)은? | 6개월 내 ① 온톨로지 노드 1,000개 미만 ② MCP Tool 실사용 에이전트 0개 ③ 현장 PoC 프로젝트 0개 → 중단 또는 전환 |

---

## 2. 철학 매핑 (PHILOSOPHY.md §9)

### 2.1 4층 매핑

- [x] **Protocol** — MCP Tool 20종이 표준 인터페이스. 에이전트 간 위임의 1차 계약
- [x] **Runtime** — 온톨로지 그래프 탐색, 기준 매핑, RAG 검색의 실행 엔진
- [ ] **Governance** — 본 제품은 데이터·판단 근거만 제공. 승인/서명은 Agent_GitOps가 담당
- [x] **A2UI** — 부적합 판정, 기준 충돌, 현장 문서 부재 시 human checkpoint를 A2UI JSON으로 반환

### 2.2 §9 체크리스트

- [x] Agent-first — MCP Tool이 1차 인터페이스, UI는 dogfooding 용도
- [x] Protocol 매핑 — MCP JSON-RPC, 추후 A2A skill 노출
- [x] 4층 매핑 — Protocol + Runtime + A2UI
- [x] Human fallback 판정 — 부적합 판정·기준 충돌·증빙 부재 3가지 조건에서만
- [x] Lineage — 모든 Tool 응답에 `basis[]` 배열(근거 노드 ID + 출처 문서)
- [x] 직원 역할 매핑 — 품질관리자(QC)·감리원
- [x] A2UI 설계 — 결정 체크포인트는 A2UI `decision` 컴포넌트로 반환

---

## 3. 목표 (Why)

### 3.1 제품 목표

1. **도메인 전문성 공급 (Phase A 핵심)**: LLM이 베테랑처럼 답할 수 있게 6가지 형태로 지식 plug-in
2. **다층 기준 해석**: 배합설계서 > 공사시방서 > KCS/KDS > 업무지침 > KS 우선순위 (locator만 제공, 원문 X)
3. **답변 생성 회피**: Tool은 verdict·답변을 단언하지 않는다. expert reasoning(근거+비교+다음 행동) 형태로 응답해 LLM이 최종 판단 작성
4. **법정 양식 인용 검증**: 별지·고시 명칭이 정확한지 `verify_form_reference`로 환각 방지 (5차 검증 발견 — 별지 번호 오류 정정)
5. **감사 증적은 별도 MCP 분리**: `export_quality_record_payload`는 도메인 외부. 향후 `agent-quality-audit-mcp` 별도 패키지 분리 예정
6. **에이전트 호출 가능**: Claude Desktop · Agent_HQ 내부 · Agent_GitOps까지 MCP로 연동

### 3.2 비즈니스 목표 (12개월)

- 황룡건설 2개 이상 현장에서 dogfooding 가동 (Agent_HQ fleet N=1)
- 외부 건설사 1곳 PoC 진입 (N=2)
- MCP Tool 월 1,000 call 이상
- NCR 작성 시 필요한 **근거·양식·법령 패키지 제공률 95% 이상** (Tool이 쓰는 건 LLM 몫)

---

## 4. 범위 (What)

### 4.1 In-Scope (MVP)

**공종 (10개)**
콘크리트 타설, 철근 배근, 거푸집 설치/해체, 방수, 조적, 미장, 타일, 토공 다짐, 아스콘 포설

**자재 (10개)**
레미콘, 철근, 시멘트, 골재, 방수재, 타일, 모르타르, 아스콘, 단열재, 창호

**시험항목 (15개)**
슬럼프, 공기량, 염화물량, 콘크리트 온도, 압축강도, 철근 인장/항복/연신율, 다짐도, 현장밀도, 함수비, 아스콘 안정도/흐름값, 방수층 두께, 접착강도

**MCP Tool 20종** (§7 참조)

**기준 데이터 소스**
- KCS/KDS: 국가건설기준센터 (정기 다운로드 → 정적 JSON)
- 품질관리 업무지침: 국토부 고시
- KS: 국가표준 발췌본 (라이선스 범위 내)
- 현장문서: 프로젝트별 업로드 (공사시방서, 배합설계서, 설계도서, 자재승인서)

### 4.2 Out-of-Scope (MVP 제외)

- 물량 산출 (→ Agent_CQ)
- 안전관리 (→ Agent_Safety_*)
- 공정 스케줄 (→ Agent_Con)
- 시공상세도 해석 (→ 별도 프로젝트)
- 전기·설비 품질관리 (Phase 2 이후)
- RDF/OWL 표준 출력 (Phase 3 이후)

---

## 5. 아키텍처 (How)

### 5.1 시스템 구성

```
┌─────────────────────────────────────────────────────────┐
│ Consumer Layer                                          │
│  - Claude Desktop (MCP)                                 │
│  - Agent_HQ 내부 에이전트 (A2A)                         │
│  - Agent_GitOps 의사결정 흐름                           │
└─────────────────────────────────────────────────────────┘
                    │ MCP JSON-RPC / A2A
┌───────────────────▼─────────────────────────────────────┐
│ agent-quality-oss-mcp (Cloud Run: agent-quality-oss-mcp)│
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ MCP Tool     │  │ A2A Skill    │  │ Dogfooding UI│  │
│  │ Router       │  │ Router       │  │ (optional)   │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         └──────────┬──────┴─────────────────┘          │
│                    ▼                                    │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Ontology Resolver                                │  │
│  │  - resolve_worktype / material / test            │  │
│  │  - graph traversal (in-memory)                   │  │
│  └──────┬───────────────────────────────────────────┘  │
│         │                                               │
│  ┌──────▼──────┐  ┌───────────────┐  ┌──────────────┐  │
│  │ Ontology    │  │ Standards     │  │ Project Doc  │  │
│  │ Graph       │  │ Repository    │  │ RAG          │  │
│  │ (JSON)      │  │ (KCS/KDS/KS)  │  │ (Firestore   │  │
│  │             │  │               │  │  + GCS)      │  │
│  └─────────────┘  └───────────────┘  └──────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Basis Priority Engine                            │  │
│  │  배합설계서 > 시방서 > KCS > 지침 > KS            │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Guide-Rail Providers (no document generation)    │  │
│  │  - get_*_schema  (양식 필드·구조만)               │  │
│  │  - compile_*_references (재료 패키지 묶음)        │  │
│  │  - export_quality_record_payload (감사 증적)      │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Code-Agent 역할 분리

| 영역 | 담당 | 근거 |
|------|------|------|
| 온톨로지 그래프 탐색 | **코드** | 정확성·재현성 필수 |
| 기준 우선순위 적용 | **코드** | 규칙 고정 |
| 수치 범위 판정 (슬럼프 150±25 등) | **코드** | 계산 |
| 공종·자재·시험 표현 정규화 (alias → canonical id) | **코드** (1차) + **LLM** (fallback) | alias 사전 우선, 없으면 Gemini |
| 현장문서 섹션 추출 | **LLM (Gemini)** | 비정형 PDF/HWPX |
| 부적합 원인 추론 (가능 원인 후보 도출) | **LLM (Gemini)** | 맥락 해석 |
| 보고서 문장 생성 | **LLM (Gemini)** | 자연어 |
| 근거 검증 (`verify_quality_basis`) | **코드** | 환각 검출 |

### 5.3 데이터 저장

| 데이터 | 저장소 | 이유 |
|--------|--------|------|
| 온톨로지 (JSON) | 리포지터리 내 `src/ontology/data/` | 버전 관리 필수, 수천 노드 규모 |
| KCS/KDS 기준 원문 | GCS (`gs://agent-quality-oss-mcp-standards/`) | PDF·HTML 대용량 |
| KCS/KDS 인덱스 | Firestore `quality_standards` | 검색 성능 |
| KS 발췌 | Firestore `quality_ks` | 라이선스 범위 내 구조화 |
| 현장 프로젝트 문서 | GCS + Firestore `quality_projects/{projectId}/documents` | 프로젝트 스코프 |
| RAG 임베딩 | Firestore `quality_embeddings` (Vertex AI embedding) | Vertex AI Matching Engine은 Phase 2 |
| 사용 로그·Tool call | Firestore `quality_tool_calls` | Lineage |

> **Firestore naming**: `rules/firestore.md` 준수 — snake_case collection, camelCase field

---

## 6. 온톨로지 스키마 (요약)

세부 JSON 예시는 사용자 설계안(§4.1~4.5) 채택. 구현 시 `src/ontology/ontology.schema.ts`에 TypeScript 타입으로 고정.

### 6.1 엔티티 (16종)

```
Project, WorkType, Task, Material, Equipment, Standard,
Specification, TestItem, InspectionCheckpoint, AcceptanceCriteria,
QualityRisk, Nonconformance, CorrectiveAction, EvidenceDocument,
Agency, SiteRecord
```

### 6.2 핵심 관계

```
WorkType --hasTask--> Task
WorkType --usesMaterial--> Material
WorkType --requiresStandard--> Standard
WorkType --hasInspectionCheckpoint--> InspectionCheckpoint
WorkType --hasQualityRisk--> QualityRisk

Material --requiresTest--> TestItem
Material --requiresDocument--> EvidenceDocument
Material --hasAcceptanceCriteria--> AcceptanceCriteria

TestItem --hasMethod--> Standard
TestItem --hasFrequency--> AcceptanceCriteria
TestItem --hasAcceptanceCriteria--> AcceptanceCriteria

InspectionCheckpoint --isBasedOn--> Standard
InspectionCheckpoint --verifies--> QualityRisk
InspectionCheckpoint --requiresEvidence--> EvidenceDocument

QualityRisk --mayCause--> Nonconformance
Nonconformance --requires--> CorrectiveAction
CorrectiveAction --isBasedOn--> Standard

Project --hasSpecification--> Specification
Project --overrides--> Standard [by Specification]
SiteRecord --proves--> InspectionCheckpoint
```

### 6.3 엔티티 ID 규칙

```
work.*        콘크리트 타설         → work.concrete_placement
task.*        슬래브 타설 세부작업   → task.concrete_pour_slab
material.*    레미콘                → material.ready_mixed_concrete
equipment.*   콘크리트 펌프카        → equipment.concrete_pump
test.*        슬럼프                 → test.slump
inspection.*  슬래브 검측            → inspection.rebar_placement_slab
criteria.*    슬럼프 허용범위        → criteria.slump_150_25
risk.*        강도 부족              → risk.low_compressive_strength
ncr.*         슬럼프 초과            → ncr.slump_too_high
action.*      타설 보류              → action.hold_delivery
doc.*         실제 프로젝트 문서     → doc.mix_design_R123 (EvidenceDocument 인스턴스)
spec.*        특정 프로젝트 시방서   → spec.projectA_concrete (Specification 인스턴스, 글로벌 온톨로지 아님)
standard.*    KCS/KDS 섹션           → standard.kcs_14_20.10.3_2
agency.*      발주처                 → agency.procurement_service
record.*      현장 기록 인스턴스     → record.20260424_slab_a
```

> **Specification vs EvidenceDocument 구분**: `doc.*`는 "문서 **유형**" (예: "배합설계서"라는 개념), `spec.*`는 "특정 프로젝트의 시방서 **인스턴스**" (예: "A 현장 구조시방서 Rev.2"). 글로벌 온톨로지에는 `doc.*`만 존재하고, `spec.*`는 프로젝트별 Firestore에 저장된다.

---

## 7. MCP Tool 20종 명세

### 7.1 온톨로지 도구 (6)

| # | Tool | 입력 | 출력 | 구현 |
|---|------|------|------|------|
| 1 | `search_quality_ontology` | `{query}` | 매칭 엔티티 배열 | 코드 (alias 사전 + fuzzy) |
| 2 | `resolve_worktype` | `{input}` | canonical workType + confidence | 코드 + LLM fallback |
| 3 | `get_work_quality_profile` | `{workType}` | 자재/시험/검측/리스크/증빙 | 코드 (그래프 1-hop) |
| 4 | `get_material_quality_profile` | `{material}` | 시험/문서/리스크 | 코드 |
| 5 | `infer_quality_risks` | `{workType, material, observations[]}` | 리스크 배열 | 코드 (규칙) + LLM (원인 후보) |
| 6 | `map_quality_basis` | `{workType, material, testItem}` | 우선순위 기준 배열 | 코드 (Basis Priority Engine) |

### 7.2 기준 검색 도구 (4)

| # | Tool | 입력 | 출력 | 구현 |
|---|------|------|------|------|
| 7 | `search_construction_standards` | `{query, scope?}` | KCS/KDS 섹션 | RAG |
| 8 | `get_construction_standard_detail` | `{standardId, section?}` | 원문 + 메타 | Firestore lookup |
| 9 | `search_quality_management_guideline` | `{query}` | 품질관리 업무지침 섹션 | RAG |
| 10 | `search_ks_standard` | `{query}` | KS 섹션 (범위 내) | RAG |

### 7.3 품질관리 도구 (5)

| # | Tool | 입력 | 출력 | 구현 |
|---|------|------|------|------|
| 11 | `search_quality_test_items` | `{workType?, material?}` | 시험항목 + 빈도 + 방법 | 코드 |
| 12 | `validate_material_test_report` | `{material, reportText, specRef?}` | 판정 + 근거 | 코드 (수치) + LLM (추출) |
| 13 | `generate_inspection_checklist` | `{workType, projectId?}` | 체크리스트 + 근거 | 체인 |
| 14 | `analyze_nonconformance` | `{description, measurements?, workType?}` | NCR 구조화 | 체인 |
| 15 | `verify_quality_basis` | `{statement, basisIds[]}` | 근거 검증 | 코드 (환각 검출) |

### 7.4 체인 도구 (5)

| # | Tool | 흐름 |
|---|------|------|
| 16 | `chain_quality_inspection` | resolve → profile → basis → standards → checklist → verify |
| 17 | `chain_quality_test_plan` | 공종 추출 → 자재별 시험 → 빈도 매핑 → 지침 조회 → 계획서 |
| 18 | `chain_test_report_review` | 성적서 파싱 → 기준 매핑 → 수치 판정 → 리포트 |
| 19 | `chain_nonconformance_report` | 이슈 → 공종 추론 → 기준 확인 → 원인 후보 → 즉시/재발방지 |
| 20 | `chain_daily_quality_briefing` | 공사일보 → 공종별 리스크 → 내일 검측 플랜 |

### 7.5 Tool 응답 공통 스키마

```json
{
  "result": { },
  "basis": [
    { "type": "project_document", "id": "doc.mix_design.R123", "priority": 1 },
    { "type": "kcs", "id": "standard.kcs_14_20", "section": "3.2.1", "priority": 3 }
  ],
  "humanCheckpoint": {
    "required": true,
    "reason": "부적합 판정 서명 필요",
    "a2ui": { "type": "decision", "options": ["승인", "반려"] }
  },
  "lineage": { "toolCallId": "...", "ontologyVersion": "0.3.0" }
}
```

---

## 8. 기능 분해 (Milestone)

### Phase 0 — Scaffolding (1주)
- [ ] `dev/oss/agent-quality-oss-mcp/` 생성 완료, `deploy.example.json`, `dev.md`, `plan.md`, `.gitignore`, `.gcloudignore`, `LICENSE`(**MIT**), `README.md`
- [ ] prep.md 검색: MCP 서버, Firestore, Gemini 연동 패턴
- [ ] Cloud Run Node.js 22 + ESM 스캐폴딩
- [ ] `/healthz`, `/mcp` 엔드포인트 뼈대
- [ ] Firestore SDK, Vertex AI SDK 초기화
- [ ] a-git(init)

### Phase 1 — 온톨로지 MVP (2주)
- [ ] `ontology.schema.ts` (엔티티 16종, 관계 정의)
- [ ] `ontology-loader.ts` (JSON → 메모리)
- [ ] `ontology-graph.ts` (인접 리스트, BFS 탐색)
- [ ] `ontology-query.ts` (1-hop, n-hop)
- [ ] `ontology-resolver.ts` (alias → canonical)
- [ ] `ontology-validator.ts` (순환 참조·고아 노드 검출)
- [ ] **시드 데이터**: 콘크리트·철근·방수 3개 공종 전체 + 레미콘/철근/방수재 자재 + 슬럼프/공기량/염화물량/압축강도/인장 시험 + 해당 검측·리스크·NCR·증빙 (≥ 150 노드)
- [ ] Tool 1~6 구현 (온톨로지 도구)
- [ ] unit test: 노드·관계·alias 해석

### Phase 2 — 기준 데이터 수집·인덱싱 (2주)
- [ ] KCS/KDS 대상 선정 (콘크리트·철근·방수 관련 ~20개)
- [ ] 수집 스크립트 (국가건설기준센터, 저작권 확인)
- [ ] PDF → 섹션 파싱 (Gemini 사용, 1회성)
- [ ] Firestore 업로드 (`quality_standards`)
- [ ] Vertex AI embedding (섹션 단위)
- [ ] Tool 7~10 구현 (기준 검색)
- [ ] 품질관리 업무지침 인덱싱 (1개 문서)
- [ ] KS 발췌 인덱싱 (라이선스 내 10개)

### Phase 3 — 현장문서 RAG (1.5주)
- [ ] 프로젝트 모델 (`quality_projects`)
- [ ] 문서 업로드 API (서명 URL, GCS)
- [ ] 문서 파서 (PDF, HWPX → Agent_HWPX API 호출)
- [ ] 섹션 추출 + 임베딩
- [ ] Basis Priority Engine (배합설계서 > 시방서 > KCS > 지침 > KS)
- [ ] Tool 11~15 구현 (품질관리 도구)

### Phase 4 — 가이드레일 체인 (1.5주)
> 2차 교차검증 반영: "문서 생성"이 아닌 "재료 패키지 제공". 실제 문서는 LLM이 작성, 사용자가 서명.
- [ ] `get_*_schema` 양식 스키마 5종 (NCR/ITP/concrete_delivery/specimen/tr_review)
- [ ] `compile_*_references` 체인 3종 (inspection/pour/ncr)
- [ ] `export_quality_record_payload` 감사 증적 (canonical JSON + SHA-256)
- [ ] A2UI JSON 반환 (human checkpoint + legalNote 강제)
- [ ] 환각 검출 (`verify_quality_basis`)
- [ ] 샘플 템플릿: 검측체크리스트·NCR·시험계획서·일일브리핑
- [ ] Gemini 프롬프트 최적화 (thinkingConfig)

### Phase 5 — MCP·A2A 노출 + Dogfooding (1주)
- [ ] MCP stdio (공식 SDK) + HTTP REST JSON (Cloud Run). 진짜 SSE/WebSocket transport는 Phase 2+
- [ ] A2A skill 매니페스트
- [ ] Claude Desktop 연동 가이드
- [ ] 황룡건설 1개 현장 샘플 문서 업로드
- [ ] a-dogfooding Phase: 페르소나 3종 (QC 신입/경력/감리) 시뮬레이션
- [ ] 발견 이슈 → a-dev 수정 루프

### Phase 6 — 배포·운영 (0.5주)
- [ ] Pre-Deploy Security Check
- [ ] a-deploy (Cloud Run)
- [ ] a-qa (Tool 20개 계약 검증)
- [ ] saveDeployLog
- [ ] 문서 최종화

**합계: 약 10주 (2.5개월)**

---

## 9. 디렉터리 구조

```
agent-quality-oss-mcp/
├─ plan.md                    # 본 문서
├─ dev.md                     # 개발 규칙 + 철학 매핑
├─ deploy.json                # Cloud Run 배포 설정
├─ prep.md                    # (a-prep 자동 생성)
├─ package.json
├─ .gcloudignore
├─ .gitignore
│
├─ index.js                   # Cloud Run entrypoint
├─ mcp-server.js              # MCP JSON-RPC 핸들러
├─ a2a.js                     # A2A skill 정의
│
├─ src/
│  ├─ ontology/
│  │  ├─ ontology.schema.ts
│  │  ├─ ontology-loader.ts
│  │  ├─ ontology-graph.ts
│  │  ├─ ontology-query.ts
│  │  ├─ ontology-resolver.ts
│  │  ├─ ontology-validator.ts
│  │  ├─ data/
│  │  │  ├─ worktypes.json
│  │  │  ├─ tasks.json
│  │  │  ├─ materials.json
│  │  │  ├─ test-items.json
│  │  │  ├─ inspections.json
│  │  │  ├─ quality-risks.json
│  │  │  ├─ nonconformance.json
│  │  │  ├─ corrective-actions.json
│  │  │  ├─ evidence-documents.json
│  │  │  ├─ standards-map.json
│  │  │  └─ aliases.json
│  │  └─ seeds/
│  │     ├─ concrete.seed.json
│  │     ├─ rebar.seed.json
│  │     └─ waterproof.seed.json
│  │
│  ├─ tools/
│  │  ├─ search-quality-ontology.js
│  │  ├─ resolve-worktype.js
│  │  ├─ get-work-quality-profile.js
│  │  ├─ get-material-quality-profile.js
│  │  ├─ infer-quality-risks.js
│  │  ├─ map-quality-basis.js
│  │  ├─ search-construction-standards.js
│  │  ├─ get-construction-standard-detail.js
│  │  ├─ search-quality-management-guideline.js
│  │  ├─ search-ks-standard.js
│  │  ├─ search-quality-test-items.js
│  │  ├─ validate-material-test-report.js
│  │  ├─ generate-inspection-checklist.js
│  │  ├─ analyze-nonconformance.js
│  │  ├─ verify-quality-basis.js
│  │  ├─ chain-quality-inspection.js
│  │  ├─ chain-quality-test-plan.js
│  │  ├─ chain-test-report-review.js
│  │  ├─ chain-nonconformance-report.js
│  │  └─ chain-daily-quality-briefing.js
│  │
│  ├─ basis/
│  │  └─ priority-engine.js   # 배합설계서 > 시방서 > KCS > 지침 > KS
│  │
│  ├─ rag/
│  │  ├─ embedding.js         # Vertex AI embedding
│  │  ├─ search.js
│  │  └─ doc-parser.js        # PDF/HWPX → 섹션
│  │
│  ├─ gemini/
│  │  └─ client.js            # gemini-2.5-pro, thinkingConfig
│  │
│  └─ firestore/
│     ├─ standards.js
│     ├─ projects.js
│     └─ tool-calls.js
│
├─ scripts/
│  ├─ ingest-kcs.js           # 국가건설기준 수집·인덱싱
│  ├─ ingest-ks.js
│  ├─ ingest-guideline.js
│  └─ seed-ontology.js        # JSON 시드 → 메모리 로딩 검증
│
├─ docs/
│  ├─ ONTOLOGY.md
│  ├─ ONTOLOGY_SCHEMA.md
│  ├─ TOOL_SPEC.md
│  ├─ BASIS_PRIORITY.md
│  └─ MCP_INTEGRATION.md
│
└─ test/
   ├─ ontology.test.js
   ├─ tools.test.js
   └─ chains.test.js
```

---

## 10. 비기능 요구사항

| 항목 | 목표 |
|------|------|
| 응답시간 | 온톨로지 도구 < 200ms, 기준 검색 < 1s, 체인 도구 < 5s |
| 가용성 | Cloud Run 기본 (min-instance 0, 콜드스타트 허용) |
| 비용 | 월 $50 이하 (PoC 단계) |
| 보안 | 현장문서는 프로젝트별 IAM. KCS/KDS는 공개 |
| 로깅 | 모든 Tool call을 Firestore `quality_tool_calls`에 기록 (Lineage) |
| 환각 방지 | 생성 응답은 모두 `basis[]` 포함, `verify_quality_basis`로 자동 검증 |

---

## 11. 의존성

| 의존 | 용도 | 비고 |
|------|------|------|
| Firestore | 기준·프로젝트·로그·임베딩 | `agenthq-446117` |
| GCS | 원문 PDF·HWPX | `agent-quality-oss-mcp-standards`, `agent-quality-oss-mcp-projects` |
| Vertex AI | embedding (`text-embedding-004`) + Gemini | `asia-northeast3` |
| Gemini | gemini-2.5-pro (판단·추출·생성), gemini-2.5-flash (경량) | `gemini-prompt-engineering` 스킬 참조 |
| Agent_HWPX | HWPX 파싱 | `~/.claude/skills/hwpx` |
| MCP SDK | `@modelcontextprotocol/sdk` ^1.29.0 | stdio (공식 SDK) + HTTP REST JSON (자체). SSE transport는 Phase 2+ |

---

## 12. 리스크 & 완화

| 리스크 | 영향 | 완화 |
|--------|------|------|
| KCS/KDS 저작권·재배포 | 법적 | 원문 재배포 금지, 링크·발췌만. 내부 검색만 허용 |
| 온톨로지 유지보수 비용 | 확장성 | 시드 JSON + 버전 관리. 외부 기여자 가이드 (`docs/ONTOLOGY.md`) |
| 현장문서 포맷 다양성 (HWP/HWPX/PDF/XLSX) | 파서 실패 | Agent_HWPX 재사용, 실패 시 수동 섹션 업로드 fallback |
| LLM 환각 (없는 기준 인용) | 신뢰성 | `verify_quality_basis` 필수, basis 미검증 시 응답 거부 |
| 기준 우선순위 분쟁 (시방서 vs KCS) | 판단 오류 | Basis Priority Engine 하드코딩 + human checkpoint 반환 |
| 온톨로지 노드 부족 | 커버리지 | MVP는 3개 공종 완전성 우선. Phase 2+에 확장 |
| Agent_CQ(물량)와의 혼동 | 포지셔닝 | 폴더/서비스명 분리 (`agent-quality-oss-mcp` vs `Agent_CQ`). OSS/사내 트랙 분리로 라이선스·책임선도 명확 |

---

## 13. 성공 기준 (Kill/Survive)

### Phase 1 종료 시점 (2주차)
- 콘크리트·철근·방수 3개 공종 온톨로지 150 노드 이상
- Tool 1~6 응답 < 200ms, 단위 테스트 80% 이상 통과

### Phase 5 종료 시점 (9주차)
- 황룡건설 1개 현장에서 체크리스트 생성 시연
- QC 담당자가 "이 초안으로 실제 검측 나갈 수 있다" 승인

### 6개월 시점
- MCP Tool 월 1,000 call 이상 (내부 + 외부 에이전트)
- 외부 PoC 1건
- NCR 자동 생성률 80% 이상

미충족 시 → Agent_HQ 내부 전용으로 축소 또는 Agent_GitOps에 흡수.

---

## 14. 작업 순서 (즉시 착수)

1. prep.md 검색: MCP 서버 / Firestore / Vertex embedding / Gemini / HWPX 패턴
2. `dev.md` 작성 (철학 매핑 + 코드·에이전트 역할 분리)
3. `deploy.json` 작성
4. `.gitignore` + `.gcloudignore` 작성
5. `package.json` + Cloud Run 스캐폴딩
6. a-git(init)
7. Phase 1 착수 — 온톨로지 스키마부터
