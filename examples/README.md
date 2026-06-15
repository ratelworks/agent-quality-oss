# Examples

`agent-quality-oss` 사용 예시 모음입니다. 먼저 빌드하세요.

```bash
npm install && npm run build
```

## CLI 스크립트

| 스크립트 | 설명 |
|---|---|
| `mcp-list-tools.sh` | 등록된 MCP 도구 43개 목록 |
| `work-profile.sh [공종]` | 공종 하나의 자재·시험·검측·리스크 프로파일 (기본: 콘크리트 타설) |

```bash
./examples/mcp-list-tools.sh
./examples/work-profile.sh 철근
```

## Claude Desktop 연결

`claude-desktop-config.json` 의 절대 경로를 본인 환경(`pwd` 결과)에 맞게 수정한 뒤 Claude Desktop 설정 파일에 넣으세요. 자세한 안내: [../docs/SETUP_CLAUDE_DESKTOP.md](../docs/SETUP_CLAUDE_DESKTOP.md).

## 브라우저 입력 폼 (CLI·AI 비서 불필요)

```bash
node build/cli.js viewer
# → http://localhost:5273
```

문서 양식을 선택하면 적용 근거·보존기간이 자동 표시되고, 입력값을 LLM 작성 컨텍스트로 묶어 줍니다.
