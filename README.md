# agent-quality-oss

[![CI](https://github.com/ratelworks/agent-quality-oss/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ratelworks/agent-quality-oss/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-2026--07--28-purple)](https://modelcontextprotocol.io)
[![Release](https://img.shields.io/badge/release-v1.0.0-blue.svg)](./CHANGELOG.md)
[![Tools](https://img.shields.io/badge/MCP%20tools-62-orange.svg)](#현장-운영-흐름)

**법으로 꼭 작성해야 하는 품질 문서, 그리고 자주 쓰는 품질 문서를 바르게.** 품질관리자(QC)와 감리원이 건설기술 진흥법령·건설공사 품질관리 업무지침이 정한 품질 문서(품질관리계획서·품질시험계획서·품질검사 실시대장·품질검사 성과 총괄표·자재 공급원 승인 요청서·검측요청서 등)와 현장에서 자주 쓰는 문서(ITP·NCR·레미콘 입회시험 기록·공시체 기록·시험성적서 검토 등)를 근거와 함께 빠짐없이 작성하도록 돕는 오픈소스 도구입니다. 건설 품질 질문에는 법령 조문과 기준 근거를 붙여, 도구 없는 AI 보다 정확한 답을 내는 것을 목표로 합니다.

**판정·시험 빈도·법령 조회·품질관리 관계망은 이 목적을 위한 수단입니다.** 문서 칸을 바르게 채우고 답의 근거를 대는 데 씁니다 — 정량 판정은 코드가 계산하고, 법령은 원문 조문을 붙이고, 양식은 법정 기재 항목을 빠뜨리지 않게 구조를 줍니다.

[정체성·도구 카탈로그](./docs/IDENTITY.md) · [기술 구조](./docs/ARCHITECTURE.md) · [온톨로지 가이드](./docs/ONTOLOGY.md) · [Claude Desktop 설정](./docs/SETUP_CLAUDE_DESKTOP.md) · [로드맵](./ROADMAP.md) · [설계 결정 기록](./decisions) · [데이터 출처·라이선스](./NOTICE.md)

---

**목차** — [한 눈에](#한-눈에--품질관리자감리원이-받는-가치) · [왜 필요한가](#왜-필요한가) · [무엇이 들어 있나](#무엇이-들어-있나) · [시작하기](#시작하기) · [사용 예시](#사용-예시) · [자동작성 흐름](#어떻게-동작하나--자동작성-흐름) · [현장 운영 흐름](#현장-운영-흐름) · [근거 등급](#신뢰성--근거-등급) · [검증 상태](#검증-상태) · [현재 한계](#현재-한계) · [기술 상세](#기술-상세--온톨로지-설계) · [기여](#개발--기여) · [라이선스](#라이선스)

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

**작성 주체는 품질관리자·감리원, 도구는 옆에서 보조** (최종 판정·승인·서명은 사람). 본 도구는 양식 구조와 근거를 공급하고, 입력한 값을 양식 구조대로 옮겨 문서 본문(Markdown · 한글 파일 · DocLang)을 만듭니다. 문장을 지어내지 않습니다 — 입력하지 않은 칸은 비워 두며, 서술이 필요한 내용은 사용자가 적거나 AI 비서가 초안을 씁니다.

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
| **품질관리 온톨로지** | 공종(WorkType) <!-- stat:work-types -->19종<!-- /stat:work-types --> + 자재·시험·판정기준·리스크·부적합·시정조치·검측·증빙·표준을 관계로 연결. <!-- stat:graph -->그래프 노드 **414개** · 관계 **1004개**<!-- /stat:graph -->. 표준 SHACL 엔진과 RDF 왕복으로 검증 |
| **법령·고시 원문 내장** | <!-- stat:laws -->건설기술 진흥법 · 건설기술 진흥법 시행령 · 건설기술 진흥법 시행규칙 · 건설공사 사업관리방식 검토기준 및 업무수행지침 · 건설공사 품질관리 업무지침 — 다섯 법령·고시의 **조문 566개 · 별표 37개 · 별지 서식 134개**<!-- /stat:laws -->의 본문을 법제처 원문 그대로 싣습니다. 판본(공포번호·시행일)을 함께 밝히고, 현행판과 같은지는 `npm run check:law-editions` 로 점검합니다. 조문은 원문에 있는 구절만 인용하며, 별표·별지 서식은 본문과 함께 공식 내려받기 위치를 안내합니다 |
| **품질시험기준 전 항목** | 건설공사 품질관리 업무지침 **별표 2(건설공사 품질시험기준)** 의 <!-- stat:test-rows -->시험종목 **1,959행**(자재·공종 244종)<!-- /stat:test-rows --> — 시험종목·시험방법·시험빈도를 표 그대로 찾습니다. 여기까지는 *무슨 시험을 얼마나 자주 하는지*이고, 합격 *판정 수치*는 콘크리트 공종과 흙쌓기 다짐도에서 갖췄습니다(그 밖은 `skeleton`, [현재 한계](#현재-한계) 참조) |
| **MCP 도구 62개** | 온톨로지 탐색 · 현장 말 문장으로 찾기 · 정량 판정 · 리스크 추론 · 근거 검증(인용 조문이 실제로 있는지까지) · 법령·기준 조회 · 품질시험기준 조회 · 문서 양식 구조(23종) · 근거 패키지 조립 · 체인 도구 5종(검측·시험계획·성적서 검토·부적합·일일 브리핑) · 입력 폼(A2UI) · 문서 본문 생성·검토·한글 파일 저장 |
| **문서 23종** | <!-- stat:forms -->법령·고시가 서식이나 기재 내용을 정한 문서 11종(품질시험계획서 · 검측요청서 · 품질검사 실시대장 · 품질관리계획서 · 품질검사 성과 총괄표 · 검측 체크리스트 · 자재 공급원 승인 요청서 · 레미콘 시공품질관리 점검표 · 아스콘 시공품질관리 점검표 · 품질시험·검사실적 보고서 · 불량자재폐기 확약서) + 실무 서식 12종(부적합 보고서(NCR) · 레미콘 차량별 입회시험 기록지 · 공시체 제작·관리 기록지 · 검사 및 시험 계획(ITP) · 시험성적서 검토 보고서 · 품질관리 건설기술인 배치 내역서 · 부적합 조치결과 확인서 · 자체 품질점검 결과 보고서 · 품질검사 대행 의뢰서 · 품질관리 일지 · 시정조치 요구서(CAR) · 내부심사(품질감사) 보고서)<!-- /stat:forms -->. 문서마다 필수 항목·근거·보존기간을 갖추고, 입력값으로 본문(Markdown · 한글 파일 · DocLang)을 만듭니다 |
| **근거 추적(Lineage)** | 모든 도구 응답에 `basis[]` + `lineage.contentHash` + `sourceStatus` 요약 — 답이 어디서 왔는지, 출처가 검증됐는지 항상 확인 |

→ 위 자료들이 **서로 연결**되어 있어, "콘크리트 타설" 한 단어만 알면 적용 자재·시험·판정기준·리스크·검측이 자동으로 따라옵니다. (패키지 버전: 1.0.0)

## 시작하기

Node.js 22.12 이상이 필요합니다 ([nodejs.org](https://nodejs.org)). 환경에 맞는 경로 하나를 고르세요.

| 사용자 환경 | 진입 경로 |
|---|---|
| **Claude Desktop / Codex CLI 사용자** | [A. AI 비서에 연결](#a-ai-비서에-연결) |
| **브라우저 폼만 쓰고 싶은 분** (AI 비서·CLI 불필요) | [B. 브라우저 입력 폼](#b-브라우저-입력-폼) |
| **터미널 · 개발자** | [C. 개발자](#c-개발자) |

> npm 에 게시된 판은 설치 없이 `npx -y agent-quality-oss <명령>` 으로 실행할 수 있습니다. 이 안내문은 저장소의 현재 코드를 기준으로 씁니다 — 게시된 버전(`npm view agent-quality-oss version`)이 위 배지의 버전보다 낮으면 아직 게시 전이므로 소스를 빌드해 쓰세요. 아래 예시는 소스를 받아 빌드한 경우이며, npx 를 쓸 때는 `node build/cli.js` 자리에 `npx -y agent-quality-oss` 를 넣으면 됩니다.

소스에서 쓰려면 먼저 빌드합니다.

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

> 소스를 받지 않고 쓰려면 `command = "npx"`, `args = ["-y", "agent-quality-oss", "serve"]` 로 적습니다(Claude Desktop 도 같습니다).

### B. 브라우저 입력 폼

> **CLI 가 익숙하지 않은 품질관리자·감리원이 가장 편하게 쓰는 방법.** 브라우저에 입력 양식이 뜨고, 적용 근거·참조 표준·보존기간이 자동 표시됩니다. 빈 칸을 채우면 문서 본문을 미리 보고 한글 파일로 받을 수 있고, AI 비서에 넘길 "작성 컨텍스트"도 만들 수 있습니다. 이 화면은 이 컴퓨터에서만 열립니다.

```bash
node build/cli.js viewer
# → 브라우저가 자동으로 http://localhost:5273 열림
#   (자동으로 안 열리면 위 주소를 브라우저 주소창에 직접 입력)
#   다른 포트로 열려면:  PORT=5280 node build/cli.js viewer
```

브라우저에서 보이는 화면:

1. **문서 양식 선택** (ITP / NCR / 검사요청서 / 시험성적서 검토 등 23종)
2. **자동 표시 영역** — 적용 근거 · 참조 표준 · 보존기간
3. **빈 칸 입력** — 양식별 필수·선택 필드 (입력값은 자동 임시 저장)
4. **작성 컨텍스트 생성** 버튼 → 입력값 + 스키마 구조 + 근거를 합친 Markdown 생성
5. **복사 / 다운로드** → LLM 에게 그대로 전달해 본문 초안 받기
6. **본문 미리보기 · 한글 저장** → 입력한 값을 양식 구조대로 옮긴 본문과 자동 검토 결과를 보고, 한글(HWPX) 파일로 받기

> 이 폼은 [Google A2UI](https://github.com/google/a2ui) (Agent-UI 표준) 기반입니다. 본 도구는 양식 구조와 근거를 제공하고 입력값을 본문으로 옮깁니다(본문 미리보기 · 한글 저장). 서술 초안은 AI 비서, 결재는 품질관리자·감리원·발주자의 책임입니다.

### C. 개발자

```bash
node build/cli.js tools          # 등록된 도구 62개 목록
node build/cli.js serve          # stdio MCP 서버
node build/cli.js serve --http   # HTTP 서버 (PORT env, 기본 8080 — 이 컴퓨터에서만 접속)
node build/cli.js doctor         # 설치 상태 점검
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

현장에서 쓰는 말 그대로 물어도 됩니다. 상황을 적은 문장에서 맞는 시험·판정 기준·부적합 유형, 법령·지침 조문, 품질시험기준(업무지침 별표 2) 행을 찾습니다.

```text
거푸집 떼보니 곰보가 생겼어. 뭘 해야 하지?
들밀도 시험은 얼마마다 해야 하나?
우리 현장은 품질관리자를 몇 명 둬야 하나?
```

## 어떻게 동작하나 — 자동작성 흐름

핵심은 문서를 바로 "그럴듯하게" 쓰는 것이 아니라, **그래프에서 근거를 조립하고, 양식 구조를 제공하고, 작성 컨텍스트로 묶어 LLM 에 넘기는** 것입니다.

1. 사용자가 "콘크리트 타설 ITP" 처럼 요청한다.
2. `resolve_worktype` 로 공종을 canonical id 로 해석한다.
3. `get_work_quality_profile` 로 자재·시험·판정기준·리스크·검측을 그래프에서 가져온다.
4. `get_itp_schema` (또는 `render_quality_form`) 로 양식 구조를 받는다.
5. `compile_*_references` 로 적용 근거 패키지를 조립한다.
6. `compose_writing_context` 가 입력값 + 구조 + 근거를 Markdown 작성 컨텍스트로 묶는다.
7. LLM 이 그 컨텍스트로 본문을 작성하고, `verify_quality_basis` 로 인용을 검수한다.
8. 입력값만으로 본문이 필요하면 `generate_quality_document` 가 양식 구조대로 옮겨 정본(.dclx — DocLang 아카이브)으로 저장하고, `review_quality_document` 로 빠진 항목·날짜·인용 조문을 검토한 뒤 `export_quality_document` 로 그 정본에서 한글 파일을 받는다.

`compose_writing_context` 는 본문을 쓰지 않습니다 — AI 비서가 초안을 쓸 때의 재료입니다. `generate_quality_document` 는 입력한 값을 그 자리에 옮길 뿐 문장을 짓지 않으며, 입력하지 않은 칸은 비워 두고 무엇을 적어야 하는지 알립니다. 어느 쪽이든 확인과 서명은 사람이 합니다.

## 현장 운영 흐름

| 단계 | 무엇을 하나 | 핵심 도구 |
|---|---|---|
| **1. 프로젝트 컨텍스트** | 현장·공사 정보 확인 | `get_project_info` |
| **2. 공종 파악** | 공종 한 단어 → 자재·시험·판정기준·리스크·검측을 그래프에서 조회 | `resolve_worktype` · `get_work_quality_profile` · `get_material_quality_profile` · `search_quality_ontology` · `discover_relevant_domain` |
| **3. 양식·근거 조립** | 문서 양식 구조(23종) + 적용 근거 패키지 조립 | `get_itp_schema` 외 양식 23종 · `compile_document_references`(제네릭, 23종 전부) · `compile_ncr_references` 외 전용 7종 · `render_quality_form` |
| **3+. 원스톱 체인** | 위 2~3단계를 한 번에 — 검측 준비·시험계획·성적서 검토·부적합 처리·일일 브리핑 | `chain_quality_inspection` · `chain_quality_test_plan` · `chain_test_report_review` · `chain_nonconformance_report` · `chain_daily_quality_briefing` |
| **4. 정량 판정** | 시험 관측값 합격 여부 · 타설 전 조건(서중·한중·운반시간) · 리스크·부적합 추론 (코드 계산) | `evaluate_observation` · `evaluate_pour_conditions` · `infer_quality_risks` · `explain_quality_decision_path` |
| **5. 작성 컨텍스트** | 입력값 + 양식 구조 + 근거 → LLM 작성 컨텍스트 | `compose_writing_context` |
| **5+. 문서 본문** | 입력값을 양식 구조대로 옮긴 정본(.dclx — DocLang 아카이브) · 정본에서 만든 한글 파일(서식 원본을 실은 법정 문서는 그 서식의 칸에 채움) · 빠진 항목·날짜·인용 조문 검토 · 이미 쓴 본문을 한글 파일로 저장 | `generate_quality_document` · `review_quality_document` · `export_quality_document` |
| **6. 검수** | 근거 우선순위 · 인용 실존 · 서식 명칭 검증 | `map_quality_basis` · `verify_quality_basis` · `verify_form_reference` |
| **법령·기준 조회** | 법령·업무지침·사업관리지침의 조문·별표 본문과 판본, KCS/KDS 조항 위치(본문은 싣지 않음), 서식 위치 | `list_core_quality_laws` · `get_quality_law_article` · `search_quality_management_guideline` · `get_quality_guideline_article` · `search_construction_standards` · `get_standard_form_locator` |
| **품질시험기준** | 업무지침 별표 2 전 항목(시험종목·시험방법·시험빈도)을 구분·종별·시험종목·KS 번호로 조회 | `search_quality_test_standards` |

전체 도구 **62개** 목록·설명은 `node build/cli.js tools` 로 확인하세요.

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
npm test                    # 전체 시험 (아래 항목과 판정·인용·문서·입력 검사·접근 경계 포함)
npm run validate:ontology   # 그래프 무결성 (orphan/dangling 0)
npm run validate:shapes     # 표준 검증 — 형태 정의(SHACL) · RDF 대조 · 역관계
npm run smoke               # 회귀 케이스
npm run docs:check          # 안내문의 수치가 자료와 같은지
npm run check:oss-hygiene   # 공개 위생 (내부 용어·경로·PII 차단)
```

최근 검증 결과:

- 온톨로지 무결성: <!-- stat:integrity -->통과 (노드 414 · 관계 1004 · orphan 0)<!-- /stat:integrity -->
- 출처를 원문과 대조한(verified) 노드: <!-- stat:verified -->173/414 노드 (42%)<!-- /stat:verified -->
- smoke 회귀: <!-- stat:smoke -->94/94 통과<!-- /stat:smoke -->
- AI 비서 연결 실사용(2026-11-16): 설치한 패키지에 AI 비서를 MCP 로 붙여 현장 질문을 던졌을 때 드러난 문제를 회귀 시험(`npm run test:usage`)으로 고정했습니다 — 슬럼프·압축강도 판정, 문장에서 시험 알아보기, 검측 확인 내용, 문서 저장
- 현장 문장 판정(`npm run test:field-judgment` · `npm run test:noise`, 2026-11-17 측정): 코드를 보지 않은 작성자들이 쓴 현장 문장(묶음마다 120문장, 3분의 1은 도구를 헷갈리게 하려고 쓴 글)으로 판정 도구를 잽니다. 고치기 전에 처음 돌린 결과를 따로 적어 둡니다(`evaluation/field-judgment/history.json`). 문장을 도구에 그대로 넣었을 때 최근 열 묶음의 틀린 판정은 묶음마다 0~3건이고, AI 비서를 거쳐 쓰면 처음 보는 묶음 넷에서 모두 실질 틀린 판정 0입니다. 다 돌린 2,430문장은 시험에 넣어 틀린 판정 0, 같은 문장에 측정값이 아닌 수를 끼워 넣은 14,580건도 틀린 판정 0입니다. 문장은 AI 가 쓴 것이고 실제 현장에서 모은 것이 아닙니다
- 현장 말투 질문(`npm run test:field-questions`, 2026-11-16 측정): 맞춰 보는 묶음 31/32 · 보지 않는 묶음 21/22 · 도구를 고정한 뒤에 쓴 묶음 15/20 — 정답이 모두 나온 질문 수. 세 묶음 모두 같은 사람이 쓴 질문이라 실제 현장 질문으로 잰 수치는 아닙니다
- typecheck: 통과 · OSS hygiene: 통과
- 별표2 커버리지: 공통·토목·건축 **전 절**

## 현재 한계

- **공종별 정량 판정 깊이 (식별 ≠ 판정)**: 별표2의 공통·토목·건축 전 절에 대해 *시험종목·방법·빈도*는 안내하지만, *합격 판정 수치(threshold)*를 원문과 대조해 갖춘 것은 **콘크리트 공종**(슬럼프·공기량·염화물·압축강도·단위수량·타설 온도·거푸집 해체강도 — KCS 14 20)과 **흙쌓기 다짐도**(노상 95 % 이상·노체 90 % 이상 — KCS 11 20 20)입니다. 철근·철강·포장·방수·마감과 토공의 그 밖의 항목(CBR·입도·함수비)은 시험종목 안내까지이며, 판정 수치는 `skeleton`(미확정)입니다. 즉 "이 값이 기준에 맞나?"의 자동 판정은 위 항목에서만 동작하고, 그 외는 KCS/KS 원문 확보 시 확장됩니다.
- KCS/KDS·KS 의 **판정 수치 원문**은 서드파티 저작권 자료로, 공공 데이터로 자동 확보되지 않는 항목은 `skeleton`(미확정)으로 남아 있습니다. 사용자가 원문을 확보하면 자동 판정이 강화됩니다.
- 법령과 국토교통부 고시는 본문을 싣지만, **KCS/KDS·KS 의 본문은 싣지 않습니다**(조항 번호·제목과 판정 기준을 확인하는 짧은 구절만). 기준 원문 검색은 로드맵이며 사용자가 직접 올린 원문에 대해서만 동작하도록 설계합니다.
- 현장 말로 쓴 문장에서 찾는 기능은 글자 단위로 견주는 방식이라 뜻이 같아도 낱말이 전혀 다르면 놓칩니다. 찾은 조문과 시험기준은 후보이므로 원문을 확인해야 합니다.
- 문서 양식 구조는 현장에서 작성하거나 받아 보관하는 23종을 다룹니다. 발주처 커스텀 양식·공종별 세부 변형은 점진 확장 대상입니다.
- 정량 판정은 **일반 기준 위주**입니다. 발주처 특기시방·프로젝트 시방서·승인 배합설계서가 일반 기준보다 우선하는 경우 해당 문서를 별도로 확인해야 합니다(프로젝트 문서 주입·버전관리는 로드맵).
- HTTP 모드(`serve --http`)는 기본으로 **이 컴퓨터에서만** 접속할 수 있습니다. 다른 컴퓨터에 열려면 `HOST` 를 지정하고, 접근 토큰(`AGENT_QUALITY_HTTP_TOKEN`)과 허용할 브라우저 출처(`AGENT_QUALITY_HTTP_ORIGINS`)를 정합니다. 요청 크기는 제한하지만 사용량 제한·감사 로그는 없으므로, 공개망에 둘 때는 앞단에서 보강해야 합니다.
- 문서 본문 생성은 입력한 값을 양식 구조대로 옮길 뿐 문장을 짓지 않습니다. 법령·고시가 서식을 정한 문서 가운데 서식 원본을 실은 문서(품질시험계획 · 검측요청·결과통보 · 검측 체크리스트 · 품질검사 실시대장 · 품질검사 성과 총괄표 · 품질시험·검사실적 보고서 · 자재 공급원 승인 요청 · 레미콘·아스콘 시공품질관리 점검표 · 불량자재폐기 확약서)은 한글 파일을 법제처에서 받은 **서식 원본의 칸에 값을 채워** 만듭니다. 서식에 칸이 없는 입력(문서번호 등)은 응답에 따로 알리고 정본에만 남깁니다. 품질관리계획서와 실무 서식은 기재 항목 구조로 만듭니다. 시험·검사 결과와 서명 칸은 사람이 채우며, 한글 프로그램에서 열어 확인한 뒤 써야 합니다.
- 본 도구는 ITP·NCR·검사요청·시험성적서 검토의 **초안·근거 패키징·검수 보조**용입니다. 전자결재·문서번호·변경이력·보존기간·서명·제출 이력을 책임지는 공식 품질경영시스템(QMS)은 아닙니다.
- 최종 품질 판정·승인·서명은 품질관리자·감리원·발주자에게 있습니다.

## 기술 상세 — 온톨로지 설계

> 이 섹션은 **개발자·기술 연구자용**입니다. 품질관리자·감리원이 본 도구를 사용하는 데 이 내용을 알 필요는 없습니다.

품질 정보를 세 계층(Layer)으로 표현합니다.

| 계층 | 역할 | 예 |
|---|---|---|
| 의미 계층 (Semantic) | 품질관리 객체와 관계 정의 | WorkType · Material · TestItem · AcceptanceCriteria · QualityRisk · Nonconformance · CorrectiveAction · InspectionCheckpoint · Standard |
| 실행 계층 (Kinetic) | 그래프 객체에 대한 MCP 도구 | `get_itp_schema` · `compile_ncr_references` · `evaluate_observation` · `render_quality_form` |
| 동적 계층 (Dynamic) | LLM·하네스의 상황 해석·도구 조합 | Claude Desktop · OpenAI Codex CLI |

핵심 의미 사슬:

```text
WorkType (공종)  →  Material (자재)  →  TestItem (시험)  →  AcceptanceCriteria (판정기준)
WorkType         →  QualityRisk (리스크) → Nonconformance (부적합) → CorrectiveAction (시정)
SchemaForm (양식) →  Standard (KCS/KS/법령/지침 인용 위치)
```

온톨로지는 자기 접두 `quality:`(JSON-LD `@context` 로 정의)를 씁니다. 다른 도메인과는 공공 표준 코드로 만납니다 — 공종마다 국토교통부 건설정보분류체계 공종(W) 코드 대응을 `src/ontology/standard-bridge.json` 에 두므로, 자매 프로젝트 [`agent-safety-oss`](https://github.com/ratelworks/agent-safety-oss)(`safety:`)처럼 같은 코드에 대응을 둔 그래프와 그 코드를 거쳐 합칠 수 있습니다. 온톨로지 데이터는 자매 프로젝트 agent-safety-oss 와 **동일한 JSON-LD 노드 구조**(`src/ontology/graph/nodes/{type}/*.jsonld` — `@id` IRI · `@type` · 관계 IRI 참조 · `_meta`)를 SSoT 로 사용합니다. 런타임은 이를 경량 in-memory 그래프(인접 리스트 + 별칭·타입 인덱스, 외부 의존성 0, sync)로 로드합니다 — 수백 노드 규모라 graphology 같은 무거운 그래프 엔진은 두지 않습니다. 즉 **데이터 구조는 safety 와 동일**하고 그래프 엔진만 규모에 맞게 경량입니다.

설계 원칙:

1. **Agent-first** — UI 가 아닌 Tool 이 1차 인터페이스
2. **Lineage** — 모든 응답에 `basis[]` + `contentHash` (환각 차단·재현성)
3. **Human checkpoint** — 부적합 판정·기준 충돌·문서 부재처럼 사람이 정해야 하는 때를 응답에 밝힘
4. **Code vs LLM 분리** — 그래프 탐색·수치 판정·기준 우선순위 = 코드 / 비정형 추출·초안 생성 = LLM

상세: [docs/ONTOLOGY.md](./docs/ONTOLOGY.md)

## 개발 · 기여

```bash
git clone https://github.com/ratelworks/agent-quality-oss.git
cd agent-quality-oss
npm install && npm run build
npm run typecheck && npm test
```

온톨로지 확장(공종/자재/시험/검측 추가)이 가장 환영받는 기여입니다. `src/ontology/graph/nodes/{type}/` 하위 JSON-LD 노드에 PR 을 보내 주세요 (1노드 = 1파일). 기여 절차·코딩 규칙은 [CONTRIBUTING.md](./CONTRIBUTING.md), 보안 신고는 [SECURITY.md](./SECURITY.md), 온톨로지 작성 가이드는 [docs/ONTOLOGY.md](./docs/ONTOLOGY.md) 를 참조하십시오.

## 제공 · 개발

- **제공**: 황룡건설(주) — 품질관리 실무 노하우 · 현장 검증 · 온톨로지 데이터 큐레이션
- **개발**: 주식회사 라텔웍스 (Ratelworks Inc.) — MCP 서버 설계·구현·오픈소스 유지. <alphamale@ratelworks.co.kr>

## 라이선스

- **코드 및 온톨로지 구조**(엔티티 타입·관계명·ID 규약): [MIT](./LICENSE)
- **법령·고시**(건설기술 진흥법·시행령·시행규칙, 건설공사 품질관리 업무지침, 사업관리방식 검토기준 및 업무수행지침): 조문·별표·서식 본문을 싣습니다 — 저작권법 제7조 제1호·제2호에 해당하는 자료입니다.
- **KCS/KDS·KS**: 패키지에 본문을 싣지 않습니다. 각 기관의 저작권·이용 조건을 따릅니다. 다만 저장소의 `evaluation/sources/` 폴더에는 초기 대조에 쓴 참고 사본(표준시방서 KCS 14 20 의 예전 판과 안내자료 2건)이 남아 있습니다 — npm 패키지에는 들어가지 않으며 현행판이 아닙니다.

| 자료 | 저작권자 | 본 저장소의 처리 |
|---|---|---|
| 건설기술 진흥법·시행령·시행규칙 | 대한민국 | 조문·별표·서식 본문 (법제처 국가법령정보 공동활용) |
| 건설공사 품질관리 업무지침 · 사업관리방식 검토기준 및 업무수행지침 | 국토교통부 고시 | 조문·별표·서식 본문 (법제처 국가법령정보 공동활용) |
| KCS/KDS (국가건설기준) | 국토교통부 / 국가건설기준센터 | 조항 번호·제목, 판정 기준을 확인하는 짧은 구절. 본문은 싣지 않음 |
| KS 표준 (KS F 2402 등) | 한국표준협회(KSA) / 국가기술표준원 | **식별자·제목만**. 원문은 KSA 라이선스 필요 |

KCS/KDS·KS 의 원문 조항이 필요하면 각 기관에서 따로 구해야 합니다. 수록한 법령·고시는 받아 둔 시점의 판본이므로 적용 전에 현행 여부를 확인하십시오. 자세한 출처와 재사용 조건은 [NOTICE.md](./NOTICE.md) 를 확인하십시오.

© 2026 Ratelworks Inc. (개발) · 황룡건설(주) (제공)
