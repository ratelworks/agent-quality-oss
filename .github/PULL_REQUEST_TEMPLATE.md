<!--
PR 제출 전:
  · CONTRIBUTING.md 의 정체성 정합·설계 7원칙 충족 확인
  · `npm run typecheck && npm run smoke && npm run validate:ontology && npm run check:oss-hygiene` 통과 확인
  · CHANGELOG.md 에 변경 요약 추가 (release 대상이면 한 줄 가치 요약 포함)
  · 개인정보 / 시크릿 / 내부 인프라 URL 노출 없음 확인
-->

## 요약

<!-- 1-3 줄로 이 PR 이 무엇을 바꾸는가 -->

## 동기 / 배경

<!-- 어떤 문제를 해결하는가. 관련 이슈가 있으면 `Closes #123` 형식으로 -->

## 변경 유형

- [ ] 🐛 버그 수정 (동작 변경 없음)
- [ ] ✨ 신규 기능 (새 도구·노드·관계·게이트)
- [ ] 📚 문서·예제
- [ ] 🧪 테스트·게이트 보강
- [ ] 🔧 리팩토링 (외부 동작 동일)
- [ ] ⚠️ Breaking change (사용자 영향 있음)

## 설계 7원칙 자체 평가

> 모든 신규 기능 PR 은 [`CONTRIBUTING.md`](../CONTRIBUTING.md) 의 정체성 정합과 설계 7원칙을 통과해야 합니다. 버그 수정·문서·리팩토링은 영향 없는 원칙 N/A 표시 OK.

- [ ] 1. Agent-first (Tool 이 1차 인터페이스 — UI 아님)
- [ ] 2. 지식 공급 레이어 (답변·생성은 LLM·사용자, 우리는 근거만 공급)
- [ ] 3. 온톨로지 기반 (그래프 노드·관계로 표현)
- [ ] 4. 한국 건설 품질 specific (KCS/KDS · 품질관리 업무지침 · 건설기술진흥법 · KS)
- [ ] 5. Lineage 필수 (모든 응답에 `basis[]` + `lineage.ontologyVersion`)
- [ ] 6. Human checkpoint (부적합 판정·기준 충돌·증빙 부재 시 A2UI decision)
- [ ] 7. No-Lock-In / 공공 인프라 (MIT · npm · MCP 표준만 의존)

## 검증

<!-- 어떤 게이트·테스트가 통과했는지 -->

- [ ] `npm run typecheck` (src + scripts)
- [ ] `npm run smoke` (Tool 시나리오)
- [ ] `npm run validate:ontology` (온톨로지 무결성)
- [ ] `npm run check:oss-hygiene` (공개 위생)
- [ ] (해당 시) `npm run audit` / `npm run coverage`

## 사용자 영향

<!-- API / CLI / 도구 인터페이스 / 응답 스키마에 변화가 있는가. CHANGELOG 에 어떻게 적었는가 -->

## 추가 컨텍스트

<!-- 스크린샷·trace·관련 PR·후속 작업 등 -->

## 체크리스트

- [ ] CHANGELOG.md 갱신
- [ ] 개인정보 / 시크릿 / 내부 인프라 URL 노출 없음
- [ ] 본인 작업물에 한해 author / contributor 출처 표기 정합
- [ ] 외부 데이터 (KCS · KDS · KS · 법령) 출처와 라이선스 표기 ([`NOTICE.md`](../NOTICE.md))
