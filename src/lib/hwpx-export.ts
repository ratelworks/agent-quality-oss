// ─────────────────────────────────────────────────────────────────────────────
// hwpx-export.ts — 문서를 정본(.dclx — DocLang 아카이브)과 한글(HWPX) 파일로 저장한다.
//
// 저장 위치: <저장 폴더>/documents/<문서 종류>/<문서 종류>-<YYYYMMDD-HHmmss>.{dclx,hwpx}
// 폴더와 파일은 실행한 사용자만 읽고 쓸 수 있게 만든다. 한글 파일은 정본(DocLang)에서 만들 수 있고,
// 본문(Markdown)에서 만들 때는 작성 안내 줄을 빼고 저장한다.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDocumentsDir } from "../config/paths.js";
import { toApprovalCopy } from "./document-body.js";
import { HWPX_MIME_TYPE, docBlocksToHwpx, markdownToHwpx } from "./hwpx-writer.js";
import { packDclx } from "./dclx.js";
import { doclangToBlocks } from "./doclang-reader.js";

// ───── 상수 ─────
const SAFE_NAME = /^[a-z][a-z0-9_]*$/;
const DEFAULT_NAME = "document";
const OWNER_ONLY_DIR = 0o700;
const OWNER_ONLY_FILE = 0o600;
const MAX_NAME_ATTEMPTS = 100;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export { HWPX_MIME_TYPE };

export interface SavedFile {
  /** 저장한 파일의 절대 경로 */
  path: string;
  fileName: string;
  bytes: number;
}

export type HwpxFile = SavedFile;

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

/** 정본(DocLang 문서)에서 한글 파일 내용을 만든다 — 정본에는 작성 안내 줄이 없다 */
export function buildHwpxFromDoclang(documentXml: string, title?: string): { data: Buffer; title: string; docId: string | null } {
  // 정본의 글을 Markdown 으로 바꿨다가 다시 읽지 않는다 — 값의 기호("10*20*30")가 서식으로 읽혀 바뀌지 않게 블록을 바로 옮긴다
  const read = doclangToBlocks(documentXml);
  const finalTitle = title?.trim() || read.title || "품질 문서";
  return { data: docBlocksToHwpx(read.blocks, { title: finalTitle }), title: finalTitle, docId: read.docId };
}

/** 파일을 저장 폴더에 새로 쓴다. 같은 초에 다시 저장해도 앞 파일을 덮어쓰지 않는다. */
export function saveDocumentBytes(docId: string | undefined, extension: string, data: Buffer, now: Date = new Date()): SavedFile {
  const name = safeDocumentName(docId);
  const dir = join(getDocumentsDir(), name);
  mkdirSync(dir, { recursive: true, mode: OWNER_ONLY_DIR });
  const base = `${name}-${stamp(now)}`;
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    const fileName = `${base}${attempt === 0 ? "" : `-${attempt + 1}`}.${extension}`;
    const path = join(dir, fileName);
    try {
      writeFileSync(path, data, { mode: OWNER_ONLY_FILE, flag: "wx" });
      return { path, fileName, bytes: data.length };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error("파일을 저장하지 못했습니다 — 같은 시각의 파일이 너무 많습니다");
}

/** 본문(Markdown)을 HWPX 파일로 저장하고 경로를 돌려준다 */
export function saveHwpx(docId: string | undefined, markdown: string, title: string, now: Date = new Date()): SavedFile {
  return saveDocumentBytes(docId, "hwpx", buildHwpx(markdown, title), now);
}

/** 정본(DocLang 문서)을 .dclx 로 저장한다 */
export function saveDclx(docId: string | undefined, documentXml: string, now: Date = new Date()): SavedFile {
  return saveDocumentBytes(docId, "dclx", packDclx(documentXml), now);
}

/** 정본(DocLang 문서)에서 만든 한글 파일을 저장한다 */
export function saveHwpxFromDoclang(docId: string | undefined, documentXml: string, title?: string, now: Date = new Date()): SavedFile {
  return saveDocumentBytes(docId, "hwpx", buildHwpxFromDoclang(documentXml, title).data, now);
}
