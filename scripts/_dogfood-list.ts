import { TOOL_MAP } from '../src/mcp/registry.js';
import type { ToolInputSchema } from '../src/mcp/types.js';

for (const [name, m] of TOOL_MAP) {
  console.log('===', name, '===');
  console.log('  desc:', m.spec.description?.slice(0, 140));
  const props = (m.spec.inputSchema as ToolInputSchema).properties ?? {};
  for (const [k, v] of Object.entries(props)) {
    const val = v as { type?: string; enum?: unknown[] };
    console.log('  -', k, ':', val.type ?? (val.enum ? `enum[${val.enum.length}]` : '?'));
  }
}
