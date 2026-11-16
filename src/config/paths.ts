// ─────────────────────────────────────────────────────────────────────────────
// paths.ts — 이 컴퓨터에 파일을 저장하는 위치.
//
// 저장하는 것은 내보낸 문서(한글 파일)와 입력 폼의 임시 저장뿐이다. 기본 위치는 사용자 홈의 .agent-quality-oss 이고,
// 환경 변수 QUALITY_LOCAL_DIR 로 바꿀 수 있다(시험·회사 정책에 따른 다른 폴더).
// 환경 변수는 부를 때마다 읽는다 — 시험이 실행 중에 바꿔도 바로 반영된다.
// ─────────────────────────────────────────────────────────────────────────────

import { homedir } from "node:os";
import { join, resolve } from "node:path";

// ───── 상수 ─────
const DEFAULT_DIR_NAME = ".agent-quality-oss";
export const STORAGE_ENV_NAME = "QUALITY_LOCAL_DIR";

/** 저장소 맨 위 폴더 */
export function getStorageRoot(): string {
  const override = process.env[STORAGE_ENV_NAME]?.trim();
  return override ? resolve(override) : resolve(homedir(), DEFAULT_DIR_NAME);
}

/** 입력 폼의 임시 저장을 두는 폴더 */
export function getDraftsDir(): string {
  return join(getStorageRoot(), "drafts");
}

/** 내보낸 문서를 두는 폴더 */
export function getDocumentsDir(): string {
  return join(getStorageRoot(), "documents");
}
