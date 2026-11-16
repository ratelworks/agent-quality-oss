// ─────────────────────────────────────────────────────────────────────────────
// hwpx-export.ts — 문서 본문을 HWPX(한글) 파일로 저장한다.
//
// 저장 위치: <저장 폴더>/documents/<문서 종류>/<문서 종류>-<YYYYMMDD-HHmmss>.hwpx
// 폴더와 파일은 실행한 사용자만 읽고 쓸 수 있게 만든다. 작성 안내 줄은 빼고 저장한다.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDocumentsDir } from "../config/paths.js";
import { toApprovalCopy } from "./document-body.js";
import { HWPX_MIME_TYPE, markdownToHwpx } from "./hwpx-writer.js";

// ───── 상수 ─────
const SAFE_NAME = /^[a-z][a-z0-9_]*$/;
const DEFAULT_NAME = "document";
const OWNER_ONLY_DIR = 0o700;
const OWNER_ONLY_FILE = 0o600;
const MAX_NAME_ATTEMPTS = 100;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export { HWPX_MIME_TYPE };

export interface HwpxFile {
  /** 저장한 파일의 절대 경로 */
  path: string;
  fileName: string;
  bytes: number;
}

/** 결재·제출용으로 정리한 본문을 HWPX 내용으로 바꾼다 (같은 입력이면 같은 바이트) */
export function buildHwpx(markdown: string, title: string): Buffer {
  return markdownToHwpx(toApprovalCopy(markdown), { title });
}

/** 파일 이름에 쓸 수 있는 문서 종류 이름 — 아니면 기본 이름 */
export function safeDocumentName(docId: string | undefined): string {
  return docId !== undefined && SAFE_NAME.test(docId) ? docId : DEFAULT_NAME;
}

/** 한국 시각의 YYYYMMDD-HHmmss */
function stamp(now: Date): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS).toISOString();
  return `${kst.slice(0, 10).replace(/-/g, "")}-${kst.slice(11, 19).replace(/:/g, "")}`;
}

/** 본문을 HWPX 파일로 저장하고 경로를 돌려준다. 같은 초에 다시 저장해도 앞 파일을 덮어쓰지 않는다. */
export function saveHwpx(docId: string | undefined, markdown: string, title: string, now: Date = new Date()): HwpxFile {
  const name = safeDocumentName(docId);
  const dir = join(getDocumentsDir(), name);
  mkdirSync(dir, { recursive: true, mode: OWNER_ONLY_DIR });
  const data = buildHwpx(markdown, title);
  const base = `${name}-${stamp(now)}`;
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    const fileName = `${base}${attempt === 0 ? "" : `-${attempt + 1}`}.hwpx`;
    const path = join(dir, fileName);
    try {
      writeFileSync(path, data, { mode: OWNER_ONLY_FILE, flag: "wx" });
      return { path, fileName, bytes: data.length };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error("한글 파일을 저장하지 못했습니다 — 같은 시각의 파일이 너무 많습니다");
}
