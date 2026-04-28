#!/usr/bin/env node
/**
 * 온톨로지 무결성 검사 CLI.
 */

import { loadOntologySync } from '../src/ontology/loader.js';
import { OntologyGraph } from '../src/ontology/graph.js';
import { validateOntology } from '../src/ontology/validator.js';

const data = loadOntologySync();
const graph = new OntologyGraph(data);
const report = validateOntology(graph);

console.log('[stats]', JSON.stringify(report.stats, null, 2));

const errors = report.issues.filter((i) => i.level === 'error');
const warns = report.issues.filter((i) => i.level === 'warn');

if (warns.length) {
  console.log(`\n[warn] ${warns.length}건`);
  for (const w of warns) console.log(`  - ${w.code} ${w.entityId ?? ''}: ${w.message}`);
}

if (errors.length) {
  console.log(`\n[error] ${errors.length}건`);
  for (const e of errors) console.log(`  - ${e.code} ${e.entityId ?? ''}: ${e.message}`);
  process.exit(1);
}

console.log('\n[OK] 온톨로지 무결성 검사 통과');
