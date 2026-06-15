#!/usr/bin/env bash
# 공종 하나의 자재·시험·검측·리스크 프로파일을 조회한다.
# 사용: ./examples/work-profile.sh "철근"   (생략 시 "콘크리트 타설")
set -euo pipefail
cd "$(dirname "$0")/.."
WORKTYPE="${1:-콘크리트 타설}"
node build/cli.js call get_work_quality_profile --workType "$WORKTYPE"
