#!/usr/bin/env bash
# 등록된 MCP 도구 46개 목록을 출력한다.
# 사용: ./examples/mcp-list-tools.sh
set -euo pipefail
cd "$(dirname "$0")/.."
node build/cli.js tools
