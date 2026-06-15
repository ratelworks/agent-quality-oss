# agent-quality-oss

[![CI](https://github.com/ratelworks/agent-quality-oss/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ratelworks/agent-quality-oss/actions/workflows/ci.yml)
[![CodeQL](https://github.com/ratelworks/agent-quality-oss/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/ratelworks/agent-quality-oss/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-1.x-purple)](https://modelcontextprotocol.io)
[![Release](https://img.shields.io/badge/release-v0.3.0-blue.svg)](./CHANGELOG.md)
[![Tools](https://img.shields.io/badge/MCP%20tools-46-orange.svg)](#mcp-도구-46개)

**건설현장의 품질관리 문서 작성과 검토를 더 빠르고 정확하게.** 건설기술 진흥법·건설공사 품질관리 업무지침·KCS/KDS·KS 를 기반으로, 품질관리자(QC)와 감리원의 ITP·NCR·검사요청·시험성적서 검토 같은 작업을 돕는 오픈소스 도구입니다.

**단순한 검색기가 아니라 "품질관리 전문가 레이어를 LLM에 장착"하는 것이 목표.** LLM 이 베테랑 품질관리자처럼 답하도록 도메인 관계망·정량 기준·의사결정 트리·법령 인용 위치·양식 구조를 즉시 공급합니다.

[온톨로지 가이드](./docs/ONTOLOGY.md) · [Claude Desktop 설정](./docs/SETUP_CLAUDE_DESKTOP.md) · [로드맵](./ROADMAP.md) · [데이터 출처·라이선스](./NOTICE.md)

---

**목차** — [한 눈에](#한-눈에--품질관리자감리원이-받는-가치) · [왜 필요한가](#왜-필요한가) · [무엇이 들어 있나](#무엇이-들어-있나) · [시작하기](#시작하기) · [사용 예시](#사용-예시) · [동작 흐름](#어떻게-동작하나) · [MCP 도구](#mcp-도구-46개) · [근거 등급](#신뢰성--근거-등급) · [검증 상태](#검증-상태) · [현재 한계](#현재-한계) · [기술 상세](#기술-상세--메타-온톨로지) · [기여](#기여) · [라이선스](#라이선스)

---

## 한 눈에 — 품질관리자·감리원이 받는 가치

> CLI(명령어 입력)가 익숙하지 않아도 됩니다. AI 비서(Claude Desktop · OpenAI Codex CLI)가 본 도구를 호출하거나, 브라우저 입력 폼(`viewer`)으로 바로 쓸 수 있습니다.

| 사용자가 하는 일 | 도구가 자동으로 공급하는 것 |
|---|---|
| "**콘크리트 타설 ITP 만들어줘**" | 검측·시험 항목 + 시험방법(KS) + 빈도 + Hold/Witness point 체계 + 적용 근거(별표2·KCS) 양식 구조 |
| "**슬럼프 180인데 기준 초과야?**" | 정량 판정(코드 계산, LLM 추측 아님) + 부적합 시 원인·조치·재시험·결재선 의사결정 트리 |
| "**철근 부적합 NCR 초안 재료 모아줘**" | NCR 양식 + 원인 후보 + 즉시·시정 조치 + 필요 증빙 + 기준 우선순위(시방서>KCS>KS) |

**누구를 위한 것인가:**

- **품질관리자(QC)** — ITP·품질시험계획·검사요청·NCR·공시체/납품 기록 양식 구조와 필수 항목 확인, 시험 판정 기준·근거 일괄 확인, LLM 작성 문서의 인용 검수
- **감리원** — 시험성적서 검토, 검측 체크포인트, 부적합 판정과 시정 흐름, 적용 기준의 인용 위치 확인
- **현장 실무자** — 공종 한 단어로 적용 자재·시험·판정기준·리스크·검측을 한 번에 조회

**작성 주체는 품질관리자·감리원, 도구는 옆에서 보조** (최종 판정·승인·서명은 사람). 본 도구는 양식 구조와 근거만 공급하며, 본문 작성은 LLM·사용자의 책임입니다.

## 왜 필요한가

건설 현장의 품질관리 자료는 보통 이렇게 흩어져 있습니다.

```text
공종 · 자재 · 시험종목 · 판정기준 · KCS/KDS · KS · 품질시험기준(별표2)
ITP · 검사요청 · 시험성적서 · NCR · 시정조치 · 검측 체크포인트
```

자료는 존재하지만 서로 연결되지 않으면, 품질관리 품질은 시스템보다 담당자의 경험과 기억에 의존합니다. `agent-quality-oss` 는 이 자료들을 다음 사슬로 연결합니다.

```text
공종 -> 자재 -> 시험 -> 판정기준 -> 리스크 -> 부적합 -> 시정조치 -> 증빙 -> 법령·기준
```

LLM 은 이 그래프를 보고 문서를 작성하거나 설명할 수 있지만, 기준 근거를 임의로 만들지는 않습니다. 출처가 확정되지 않은 판정 수치는 `skeleton`(재인용 금지)으로 표시되고, 근거 없는 인용은 검수 도구가 잡아냅니다.

## 무엇이 들어 있나

| 영역 | 내용 |
|---|---|
| **품질관리 온톨로지** | 공종(WorkType) 19종 + 자재·시험·판정기준·리스크·부적합·시정조치·검측·증빙·표준을 관계로 연결. 그래프 노드 **324개** · 관계 **912개** |
| **법정 품질시험기준 커버리지** | 건설공사 품질관리 업무지침 **별표2(품질시험기준)** 의 공통·토목·건축 **전 절** 시험종목·방법·빈도 |
| **MCP 도구 46개** | 온톨로지 탐색 · 정량 판정 · 리스크 추론 · 근거 검증 · 법령/기준 인용 위치 · 문서 양식 구조(19종) · 근거 패키지 조립(7종) · 입력 폼(A2UI) |
| **문서 양식 구조 19종** | (법정 16종) ITP · NCR · 검사요청서 · 콘크리트 납품기록 · 공시체 기록 · 시험성적서 검토 · 품질관리자 배치신고 · 품질시험계획 · 검사대장 · 품질관리계획서 · 성과총괄표(별지43) · 부적합조치결과확인서(별지6) · 점검결과보고서 · 시험의뢰서(KOLAS) · 검측체크리스트 · 자재공급원승인(별지37) + (실무·ISO 관행 3종) 시방서일지 · 시정조치요구서(CAR) · 품질감사보고서 — 시공자 작성 문서 전종 (필수 필드 + 근거 + 보존기간) |
| **건설 메타 온톨로지** | `cc:` 네임스페이스 — 안전·환경 등 다른 도메인 OSS 와 같은 IRI 공간 공유 |
| **근거 추적(Lineage)** | 모든 도구 응답에 `basis[]` + `lineage.contentHash` + `sourceStatus` 요약 — 답이 어디서 왔는지, 출처가 검증됐는지 항상 확인 |

→ 위 자료들이 **서로 연결**되어 있어, "콘크리트 타설" 한 단어만 알면 적용 자재·시험·판정기준·리스크·검측이 자동으로 따라옵니다. (패키지 버전: 0.3.0)

## 시작하기

Node.js 22 이상이 필요합니다 ([nodejs.org](https://nodejs.org)). 환경에 맞는 경로 하나를 고르세요.

| 사용자 환경 | 진입 경로 |
|---|---|
| **Claude Desktop / Codex CLI 사용자** | [A. AI 비서에 연결](#a-ai-비서에-연결) |
| **브라우저 폼만 쓰고 싶은 분** (AI 비서·CLI 불필요) | [B. 브라우저 입력 폼](#b-브라우저-입력-폼) |
| **터미널 · 개발자** | [C. 개발자](#c-개발자) |

> 현재 npm 공개 준비 중입니다. 아래는 소스 빌드 기준이며, npm 공개 후에는 `npx -y agent-quality-oss <명령>` 으로 설치 없이 실행할 수 있습니다.

먼저 소스를 빌드합니다.

```bash
git clone https://github.com/ratelworks/agent-quality-oss.git
cd agent-quality-oss
npm install && npm run build
```

### A. AI 비서에 연결

**Claude Desktop** — 설정 파일에 다음을 추가:

```json
{
  "mcpServers": {
    "agent-quality-oss": {
      "command": "node",
      "args": ["/absolute/path/to/agent-quality-oss/build/cli.js", "serve"]
    }
  }
}
```

설정 파일 위치:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

저장 후 Claude Desktop 을 완전 종료·재시작하면 도구 목록에 `agent-quality-oss` 가 보입니다. 자세한 안내: [docs/SETUP_CLAUDE_DESKTOP.md](./docs/SETUP_CLAUDE_DESKTOP.md).

**OpenAI Codex CLI** — `~/.codex/config.toml` 에 다음을 추가:

```toml
[mcp_servers.agent-quality-oss]
command = "node"
args = ["/absolute/path/to/agent-quality-oss/build/cli.js", "serve"]
```

> npm 공개 후에는 `command = "npx"`, `args = ["-y", "agent-quality-oss", "serve"]` 로 바꾸면 됩니다.

### B. 브라우저 입력 폼

> **CLI 가 익숙하지 않은 품질관리자·감리원이 가장 편하게 쓰는 방법.** 브라우저에 입력 양식이 뜨고, 적용 근거·참조 표준·보존기간이 자동 표시됩니다. 빈 칸을 채우면 LLM 에 그대로 넘길 "작성 컨텍스트"가 생성됩니다.

```bash
node build/cli.js viewer
# → 브라우저가 자동으로 http://localhost:5273 열림
#   (자동으로 안 열리면 위 주소를 브라우저 주소창에 직접 입력)
#   다른 포트로 열려면:  PORT=5280 node build/cli.js viewer
```

브라우저에서 보이는 화면:

1. **문서 양식 선택** (ITP / NCR / 검사요청서 / 시험성적서 검토 등 9종)
2. **자동 표시 영역** — 적용 근거 · 참조 표준 · 보존기간
3. **빈 칸 입력** — 양식별 필수·선택 필드 (입력값은 자동 임시 저장)
4. **작성 컨텍스트 생성** 버튼 → 입력값 + 스키마 구조 + 근거를 합친 Markdown 생성
5. **복사 / 다운로드** → LLM 에게 그대로 전달해 본문 초안 받기

> 이 폼은 [Google A2UI](https://github.com/google/a2ui) (Agent-UI 표준) 기반입니다. 본 도구는 양식 구조와 근거만 제공하며, 본문 작성은 LLM, 결재는 품질관리자·감리원·발주자의 책임입니다.

### C. 개발자

```bash
node build/cli.js tools          # 등록된 도구 46개 목록
node build/cli.js serve          # stdio MCP 서버
node build/cli.js serve --http   # HTTP JSON 서버 (PORT env, 기본 8080 → /mcp/tools)
node build/cli.js call get_work_quality_profile --workType 콘크리트
```

## 사용 예시

Claude Desktop 이나 Codex 에서 자연어로 요청합니다.

```text
콘크리트 타설 공종의 검측·시험 항목과 판정 기준을 ITP 형식으로 정리해줘.
적용 근거(별표2·KCS)도 같이 표시해줘.
```

```text
슬럼프 시험값이 180mm 나왔어. 기준 초과인지 판정하고,
부적합이면 원인·즉시조치·재시험·결재선까지 알려줘.
```

```text
철근 인장강도 부적합이 났어. NCR 초안에 필요한 재료를 모아줘 —
원인 후보, 시정조치, 필요 증빙, 적용 기준 우선순위까지.
```

## 어떻게 동작하나

핵심은 문서를 바로 "그럴듯하게" 쓰는 것이 아니라, **그래프에서 근거를 조립하고, 양식 구조를 제공하고, 작성 컨텍스트로 묶어 LLM 에 넘기는** 것입니다.

1. 사용자가 "콘크리트 타설 ITP" 처럼 요청한다.
2. `resolve_worktype` 로 공종을 canonical id 로 해석한다.
3. `get_work_quality_profile` 로 자재·시험·판정기준·리스크·검측을 그래프에서 가져온다.
4. `get_itp_schema` (또는 `render_quality_form`) 로 양식 구조를 받는다.
5. `compile_*_references` 로 적용 근거 패키지를 조립한다.
6. `compose_writing_context` 가 입력값 + 구조 + 근거를 Markdown 작성 컨텍스트로 묶는다.
7. LLM 이 그 컨텍스트로 본문을 작성하고, `verify_quality_basis` 로 인용을 검수한다.

`compose_writing_context` 는 본문을 직접 생성하지 않습니다 — 작성은 LLM, 결재는 사람이라는 본질을 지킵니다.

## MCP 도구 46개

| 묶음 | 도구 |
|---|---|
| **온톨로지 탐색·프로파일** (5) | `search_quality_ontology` · `resolve_worktype` · `get_work_quality_profile` · `get_material_quality_profile` · `discover_relevant_domain` |
| **리스크·판정** (3) | `infer_quality_risks` · `evaluate_observation` · `explain_quality_decision_path` |
| **근거·검증** (3) | `map_quality_basis` · `verify_quality_basis` · `verify_form_reference` |
| **법령·기준 인용 위치** (7) | `list_core_quality_laws` · `get_quality_law_article` · `search_quality_management_guideline` · `get_quality_guideline_article` · `search_construction_standards` · `get_standard_form_locator` · `get_project_info` |
| **문서 양식 구조** (19) | `get_itp_schema` · `get_ncr_schema` · `get_inspection_request_schema` · `get_concrete_delivery_record_schema` · `get_specimen_record_schema` · `get_test_report_review_schema` · `get_qc_assignment_notice_schema` · `get_quality_test_plan_schema` · `get_quality_inspection_register_schema` · `get_quality_plan_schema` · `get_quality_inspection_summary_schema` · `get_nc_corrective_result_schema` · `get_quality_inspection_report_schema` · `get_test_request_schema` · `get_inspection_checklist_schema` · `get_material_source_approval_schema` · `get_quality_daily_log_schema` · `get_corrective_action_request_schema` · `get_quality_audit_report_schema` |
| **근거 패키지 조립** (7) | `compile_ncr_references` · `compile_concrete_pour_references` · `compile_inspection_references` · `compile_inspection_request_references` · `compile_qc_assignment_notice_references` · `compile_quality_test_plan_references` · `compile_quality_inspection_register_references` |
| **입력 폼·작성 컨텍스트 (A2UI)** (2) | `render_quality_form` · `compose_writing_context` |

전체 목록·설명은 `node build/cli.js tools` 로 확인하세요.

## 신뢰성 — 근거 등급

모든 도구 응답의 `basis[]` 에는 출처 검증 상태(`sourceStatus`)가 붙습니다.

| 등급 | 의미 |
|---|---|
| `verified` | 별표2·법령 본문과 1:1 대조 완료 (시험종목·방법·빈도 등) |
| `indirect_source` | 간접 인용 — 호수·발행기관 검증 미완. 인용 시 확인 필요 |
| `skeleton` | 출처 미확정 — LLM 에게 **재인용 금지** 신호 (예: KCS/KS 원문 미확보 판정 수치) |

> **정확성 원칙(환각 방지):** 별표2 로 확인되는 **시험종목·방법·빈도는 `verified`**, KCS/KS 원문이 공공 데이터로 자동 확보되지 않는 **판정 수치는 `skeleton`(threshold 미정)** 으로 둡니다. 없는 수치를 지어내지 않습니다 — 원문 확보 시 자동 판정으로 강화됩니다.

LLM 이 "기준 초과", "부적합", "합격" 같은 표현을 쓰면 `verify_quality_basis` 가 근거를 요구합니다.

## 검증 상태

```bash
npm run build && npm run typecheck
npm run validate:ontology   # 그래프 무결성 (orphan/dangling 0)
npm run smoke               # 회귀 케이스
npm run check:oss-hygiene   # 공개 위생 (내부 용어·경로·PII 차단)
```

최근 검증 결과:

- 온톨로지 무결성: 통과 (노드 324 · 관계 912 · orphan 0)
- smoke 회귀: 81/81 통과
- typecheck: 통과 · OSS hygiene: 통과
- 별표2 커버리지: 공통·토목·건축 **전 절**

## 현재 한계

- KCS/KDS·KS 의 **판정 수치 원문**은 서드파티 저작권 자료로, 공공 데이터로 자동 확보되지 않는 항목은 `skeleton`(미확정)으로 남아 있습니다. 사용자가 원문을 확보하면 자동 판정이 강화됩니다.
- 기준 RAG(원문 검색)는 Phase 2+ 로드맵이며, **사용자가 업로드한 원문에 대해서만** 동작하도록 설계됩니다. OSS 배포본에는 원문 텍스트가 포함되지 않습니다.
- `render_quality_form` 입력 폼은 9종 문서 양식을 다룹니다. 공종별 세부 변형은 점진 확장 대상입니다.
- 최종 품질 판정·승인·서명은 품질관리자·감리원·발주자에게 있습니다.

## 기술 상세 — 메타 온톨로지

> 이 섹션은 **개발자·기술 연구자용**입니다.

본 OSS 는 라텔웍스 **건설 메타 온톨로지** (`cc: https://construction.ratelworks.org/ontology/v1/`) 의 품질 도메인 레이어입니다.

```text
                cc: (건설 메타 — Project / Site / Person / Document / Equipment)
                 │
  ┌──────────────┼──────────────┬──────────────┐
  │              │              │              │
quality:       safety:       (environment:)  (schedule:)
agent-quality- agent-safety- (예정)          (예정)
oss            oss
```

| 레이어 | namespace | 역할 |
|---|---|---|
| **메타** | `cc:` | Project · Site · Person · Document · Equipment 등 도메인 공통 클래스 |
| **품질** | `quality:` | WorkType · Material · TestItem · AcceptanceCriteria · QualityRisk · Nonconformance · CorrectiveAction · InspectionCheckpoint |
| **안전** | `safety:` | Hazard · Control · Activity (별도 OSS [`agent-safety-oss`](https://github.com/ratelworks/agent-safety-oss)) |
| **표준** | `kcs:` `kds:` `ks:` | 국가건설기준 · KS 표준 식별자 |
| **W3C** | `schema:` `eli:` `sh:` `prov:` | schema.org / EU 법령 / SHACL / Provenance |

핵심 의미 사슬:

```text
WorkType (공종)  →  Material (자재)  →  TestItem (시험)  →  AcceptanceCriteria (판정기준)
WorkType         →  QualityRisk (리스크) → Nonconformance (부적합) → CorrectiveAction (시정)
SchemaForm (양식) →  Standard (KCS/KS/법령/지침 인용 위치)
```

같은 IRI 공간을 공유하므로 안전·품질·환경 그래프를 합쳐도 LLM 이 **하나의 건설 도메인**으로 관계 추론을 이어갈 수 있습니다. 런타임은 무거운 그래프 DB 없이 로컬 파일 + MCP 도구로 동작합니다.

설계 원칙:

1. **Agent-first** — UI 가 아닌 Tool 이 1차 인터페이스
2. **Lineage** — 모든 응답에 `basis[]` + `contentHash` (환각 차단·재현성)
3. **Human checkpoint** — 부적합 판정·기준 충돌·문서 작성 시 A2UI decision 반환
4. **Code vs LLM 분리** — 그래프 탐색·수치 판정·기준 우선순위 = 코드 / 비정형 추출·초안 생성 = LLM

상세: [docs/ONTOLOGY.md](./docs/ONTOLOGY.md) · 벤치마크 패턴은 [`korean-law-mcp`](https://github.com/chrisryugj/korean-law-mcp)(법령 네비게이터, 부분 차용) 와 [`agent-safety-oss`](https://github.com/ratelworks/agent-safety-oss)(동일 패턴, 도메인이 안전→품질).

## 법적 고지 — 기준 데이터 저작권

본 저장소의 **코드와 온톨로지 구조(엔티티 타입·관계명·ID 규약)** 는 MIT 로 공개되지만, 이하 데이터의 **원문은 포함하지 않으며 서드파티 저작권이 적용**됩니다.

| 자료 | 저작권자 | 본 저장소의 처리 |
|---|---|---|
| KCS/KDS (국가건설기준) | 국토교통부 / 국가건설기준센터 | **식별자·섹션 메타데이터만**. 원문 조문 재배포 금지 |
| 건설공사 품질관리 업무지침 | 국토교통부 고시 | 식별자·범위만 |
| KS 표준 (KS F 2402 등) | 한국표준협회(KSA) / 국가기술표준원 | **식별자·제목만**. 원문은 KSA 라이선스 필요 |

사용자가 위 문서의 **원문 조항**이 필요한 경우 각 기관에서 별도로 획득해야 합니다.

## 기여

온톨로지 확장(공종/자재/시험/검측 추가)이 가장 환영받는 기여입니다. `src/ontology/data/` 하위 JSON 에 PR 을 보내 주세요. 기여 절차·코딩 규칙은 [CONTRIBUTING.md](./CONTRIBUTING.md), 보안 신고는 [SECURITY.md](./SECURITY.md), 온톨로지 작성 가이드는 [docs/ONTOLOGY.md](./docs/ONTOLOGY.md) 를 참조하십시오.

## 제공 · 개발

- **제공**: 황룡건설(주) — 품질관리 실무 노하우 · 현장 검증 · 온톨로지 데이터 큐레이션
- **개발**: 주식회사 라텔웍스 (Ratelworks Inc.) — MCP 서버 설계·구현·오픈소스 유지. <alphamale@ratelworks.co.kr>

## 라이선스

- 코드 및 온톨로지 구조: [MIT](./LICENSE)
- KCS/KDS/KS 등 서드파티 자료의 저작권은 각 기관에 귀속되며, 본 저장소에는 원문이 포함되지 않습니다.

자세한 출처와 재사용 조건은 [NOTICE.md](./NOTICE.md) 를 확인하십시오.

© 2026 Ratelworks Inc. (개발) · 황룡건설(주) (제공)
