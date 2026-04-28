# agent-quality-oss-mcp

> 🇰🇷 한국 건설 품질관리 도메인 전문성을 LLM에 연결하는 Model Context Protocol(MCP) 서버
>
> **단순한 검색기가 아니라 "품질관리 전문가 레이어를 LLM에 장착"하는 것이 목표.**
> LLM이 베테랑 품질관리자처럼 답할 수 있도록 도메인 관계망·정량 기준·의사결정 트리·법령 인용 위치·양식 구조를 즉시 공급합니다.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-purple)](https://modelcontextprotocol.io/)

---

### 🏗️ 제공 · 개발 크레딧

**제공: 황룡건설(주)**
- 품질관리 실무 노하우 · 현장 검증 · 온톨로지 데이터 큐레이션

**개발: 주식회사 라텔웍스 (Ratelworks Inc.) — 이사 황룡**
- MCP 서버 설계 · 구현 · 오픈소스 유지

본 프로젝트는 **품질관리 도메인 전문성**(공종·자재·시험·기준·리스크·부적합·조치·증빙·법령·양식의 관계망)을 LLM에 plug-in 할 수 있게 만들어, LLM이 답을 만들 때 베테랑 품질관리자가 옆에 있는 것과 같은 효과를 제공합니다.

### 벤치마크 패턴

| 모델 | 패턴 | 우리 위치 |
|------|------|----------|
| [`korean-law-mcp`](https://github.com/chrisryugj/korean-law-mcp) | 법령 카탈로그 네비게이터 — 위치만 안내 | 부분 차용 (locator·verify) |
| `agent-safety-oss-mcp` | 안전관리 전문가 레이어 — 도메인 지식을 LLM에 장착 | **동일 패턴** (도메인이 안전→품질) |

→ 우리는 **"품질관리 전문가 레이어"**.

---

## 무엇이 다른가 — 6가지 도메인 전문성 공급

LLM이 품질관리 질문에 답할 때 베테랑 품질관리자처럼 답하도록:

| # | 공급 | 내용 |
|---|------|------|
| ① | **도메인 관계망** | 공종↔자재↔시험↔기준↔리스크↔부적합↔조치↔증빙↔법령 (온톨로지 그래프) |
| ② | **정량적 판정 기준** | AcceptanceCriteria + operator + condition (수치·범위·허용차) |
| ③ | **의사결정 트리** | NCR · possibleCauses · immediateActions · correctiveActions · effectivenessCheck · closureCriteria · approver |
| ④ | **법령·기준 인용 위치** | `standard.law.*` / `standard.guideline.*` / `standard.kcs.*` / `standard.form.*` (locator·원문 미포함) |
| ⑤ | **양식 구조** | 필수 필드 + 증빙 슬롯 + 서명권자 + 검증 규칙 (작성은 LLM이, 구조는 우리가) |
| ⑥ | **환각 방지** | `verify_quality_basis` (인용·근거 실존성) |

원문·답변·판단·생성은 LLM·사용자의 책임. MCP는 **"베테랑의 머릿속 지식을 즉시 공급"**.

## 빠른 시작 (stdio — Claude Desktop 등)

```bash
npm install
npm run start:stdio
```

Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agent-quality-oss-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/agent-quality-oss-mcp/index.js", "--stdio"]
    }
  }
}
```

## HTTP JSON 모드 (Cloud Run 등)

```bash
npm start
# → http://localhost:8080/mcp/tools
```

> 현재는 REST JSON (`GET /mcp/tools`, `POST /mcp/tools/:name`)만 지원. 표준 MCP SSE/WebSocket transport는 Phase 2+ 로드맵.

## MCP Tool (MVP 6종)

| Tool | 설명 |
|------|------|
| `search_quality_ontology` | 공종·자재·시험·검측 노드 검색 |
| `resolve_worktype` | 자연어 공종 표현 → canonical id |
| `get_work_quality_profile` | 공종 하나의 자재/시험/검측/리스크/증빙 프로파일 |
| `get_material_quality_profile` | 자재 하나의 시험/문서/리스크 프로파일 |
| `infer_quality_risks` | 공종·자재·관측값에서 리스크 추론 |
| `map_quality_basis` | 근거 우선순위 매핑 (배합설계서 > 시방서 > KCS > 지침 > KS) |

> Phase 2+에 기준 검색(KCS/KDS/KS), 현장문서 RAG, 체인 도구(체크리스트 생성 / NCR 보고서) 추가 예정.
> 전체 로드맵: [`plan.md`](plan.md)

## 설계 원칙

1. **Agent-first**: UI가 아닌 Tool이 1차 인터페이스
2. **Lineage**: 모든 응답에 `basis[]` 포함 (환각 차단)
3. **Human checkpoint**: 부적합 판정·기준 충돌 시 A2UI decision 반환
4. **Code vs LLM 분리**: 그래프 탐색·수치 판정·기준 우선순위 = 코드 / 비정형 추출·초안 생성 = LLM

## 법적 고지 — 기준 데이터 저작권

본 저장소의 **코드와 온톨로지 구조(엔티티 타입·관계명·ID 규약)** 는 MIT 라이선스로 공개되지만, 이하 데이터의 **원문은 포함하지 않으며 서드파티 저작권이 적용**됩니다.

| 자료 | 저작권자 | 본 저장소의 처리 |
|------|----------|-----------------|
| KCS/KDS (국가건설기준) | 국토교통부 / 국가건설기준센터 | **식별자·섹션 메타데이터만** (제목, 조항 번호). 원문 조문 재배포 금지 |
| 건설공사 품질관리 업무지침 | 국토교통부 고시 | 식별자·범위만 |
| KS 표준 (KS F 2402 등) | 한국표준협회(KSA) / 국가기술표준원 | **식별자·제목만**. 원문은 KSA 라이선스 필요 |

사용자가 위 문서의 **원문 조항**이 필요한 경우 각 기관에서 별도로 획득해야 하며, 본 서버의 기준 RAG(Phase 2+)는 **사용자가 업로드한 원문에 대해서만** 동작합니다. OSS 배포본에는 원문 텍스트가 포함되지 않습니다.

## 라이선스

[MIT](LICENSE) — 코드 및 온톨로지 구조
© 2026 Ratelworks Inc. (개발) · 황룡건설(주) (제공)

> KCS/KDS/KS 등 서드파티 자료의 저작권은 각 기관에 귀속되며, 본 저장소에는 원문이 포함되지 않습니다. 상세는 [`LICENSE`](LICENSE) 말미의 Third-Party Data Notice 참조.

## 기여

온톨로지 확장(공종/자재/시험/검측 추가)이 가장 환영받는 기여입니다. `src/ontology/data/` 하위 JSON에 PR을 보내 주세요. 가이드: [`docs/ONTOLOGY.md`](docs/ONTOLOGY.md) (Phase 1 중 작성).
