# dev.md — agent-quality-oss-mcp 개발 규칙

> **MCP 정체성 (2026-04-25 정정)**
> 한국 건설 품질관리 **도메인 전문성을 LLM에 연결**하는 MCP. agent-safety-oss-mcp 패턴(전문가 레이어) 적용 + korean-law-mcp 패턴(locator + verify) 차용.
> 답변·판단·생성은 LLM·사용자가, 우리는 **베테랑 머릿속 지식을 즉시 공급**.

> 본 문서는 이 프로젝트에서 **CLAUDE.md보다 우선**하는 개발 규칙이다.
> 철학 원칙은 [`../../Agent_HQ/PHILOSOPHY.md`](../../Agent_HQ/PHILOSOPHY.md)를 참조하되, 오픈소스 특성에 맞게 적용한다.

---

## 1. 프로젝트 성격

- **트랙**: 오픈소스 (MIT), `dev/oss/` 하위
- **네이밍**: kebab-case 통일 (폴더/npm/리포/Cloud Run 서비스명 전부 `agent-quality-oss-mcp`)
- **듀얼 런타임**: ① stdio MCP (로컬 Claude Desktop 등, `@modelcontextprotocol/sdk` 사용), ② HTTP JSON (Cloud Run, REST `/mcp/tools`). 진짜 MCP SSE/WebSocket transport는 Phase 2+ 과제.
- **Agent_HQ 관계**: 사내 에이전트는 이 MCP를 **외부 오픈소스 의존**처럼 소비. 내부 전용 기능·자격 증명·프로젝트 ID는 포함하지 않음.

---

## 2. 철학 매핑 (PHILOSOPHY.md §9 차용)

### 4층 매핑
- [x] **Protocol** — MCP Tool 20종이 표준 인터페이스 (1차 계약)
- [x] **Runtime** — 온톨로지 그래프 탐색, 기준 매핑, RAG 실행
- [ ] **Governance** — 본 MCP는 근거만 제공, 승인/서명은 소비 에이전트가 담당
- [x] **A2UI** — 부적합 판정·기준 충돌·증빙 부재 시 human checkpoint를 A2UI JSON으로 반환

### §9 체크리스트
- Agent-first: Tool이 1차 인터페이스. Dogfooding UI는 optional
- Protocol 매핑: MCP JSON-RPC (stdio) + HTTP REST JSON (Cloud Run)
- 4층 매핑: Protocol + Runtime + A2UI
- Human fallback: 부적합 판정·기준 충돌·현장 문서 부재 3가지 조건에서만
- Lineage: 모든 Tool 응답에 `basis[]` + `lineage.ontologyVersion` 필수
- 직원 역할: 품질관리자(QC) · 감리원
- A2UI: `humanCheckpoint` 필드에 A2UI decision 컴포넌트 반환

---

## 3. Code ↔ LLM 역할 분리 (CLAUDE.md §0 SSoT)

| 영역 | 담당 | 근거 |
|------|------|------|
| 온톨로지 그래프 탐색 (1-hop, n-hop) | **코드** | 정확성·재현성 필수 |
| alias → canonical id 해석 (1차) | **코드** (사전 기반) | 재현성 |
| alias 해석 fallback | **LLM** | 사전 누락 표현 대응 |
| 기준 우선순위 적용 (배합설계서 > 시방서 > KCS > 지침 > KS) | **코드** | 규칙 고정 |
| 수치 범위 판정 (슬럼프 150±25 등) | **코드** | 계산 |
| 공종 + 자재 + 시험 → 리스크 매핑 | **코드** (규칙 테이블) | 재현성 |
| 리스크 → 가능 원인 후보 추론 | **LLM** | 맥락 해석 |
| PDF/HWPX 섹션 추출 | **LLM** | 비정형 |
| 부적합 보고서·체크리스트 **초안** 문장 생성 | **LLM** | 자연어 |
| 근거 검증 (`verify_quality_basis`) | **코드** | 환각 검출 |

> **원칙**: "매번 같은 결과가 나와야 하는가?" YES → 코드. "상황 따라 달라야 하는가?" YES → LLM.

---

## 4. 코드 규칙

### 언어 / 스타일
- **언어**: Node.js ES Module (`"type": "module"`), Node 22+
- **타입**: JSDoc 타입 주석으로 시작 (TS 전환은 v1.0 이후 논의)
- **주석·문서**: 한국어 (OSS 공개 시 영문 README 병행)
- **상수**: 파일 최상단 선언 필수
- **비동기**: `async/await` 기본. Promise 체이닝 지양.

