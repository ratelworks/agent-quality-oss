// ─────────────────────────────────────────────────────────────────────────────
// cm-duties.ts — 일마다 건설사업관리기술인(감리)이 해야 하는 일을 정한 사업관리지침 조문을 원문 그대로 꺼낸다.
//
// 검측·자재 검수·품질시험·시공상세도에서 감리가 할 일은 사업관리지침 한 조에 여러 항·호로 흩어져 있다.
// 문장 몇 개만 골라 주면 나머지 의무를 AI 비서가 모른다 — 실제로 "타설 중 계속적인 입회"(제11항 제5호),
// "검측일을 못 지키면 앞뒤로 검측하고 비용은 건설사업관리용역사업자 부담"(제11항 제7호),
// "이형봉강은 공인계량소에서 계량"(검수ㆍ관리 조) 을 빠뜨린 답이 나왔다. 그래서 조 전체를 싣는다.
// 감독 권한대행을 포함하는 건설사업관리(제3장 제8절) 조문을 싣고, 포함하지 않는 경우(제7절)의 조 번호를 함께 알린다.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLaw } from '../ontology/laws.js';

// ───── 상수 ─────
const LINKS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ontology', 'duty-links.json');
const WITH_DELEGATION = '감독 권한대행을 포함하는 건설사업관리(제3장 제8절, 제3조제2항)';
const WITHOUT_DELEGATION = '감독 권한대행을 포함하지 않는 건설사업관리(제3장 제7절, 제3조제2항)';
/** 근거 묶음에 싣는 조의 최대 수 — 조 하나가 2~3천 자다 */
const MAX_DUTY_ARTICLES = 3;

interface DutyLinks {
  law: string;
  duties: Record<string, { label: string; withDelegation: string; withoutDelegation: string }>;
  workTypes: Record<string, string[]>;
  tools: Record<string, string[]>;
  documents: Record<string, string[]>;
}

let linksCache: DutyLinks | null = null;

/** 일 → 감리 의무 조문 연결 자료 */
export function loadDutyLinks(): DutyLinks {
  if (linksCache) return linksCache;
  const data = JSON.parse(readFileSync(LINKS_PATH, 'utf8')) as Partial<DutyLinks>;
  linksCache = { law: data.law ?? '', duties: data.duties ?? {}, workTypes: data.workTypes ?? {}, tools: data.tools ?? {}, documents: data.documents ?? {} };
  return linksCache;
}

export interface CmDuty {
  law: string;
  /** "제86조" */
  ref: string;
  title: string;
  /** 이 조문이 적용되는 경우 */
  appliesWhen: string;
  /** 감독 권한대행을 포함하지 않는 경우의 같은 이름 조문 — 항 번호가 다를 수 있다 */
  otherCase: { ref: string; appliesWhen: string };
  /** 조 전체 원문 */
  text: string;
}

/**
 * 도구·일·문서에 걸린 감리 의무 조문.
 * @param keys "tool:compile_inspection_references" · "work:rebar_placement" · "document:material_source_approval" · "duty:inspection"
 */
export function relatedCmDuties(keys: readonly string[]): CmDuty[] {
  const links = loadDutyLinks();
  const law = findLaw(links.law);
  if (!law) return [];
  const ids = new Set<string>();
  for (const key of keys) {
    const [kind, raw] = key.split(':', 2) as [string, string];
    const id = (raw ?? '').replace(/^work[.:]/u, '');
    const found =
      kind === 'tool' ? links.tools[id] : kind === 'work' ? links.workTypes[id] : kind === 'document' ? links.documents[id] : kind === 'duty' ? [id] : undefined;
    for (const d of found ?? []) ids.add(d);
  }
  const out: CmDuty[] = [];
  for (const id of ids) {
    const duty = links.duties[id];
    const article = duty ? law.articles.find((a) => String(a.number) === duty.withDelegation && !a.branch && !a.deleted) : undefined;
    if (!duty || !article) continue;
    out.push({
      law: law.name,
      ref: `제${duty.withDelegation}조`,
      title: article.title,
      appliesWhen: WITH_DELEGATION,
      otherCase: { ref: `제${duty.withoutDelegation}조`, appliesWhen: WITHOUT_DELEGATION },
      text: article.text,
    });
    if (out.length >= MAX_DUTY_ARTICLES) break;
  }
  return out;
}

/** 근거 묶음에 함께 싣는 안내 */
export const CM_DUTY_NOTE =
  '이 일에서 건설사업관리기술인(감리)이 해야 하는 일을 정한 조문 전체입니다. 감리 업무·입회·검수·확인·비용 부담을 물으면 이 글에서 답하고 항·호 번호를 함께 적습니다 — 한 항만 보고 "규정이 없다"고 답하지 않습니다. 감독 권한대행을 포함하지 않는 건설사업관리면 otherCase 의 조문이 적용되며 항 번호가 다를 수 있으니, 그 경우의 인용은 get_quality_law_article 로 그 조문을 확인합니다.';
