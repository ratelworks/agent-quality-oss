// ─────────────────────────────────────────────────────────────────────────────
// server/resources.ts — MCP 리소스. 도구를 부르기 전에 AI 비서가 읽어 둘 목록.
//
//   quality://documents          문서 양식 목록(종류·근거·보존기간)
//   quality://ontology/summary   그래프 규모와 근거 등급 분포
// ─────────────────────────────────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/server";
import type { OntologyGraph } from "../ontology/graph.js";
import { getSchema, listSchemaIds } from "../schemas/loader.js";
import { VERSION } from "../version.js";

// ───── 상수 ─────
const MIME_JSON = "application/json";
const URI_DOCUMENTS = "quality://documents";
const URI_ONTOLOGY_SUMMARY = "quality://ontology/summary";

function documentsBody(): string {
  const documents = listSchemaIds().map((id) => {
    const schema = getSchema(id);
    return {
      docId: id,
      title: schema?.title ?? id,
      reference: schema?.reference ?? null,
      retention: schema?.retention ?? null,
      sections: (schema?.sections ?? []).map((s) => s.key),
    };
  });
  return JSON.stringify({ count: documents.length, documents }, null, 2);
}

function ontologySummaryBody(graph: OntologyGraph): string {
  const sourceStatus: Record<string, number> = {};
  for (const entity of graph.entities.values()) {
    const raw = (entity.meta as Record<string, unknown> | undefined)?.["sourceStatus"];
    const status = typeof raw === "string" ? raw : "unlabeled";
    sourceStatus[status] = (sourceStatus[status] ?? 0) + 1;
  }
  return JSON.stringify({ packageVersion: VERSION, stats: graph.stats(), sourceStatus }, null, 2);
}

export function registerResources(server: McpServer, graph: OntologyGraph): void {
  server.registerResource(
    "documents",
    URI_DOCUMENTS,
    {
      title: "품질관리 문서 양식 목록",
      description: "지원하는 문서 양식의 종류·근거·보존기간·섹션 목록. 문서 도구에 넘길 docId 를 여기서 고른다.",
      mimeType: MIME_JSON,
    },
    async () => ({ contents: [{ uri: URI_DOCUMENTS, mimeType: MIME_JSON, text: documentsBody() }] }),
  );

  server.registerResource(
    "ontology-summary",
    URI_ONTOLOGY_SUMMARY,
    {
      title: "온톨로지 요약",
      description: "그래프의 노드·관계 수와 근거 등급(verified·indirect_source·skeleton) 분포.",
      mimeType: MIME_JSON,
    },
    async () => ({
      contents: [{ uri: URI_ONTOLOGY_SUMMARY, mimeType: MIME_JSON, text: ontologySummaryBody(graph) }],
    }),
  );
}
