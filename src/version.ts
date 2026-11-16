// 파일 최상단 상수 — 버전 관리 단일 출처
// graph.version (온톨로지 버전)과는 별개로 패키지 버전을 노출
export const VERSION = "1.0.0";
export const SERVER_NAME = "agent-quality-oss";
export const SERVER_DESCRIPTION =
  "한국 건설 품질관리 MCP 서버 — KCS·KDS·품질관리 업무지침·KS·법정 별지 서식을 LLM 에이전트가 근거 기반으로 활용하도록 구조화된 도구로 제공. 제공: 황룡건설(주) · 개발: ㈜라텔웍스 · 라이선스: MIT.";
/** MCP 연결 때 AI 비서에게 주는 사용 안내 — 서버 설명 + 도구를 고르는 법 */
export const SERVER_INSTRUCTIONS = [
  SERVER_DESCRIPTION,
  "도구 고르는 법:",
  "- 측정값의 합격·불합격은 evaluate_observation 에 현장 문장을 그대로 넣는다(값을 골라 넣지 않는다). 도구가 판정을 보류하면 그 까닭을 그대로 전하고 필요한 값을 묻는다.",
  "- 레미콘 규격(예: 25-24-150)은 스스로 풀지 말고 compile_concrete_pour_references 의 mixCode 로 넘긴다 — 둘째 수가 호칭강도다.",
  "- 법령·고시의 의무와 절차는 search_quality_law_text 로 조문을 찾고 get_quality_law_article 로 전문을 본다. 어기면 어떻게 되는지(벌점·형벌·과태료)를 묻거나 그 위험이 있으면 상황 낱말에 \"벌점\" 또는 \"처벌\"을 붙여 찾고, penaltyItems 의 항목 번호·점수를 그대로 쓴다.",
  "- 문서를 써 달라는 요청이면 generate_quality_document 를 format: 'hwpx' 로 불러 한글 파일까지 만든다. 받은 값만으로 먼저 만들고, 빠진 칸은 비워 둔 채 무엇이 빠졌는지 알린다(묻느라 파일을 미루지 않는다).",
  "- 사진·도면 이미지를 읽거나 사진으로 길이·폭을 재는 도구는 없다. 사진 판독을 요청받으면 그렇게 밝히고 실제 측정값을 받는다.",
  "- 도구로 확인하지 못한 수치·조문 번호는 지어내지 않는다.",
].join("\n");
export const PROVIDED_BY = "황룡건설(주)";
export const DEVELOPED_BY = "주식회사 라텔웍스 (Ratelworks Inc.)";