### 파일 구조 (§9 디렉터리 스펙은 plan.md 참조)
- **index.js**: 엔트리. `--stdio` 인자로 stdio 모드, 없으면 HTTP (`app` export)
- **src/mcp/**: MCP 서버 구성 (transport, tool registry)
- **src/tools/**: MCP Tool 구현 (1 파일 = 1 tool)
- **src/ontology/**: 온톨로지 엔진 + 데이터
- **src/basis/**: Basis Priority Engine
- **src/rag/**: 문서 임베딩·검색 (Phase 3)
- **src/gemini/**: LLM 클라이언트 (Phase 3~4)
- **scripts/**: 온톨로지 검증·시드 로더·smoke test

### 네이밍
- 파일명: kebab-case (`search-quality-ontology.js`)
- 함수·변수: camelCase
- 엔티티 id: `{type}.{snake_case_name}` (plan.md §6.3)
- MCP Tool 이름: snake_case (MCP 관례)

---

## 5. MCP Tool 응답 스키마 (필수)

모든 Tool은 다음 구조를 따른다:

```json
{
  "result": { },
  "basis": [
    { "type": "ontology", "id": "work.concrete_placement", "priority": 1 },
    { "type": "kcs", "id": "standard.kcs_14_20", "section": "3.2.1", "priority": 3 }
  ],
  "humanCheckpoint": {
    "required": false,
    "reason": null
  },
  "lineage": {
    "toolName": "search_quality_ontology",
    "toolCallId": "uuid",
    "ontologyVersion": "0.1.0",
    "generatedAt": "2026-04-24T..."
  }
}
```

### 응답 규칙
1. `basis[]` 없으면 응답 거부 (환각 방지)
2. LLM 생성 텍스트는 `result.draft`에 담고, 근거 id를 `basis[]`에 매핑
3. `humanCheckpoint.required = true`면 A2UI `decision` 컴포넌트 반환
4. `lineage.ontologyVersion`은 package.json version과 동기화

---

## 6. 온톨로지 데이터 규칙

- 한 파일 = 한 엔티티 타입 (`worktypes.json`, `materials.json` ...)
- 엔티티 id는 **전역 유일**, 타입 prefix (`work.*`, `material.*`, `test.*`, `inspection.*`, `risk.*`, `ncr.*`, `action.*`, `doc.*`, `standard.*`)
- 관계는 id 참조. **순환 참조 금지** (`ontology-validator.ts`가 검출)
- aliases 배열에 한국어 동의어 포함 (`"슬래브 타설"`, `"레미콘 타설"` 등)
- 노드 추가 시 `scripts/validate-ontology.js` 통과 필수

---

## 7. 보안 / 배포

### 비밀 관리
- `.env` 금지 (OSS). 환경변수는 런타임에 주입 (Cloud Run 시크릿 매니저)
- Firestore/Vertex AI 키는 Cloud Run 서비스 계정 ADC로 해결
- 사용자는 `.env.example`만 참고

### 배포 전 체크리스트
- [ ] `.gcloudignore`가 `.git/`, `.claude/`, `*.md` 제외
- [ ] `npm run validate:ontology` 통과
- [ ] `npm run smoke` 통과
- [ ] `scripts.start`가 functions-framework로 기동
- [ ] `a-deploy` 사용 (gcloud 직접 금지)

### Agent_HQ 연동
- 사내 에이전트는 HTTP 엔드포인트(`/mcp`)로만 접근
- 사내 전용 데이터(배합설계서 등)는 **소비 측 에이전트**가 Tool 호출 시 payload로 전달

---

## 8. 커밋 / 리뷰

- Conventional Commits: `feat(ontology): 콘크리트 공종 시드 추가` 형식
- 온톨로지 PR은 `validate-ontology` 결과를 PR body에 첨부
- 배포 전 `a-git(commit, type: deploy)` + `a-git(tag)` (사내 배포 트랙)

---

## 9. Phase별 우선순위

| Phase | 범위 | 본 문서 적용 항목 |
|-------|------|------------------|
| 0 | 스캐폴딩 | §4, §7 (배포는 후순위) |
| 1 | 온톨로지 MVP (콘크리트 공종) | §6 필수, §3 Code 영역 집중 |
| 2 | 기준 RAG | §5 basis[] 세밀화, §3 LLM 영역 추가 |
| 3 | 현장문서 RAG | §7 보안 강화, §3 LLM 영역 확대 |
| 4+ | 체인 도구 | §5 humanCheckpoint 본격 사용 |
