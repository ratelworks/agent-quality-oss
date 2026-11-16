#!/usr/bin/env tsx
/**
 * test-access-boundary.ts — 브라우저 폼 서버와 HTTP 서버의 접근 경계 회귀 시험
 *
 *   1. 요청 판정(Host·Origin·교차 사이트)과 접근 설정 해석 — 순수 함수
 *   2. 브라우저 폼 서버: 이 컴퓨터 주소로만 열리는지, 다른 Host·Origin 은 403, 큰 본문은 413
 *   3. HTTP 서버(기본): 같은 경계 + 다른 출처에 응답을 열어 주는 헤더가 없는지
 *   4. HTTP 서버(외부 접속을 켠 경우): 접근 토큰이 없으면 401, 있으면 200, 허용한 출처만 열어 줌
 *
 * 빌드 산출물(build/cli.js)을 띄운다 — `npm run build` 뒤에 실행한다.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import { connect } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requestRejection } from "../../src/lib/request-guard.js";
import { resolveHttpAccess } from "../../src/server/http.js";

// ── 상수 ────────────────────────────────────────────────────────────
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = resolve(ROOT, "build", "cli.js");
const BASE_PORT = 20000 + Math.floor(Math.random() * 20000);
const VIEWER_PORT = BASE_PORT;
const HTTP_PORT = BASE_PORT + 1;
const EXTERNAL_PORT = BASE_PORT + 2;
const START_TIMEOUT_MS = 30_000;
const OVERSIZED_BODY_BYTES = 2 * 1024 * 1024;
const TOKEN = "test-token-0123456789";
const ALLOWED_ORIGIN = "https://tools.example";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

interface Reply {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function send(
  port: number,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
): Promise<Reply> {
  return new Promise((resolvePromise, reject) => {
    const req = request(
      { host: "127.0.0.1", port, method: options.method ?? "GET", path: options.path ?? "/", headers: options.headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolvePromise({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ host, port, timeout: 1500 });
    socket.once("connect", () => {
      socket.destroy();
      resolvePromise(true);
    });
    socket.once("error", () => resolvePromise(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolvePromise(false);
    });
  });
}

async function waitUntilUp(port: number): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await canConnect("127.0.0.1", port)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`포트 ${port} 의 서버가 시간 안에 뜨지 않음`);
}

function start(args: string[], env: Record<string, string>): ChildProcess {
  return spawn(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...process.env, ...env }, stdio: "ignore" });
}

function lanAddress(): string | undefined {
  return Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
}

function testDecision(): void {
  const ok = { host: "localhost:5273" };
  check("localhost Host 허용", requestRejection(ok, 5273) === null);
  check("127.0.0.1 Host 허용", requestRejection({ host: "127.0.0.1:5273" }, 5273) === null);
  check("같은 주소 Origin 허용", requestRejection({ ...ok, origin: "http://localhost:5273" }, 5273) === null);
  check("다른 Host 거절", requestRejection({ host: "evil.example:5273" }, 5273) !== null);
  check("다른 포트 Host 거절", requestRejection({ host: "localhost:9999" }, 5273) !== null);
  check("Host 없음 거절", requestRejection({}, 5273) !== null);
  check("다른 Origin 거절", requestRejection({ ...ok, origin: "http://evil.example" }, 5273) !== null);
  check("null Origin 거절", requestRejection({ ...ok, origin: "null" }, 5273) !== null);
  check("교차 사이트 표시 거절", requestRejection({ ...ok, "sec-fetch-site": "cross-site" }, 5273) !== null);
  check("같은 출처 표시 허용", requestRejection({ ...ok, "sec-fetch-site": "same-origin" }, 5273) === null);

  const byDefault = resolveHttpAccess({});
  check("접근 설정 기본값은 이 컴퓨터 전용", byDefault.loopbackOnly && byDefault.host === "127.0.0.1" && byDefault.token === null);
  const cloudRun = resolveHttpAccess({ K_SERVICE: "svc" });
  check("Cloud Run 에서는 밖에서 받음", !cloudRun.loopbackOnly && cloudRun.host === "0.0.0.0");
  const explicit = resolveHttpAccess({ HOST: "0.0.0.0", AGENT_QUALITY_HTTP_ORIGINS: " https://A.example ,https://b.example", AGENT_QUALITY_HTTP_TOKEN: " t " });
  check(
    "HOST·허용 출처·토큰 해석",
    !explicit.loopbackOnly && explicit.token === "t" && JSON.stringify(explicit.allowedOrigins) === '["https://a.example","https://b.example"]',
  );
  check("HOST 를 이 컴퓨터 주소로 적으면 Cloud Run 이어도 전용", resolveHttpAccess({ HOST: "127.0.0.1", K_SERVICE: "svc" }).loopbackOnly);
}

async function testViewer(): Promise<void> {
  const port = VIEWER_PORT;
  // 저장 폴더를 임시 폴더로 돌린다 — 임시 저장이 사용자 홈이 아니라 지정한 폴더에 가는지도 본다
  const store = mkdtempSync(join(tmpdir(), "quality-viewer-test-"));
  const child = start(["viewer", "--port", String(port)], { QUALITY_VIEWER_NO_OPEN: "1", QUALITY_LOCAL_DIR: store });
  try {
    await waitUntilUp(port);
    const home = await send(port, { headers: { Host: `localhost:${port}` } });
    check("폼: 정상 요청은 화면을 돌려줌", home.status === 200 && home.body.includes("<!doctype html>"), String(home.status));
    // 화면 코드는 서버 코드 안의 글자열이라 형식 검사를 거치지 않는다 — 내보낸 그대로 문법을 본다
    const pageScript = /<script>([\s\S]*)<\/script>/.exec(home.body)?.[1] ?? "";
    let scriptProblem = pageScript === "" ? "화면 코드 없음" : "";
    try {
      new Function(pageScript);
    } catch (err) {
      scriptProblem = err instanceof Error ? err.message : String(err);
    }
    check("폼: 화면 코드에 문법 오류가 없음", scriptProblem === "", scriptProblem);
    const previewed = await send(port, {
      method: "POST",
      path: "/api/preview",
      headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, "Content-Type": "application/json" },
      body: JSON.stringify({ docId: "ncr", formValues: { projectName: "시험 현장", reportDate: "2026-02-30" } }),
    });
    const previewBody = JSON.parse(previewed.body) as { document?: { markdown?: string; requiredFilled?: number }; review?: { verdict?: string; findings?: Array<{ code: string }> } };
    check(
      "폼: 본문 미리보기 — 입력값을 옮긴 본문과 자동 검토",
      previewed.status === 200 && (previewBody.document?.markdown ?? "").includes("| 공사명 | 시험 현장 |") && previewBody.review?.verdict === "needs_revision" && (previewBody.review.findings ?? []).some((f) => f.code === "format"),
      previewed.body.slice(0, 160),
    );
    const exported = await send(port, {
      method: "POST",
      path: "/api/export-hwpx",
      headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, "Content-Type": "application/json" },
      body: JSON.stringify({ docId: "ncr", formValues: { projectName: "시험 현장" } }),
    });
    const exportedFile = (JSON.parse(exported.body) as { file?: { fileName?: string; contentBase64?: string; hwpxPath?: string } }).file;
    check(
      "폼: 한글 저장 — 파일 내용을 돌려주고 서버에 따로 저장하지 않음",
      exported.status === 200 && exportedFile?.fileName === "ncr.hwpx" && Buffer.from(exportedFile.contentBase64 ?? "", "base64").subarray(0, 2).toString() === "PK" && exportedFile.hwpxPath === undefined,
      exported.body.slice(0, 160),
    );
    const previewBadOrigin = await send(port, {
      method: "POST",
      path: "/api/export-hwpx",
      headers: { Host: `localhost:${port}`, Origin: "http://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ docId: "ncr", formValues: {} }),
    });
    check("폼: 다른 Origin 의 한글 저장 요청은 403", previewBadOrigin.status === 403, String(previewBadOrigin.status));
    const saved = await send(port, {
      method: "POST",
      path: "/api/draft/save",
      headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, "Content-Type": "application/json" },
      body: JSON.stringify({ docId: "ncr", formValues: { projectName: "시험 현장" } }),
    });
    const draftFile = join(store, "drafts", "ncr.json");
    check(
      "폼: 임시 저장은 지정한 저장 폴더에, 소유자만 읽는 파일로",
      saved.status === 200 && existsSync(draftFile) && (statSync(draftFile).mode & 0o777) === 0o600 && readFileSync(draftFile, "utf8").includes("시험 현장"),
      `${saved.status} ${existsSync(draftFile)}`,
    );
    const loaded = await send(port, { path: "/api/draft/load?docId=ncr", headers: { Host: `localhost:${port}` } });
    check("폼: 임시 저장한 값을 다시 불러옴", loaded.status === 200 && loaded.body.includes("시험 현장"), loaded.body.slice(0, 80));
    const icon = await send(port, { path: "/favicon.ico", headers: { Host: `localhost:${port}` } });
    check("폼: 아이콘 요청에 오류를 내지 않음", icon.status === 204, String(icon.status));
    const badHost = await send(port, { headers: { Host: `evil.example:${port}` } });
    check("폼: 다른 Host 는 403", badHost.status === 403, String(badHost.status));
    const badOrigin = await send(port, {
      method: "POST",
      path: "/api/draft/save",
      headers: { Host: `localhost:${port}`, Origin: "http://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ docId: "ncr", formValues: {} }),
    });
    check("폼: 다른 Origin 의 저장 요청은 403", badOrigin.status === 403, String(badOrigin.status));
    const crossSite = await send(port, {
      path: "/api/draft/load?docId=ncr",
      headers: { Host: `localhost:${port}`, "Sec-Fetch-Site": "cross-site" },
    });
    check("폼: 교차 사이트 조회 요청은 403", crossSite.status === 403, String(crossSite.status));
    const big = await send(port, {
      method: "POST",
      path: "/api/compose",
      headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, "Content-Type": "application/json" },
      body: "x".repeat(OVERSIZED_BODY_BYTES),
    });
    check("폼: 큰 본문은 413", big.status === 413, String(big.status));
    const form = await send(port, {
      method: "POST",
      path: "/api/form",
      headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, "Content-Type": "application/json" },
      body: JSON.stringify({ docId: "ncr" }),
    });
    check("폼: 같은 출처의 폼 요청은 200", form.status === 200, String(form.status));
    const lan = lanAddress();
    if (lan) check(`폼: 다른 기기용 주소(${lan})로는 접속되지 않음`, !(await canConnect(lan, port)));
    else console.log("  (외부용 네트워크 주소가 없어 폼 바인딩 확인은 건너뜀)");
  } finally {
    child.kill("SIGTERM");
  }
}

async function testHttpDefault(): Promise<void> {
  const port = HTTP_PORT;
  const child = start(["serve", "--http", "--port", String(port)], { HOST: "", K_SERVICE: "" });
  try {
    await waitUntilUp(port);
    const tools = await send(port, { path: "/mcp/tools", headers: { Host: `localhost:${port}` } });
    check("HTTP: 정상 요청은 도구 목록을 돌려줌", tools.status === 200 && tools.body.includes('"tools"'), String(tools.status));
    check("HTTP: 다른 출처에 응답을 열어 주는 헤더가 없음", tools.headers["access-control-allow-origin"] === undefined);
    const badHost = await send(port, { path: "/mcp/tools", headers: { Host: `evil.example:${port}` } });
    check("HTTP: 다른 Host 는 403", badHost.status === 403, String(badHost.status));
    const badOrigin = await send(port, {
      method: "POST",
      path: "/mcp/tools/resolve_worktype",
      headers: { Host: `localhost:${port}`, Origin: "http://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ input: "슬래브 타설" }),
    });
    check("HTTP: 다른 Origin 의 도구 호출은 403", badOrigin.status === 403, String(badOrigin.status));
    const call = await send(port, {
      method: "POST",
      path: "/mcp/tools/resolve_worktype",
      headers: { Host: `localhost:${port}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: "슬래브 타설" }),
    });
    check("HTTP: 정상 도구 호출은 200", call.status === 200 && call.body.includes('"lineage"'), String(call.status));
    const invalid = await send(port, {
      method: "POST",
      path: "/mcp/tools/resolve_worktype",
      headers: { Host: `localhost:${port}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: 123 }),
    });
    check("HTTP: 형식에 맞지 않는 입력은 400", invalid.status === 400 && invalid.body.includes("INVALID_INPUT"), String(invalid.status));
    const unknown = await send(port, {
      method: "POST",
      path: "/mcp/tools/no_such_tool",
      headers: { Host: `localhost:${port}`, "Content-Type": "application/json" },
      body: "{}",
    });
    check("HTTP: 없는 도구는 404", unknown.status === 404, String(unknown.status));
    const big = await send(port, {
      method: "POST",
      path: "/mcp/tools/resolve_worktype",
      headers: { Host: `localhost:${port}`, "Content-Type": "application/json" },
      body: "x".repeat(OVERSIZED_BODY_BYTES),
    });
    check("HTTP: 큰 본문은 413", big.status === 413, String(big.status));
    const lan = lanAddress();
    if (lan) check(`HTTP: 다른 기기용 주소(${lan})로는 접속되지 않음`, !(await canConnect(lan, port)));
    else console.log("  (외부용 네트워크 주소가 없어 HTTP 바인딩 확인은 건너뜀)");
  } finally {
    child.kill("SIGTERM");
  }
}

async function testHttpExternal(): Promise<void> {
  const port = EXTERNAL_PORT;
  const child = start(["serve", "--http", "--port", String(port)], {
    HOST: "0.0.0.0",
    AGENT_QUALITY_HTTP_TOKEN: TOKEN,
    AGENT_QUALITY_HTTP_ORIGINS: ALLOWED_ORIGIN,
  });
  try {
    await waitUntilUp(port);
    const noToken = await send(port, { path: "/mcp/tools", headers: { Host: "service.example" } });
    check("외부 접속: 토큰 없는 요청은 401", noToken.status === 401, String(noToken.status));
    const wrongToken = await send(port, { path: "/mcp/tools", headers: { Host: "service.example", Authorization: "Bearer wrong-token-0123456789" } });
    check("외부 접속: 틀린 토큰은 401", wrongToken.status === 401, String(wrongToken.status));
    const health = await send(port, { path: "/healthz", headers: { Host: "service.example" } });
    check("외부 접속: 상태 확인은 토큰 없이 200", health.status === 200, String(health.status));
    const withToken = await send(port, {
      path: "/mcp/tools",
      headers: { Host: "service.example", Authorization: `Bearer ${TOKEN}`, Origin: ALLOWED_ORIGIN },
    });
    check("외부 접속: 맞는 토큰은 200", withToken.status === 200, String(withToken.status));
    check("외부 접속: 허용한 출처에만 응답을 열어 줌", withToken.headers["access-control-allow-origin"] === ALLOWED_ORIGIN);
    const otherOrigin = await send(port, {
      path: "/mcp/tools",
      headers: { Host: "service.example", Authorization: `Bearer ${TOKEN}`, Origin: "https://evil.example" },
    });
    check("외부 접속: 허용하지 않은 출처에는 열어 주지 않음", otherOrigin.headers["access-control-allow-origin"] === undefined);
  } finally {
    child.kill("SIGTERM");
  }
}

testDecision();
await testViewer();
await testHttpDefault();
await testHttpExternal();
console.log(`[access-boundary] ${pass} 통과 / ${fail} 실패`);
process.exit(fail > 0 ? 1 : 0);
