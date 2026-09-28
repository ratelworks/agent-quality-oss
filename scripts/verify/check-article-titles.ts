#!/usr/bin/env tsx
/**
 * check-article-titles.ts — 조문 노드의 이름이 내장 원문과 같은 조문을 가리키는지 검사
 *
 * 조문 노드(category: law / decree / rule / guideline)의 name 은 "… §N (제목)" 형식이다.
 * 이 name 이 내장 원문(_meta.bodyText)의 첫 조문 머리 "제N조(제목)" 과 조 번호·제목 모두 일치해야 한다.
 * 이름이 원문과 다르면 문서 스키마·도구가 틀린 조문을 근거로 인용하게 된다 (v0.4.1 정정 — 12건 실측).
 *
 * 검출 (exit 1):
 *   - article_number_mismatch : name 의 §N ≠ 원문 머리의 제N조
 *   - article_title_mismatch  : name 괄호 안 제목 ≠ 원문 머리 제목 (공백·가운뎃점 차이는 무시)
 *   - article_heading_missing : 원문은 있는데 조문 머리를 찾지 못함
 *   - article_name_format     : 원문은 조문인데 name 이 "§N (제목)" 형식이 아님 (건너뛰면 통과로 보인다)
 * 경고 (exit 0 유지):
 *   - article_unverified      : 원문이 내장되지 않은 조문 노드 (이름을 대조할 수 없음)
 *
 * 사용: tsx scripts/verify/check-article-titles.ts
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const STANDARDS_DIR = join(ROOT, "src/ontology/graph/nodes/standards");
/** 검사 대상 조문 노드 분류 */
const ARTICLE_CATEGORIES = new Set(["law", "decree", "rule", "guideline"]);
/** 원문 조문 머리: "제55조(제목)" · "제45조의2 (제목)" */
const HEADING_RE = /^제(\d+)조(?:의(\d+))?\s*\(([^)]+)\)/;
/** name 형식: "… §55 (제목)" · "… §45의2 (제목)" */
const NAME_RE = /§(\d+)(?:의(\d+))?\s*\(([^)]+)\)\s*$/;

interface Finding {
  file: string;
  code: string;
  detail: string;
}

/** 비교용 정규화 — 공백·가운뎃점·쉼표 차이는 같은 제목으로 본다 */
function normalizeTitle(s: string): string {
  return s.replace(/[\s·ㆍ・,]/g, "");
}

function articleKey(main: string | undefined, sub: string | undefined): string {
  return sub ? `${main}의${sub}` : String(main);
}

async function main(): Promise<void> {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  let checked = 0;

  for (const file of (await readdir(STANDARDS_DIR)).filter((f) => f.endsWith(".jsonld")).sort()) {
    const node = JSON.parse(await readFile(join(STANDARDS_DIR, file), "utf-8")) as {
      name?: string;
      _meta?: { category?: string; bodyText?: string };
    };
    const meta = node._meta ?? {};
    if (!ARTICLE_CATEGORIES.has(meta.category ?? "")) continue;
    const nameMatch = (node.name ?? "").match(NAME_RE);
    if (!nameMatch) {
      // 원문이 조문이면 이름도 조문 형식이어야 한다 — 형식 이탈을 건너뛰면 틀린 이름이 통과로 보인다
      const bodyIsArticle = (meta.bodyText ?? "")
        .replace(/\*\*/g, "")
        .split("\n")
        .some((l) => HEADING_RE.test(l.trim()));
      if (bodyIsArticle) {
        errors.push({ file, code: "article_name_format", detail: `원문은 조문인데 이름이 "§N (제목)" 형식이 아님: ${node.name}` });
      }
      continue; // 고시 전체 등 조문이 아닌 노드
    }

    if (!meta.bodyText) {
      warnings.push({ file, code: "article_unverified", detail: `원문 미내장 — 이름 대조 불가: ${node.name}` });
      continue;
    }
    const heading = meta.bodyText
      .replace(/\*\*/g, "")
      .split("\n")
      .map((l) => l.trim())
      .map((l) => l.match(HEADING_RE))
      .find((m) => m !== null);
    if (!heading) {
      errors.push({ file, code: "article_heading_missing", detail: `원문에서 조문 머리를 찾지 못함: ${node.name}` });
      continue;
    }
    checked++;
    const nameNo = articleKey(nameMatch[1], nameMatch[2]);
    const bodyNo = articleKey(heading[1], heading[2]);
    if (nameNo !== bodyNo) {
      errors.push({ file, code: "article_number_mismatch", detail: `이름 §${nameNo} ≠ 원문 제${bodyNo}조` });
    }
    const nameTitle = nameMatch[3] ?? "";
    const bodyTitle = heading[3] ?? "";
    if (normalizeTitle(nameTitle) !== normalizeTitle(bodyTitle)) {
      errors.push({ file, code: "article_title_mismatch", detail: `이름 "${nameTitle}" ≠ 원문 "${bodyTitle}"` });
    }
  }

  for (const w of warnings) console.warn(`⚠️  [${w.code}] ${w.file} — ${w.detail}`);
  for (const e of errors) console.error(`❌ [${e.code}] ${e.file} — ${e.detail}`);
  if (errors.length > 0) {
    console.error(`\n조문 이름 검사 실패: ${errors.length}건 (대조 ${checked}건)`);
    process.exit(1);
  }
  console.log(`✅ 조문 이름 검사 통과 — 대조 ${checked}건, 원문 미내장 경고 ${warnings.length}건`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
