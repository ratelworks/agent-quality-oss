// ─────────────────────────────────────────────────────────────────────────────
// viewer.ts — 브라우저 입력 폼 (CLI·AI 비서 불필요).
//
// `npx agent-quality-oss viewer` 한 줄로 뜨는 로컬 웹 폼. 품질 문서 9종을 선택하면
// 적용 근거·보존기간·참조 표준이 자동 표시되고, 필드를 채운 뒤 "작성 컨텍스트"를
// 생성해 LLM 에게 그대로 넘길 수 있다. (본문 작성은 LLM, 결재는 품질관리자·감리원)
//
// 의존성 0 — node:http + 인라인 HTML. 그래프를 1회 로드해 in-process 로 도구를 호출한다.
// A2UI 폼은 render_quality_form, 작성 컨텍스트는 compose_writing_context 가 생성한다.
// agent-safety-oss viewer 와 통일한 구조 (A2UI 기반).
// ─────────────────────────────────────────────────────────────────────────────

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { SERVER_NAME, VERSION, PROVIDED_BY, DEVELOPED_BY } from "./version.js";
import { loadOntologySync } from "./ontology/loader.js";
import { OntologyGraph } from "./ontology/graph.js";
import { validateOntology } from "./ontology/validator.js";
import { callTool } from "./tool-registry.js";
import { listSchemaIds, getSchema } from "./schemas/loader.js";

// 파일 최상단 상수
const DEFAULT_PORT = 5273; // safety viewer(5174)와 구분
const DRAFT_DIR = path.join(homedir(), ".agent-quality-oss", "drafts");

