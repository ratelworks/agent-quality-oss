#!/usr/bin/env node
/**
 * agent-quality-oss-mcp 엔트리.
 * - `node build/index.js --stdio` → stdio MCP
 * - 기본 → HTTP JSON (node:http)
 */

import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { loadOntologySync } from './ontology/loader.js';
import { OntologyGraph } from './ontology/graph.js';
import { validateOntology } from './ontology/validator.js';
import { createHttpHandler } from './mcp/http.js';

const ontologyData = loadOntologySync();
const graph = new OntologyGraph(ontologyData);
const report = validateOntology(graph);
if (!report.ok) {
  process.stderr.write(
    `[agent-quality-oss-mcp] 온톨로지 검증 실패 — 서버를 기동할 수 없습니다.\n` +
      report.issues
        .filter((i) => i.level === 'error')
        .map((i) => `  - ${i.code} ${i.entityId ?? ''}: ${i.message}`)
        .join('\n') +
      '\n',
  );
  process.exit(1);
}

/** HTTP handler — Cloud Run/custom server에서 재사용 가능 */
export const app = createHttpHandler(graph);

const entry = process.argv[1];
const isDirect = entry != null && import.meta.url === pathToFileURL(entry).href;
if (isDirect) {
  const mode = process.argv.includes('--stdio') ? 'stdio' : 'http';
  if (mode === 'stdio') {
    const { startStdioServer } = await import('./mcp/stdio.js');
    await startStdioServer(graph);
  } else {
    const port = Number(process.env['PORT'] ?? 8080);
    createServer(app).listen(port, () => {
      process.stdout.write(
        `[agent-quality-oss-mcp] HTTP 서버 기동 http://localhost:${port} ` +
          `(ontology v${graph.version}, ${graph.entities.size} entities)\n`,
      );
    });
  }
}
