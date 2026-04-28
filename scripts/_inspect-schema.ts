import { TOOL_MAP } from '../src/mcp/registry.js';
import { OntologyGraph } from '../src/ontology/graph.js';
import { loadOntologySync } from '../src/ontology/loader.js';

const g = new OntologyGraph(loadOntologySync());
const targets = [
  'get_ncr_schema',
  'get_itp_schema',
  'get_test_report_review_schema',
  'get_specimen_record_schema',
  'get_concrete_delivery_record_schema',
];
for (const name of targets) {
  console.log(`\n========== ${name} ==========`);
  const r = TOOL_MAP.get(name)!.run({}, g);
  console.log(JSON.stringify(r.result, null, 2).slice(0, 1500));
}
