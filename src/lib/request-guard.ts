// ─────────────────────────────────────────────────────────────────────────────
// request-guard.ts — 이 컴퓨터에서만 쓰는 HTTP 서버(브라우저 폼·HTTP 서버 기본값)의 접근 경계.
//
//   - 요청 판정: Host·Origin·교차 사이트 표시가 이 컴퓨터 주소의 것인지 본다
//   - 본문 상한: 정해진 크기를 넘는 본문은 읽다가 그만둔다
//
// 127.0.0.1 에만 바인딩해도 브라우저에 열린 다른 웹 페이지가 이 서버로 요청을 보낼 수
// 있다(DNS 재지정·교차 출처 요청). 그래서 주소 제한과 요청 판정을 함께 쓴다.
// ─────────────────────────────────────────────────────────────────────────────

import type { IncomingMessage } from "node:http";

// ───── 상수 ─────
/** 요청 본문 상한 (1 MiB) */
export const MAX_BODY_BYTES = 1024 * 1024;
/** 이 컴퓨터에서만 받을 때 바인딩하는 주소 */
export const LOOPBACK_ADDRESS = "127.0.0.1";
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

export interface GuardHeaders {
  host?: string | undefined;
  origin?: string | undefined;
  "sec-fetch-site"?: string | string[] | undefined;
}

/** 바인딩 주소가 이 컴퓨터 전용 주소인가 */
export function isLoopbackAddress(host: string): boolean {
  return host === LOOPBACK_ADDRESS || host === "localhost" || host === "::1";
}

/**
 * 이 컴퓨터의 주소로 온 같은 출처 요청이 아니면 거절 사유를 돌려준다. 받아도 되면 null.
 */
export function requestRejection(headers: GuardHeaders, port: number): string | null {
  const allowedHosts = LOOPBACK_HOSTNAMES.map((h) => `${h}:${port}`);
  const host = headers.host?.toLowerCase();
  if (!host || !allowedHosts.includes(host)) return "이 컴퓨터의 주소로 온 요청이 아닙니다";
  const origin = headers.origin?.toLowerCase();
  if (origin !== undefined && !allowedHosts.some((h) => origin === `http://${h}`)) {
    return "다른 출처에서 온 요청입니다";
  }
  if (headers["sec-fetch-site"] === "cross-site") return "교차 사이트 요청입니다";
  return null;
}

export class BodyTooLargeError extends Error {
  constructor() {
    super("요청 본문이 너무 큽니다");
    this.name = "BodyTooLargeError";
  }
}

/** 요청 본문을 상한까지만 읽는다. 넘으면 BodyTooLargeError 로 끝낸다. */
export function readBodyText(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        // 남은 본문은 버린다 — 응답(413)을 보낼 수 있게 연결은 그대로 둔다
        req.resume();
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!done) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (!done) reject(err);
    });
  });
}
