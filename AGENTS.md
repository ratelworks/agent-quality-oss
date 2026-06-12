# AGENTS.md — agent-quality-oss

> Common SSoT for Claude Code, Codex CLI, Cursor, Continue.dev. Read this first.

## Project Context

`agent-quality-oss` is an MCP server that connects Korean construction **quality management**
expertise to LLMs — domain relations, quantitative criteria, decision trees, statute citation
points, and form structures over KCS/KDS standards, Quality Management Guidelines (건설공사
품질관리 업무지침), and KS. Target users are site QC managers (품질관리자) and supervision
engineers (감리원). The goal is to mount a veteran quality-manager layer onto the LLM,
not to build a simple retriever.

- **Surfaces**: MCP server (stdio, `npm run mcp:start`) + CLI (`npm run cli`)
- **The human stays in charge**: the tool drafts and reviews; engineering judgement and
  sign-off remain with the QC manager / supervision engineer
- **Domain boundary**: construction quality management only — statutory *safety* documents
  belong to the sibling `agent-safety-oss`
- **Sibling reference**: `dev/oss/agent-safety-oss` is the reference implementation for
  hygiene/release gates — keep parity when touching release or verify scripts

## Build & Test

```bash
npm install
npm run build              # tsc + data copy
npm run typecheck
npm run smoke              # smoke test
npm run audit              # ontology/graph audit
npm run validate:ontology  # ontology validation
npm run mcp:tools          # list registered MCP tools
npm run check:oss-hygiene  # public-repo hygiene gate (also runs in prepublishOnly)
```

## Stack & Conventions

- Runtime: **Node.js >=22**, ES Modules, TypeScript
- MCP: `@modelcontextprotocol/sdk` (stdio transport) — entries `src/index.ts` (server) / `src/cli.ts` (CLI)
- Comments: Korean (개발 주체가 라텔웍스). User-facing output is Korean by design
  (target users are Korean QC managers)
- Constants at the top of the file they belong to

## Critical Rules

1. **Ontology data is the SSoT.** Tools read domain facts (criteria, relations, citations)
   from `src/ontology/` / `src/taxonomy/`; never hardcode them in code paths.
2. **Correct evidence beats coverage.** Do not over-dump criteria or citations; wrong-but-plausible
   output is the failure mode this project exists to prevent (same doctrine as agent-safety-oss).
3. **`prepublishOnly` chain is the release gate** (hygiene → build → checks). Never bypass; fix the cause.
4. **No PII, no internal-operations vocabulary** in any tracked file — `npm run check:oss-hygiene`
   blocks publish/merge on violation.
5. **Release notes are generated from CHANGELOG** (`npm run release:notes`, tag-push workflow) —
   do not hand-write GitHub releases.

## File Structure

```
src/
├── index.ts / cli.ts                  # MCP server · CLI entries
├── tool-registry.ts                   # tool registration
├── tools/                             # one file per MCP tool
├── ontology/ · taxonomy/ · judgment/  # domain data & reasoning
├── lib/ · config/ · schemas/ · server/
└── version.ts
```

## When to Ask

- Before changing ontology/taxonomy schemas — downstream tools depend on them
- Before adding any new network dependency
- Before expanding beyond the quality-management document/tool set — identity-gate decision needed

## License & Credit

- License: MIT (`LICENSE`)
- Provided by: 황룡건설(주) / Developed by: ㈜라텔웍스 (Ratelworks Inc.)
