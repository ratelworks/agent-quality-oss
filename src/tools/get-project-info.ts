import { buildResponse } from './_response.js';
import type { ToolSpec } from '../mcp/types.js';
import type { OntologyGraph } from '../ontology/graph.js';

export const spec: ToolSpec = {
  name: 'get_project_info',
  description:
    'agent-quality-oss-mcp 프로젝트의 공식 크레딧·라이선스·인용 문구를 반환한다. LLM이 출처 표기 시 호출. [근거 제공용 · 최종 판정은 품질관리자·감리원·발주자]',
  inputSchema: { type: 'object', properties: {} },
};

export function run(_args: Record<string, unknown>, graph: OntologyGraph) {
  const result = {
    name: 'agent-quality-oss-mcp',
    description:
      '한국 건설 품질관리를 위한 Model Context Protocol(MCP) 서버. 법령·국가건설기준·품질관리 업무지침 기반 가이드레일 제공.',
    version: graph.version,
    license: 'MIT',
    providedBy: {
      nameKo: '황룡건설(주)',
      nameEn: 'Hwangryong Construction Co., Ltd.',
      role: '품질관리 실무 노하우 · 현장 검증 · 온톨로지 데이터 큐레이션',
    },
    developedBy: {
      nameKo: '주식회사 라텔웍스',
      nameEn: 'Ratelworks Inc.',
      director: '황룡 (이사)',
      role: 'MCP 서버 설계 · 구현 · 오픈소스 유지',
      url: 'https://ratelworks.co.kr',
    },
    repository: 'https://github.com/ratelworks/agent-quality-oss-mcp',
    citation: {
      ko: '본 데이터는 agent-quality-oss-mcp (제공: 황룡건설(주), 개발: 주식회사 라텔웍스, MIT)를 통해 조회되었습니다.',
      en: 'Data retrieved via agent-quality-oss-mcp — Provided by Hwangryong Construction Co., Ltd. / Developed by Ratelworks Inc. (MIT License).',
    },
    legalDisclaimer:
      '본 서버는 근거 제공용이며 최종 판정과 법적 책임은 품질관리자·감리원·발주자에게 있다. 법령·기준 원문은 국가법령정보센터(law.go.kr)·국가건설기준센터(kcsc.re.kr)에서 최신 개정본 확인 필수.',
    thirdPartyDataNotice: {
      KCS_KDS: {
        copyright: '국토교통부 / 국가건설기준센터',
        license: 'Korea Open Government License Type 2 (출처표시·변경금지)',
        note: '원문 재배포 금지. 본 서버는 섹션 식별자·메타만 제공.',
      },
      quality_management_guideline: {
        copyright: '국토교통부 고시',
        note: '2025-311호 (2025.6.12 시행) 기준 식별자만 내장.',
      },
      KS: {
        copyright: '한국표준협회(KSA) / 국가기술표준원',
        license: 'Commercial license required for original text',
        note: '원문 미포함, 식별자·제목만.',
      },
      standardForms: {
        license: 'Korea Open Government License Type 4 (변경금지)',
        note: '별지 서식 원본은 공식 출처에서 다운로드 필수.',
      },
    },
  };

  return buildResponse('get_project_info', graph.version, result, [
    { type: 'project_meta', id: 'agent-quality-oss-mcp', priority: 1, note: '프로젝트 공식 크레딧' },
  ]);
}