// ───── draft 로컬 저장 (viewer 전용) ─────
function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}
function ensureDraftDir(): void {
  if (!existsSync(DRAFT_DIR)) mkdirSync(DRAFT_DIR, { recursive: true });
}
function saveDraft(docId: string, formValues: Record<string, unknown>): void {
  ensureDraftDir();
  const file = path.join(DRAFT_DIR, `${safeId(docId)}.json`);
  writeFileSync(
    file,
    JSON.stringify({ docId, formValues, savedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
}
function loadDraft(docId: string): unknown {
  const file = path.join(DRAFT_DIR, `${safeId(docId)}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

// ───── 그래프 로드 + 검증 ─────
function loadGraph(): OntologyGraph {
  const data = loadOntologySync();
  const graph = new OntologyGraph(data);
  const report = validateOntology(graph);
  if (!report.ok) {
    throw new Error("온톨로지 검증 실패 — viewer 를 기동할 수 없습니다.");
  }
  return graph;
}

// ───── HTTP 헬퍼 ─────
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

// ───── 요청 핸들러 ─────
async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  graph: OntologyGraph,
): Promise<void> {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = (req.method ?? "GET").toUpperCase();

  try {
    if (pathname === "/" && method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(HTML);
      return;
    }

    if (pathname === "/api/list-docs" && method === "GET") {
      const docs = listSchemaIds().map((id) => {
        const s = getSchema(id);
        return { id, title: s?.title ?? id, reference: s?.reference ?? null };
      });
      sendJson(res, 200, { docs });
      return;
    }

    if (pathname === "/api/form" && method === "POST") {
      const body = await readBody(req);
      const docId = String(body["docId"] ?? "");
      const result = await callTool("render_quality_form", { docId }, { graph });
      sendJson(res, 200, result);
      return;
    }

    if (pathname === "/api/compose" && method === "POST") {
      const body = await readBody(req);
      const docId = String(body["docId"] ?? "");
      const formValues = (body["formValues"] as Record<string, unknown>) ?? {};
      const result = await callTool(
        "compose_writing_context",
        { docId, formValues },
        { graph },
      );
      sendJson(res, 200, result);
      return;
    }

    if (pathname === "/api/draft/save" && method === "POST") {
      const body = await readBody(req);
      const docId = String(body["docId"] ?? "");
      const formValues = (body["formValues"] as Record<string, unknown>) ?? {};
      if (docId) saveDraft(docId, formValues);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/api/draft/load" && method === "GET") {
      const docId = url.searchParams.get("docId") ?? "";
      sendJson(res, 200, { draft: docId ? loadDraft(docId) : null });
      return;
    }

    sendJson(res, 404, { error: `not found: ${method} ${pathname}` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: msg });
  }
}

// ───── 브라우저 자동 오픈 (크로스플랫폼) ─────
function openBrowser(targetUrl: string): void {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", targetUrl] : [targetUrl];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* 자동 오픈 실패는 무시 — 사용자가 직접 주소 입력 */
  }
}

// ───── 진입점 ─────
export async function startViewer(opts: { port?: number } = {}): Promise<void> {
  const graph = loadGraph();
  const port = opts.port ?? Number(process.env["PORT"] ?? DEFAULT_PORT);
  const server = createServer((req, res) => {
    void handle(req, res, graph);
  });
  server.listen(port, () => {
    const targetUrl = `http://localhost:${port}`;
    process.stdout.write(
      `[${SERVER_NAME} v${VERSION}] 입력 폼 ${targetUrl}\n` +
        `  제공: ${PROVIDED_BY} · 개발: ${DEVELOPED_BY}\n` +
        `  (자동으로 안 열리면 위 주소를 브라우저에 직접 입력)\n`,
    );
    if (!process.env["QUALITY_VIEWER_NO_OPEN"]) openBrowser(targetUrl);
  });
}

// ───── 인라인 프론트엔드 (의존성 0, vanilla) ─────
const HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>agent-quality-oss — 품질문서 작성 보조</title>
<style>
  :root { --bg:#f6f7f9; --card:#fff; --line:#e3e6ea; --ink:#1b2733; --muted:#667; --accent:#1a56db; --accent-soft:#eaf0fe; --warn:#b54708; --warn-soft:#fef3e7; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Apple SD Gothic Neo",Roboto,sans-serif; background:var(--bg); color:var(--ink); }
  header { background:var(--card); border-bottom:1px solid var(--line); padding:14px 22px; display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
  header h1 { font-size:16px; margin:0; font-weight:700; }
  header .sub { font-size:12px; color:var(--muted); }
  header select { margin-left:auto; padding:8px 12px; border:1px solid var(--line); border-radius:8px; font-size:14px; background:#fff; min-width:280px; }
  main { display:grid; grid-template-columns: 1fr 1fr; gap:18px; padding:18px 22px; align-items:start; }
  @media (max-width: 900px) { main { grid-template-columns:1fr; } }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; }
  .card h2 { font-size:14px; margin:0 0 12px; font-weight:700; }
  .section-title { font-size:13px; font-weight:700; color:var(--accent); margin:18px 0 8px; padding-bottom:5px; border-bottom:1px solid var(--accent-soft); }
  .section-title:first-child { margin-top:0; }
  .field { margin-bottom:12px; }
  .field label { display:block; font-size:12px; font-weight:600; margin-bottom:4px; }
  .field label .req { color:#d92d20; margin-left:3px; }
  .field .hint { font-size:11px; color:var(--muted); margin-top:3px; }
  input, select, textarea { width:100%; padding:8px 10px; border:1px solid var(--line); border-radius:8px; font-size:13px; font-family:inherit; }
  textarea { min-height:60px; resize:vertical; }
  .basis-item { font-size:12px; padding:6px 0; border-bottom:1px dashed var(--line); }
  .basis-item .id { color:var(--muted); font-family:ui-monospace,monospace; font-size:11px; }
  .meta-row { font-size:12px; margin-bottom:8px; }
  .meta-row b { color:var(--muted); font-weight:600; }
  .btn { display:inline-block; padding:9px 16px; border:0; border-radius:8px; background:var(--accent); color:#fff; font-size:13px; font-weight:600; cursor:pointer; }
  .btn.ghost { background:#fff; color:var(--accent); border:1px solid var(--accent); }
  .btn:disabled { opacity:.5; cursor:default; }
  .toolbar { display:flex; gap:8px; margin:12px 0; flex-wrap:wrap; align-items:center; }
  .status { font-size:12px; color:var(--muted); }
  .warn { background:var(--warn-soft); color:var(--warn); border-radius:8px; padding:8px 10px; font-size:12px; margin-bottom:10px; }
  pre.context { background:#0d1117; color:#e6edf3; border-radius:10px; padding:14px; font-size:12px; line-height:1.5; overflow:auto; max-height:440px; white-space:pre-wrap; word-break:break-word; }
  .empty { color:var(--muted); font-size:13px; padding:24px 0; text-align:center; }
  .legal { font-size:11px; color:var(--muted); margin-top:14px; line-height:1.5; }
</style>
</head>
<body>
<header>
  <div>
    <h1>agent-quality-oss · 품질문서 작성 보조</h1>
    <div class="sub">양식 구조·근거는 도구가 공급 · 본문 작성은 LLM · 결재는 품질관리자·감리원</div>
  </div>
  <select id="docSelect"><option value="">문서 양식을 선택하세요…</option></select>
</header>
<main>
  <section class="card">
    <h2>입력 폼</h2>
    <div id="formArea"><div class="empty">상단에서 문서 양식을 선택하면 필드가 표시됩니다.</div></div>
    <div class="toolbar" id="formToolbar" style="display:none">
      <button class="btn" id="composeBtn">작성 컨텍스트 생성</button>
      <span class="status" id="draftStatus"></span>
    </div>
  </section>
  <section class="card">
    <h2>적용 근거 · 작성 컨텍스트</h2>
    <div id="metaArea"><div class="empty">문서를 선택하면 참조 표준·보존기간·근거가 표시됩니다.</div></div>
    <div id="contextArea"></div>
    <div class="legal">
      본 도구는 양식 구조와 적용 근거만 제공합니다. 생성된 작성 컨텍스트를 LLM 에게 전달해 초안을 받으십시오.
      최종 판정·승인·서명은 품질관리자·감리원·발주자의 책임입니다.
    </div>
  </section>
</main>
<script>
var currentDoc = "";
var draftTimer = null;

function el(tag, attrs, children) {
  var e = document.createElement(tag);
  if (attrs) for (var k in attrs) { if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }
  if (children) children.forEach(function(c){ e.appendChild(c); });
  return e;
}

function loadDocs() {
  fetch("/api/list-docs").then(function(r){return r.json();}).then(function(d){
    var sel = document.getElementById("docSelect");
    d.docs.forEach(function(doc){
      var o = document.createElement("option");
      o.value = doc.id; o.textContent = doc.title;
      sel.appendChild(o);
    });
  });
}

function buildField(comp) {
  var wrap = el("div", { "class":"field" });
  var label = el("label", {});
  label.appendChild(document.createTextNode(comp.label));
  if (comp.required) { var r = el("span", {"class":"req","text":"*"}); label.appendChild(r); }
  wrap.appendChild(label);

  var input;
  if (comp.fieldType === "select" && comp.options) {
    input = el("select", {});
    input.appendChild(el("option", {"value":"","text":"선택…"}));
    comp.options.forEach(function(op){ input.appendChild(el("option", {"value":op,"text":op})); });
  } else if (comp.fieldType === "longText") {
    input = el("textarea", {});
  } else if (comp.fieldType === "date") {
    input = el("input", {"type":"date"});
  } else if (comp.fieldType === "number") {
    input = el("input", {"type":"number"});
  } else {
    input = el("input", {"type":"text"});
  }
  input.setAttribute("data-field", comp.label);
  input.addEventListener("input", scheduleDraft);
  wrap.appendChild(input);

  if (comp.hint) wrap.appendChild(el("div", {"class":"hint","text":comp.hint}));
  return wrap;
}

function renderForm(resp) {
  var area = document.getElementById("formArea");
  area.innerHTML = "";
  var msg = (resp.result.messages || []).filter(function(m){return m.updateComponents;})[0];
  if (!msg) { area.innerHTML = "<div class='empty'>폼을 불러오지 못했습니다.</div>"; return; }
  var comps = msg.updateComponents.components;
  var byId = {}; comps.forEach(function(c){ byId[c.id] = c; });
  var root = byId["form_root"];
  (root.children || []).forEach(function(secId){
    var sec = byId[secId];
    area.appendChild(el("div", {"class":"section-title","text":sec.title || secId}));
    (sec.children || []).forEach(function(fid){
      var f = byId[fid];
      if (f) area.appendChild(buildField(f));
    });
  });
  document.getElementById("formToolbar").style.display = "flex";
  loadDraftValues();
}

function renderMeta(resp) {
  var m = document.getElementById("metaArea");
  m.innerHTML = "";
  var r = resp.result;
  if (r.reference) m.appendChild(el("div", {"class":"meta-row"})).innerHTML = "<b>참조</b> " + escapeHtml(r.reference);
  if (r.referenceStandard) m.appendChild(el("div", {"class":"meta-row"})).innerHTML = "<b>참조 표준</b> " + escapeHtml(r.referenceStandard);
  if (r.retention) m.appendChild(el("div", {"class":"meta-row"})).innerHTML = "<b>보존기간</b> " + escapeHtml(r.retention);
  var bt = el("div", {"class":"section-title","text":"적용 근거 ("+(resp.basis?resp.basis.length:0)+")"});
  m.appendChild(bt);
  (resp.basis || []).forEach(function(b){
    var d = el("div", {"class":"basis-item"});
    d.innerHTML = "<span class='id'>"+escapeHtml(b.id)+"</span>" + (b.sourceStatus?" · "+escapeHtml(b.sourceStatus):"");
    m.appendChild(d);
  });
}

function selectDoc(docId) {
  currentDoc = docId;
  document.getElementById("contextArea").innerHTML = "";
  if (!docId) {
    document.getElementById("formArea").innerHTML = "<div class='empty'>문서 양식을 선택하세요.</div>";
    document.getElementById("metaArea").innerHTML = "<div class='empty'>—</div>";
    document.getElementById("formToolbar").style.display = "none";
    return;
  }
  fetch("/api/form", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({docId:docId})})
    .then(function(r){return r.json();})
    .then(function(resp){ if(resp.error){alert(resp.error);return;} renderForm(resp); renderMeta(resp); });
}

function collectValues() {
  var vals = {};
  document.querySelectorAll("[data-field]").forEach(function(inp){
    var k = inp.getAttribute("data-field");
    if (inp.value !== "") vals[k] = inp.value;
  });
  return vals;
}

function scheduleDraft() {
  document.getElementById("draftStatus").textContent = "입력 중…";
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 800);
}
function saveDraft() {
  if (!currentDoc) return;
  fetch("/api/draft/save", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({docId:currentDoc,formValues:collectValues()})})
    .then(function(){ document.getElementById("draftStatus").textContent = "임시 저장됨 ✓"; });
}
function loadDraftValues() {
  if (!currentDoc) return;
  fetch("/api/draft/load?docId="+encodeURIComponent(currentDoc)).then(function(r){return r.json();}).then(function(d){
    if (!d.draft || !d.draft.formValues) return;
    var fv = d.draft.formValues;
    document.querySelectorAll("[data-field]").forEach(function(inp){
      var k = inp.getAttribute("data-field");
      if (fv[k] !== undefined) inp.value = fv[k];
    });
    document.getElementById("draftStatus").textContent = "이전 입력 복원됨";
  });
}

function compose() {
  if (!currentDoc) return;
  fetch("/api/compose", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({docId:currentDoc,formValues:collectValues()})})
    .then(function(r){return r.json();})
    .then(function(resp){
      if (resp.error) { alert(resp.error); return; }
      var area = document.getElementById("contextArea");
      area.innerHTML = "";
      var r = resp.result;
      if (r.missingRequired && r.missingRequired.length) {
        var w = el("div", {"class":"warn"});
        w.textContent = "미입력 필수 항목 " + r.missingRequired.length + "건: " + r.missingRequired.slice(0,5).join(", ") + (r.missingRequired.length>5?" 외":"");
        area.appendChild(w);
      }
      var bar = el("div", {"class":"toolbar"});
      var copyBtn = el("button", {"class":"btn ghost","text":"클립보드 복사"});
      copyBtn.addEventListener("click", function(){ navigator.clipboard.writeText(r.markdown); copyBtn.textContent="복사됨 ✓"; setTimeout(function(){copyBtn.textContent="클립보드 복사";},1500); });
      var dlBtn = el("button", {"class":"btn ghost","text":"Markdown 다운로드"});
      dlBtn.addEventListener("click", function(){ downloadMd(r.docId, r.markdown); });
      bar.appendChild(copyBtn); bar.appendChild(dlBtn);
      area.appendChild(bar);
      var pre = el("pre", {"class":"context"});
      pre.textContent = r.markdown;
      area.appendChild(pre);
    });
}

function downloadMd(docId, text) {
  var blob = new Blob([text], {type:"text/markdown"});
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = docId + "-context.md";
  a.click();
  URL.revokeObjectURL(a.href);
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]; }); }

document.getElementById("docSelect").addEventListener("change", function(e){ selectDoc(e.target.value); });
document.getElementById("composeBtn").addEventListener("click", compose);
loadDocs();
</script>
</body>
</html>`;
