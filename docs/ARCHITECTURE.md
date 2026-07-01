# ARCHITECTURE — 기술 구조

> 개발자·기여자용. 정체성·도구 카탈로그는 [IDENTITY](./IDENTITY.md), 온톨로지 작성 가이드는 [ONTOLOGY](./ONTOLOGY.md) 참조.

## 계층 (Semantic / Kinetic / Dynamic / Human)

```
Human    결재·서명·법적 책임 (humanCheckpoint 로 항상 명시)
Dynamic  LLM·MCP 호스트 — 상황 해석·도구 조합·본문 작성 (Claude Desktop · Codex CLI)
Kinetic  MCP 도구 52종 — 그래프 탐색·수치 판정·근거 조립·검수 (코드 = 재현성)
Semantic 온톨로지 그래프 — 공종·자재·시험·기준·리스크·부적합·법령을 관계로 연결
```

## 데이터 2단 구조 (staging → runtime)

```
법제처 lawService.do (law + admrul)
   │  scripts/sync-annexes.ts · sync-law-articles.ts · sync-quality-notice.ts
   ▼
src/taxonomy/            ← staging (원본 보관소, 자동 sync 산출물 전량)
   ├── graph/nodes/articles/   조문 원문 (verified)
   ├── graph/nodes/annexes/    별표·별지 본문 + HWP/PDF 링크
   └── quality-laws/*.md       고시 전문 (사람 열람용)
   │  scripts/promote-taxonomy.ts  ← 선별·병합 (명시적 매핑 테이블 = SSoT)
   ▼
src/ontology/graph/nodes/{type}/*.jsonld   ← runtime SSoT (로더가 읽는 유일한 트리)
```

- **왜 2단인가**: staging 은 전량 보관(대행업자 평가 서식 등 주변 도메인 포함), runtime 은 **시공자 QC·감리 직결만 선별** — 검색 노이즈 방지(올바름 > 양). 선별 기준은 `promote-taxonomy.ts` 의 매핑 테이블이 명시적으로 담는다.
- **본문 상한**: 별표 본문은 20,000자에서 절단(대형 별표2 = 502KB 전문은 staging 에만) — 그래프 메모리·응답 비대 방지. 절단 시 `bodyTruncated: true` + sourceUrl 안내.

## 런타임 로딩

- `src/ontology/loader.ts` — 서버 기동 시 1회 sync 로드. `graph/nodes/**/*.jsonld` 전량 → zod(EntityZ) 검증 → in-memory 그래프.
- 그래프 엔진 = 인접 리스트 + 별칭·타입 인덱스 (`src/ontology/graph.ts`, 외부 의존성 0). 수백 노드 규모라 graphology 급 엔진은 두지 않는다.
- JSON-LD 규약: `@id` IRI(`work:concrete` → 단축 id `work.concrete`) · `@type` closed set(16종) · 배열 값 = 관계 · `_meta` = 속성. 자매 safety-oss 와 동일 구조·동일 IRI 공간.

## 응답 파이프라인

```
tool.run(args, graph)                      # 도구 본체 — result + basis[] + humanCheckpoint
  → annotateResponse(graph, raw)           # 서버 레이어 — basis 각 항목에 sourceStatus 주입
  → sourceStatusSummary (worst/counts)     # 응답 신뢰도 요약
  → lineage { toolName, ontologyVersion, contentHash(sha256) }
```

측정 러너(`scripts/_dogfood-r02.ts`)도 동일하게 annotate 를 적용한다 — **측정 경로 = 서버 경로** (측정 정직성).

## 품질 게이트 체인 (3중 방어)

| 층 | 지점 | 게이트 |
|---|---|---|
| L1 로컬 | `npm test` | 스위트 무결성(suite↔smoke 1:1·도구 수 SSoT) + 온톨로지 무결성(orphan/dangling/cycle 0) + smoke 회귀 94케이스 |
| L2 CI | `.github/workflows/ci.yml` | audit(high) → oss-hygiene → typecheck → build → **npm test** → doc-code-sync → form-conformance → audit(그래프 건강성) → coverage → release:notes → pack dry-run + **CodeQL**(별도 워크플로우, 주간 재스캔) |
| L3 배포 | `prepublishOnly` | oss-hygiene → release:notes → build → doc-code-sync → validate:ontology → form-conformance |

- **doc-code-sync** — README·docs·examples 의 수치(도구 수·노드 수·smoke 수)가 코드 실측과 다르면 차단 (문서 드리프트 게이트).
- **form-conformance** — 19종 문서 스키마의 legalBasis id 가 그래프에 실재하는지 검증 (환각 인용 차단).
- **oss-hygiene** — 내부 용어·내부 경로·PII 노출 차단 (publish·CI 이중).

## 테스트 자산 (행동 계약의 누적)

- `tests/tools.suite.md` — 94 케이스의 **행동 계약** 정의(SSoT). 실행체는 `scripts/smoke-test.ts`(1:1 매핑, `suite-coverage.test.mjs` 가 정합 강제).
- `scripts/measure.ts` — 응답 신뢰도 3관점(worst/any/ratio)·문서 커버리지·오인용률 자동 측정. 함정 시나리오(C06 운반시간 등)로 false PASS 차단.
- negative 테스트 — doc-code-sync·form-conformance 게이트 자체의 오탐/미탐 회귀.

## 디렉토리 맵

```
src/
  index.ts / cli.ts / viewer.ts   진입점 (stdio MCP · CLI · 브라우저 폼)
  tool-registry.ts                도구 단일 등록 지점 (52종)
  tools/                          도구 1종 = 1파일 (+_compile-common 등 공용 헬퍼)
  ontology/                       schema(zod SSoT) · loader · graph · resolver · validator
  ontology/graph/nodes/           런타임 그래프 SSoT (JSON-LD)
  taxonomy/                       법제처 sync staging (원본 보관)
  schemas/document-schemas.json   19종 문서 양식 SSoT
  judgment/                       수치 판정 엔진 (연산자·통계 모드)
scripts/                          sync · promote · 검증 게이트 · 측정
tests/                            스위트 정의(suite.md) + 게이트 회귀(mjs)
```
