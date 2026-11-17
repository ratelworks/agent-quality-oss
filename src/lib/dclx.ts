// ─────────────────────────────────────────────────────────────────────────────
// dclx.ts — DocLang 아카이브(.dclx)를 묶고 푼다.
//
// DocLang 규격 부록 B(DocLang archive format)를 따른다 — ZIP 위의 OPC 꾸러미이고
//   [Content_Types].xml   필수 — document.xml 의 내용 형식(Override)과 들어 있는 확장자의 Default
//   _rels/.rels           필수 — 본문 문서를 가리키는 관계가 정확히 하나
//   document.xml          필수 — DocLang 문서
// 이 도구가 만드는 문서는 그림·소리가 없어 위 세 부분만 넣는다. 그림·소리·영상 확장자의 Default 는 규격 권고와 공식 도구대로 선언한다.
// 규격: https://github.com/doclang-project/doclang/blob/main/spec.md (Annex B)
// ─────────────────────────────────────────────────────────────────────────────

import { unzip, zip } from "./zip.js";

// ───── 상수 ─────
export const DCLX_EXTENSION = "dclx";
/** 규격이 따로 정하지 않았다 — ZIP 꾸러미 */
export const DCLX_MIME_TYPE = "application/zip";
const CONTENT_TYPES_PATH = "[Content_Types].xml";
const RELS_PATH = "_rels/.rels";
const DOCUMENT_PATH = "document.xml";
const DOCUMENT_CONTENT_TYPE = "application/vnd.doclang.document+xml";
const RELS_CONTENT_TYPE = "application/vnd.openxmlformats-package.relationships+xml";
const DOCUMENT_REL_TYPE = "http://doclang.ai/ns/package/2026/relationships/document";
const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
/**
 * 규격 권고 — pages/ 의 그림, audio/·video/ 의 소리·영상 확장자.
 * 공식 도구(doclang 0.9.0 의 pack)가 쓰는 목록·순서와 같게 둔다 — 같은 문서면 공식 도구와 같은 [Content_Types].xml 이 나온다.
 */
const MEDIA_DEFAULTS: ReadonlyArray<readonly [string, string]> = [
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
  ["mp3", "audio/mpeg"],
  ["m4a", "audio/mp4"],
  ["aac", "audio/aac"],
  ["ogg", "audio/ogg"],
  ["opus", "audio/ogg"],
  ["wav", "audio/wav"],
  ["flac", "audio/flac"],
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
  ["mkv", "video/x-matroska"],
  ["mov", "video/quicktime"],
];
const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

function contentTypesXml(): string {
  const defaults = [`  <Default Extension="rels" ContentType="${RELS_CONTENT_TYPE}"/>`, ...MEDIA_DEFAULTS.map(([ext, type]) => `  <Default Extension="${ext}" ContentType="${type}"/>`)];
  return `${XML_DECL}\n<Types xmlns="${CONTENT_TYPES_NS}">\n${defaults.join("\n")}\n  <Override PartName="/${DOCUMENT_PATH}" ContentType="${DOCUMENT_CONTENT_TYPE}"/>\n</Types>\n`;
}

function relsXml(): string {
  return `${XML_DECL}\n<Relationships xmlns="${RELS_NS}">\n  <Relationship Id="rId1"\n    Type="${DOCUMENT_REL_TYPE}"\n    Target="${DOCUMENT_PATH}"/>\n</Relationships>\n`;
}

/** DocLang 문서(XML)를 .dclx 바이트로 묶는다 — 같은 문서면 같은 바이트 */
export function packDclx(documentXml: string): Buffer {
  const text = (value: string): Buffer => Buffer.from(value, "utf8");
  return zip([
    { name: CONTENT_TYPES_PATH, data: text(contentTypesXml()) },
    { name: RELS_PATH, data: text(relsXml()) },
    { name: DOCUMENT_PATH, data: text(documentXml) },
  ]);
}

const attr = (tag: string, name: string): string | null => new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1] ?? new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`).exec(tag)?.[1] ?? null;

/** .dclx 바이트에서 본문 DocLang 문서(XML)를 꺼낸다 — 규격의 필수 부분이 없으면 오류 */
export function unpackDclx(data: Buffer): { documentXml: string; documentPath: string } {
  let entries: Map<string, Buffer>;
  try {
    entries = unzip(data);
  } catch (err) {
    throw new Error(`.dclx(DocLang 아카이브)를 읽지 못했습니다 — ${(err as Error).message}`);
  }
  const contentTypes = entries.get(CONTENT_TYPES_PATH)?.toString("utf8");
  const rels = entries.get(RELS_PATH)?.toString("utf8");
  if (!contentTypes) throw new Error(`.dclx 에 ${CONTENT_TYPES_PATH} 가 없습니다`);
  if (!rels) throw new Error(`.dclx 에 ${RELS_PATH} 가 없습니다`);
  const documentRels = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).filter((tag) => attr(tag, "Type") === DOCUMENT_REL_TYPE);
  if (documentRels.length !== 1) throw new Error(`.dclx 의 ${RELS_PATH} 에 본문 문서 관계가 정확히 하나여야 합니다(${documentRels.length}개)`);
  const target = (attr(documentRels[0] as string, "Target") ?? "").replace(/^\/+/, "");
  const override = [...contentTypes.matchAll(/<Override\b[^>]*>/g)].map((m) => m[0]).find((tag) => (attr(tag, "PartName") ?? "").replace(/^\/+/, "") === target);
  if (!override || attr(override, "ContentType") !== DOCUMENT_CONTENT_TYPE) {
    throw new Error(`.dclx 의 ${CONTENT_TYPES_PATH} 에 /${target} 의 내용 형식(${DOCUMENT_CONTENT_TYPE})이 없습니다`);
  }
  const document = entries.get(target);
  if (!document) throw new Error(`.dclx 에 본문 문서(${target})가 없습니다`);
  return { documentXml: document.toString("utf8"), documentPath: target };
}
