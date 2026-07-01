---
id: 002
status: accepted
date: 2026-07-02
deciders: 황룡, Claude
tags: [mcp, tools, chains, design, measurement]
---

# 002. 제네릭 근거 패키지 1종 채택 — 문서별 도구 폭증 회피

## Context

초기 로드맵은 "19종 문서 × 2 (get_*_schema + compile_*_references)" — compile 도구를 문서마다 신설해 도구 수를 54까지 늘리는 계획이었다. 그러나 MCP 도구가 많아질수록 LLM 의 도구 선택 정확도가 떨어진다(도구 목록이 컨텍스트를 점유하고 유사 이름이 혼동을 유발). 자매 agent-safety-oss 는 동일 문제를 제네릭 `assemble_doc_context` 1종으로 풀었다.

## Decision

1. **문서별 bespoke compile 12종 추가 대신 제네릭 `compile_document_references(docId)` 1종** — 19종 문서 전부의 근거 패키지(양식 + verified 법령 원문 발췌 + 서식 다운로드 locator + 공종 재료)를 docId 하나로 조립. 그래프 traversal 이 깊은 **전용 compile 7종은 유지** (NCR·콘크리트 타설 등 — 제네릭으로 표현 불가한 도메인 로직).
2. **체인 도구 5종 신설** — 검측 준비·시험계획·성적서 검토·부적합 처리·일일 브리핑. 기존 도구 run 의 코드 오케스트레이션(LLM 왕복 제거). 도구 수 46 → 52.
3. **모든 compile·chain 의 basis 에 문서 스키마의 legalBasis(verified) 포함** (`_compile-common.ts`) — 응답 신뢰도(any/ratio)를 데이터가 아니라 **응답 조성**이 견인하도록.
4. **측정 러너 정합** — `_dogfood-r02.ts` 가 서버의 annotate 레이어(sourceStatus 주입)를 우회한 채 측정하던 결함 수정. 측정 경로 = 서버 경로.

## Consequences

- 응답 신뢰도(verified): any 0% → 62.5%, ratio 0% → 35.9% (worst 0% 는 KCS 원문 미확보의 정직한 한계 — 라이선스 제약).
- 도구 수 52 가 사실상 상한 — 이후 기능은 기존 도구 확장 또는 체인으로. "도구 수" 자체는 KPI 가 아니다.
- 관련 비채택 결정 (측정 절제):
  - **SHACL(shapes) 비도입** — zod(EntityZ) closed-set 검증 + validate:ontology(무결성) 가 동일 역할을 이미 수행. 이중 스키마 유지비용 > 실익.
  - **문서 marker 자동 갱신(sync-docs) 비도입** — doc-code-sync 게이트가 드리프트를 이미 *차단*(실측: 도구 수 변경 시 README·SETUP·examples 3곳 적발). 자동 치환은 편의일 뿐이며 게이트가 있는 한 드리프트는 구조적으로 불가능.
