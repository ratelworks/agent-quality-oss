// ─────────────────────────────────────────────────────────────────────────────
// viewer.ts — 브라우저 입력 폼 (CLI·AI 비서 불필요).
//
// `npx agent-quality-oss viewer` 한 줄로 뜨는 로컬 웹 폼. 품질 문서 19종을 선택하면
// 적용 근거·보존기간·참조 표준이 자동 표시되고, 필드를 채운 뒤 "작성 컨텍스트"를
// 생성해 AI 비서에게 그대로 넘길 수 있다. (결재는 품질관리자·감리원)
//
// 의존성 0 — node:http + 인라인 HTML. 그래프를 1회 로드해 in-process 로 도구를 호출한다.
// 폼은 render_quality_form 이 주는 A2UI 1.0 메시지를 화면 스크립트가 그린다.
// 작성 컨텍스트는 compose_writing_context 가 만든다.
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
import {
  BodyTooLargeError,
  LOOPBACK_ADDRESS,
  readBodyText,
  requestRejection,
} from "./lib/request-guard.js";

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
/** 본문(JSON)을 상한까지만 읽는다. JSON 이 아니면 빈 객체로 본다. */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBodyText(req);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
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

  // 이 컴퓨터의 주소로 온 같은 출처 요청만 받는다 — 다른 웹 페이지가 저장·조회를 시키지 못하게
  const rejection = requestRejection(req.headers, req.socket.localPort ?? 0);
  if (rejection) {
    sendJson(res, 403, { error: rejection });
    return;
  }

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
    if (err instanceof BodyTooLargeError) {
      sendJson(res, 413, { error: err.message });
      return;
    }
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
  // 실행한 컴퓨터에서만 열린다 — 같은 네트워크의 다른 기기에서는 접속할 수 없다
  server.listen(port, LOOPBACK_ADDRESS, () => {
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
  .doc-title { font-size:15px; font-weight:700; margin-bottom:4px; }
  .group { margin-top:14px; }
  .group-label { font-size:12px; font-weight:700; margin:10px 0 6px; }
  .rows table { width:100%; border-collapse:collapse; margin-bottom:6px; }
  .rows th { font-size:11px; font-weight:600; color:var(--muted); text-align:left; padding:2px 4px; white-space:nowrap; }
  .rows td { padding:2px; }
  .rows { overflow-x:auto; }
  .rows input { min-width:90px; }
  .btn.small { padding:5px 10px; font-size:12px; }
  .legal { font-size:11px; color:var(--muted); margin-top:14px; line-height:1.5; }
</style>
</head>
<body>
<header>
  <div>
    <h1>agent-quality-oss · 품질문서 작성 보조</h1>
    <div class="sub">양식 구조·근거는 도구가 공급 · 초안 작성은 AI 비서 · 결재는 품질관리자·감리원</div>
  </div>
  <select id="docSelect"><option value="">문서 양식을 선택하세요…</option></select>
</header>
<main>
  <section class="card">
    <h2>입력 폼</h2>
    <div id="formArea"><div class="empty">상단에서 문서 양식을 선택하면 필드가 표시됩니다.</div></div>
    <div class="toolbar" id="formToolbar" style="display:none">
      <span class="status" id="draftStatus"></span>
    </div>
  </section>
  <section class="card">
    <h2>적용 근거 · 작성 컨텍스트</h2>
    <div id="metaArea"><div class="empty">문서를 선택하면 참조 표준·보존기간·근거가 표시됩니다.</div></div>
    <div id="contextArea"></div>
    <div class="legal">
      본 도구는 양식 구조와 적용 근거만 제공합니다. 생성된 작성 컨텍스트를 AI 비서에게 전달해 초안을 받으십시오.
      최종 판정·승인·서명은 품질관리자·감리원·발주자의 책임입니다.
    </div>
  </section>
</main>
<script>
// A2UI 1.0 메시지(render_quality_form 결과)를 그리는 작은 렌더러.
// 입력 컴포넌트의 값은 데이터 모델 경로(/draft/...)에 묶인다 — bindings 가 경로와 화면 입력을 잇는다.
var currentDoc = "";
var draftTimer = null;
var bindings = [];
var buttons = [];

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

// "/draft/a/b" → ["a","b"] (JSON Pointer 이스케이프 해제)
function pathSegments(pointer) {
  return pointer.split("/").slice(2).map(function(s){ return s.replace(/~1/g, "/").replace(/~0/g, "~"); });
}
function readPath(obj, segs) {
  var cur = obj;
  for (var i = 0; i < segs.length; i++) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = cur[segs[i]];
  }
  return cur;
}
function writePath(obj, segs, value) {
  var cur = obj;
  for (var i = 0; i < segs.length - 1; i++) {
    if (typeof cur[segs[i]] !== "object" || cur[segs[i]] === null) cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  cur[segs[segs.length - 1]] = value;
}
function extensionsOf(comp) { var m = comp["@metadata"]; return (m && m.extensions) || {}; }
function isRequired(comp) {
  return (comp["@checks"] || []).some(function(c){ return c.condition && c.condition["@call"] === "required"; });
}
function bind(comp, get, set) {
  bindings.push({ segs: pathSegments(comp.value["@path"]), get: get, set: set });
}

// 표 입력 — 열은 @metadata.extensions.columns, 값은 행 객체의 목록
function buildRowsEditor(comp, columns) {
  var wrap = el("div", {"class":"rows"});
  var table = el("table", {});
  var head = el("tr", {});
  columns.forEach(function(c){ head.appendChild(el("th", {"text": c.label})); });
  head.appendChild(el("th", {}));
  table.appendChild(head);
  function addRow(values) {
    var tr = el("tr", {"class":"row"});
    columns.forEach(function(c){
      var inp = el("input", {"type":"text","data-col":c.key,"aria-label":c.label});
      if (values && values[c.key] !== undefined) inp.value = values[c.key];
      inp.addEventListener("input", scheduleDraft);
      tr.appendChild(el("td", {}, [inp]));
    });
    var del = el("button", {"class":"btn ghost small","type":"button","text":"삭제"});
    del.addEventListener("click", function(){ tr.remove(); scheduleDraft(); });
    tr.appendChild(el("td", {}, [del]));
    table.appendChild(tr);
  }
  var add = el("button", {"class":"btn ghost small","type":"button","text":"행 추가"});
  add.addEventListener("click", function(){ addRow(null); });
  wrap.appendChild(table);
  wrap.appendChild(add);
  addRow(null);
  bind(comp, function(){
    var rows = [];
    table.querySelectorAll("tr.row").forEach(function(tr){
      var row = {}; var any = false;
      tr.querySelectorAll("input").forEach(function(inp){
        if (inp.value !== "") { row[inp.getAttribute("data-col")] = inp.value; any = true; }
      });
      if (any) rows.push(row);
    });
    return rows;
  }, function(value){
    if (!Array.isArray(value) || value.length === 0) return;
    table.querySelectorAll("tr.row").forEach(function(tr){ tr.remove(); });
    value.forEach(function(row){ addRow(row !== null && typeof row === "object" ? row : null); });
  });
  return wrap;
}

function buildInput(comp) {
  var ext = extensionsOf(comp);
  var inputId = "in_" + comp.id;
  var wrap = el("div", {"class":"field"});
  var label = el("label", {"for": inputId});
  label.appendChild(document.createTextNode(comp.label || ""));
  if (isRequired(comp)) label.appendChild(el("span", {"class":"req","text":"*"}));
  wrap.appendChild(label);
  if (ext.inputKind === "rows" && ext.columns) {
    wrap.appendChild(buildRowsEditor(comp, ext.columns));
    return wrap;
  }
  var input;
  if (comp.component === "ChoicePicker") {
    input = el("select", {"id": inputId});
    input.appendChild(el("option", {"value":"","text":"선택…"}));
    (comp.options || []).forEach(function(op){ input.appendChild(el("option", {"value":op.value,"text":op.label})); });
    bind(comp, function(){ return input.value === "" ? [] : [input.value]; }, function(v){
      var x = Array.isArray(v) ? v[0] : v;
      if (x !== undefined) input.value = x;
    });
  } else {
    if (comp.component === "DateTimeInput") input = el("input", {"type": comp.enableTime ? "datetime-local" : "date"});
    else if (comp.variant === "longText") input = el("textarea", {});
    else if (comp.variant === "number") input = el("input", {"type":"number","step":"any"});
    else input = el("input", {"type":"text"});
    input.setAttribute("id", inputId);
    if (comp.placeholder) input.setAttribute("placeholder", comp.placeholder);
    bind(comp, function(){ return input.value; }, function(v){
      if (typeof v === "string" || typeof v === "number") input.value = v;
      else if (Array.isArray(v)) input.value = v.join("\\n");
    });
  }
  input.addEventListener("input", scheduleDraft);
  input.addEventListener("change", scheduleDraft);
  wrap.appendChild(input);
  return wrap;
}

function renderNode(id, byId, parent) {
  var c = byId[id];
  if (!c) return;
  if (c.component === "Column") {
    (c.children || []).forEach(function(ch){ renderNode(ch, byId, parent); });
  } else if (c.component === "Card") {
    var card = el("div", {"class":"group"});
    parent.appendChild(card);
    renderNode(c.child, byId, card);
  } else if (c.component === "Text") {
    var t = c.text || "";
    if (t.indexOf("## ") === 0) parent.appendChild(el("div", {"class":"section-title","text":t.slice(3)}));
    else if (t.indexOf("# ") === 0) parent.appendChild(el("div", {"class":"doc-title","text":t.slice(2)}));
    else if (c.variant === "caption") parent.appendChild(el("div", {"class":"hint","text":t}));
    else parent.appendChild(el("div", {"class":"group-label","text":t}));
  } else if (c.component === "Button") {
    buttons.push(c);
  } else if (c.value && c.value["@path"]) {
    parent.appendChild(buildInput(c));
  }
}

// 폼의 버튼은 이름 붙은 이벤트를 낸다 — 이 화면은 그 이름에 맞는 동작을 한다
function renderButtons(byId) {
  var bar = document.getElementById("formToolbar");
  bar.querySelectorAll("button").forEach(function(b){ b.remove(); });
  var status = document.getElementById("draftStatus");
  buttons.forEach(function(b){
    var text = (byId[b.child] || {}).text || "";
    var btn = el("button", {"class": b.variant === "primary" ? "btn" : "btn ghost", "type":"button", "text": text});
    var name = b.action && b.action.event && b.action.event.name;
    btn.addEventListener("click", function(){
      if (name === "submit_document") compose();
      else if (name === "save_draft") saveDraft();
    });
    bar.insertBefore(btn, status);
  });
}

function renderForm(resp) {
  var area = document.getElementById("formArea");
  area.innerHTML = "";
  bindings = [];
  buttons = [];
  var msg = (resp.result.messages || []).filter(function(m){return m.updateComponents;})[0];
  if (!msg) { area.innerHTML = "<div class='empty'>폼을 불러오지 못했습니다.</div>"; return; }
  var byId = {};
  msg.updateComponents.components.forEach(function(c){ byId[c.id] = c; });
  renderNode("root", byId, area);
  renderButtons(byId);
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

// 화면의 입력값을 데이터 모델의 draft 가지와 같은 모양으로 모은다
function collectValues() {
  var draft = {};
  bindings.forEach(function(b){ writePath(draft, b.segs, b.get()); });
  return draft;
}

function scheduleDraft() {
  document.getElementById("draftStatus").textContent = "입력 중…";
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 800);
}
function saveDraft() {
  if (!currentDoc) return;
  fetch("/api/draft/save", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({docId:currentDoc,formValues:collectValues()})})
    .then(function(r){ document.getElementById("draftStatus").textContent = r.ok ? "임시 저장됨 ✓" : "임시 저장 실패"; });
}
function loadDraftValues() {
  if (!currentDoc) return;
  fetch("/api/draft/load?docId="+encodeURIComponent(currentDoc)).then(function(r){return r.json();}).then(function(d){
    if (!d.draft || !d.draft.formValues) return;
    var fv = d.draft.formValues;
    bindings.forEach(function(b){
      var v = readPath(fv, b.segs);
      if (v !== undefined) b.set(v);
    });
    document.getElementById("draftStatus").textContent = "이전 입력 복원됨";
  });
}

function warnBox(area, title, items) {
  if (!items || !items.length) return;
  var w = el("div", {"class":"warn"});
  w.textContent = title + " " + items.length + "건: " + items.slice(0,5).join(", ") + (items.length>5?" 외":"");
  area.appendChild(w);
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
      warnBox(area, "미입력 필수 항목", r.missingRequired);
      warnBox(area, "확인이 필요한 값", r.problems);
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
loadDocs();
</script>
</body>
</html>`;
