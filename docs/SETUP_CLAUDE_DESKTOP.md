# Claude Desktop 설정

`agent-quality-oss` 를 Claude Desktop 에 MCP 서버로 연결하는 방법입니다.

## 준비물

- Claude Desktop
- Node.js 22 이상 ([nodejs.org](https://nodejs.org))

키 없이 모든 도구(52개)가 동작합니다 — 온톨로지 탐색, 정량 판정, 법령·기준 인용 위치, 문서 양식 구조, 작성 컨텍스트 생성 모두 인터넷 없이 로컬에서 실행됩니다.

## 1. 소스 빌드

> npm 공개 후에는 이 단계 없이 `npx -y agent-quality-oss serve` 로 바로 쓸 수 있습니다. 현재는 소스 빌드 기준입니다.

```bash
git clone https://github.com/ratelworks/agent-quality-oss.git
cd agent-quality-oss
npm install && npm run build
pwd   # 절대 경로 확인 (아래 설정에 사용)
```

## 2. 설정 파일 위치

| OS | 경로 |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

파일이 없으면 새로 만듭니다.

## 3. 설정 추가

`pwd` 로 확인한 절대 경로를 `/absolute/path/to` 자리에 넣습니다.

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

> npm 공개 후에는 `"command": "npx"`, `"args": ["-y", "agent-quality-oss", "serve"]` 로 교체하면 절대 경로가 필요 없습니다.

## 4. 재시작·확인

Claude Desktop 을 **완전 종료 후 재시작**합니다. 도구 목록에 `agent-quality-oss` 가 보이면 성공입니다.

다음처럼 한국어로 요청해 보세요.

```text
콘크리트 타설 공종의 검측·시험 항목과 판정 기준을 ITP 형식으로 정리해줘.
```

## 브라우저 입력 폼만 쓰고 싶다면

Claude Desktop 없이도 브라우저 폼으로 쓸 수 있습니다.

```bash
node build/cli.js viewer
# → http://localhost:5273
```

자세한 내용은 [README 의 브라우저 입력 폼](../README.md#b-브라우저-입력-폼) 참조.

## 문제 해결

| 증상 | 확인 |
|---|---|
| 도구가 안 보임 | Claude Desktop 완전 종료 후 재시작했는지 / 설정 JSON 문법(쉼표·따옴표) |
| `Cannot find module` | `npm run build` 를 했는지 / `build/cli.js` 절대 경로가 정확한지 |
| `node: command not found` | Node.js 22+ 설치 확인 (`node -v`) |
