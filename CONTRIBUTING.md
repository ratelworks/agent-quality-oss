# Contributing to agent-quality-oss

한국 건설 품질관리(QC·감리) 도메인 지식을 LLM에 공급하는 MCP 서버입니다. 기여를 환영합니다.

## 1. 정체성 정합 (모든 기여의 1차 검증선)

- 본 OSS 는 **도메인 지식 공급 레이어**입니다 — 답변·생성은 LLM 과 사용자, 우리는 베테랑 품질관리자의 지식(관계망·정량 기준·의사결정 트리·법령 인용 위치·양식 구조)을 공급합니다.
- 모든 도구 응답에는 근거 목록(`basis[]`)과 온톨로지 버전(`lineage.ontologyVersion`)이 포함되어야 합니다.
- 내부 전용 기능·자격증명·프로젝트 ID 는 포함 금지 (외부 의존처럼 소비되는 OSS 입니다).

## 2. 개발 환경

```bash
git clone https://github.com/ratelworks/agent-quality-oss.git
cd agent-quality-oss
npm install
npm run build          # tsc + 데이터 복사
npm run typecheck
npm run smoke          # 스모크 테스트
npm run validate:ontology
```

## 3. PR 절차

1. 새 브랜치에서 작업 후 PR
2. 통과 필수: `npm run typecheck` · `npm run smoke` · `npm run validate:ontology` · `npm run check:oss-hygiene`
3. 커밋 메시지: `<type>(<scope>): <한국어 요약>` (type: feat / fix / docs / chore / refactor / test)

## 4. Release 절차 (maintainer)

**Release 노트의 SSoT 는 CHANGELOG 입니다. GitHub Release 를 손으로 작성하지 않습니다.**

1. CHANGELOG 에 `## [X.Y.Z] — YYYY-MM-DD` 섹션 작성
   - 헤더 바로 다음 줄에 **한 줄 가치 요약** (사용자 관점, 70자 이내) — Release 제목으로 자동 사용됨
   - 규칙: 한국어 · 사용자 관점("이 릴리즈로 무엇을 얻나") · 핵심만 · breaking change 명시 · 코드 내부 경로·구현 디테일·내부 용어 금지
2. `package.json` 버전 bump
3. `npm run release:notes` 로 게이트 사전 확인 — `npm run release:notes:preview` 로 실제 Release 본문 미리보기
4. commit → annotated tag `vX.Y.Z` → push (tag 포함)
5. **tag push 가 끝** — `.github/workflows/release.yml` 이 게이트(버전 일치 · 공개 위생 · 노트 규칙) 통과 후 GitHub Release 를 자동 생성합니다. `npm publish` 는 별도 실행하며, `prepublishOnly` 가 같은 게이트를 다시 강제합니다.

수동 `gh release create` 는 금지합니다 — workflow 게이트를 우회하게 됩니다.

## 5. 라이선스

본 OSS 에 기여하는 것은 [MIT 라이선스](./LICENSE) 하에 코드를 배포하는 것에 동의하는 것입니다. KCS/KDS·KS·법령 등 외부 기준 데이터는 각 출처의 이용조건을 준수합니다.

---

문의: `alphamale@ratelworks.co.kr` · ㈜라텔웍스 · GitHub Issues
