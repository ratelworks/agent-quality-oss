/**
 * 현장 관측값 문자열 파서.
 * "슬럼프 210mm", "기준 150±25mm", "염화물 ≤ 0.30 kg/㎥" 등. 날짜·시각·레미콘 규격(25-24-150)은 측정값으로 읽지 않는다.
 *
 * 여러 번의 시험값과, 판정에 필요한 조건(강도의 종류·공시체의 종류·시공 조건)도 함께 읽는다.
 *   "연속 3회 평균 25 최저 21" → series { mean, min, n }
 *   "압축강도 1회 시험값 21MPa, 호칭강도 24MPa" → scalar 21 + context.fcn=24
 *   "코어 4개 평균 22MPa 최저 17MPa, 품질기준강도 24MPa" → series + context.fcq=24 + strengthCase=core
 */

export type ObservationKind = 'tolerance' | 'range' | 'compare' | 'scalar' | 'series' | 'qualitative';

export interface ObservationToken {
  kind: ObservationKind;
  value?: number;
  min?: number;
  max?: number;
  plusMinus?: number;
  operator?: string;
  unit: string | null;
  original: string;
  /** series 모드 — n회 평균/최저/최고/values */
  n?: number;
  mean?: number;
  values?: number[];
  /** 쉼표로 이어 적은 값들이 공시체 여러 개(1회 시험)인지 여러 회의 시험값인지 문장에 없을 때 */
  listUnclear?: boolean;
  /** values 가 회마다의 시험값이다 ("1회 28.4 / 2회 27.1 / 3회 29.0") — 공시체 값으로 묶어 평균하지 않는다 */
  perTest?: boolean;
  /** values 가 한 회의 공시체 값이다 ("1회: 25.1 26.4 27.8") — 평균이 1회 시험값이다 */
  specimens?: boolean;
  /** 평균 하나만 적혔고, 공시체 평균(1회 시험값)인지 연속 3회 시험값의 평균인지 문장에 없다 */
  meanUnclear?: boolean;
}

/**
 * 판정에 쓰는 조건. 관측값 문장에서 읽는다.
 * 강도의 이름은 KCS 14 20 10 의 뜻을 따른다(2.2.2).
 */
export interface ObservationContext {
  /** 호칭강도 — 레디믹스트 콘크리트를 주문할 때의 강도 (품질기준강도 + 기온보정강도) */
  fcn?: number;
  /** 품질기준강도 — 설계기준압축강도와 내구성기준압축강도 중 큰 값 */
  fcq?: number;
  /** 설계기준압축강도 */
  fck?: number;
  /** 내구성기준압축강도 */
  durabilityFc?: number;
  /** 기온보정강도 */
  tempCorrection?: number;
  /** 어떤 공시체·생산 방식인지 (말하지 않으면 레디믹스트 콘크리트의 표준양생 공시체로 본다) */
  strengthCase?: 'site_batch' | 'field_cured' | 'core';
  /** "공시체 3개 평균"처럼 공시체 여러 개의 평균(= 1회 시험값)을 말했는지 */
  specimenAverage?: boolean;
  /** 단층구조·다층구조 — 슬래브·보 밑면 거푸집 해체 강도가 달라진다 */
  storyType?: 'single' | 'multi';
  /** 필러 동바리 구조 */
  fillerShoring?: boolean;
  /** 한중·서중 콘크리트 — 타설할 때의 콘크리트 온도 기준이 달라진다 */
  weather?: 'cold' | 'hot';
  /** 외기온도 (℃) — 운반시간/한중 분기 */
  ambientTemperature?: number;
  /** 부재 종류 키워드 (slab/beam/column/wall/footing) — R5 거푸집 라우팅 */
  memberKeyword?: string;
}

/** 단위 정규화 (lowercase 기준) */
const UNIT_ALIAS: Readonly<Record<string, string>> = {
  'kg/m3': 'kg/㎥',
  'kg/m³': 'kg/㎥',
  'mpa': 'MPa',
  'degc': '℃',
  '°c': '℃',
};

const UNIT_INLINE =
  '(?:kg\\/㎥|kg\\/m3|kg\\/m³|mpa|MPa|mm|cm|degC|degc|°C|°c|℃|%|m)';
const TOLERANCE_RE = new RegExp(
  `(-?\\d+(?:\\.\\d+)?)\\s*[±±]\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_INLINE})?`,
  'iu',
);
const RANGE_RE = new RegExp(
  `(-?\\d+(?:\\.\\d+)?)\\s*[~\\-]\\s*(-?\\d+(?:\\.\\d+)?)\\s*(${UNIT_INLINE})?`,
  'iu',
);
const COMPARE_RE = new RegExp(
  `(≤|≥|<=|>=|<|>|이상|이하|초과|미만)\\s*(-?\\d+(?:\\.\\d+)?)\\s*(${UNIT_INLINE})?`,
  'iu',
);
const SCALAR_WITH_UNIT_RE = new RegExp(
  `(-?\\d+(?:\\.\\d+)?)\\s*(${UNIT_INLINE})?`,
  'iu',
);
const SCALAR_GLOBAL_RE = new RegExp(SCALAR_WITH_UNIT_RE.source, 'giu');
/** 조건 값의 이름 뒤에 오는 수 — 이름 뒤에 조사·기호가 올 수 있다 ("호칭강도는 27", "fck=24") */
const CONTEXT_NUM = '\\s*(?:은|는|이|가)?\\s*[:=]?\\s*(-?\\d+(?:\\.\\d+)?)(?!\\d|\\.\\d|\\s*-\\s*\\d)';
/** 조건으로 읽는 강도의 이름과 정규식 플래그 — 차례: 호칭강도 · 품질기준강도 · 설계기준압축강도 · 내구성기준압축강도 · 기온보정강도 */
const CONTEXT_LABELS: ReadonlyArray<readonly [label: string, flags: string]> = [
  ['(?:fcn|호칭\\s*강도|호칭)', 'iu'],
  ['(?:fcq|품질\\s*기준\\s*강도)', 'iu'],
  ['(?:fck|설계\\s*기준\\s*(?:압축)?\\s*강도|설계\\s*강도)', 'iu'],
  ['(?:fcd|내구성\\s*기준\\s*(?:압축)?\\s*강도)', 'iu'],
  ['(?:Tn|기온\\s*보정\\s*(?:강도|값)?)', 'u'],
];
/** 외기온도 / 외기 N℃ / 기온 N℃ */
const AMBIENT_TEMPERATURE_RE = /(?:외기(?:온도)?|기온|대기온도)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(?:℃|°C|degC|degc)?/iu;

/** 수 하나와 그 뒤의 단위 */
const VALUE_TOKEN_RE = new RegExp(`(?<![\\d.A-Za-z])(-?\\d+(?:\\.\\d+)?)(?:\\s*(${UNIT_INLINE})(?![A-Za-z/]))?`, 'giu');
/** 수에 바로 붙은, 이 도구가 다루지 않는 단위 ("1.92g/㎤" · "30kN" · "2F") */
const FOREIGN_UNIT_RE = /^[A-Za-z㎤㎡㎥㎏㎜㎝㎞°µ][A-Za-z0-9㎤㎡㎥²³/]*/u;
/** 수 뒤에 한글로 적은 온도 단위 ("32도" · "영하 2도" 의 "도") */
const KOREAN_DEGREE_RE = /^\s?도(?![가-힣])/u;
/** 다루지 않는 단위가 붙은 수의 단위 표시 — 어느 판정기준의 단위와도 같지 않다 */
const FOREIGN_UNIT = '(다른 단위)';
/** 값과 값 사이에 올 수 있는 것 — 공백, 구분 기호 하나, 잇는 말 하나 ("190, 150" · "190·150" · "190 및 150" · "190이고 150") */
const LIST_JOIN_RE = /^\s*(?:(?:이고|이며|이랑|랑|와|과|하고|및|그리고)\s*|(?:[,，、·ㆍ/]\s*)+)?$/u;
/**
 * 순번·횟수·기간·위치처럼 세는 말이 붙은 수 — 측정값이 아니다 ("3호차" · "6호차의" · "2회차" · "28일" · "90분" · "2층째").
 * 여기에 없는 말이 붙은 수는 값으로 남긴다 — 값을 놓쳐 하나만 판정하는 것보다 되묻는 쪽이 안전하다.
 */
/** 두 글자 이상인 세는 말 — 뒤에 무슨 말이 붙어도 세는 말이다 ("4호차입니다" · "1대분의") */
const COUNTER_WORDS = '호차|회차|번차|번째|차수|차례|대분|차분|회분|개월|개소|호기|시간|구간|구역|공구|블록|단계|세트|군데|스팬|경간|호선|루베|리프트|입방|만\\s*원|천\\s*원|억\\s*원';
/** 한 글자 세는 말 — 뒤에 조사·서술어가 붙을 때만 세는 말로 본다 ("3대입니다" 는 세는 말, "160 대기중" 은 아니다) */
const COUNTER_CHARS = '번|차|층|대|회|개|일|월|동|호|분|초(?!과)|톤|명|주|년|배|열|단|급|종|본|조|곳|건|팀|장|매|포|쪽|부|권|원';
const COUNTER_TAIL =
  '(?:째|차|간|쯤|씩|당|후|전|뒤|경|분)?(?:(?:입|임|이었|였|이에|예요|이고|이며|인데|이라|이니|이랑|이나|에서|에는|으로|부터|까지|마다|동안|정도|가량|짜리)[가-힣]*|의|은|는|이|가|을|를|에|로|와|과|만|도)?';
/** 수 바로 뒤에 세는 말이 온다 — 지정값을 가리키는 말 뒤의 수가 세는 수("규격 … 8번차")인지 가리는 데 쓴다 */
export const COUNTER_AFTER_RE = new RegExp(`^\\s*(?:(?:${COUNTER_WORDS})|(?:${COUNTER_CHARS})${COUNTER_TAIL}(?![가-힣a-z]))`, 'u');
export const COUNTER_RE = new RegExp(
  // 한 글자 세는 말은 수에 붙여 쓴 것만 — "175 차 2호" 의 175 는 측정값이고 "차"는 뒤의 "2호"에 걸린다
  `(?:\\d+(?:\\.\\d+)?\\s*[·ㆍ~]\\s*)*\\d+(?:\\.\\d+)?(?:\\s*(?:${COUNTER_WORDS})[가-힣]*|(?:${COUNTER_CHARS})${COUNTER_TAIL}(?![가-힣a-z]))`,
  'giu',
);
/** 기준·조문·표·측점 번호 — 측정값이 아니다 ("KS F 2402" · "KCS 14 20 10" · "제41조" · "별표 2" · "표 1.7-2" · "STA.2+340" · "No.14") */
const REFERENCE_RE =
  /K(?:CS|DS)\s*\d{2}\s*\d{2}(?:\s*\d{2})?(?!\d)|KS\s*[A-Z](?:\s*ISO)?\s*\d+(?:-\d+)?|제\s*\d+\s*조(?:의\s*\d+)?(?:\s*제?\s*\d+\s*항)?|(?<![가-힣])(?:별표|별지|표|그림|부록|서식)\s*(?:제\s*)?\d+(?:\.\d+)*(?:-\d+)?|(?<![\d.])\d{1,3}\s*\+\s*\d{3}(?:\.\d+)?(?!\d)|STA\.?\s*\d+\s*\+\s*\d+(?:\.\d+)?(?:\s*[~\-]\s*(?:STA\.?\s*)?\d+\s*\+\s*\d+(?:\.\d+)?)?|No\.?\s*\d+(?:-\d+)*(?:\s*\+\s*\d+(?:\.\d+)?)?/giu;
/**
 * 식별 번호 — 측정값이 아니다.
 *   전화번호("010-1234-5678" · "010-****-4471"), 차량 번호판("경기88자 4127"), 문서 번호("제2026-0458호" · "2611-0387" · "C-1107-22"),
 *   0 으로 시작하는 번호("0418"), 줄 머리의 항목 번호("3. 품질시험"), 치수("Ø100×200"), 낱개 번호("공시체1")
 */
const IDENTIFIER_RE = new RegExp(
  [
    '(?<![\\d.])0\\d{1,2}[-.\\s]?(?:\\d{3,4}|[*xX○●]{3,4})[-.\\s]\\d{4}',
    // 층 표기 — "7F" · "B2F" · "B1" (위치이지 값이 아니다)
    '(?<![\\d.A-Za-z])B?\\d{1,3}F(?![A-Za-z\\d])|(?<![\\d.A-Za-z])B\\d{1,2}(?![A-Za-z\\d.])',
    // 파일 이름 — "노상_다짐도_95.pdf"
    '[^\\s,，、()（）]*\\.(?:pdf|hwpx?|xlsx?|xls|docx?|jpe?g|png|zip|csv)(?![A-Za-z])',
    '#\\s?\\d+',
    '[*]{2,}[-.\\s]?\\d{2,4}',
    '(?:[가-힣]{2}\\s?)?(?<![\\d.])\\d{2,3}\\s?[가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주아바사자하허호배]\\s?\\d{4}(?!\\d)',
    '제\\s*\\d[\\d가-힣-]*\\s*호',
    '(?<![가-힣A-Za-z])[가-힣]{1,3}-\\d+(?:-\\d+)*',
    '(?<![\\d.])\\d+-\\d+\\s*호선',
    '(?<![\\d.])\\d+-0\\d+(?:-\\d+)*',
    '(?<![\\d.])\\d{4,}-\\d+(?:-\\d+)*',
    '(?<![\\d.])0\\d{2,}(?![\\d.])',
    '(?<![A-Za-z가-힣])[A-Za-z]{1,4}-\\d+(?:-\\d+)*',
    '(?:^|\\n)\\s*(?:\\d{1,2}[.)]|\\(\\d{1,2}\\))\\s+(?=\\S)',
    '[ØΦφ]?\\s*\\d+(?:\\.\\d+)?\\s*[×xX]\\s*\\d+(?:\\.\\d+)?(?:\\s*[×xX]\\s*\\d+(?:\\.\\d+)?)?',
    '[ØΦφ]\\s*\\d+(?:\\.\\d+)?',
    '(?:공시체|시험체|시료|샘플|몰드)\\s*(?:No\\.?)?\\s*[1-9](?![\\d.]|\\s*(?:개|본|조|회|MPa))',
  ].join('|'),
  'gu',
);
/**
 * 기록의 다른 칸 — 이 말 바로 뒤의 수는 그 칸의 값이지 측정값이 아니다 ("회차 4" · "층: 3" · "일자 11.03" · "타설누계 72" · "끝번호 4521").
 * 여기에 없는 말 뒤의 수("재시험 6.5" · "B구간 92")는 측정값일 수 있으므로 남긴다.
 */
const FIELD_VALUE_RE =
  /(?<![가-힣A-Za-z\d])(?:일자|날짜|일시|시험일|타설일|측정일|작성일|출하일|회차|차수|층|동|호기|부위|위치|공종|규격|타설량|타설\s*누계|누계|누적|물량|수량|잔량|인원|장비|대수|비고|재령|끝\s*번호|끝\s*자리|뒷\s*자리|연락처|전화\s*번호|전화|휴대폰|핸드폰|내선|납품서|송장|성적서|문서|접수|관리|차량|운반차|등록|배합\s*번호|로트|LOT|순번|연번|금액|단가|비용|견적|페이지)\s*(?:번호|No\.?)?\s*[:：=]?\s*\d+(?:[.\-/]\d+)*/giu;
/**
 * 날짜·시각 — 측정값으로 읽지 않는다
 * ("2026-11-16" · "26.11.12" · "11.13(목)" · "(STA 7+120, 11.14 15:30)" 의 11.14 · "11월 13일" · "11/12" · "09:40" · "8시 30분").
 * 시각 앞의 "월.일" 은 구분 기호 뒤에 적힌 것만 날짜로 읽는다 — "공기량 5.12 10:30" 의 5.12 는 측정값이다.
 * 시각의 "시"는 수에 붙여 쓴 것만 읽는다 — "175 시험" 의 75 를 시각으로 읽지 않는다.
 */
export const DATE_TIME_RE =
  /(?<![\d.])(?:19|20)\d{2}\s*[-./년]\s*(?:1[0-2]|0?[1-9])\s*[-./월]\s*(?:3[01]|[12]\d|0?[1-9])(?!\d)\s*일?|(?<![\d.])\d{2}\.\d{1,2}\.\d{1,2}(?![\d.])|(?<![\d.-])\d{2}-(?:1[0-2]|0?[1-9])-(?:3[01]|[12]\d|0?[1-9])(?![\d-])|(?<![\d.])20\d{2}\.\s?(?:1[0-2]|0?[1-9])(?![\d.])|(?<![\d.])(?:1[0-2]|0?[1-9])\.\s+(?:3[01]|[12]\d|0?[1-9])\.(?!\d)|(?<![\d.])\d{1,2}\.\d{1,2}\.?\s*\((?:월|화|수|목|금|토|일)\)|(?<=(?:^|[(\[,;|/\n])\s*)(?:1[0-2]|0?[1-9])\.(?:3[01]|[12]\d|0?[1-9])(?=\s+\d{1,2}\s*:\s*\d{2})|\((?:월|화|수|목|금|토|일)\)|\(\s*(?:1[0-2]|0[1-9])\.(?:3[01]|[12]\d|0[1-9])\s*\)|\d{1,2}\s*월\s*\d{1,2}\s*일|(?<![\d./])(?:1[0-2]|0?[1-9])\/(?:3[01]|[12]\d|0?[1-9])(?![\d./]|\s*(?:mm|cm|%|MPa|kg))|(?<![\d.])\d{1,2}:\d{2}(?::\d{2})?(?!\d|\.\d)|(?<![\d.])\d{1,2}시(?:\s*\d{1,2}\s*분)?/giu;
/**
 * 레디믹스트 콘크리트 규격 "굵은골재 최대치수-호칭강도-슬럼프" (예: 25-24-150).
 * 첫 수가 굵은골재 최대치수(10·13·15·19·20·25·40)이고 둘째 수가 15 이상일 때만 규격으로 읽는다 — "26-11-13" 은 날짜다.
 */
export const MIX_CODE_RE = /(?<![\d.-])(10|13|15|19|20|25|40)\s*-\s*(1[5-9]|[2-9]\d|1\d{2})\s*-\s*(\d{2,3})(?!\d|\s*-\s*\d)/u;
const MIX_CODE_ALL_RE = new RegExp(MIX_CODE_RE.source, 'gu');

/**
 * 측정 항목을 가리키는 말. 수 앞에 이 말이 있으면 그 수는 그 항목의 값으로 본다 —
 * "공기량 3.3 슬럼프 185" 에서 185 는 슬럼프의 값이지 공기량의 두 번째 값이 아니다.
 * 긴 말을 먼저 둔다(같은 자리에서 끝나면 긴 말을 고른다: "외기온도" 는 "온도" 가 아니다).
 */
const QUANTITY_WORDS: readonly string[] = [
  '물결합재비', '외기온도', '대기온도', '건조밀도', '단위수량', '투수계수', '열전도율',
  '함수비', '공기량', '염화물', '슬럼프', '다짐도', '외기온', '안정도', '지지력', '흡수율',
  '최대치수', '함수량', '잔골재율', '시멘트량', '침하량', '평탄성', '공극률', '흐름값', '통과율', '조립률', '마모율', '연신율', '함수율', '풍속', '수온',
  '강도', '온도', '기온', '밀도', '습도', '두께', '피복', '간격', '플로', '함량', '하중', '치수', '길이', '높이', '깊이', '연장', '직경', '지름', 'CBR', 'W/B', 'W/C',
];

/**
 * 줄여 쓰거나 영문으로 쓴 항목 이름 → 항목 이름 ("SLUMP 155" · "슬 180" · "에어5.3" · "Cl 0.05" · "OMC 12.1" · "γdmax 1.95").
 * 한 글자 줄임말("슬" · "염")은 수 바로 앞에 따로 적혔을 때만 읽는다.
 */
const QUANTITY_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/슬럼(?!프)|(?<![A-Za-z])SLUMP(?![A-Za-z])|(?<![A-Za-z])S\.?L\.?(?![A-Za-z/])|(?<![가-힣])슬\s*[:=]?\s*$/giu, '슬럼프'],
  [/(?<![가-힣])공기(?!량)|에어(?!컨)|(?<![A-Za-z])AIR(?![A-Za-z])|(?<![가-힣])공\s*[:=]?\s*$/giu, '공기량'],
  [/염분|염화\s*이온|염소\s*이온|(?<![A-Za-z])Cl(?![A-Za-z])|(?<![가-힣])염\s*[:=]?\s*$/giu, '염화물'],
  [/(?<![A-Za-z])OMC(?![A-Za-z])/giu, '함수비'],
  [/γ\s*d(?:\s*max)?|γ\s*t|(?<![A-Za-z])r\s*d\s*max/giu, '밀도'],
  [/(?<![A-Za-z])TEMP(?![A-Za-z])|콘온|(?<![가-힣])온\s*[:=]?\s*$|(?<![A-Za-z])T\s*[:=]?\s*$/giu, '온도'],
  [/(?<![A-Za-z])FLOW(?![A-Za-z])/giu, '플로'],
  [/물\s*시멘트\s*비/gu, 'W/C'],
  [/(?<![A-Za-z])S\/a(?![A-Za-z])/giu, '잔골재율'],
];
/** 측정값을 가리키는 말 — 수 바로 앞에 있으면 그 수는 이 시험의 값이다 ("시험값 30.8" · "결과 6.8") */
/** 낱말 끝의 조사 — "질량의" → "질량", "사진에도" → "사진" */
const PARTICLE_TAIL_RE = /(?:에서는|에서|에도|에는|에게|으로|해도|라도|까지|부터|의|은|는|이|가|을|를|로|에|와|과|도|만)$/u;
/** 측정값을 가리키는 말이 든 낱말 — 다른 양의 이름이 아니다 ("재시험도 5.2%" · "판정란에도 170" · "염화물 함유량 0.34") */
const NEUTRAL_MEASURE_PART_RE = /측정|시험|결과|실측|입회|판정|기록|확인|평균|수치|함유량|함량/u;
/** 세는 말이 붙은 이름 — 양의 이름이 아니다 ("1호차" · "3회차") */
const COUNTER_NOUN_RE = /(?:호차|회차|번차|차수|차량|일차|대차|층차)$/u;
/** '도'로 끝나는 양의 이름 — '도'는 조사와 겹치므로 이름을 하나씩 적는다 */
const OTHER_MEASURE_DO_RE = /(?:온도|밀도|강도|농도|습도|각도|속도|경도|입도|점도|조도)$/u;
/** 양을 나타내는 이름의 끝 — "오차" · "첨가량" · "진척률" · "질량" · "두께" … */
const OTHER_MEASURE_NOUN_RE = /(?:률|율|량|비|차|치|폭|두께|기간|시간|거리|길이|높이|깊이|간격|오차|편차|무게|용량|체적|면적|금액|단가|진척|공정)$/u;
const GENERIC_VALUE_LABEL_RE = /(?:시험값|측정값|측정치|실측값?|결과값?|시험\s*결과|재시험|재측정|결과)\s*(?:은|는|이|가|도)?\s*[:=]?\s*$/u;

/** 글에 든 측정 항목 이름들 — 판정기준의 이름에서 '이 기준이 다루는 항목'을 얻는 데 쓴다 */
export function quantityWordsIn(text: string): string[] {
  return QUANTITY_WORDS.filter((w) => text.includes(w));
}

/** 글에서 마지막으로 나오는 측정 항목 이름 — 없으면 null */
function lastQuantityWord(raw: string): string | null {
  // "들밀도"는 다짐도를 재는 시험의 이름이다 — 밀도라는 항목 이름으로 읽지 않는다
  const text = raw.replace(/들밀도/gu, '들밀 ');
  let best: { end: number; length: number; word: string } | null = null;
  const consider = (end: number, length: number, word: string): void => {
    if (best === null || end > best.end || (end === best.end && length > best.length)) best = { end, length, word };
  };
  for (const word of QUANTITY_WORDS) {
    const at = text.lastIndexOf(word);
    if (at >= 0) consider(at + word.length, word.length, word);
  }
  for (const [re, word] of QUANTITY_ALIASES) {
    for (const m of text.matchAll(re)) consider((m.index ?? 0) + m[0].length, m[0].length, word);
  }
  return (best as { word: string } | null)?.word ?? null;
}

/** 이어 적은 값의 묶음 */
export interface ValueRun {
  values: number[];
  /** 묶음 안 어느 값에든 붙어 있던 단위 — 하나도 없으면 null */
  unit: string | null;
  /** 묶음 바로 앞에 적힌 측정 항목 이름 ("공기량 4.8" 의 공기량) — 없으면 null */
  label: string | null;
  /** 묶음 바로 앞에 측정값을 가리키는 말이 있다 ("시험값 30.8") */
  generic: boolean;
  /** 묶음 앞뒤에 재서 나온 값이라는 말이 있다 ("175 나왔습니다" · "쟀더니 160") */
  cue: boolean;
  /** 묶음 바로 앞의 낱말 ("오차 0.1%" 의 오차) — 그 낱말의 값인지 가리는 데 쓴다 */
  nearWord?: string | null;
}

/** 수 뒤에 붙는, 재서 나온 값이라는 말 */
const CUE_AFTER_RE =
  /^\s*(?:mm|%|MPa|kg\/㎥)?\s*(?:이|가|으로|로|은|는|을|를)?\s*(?:나왔|나옴|나오|나와|나온|측정|확인|찍|떴|기록|였|이었|입니다|임다|이에요|예요|이고|이며|이네|이요|요(?![가-힣])|이라고|라고|밖에|이면|인데|이던데|이래요|이랍니다)/u;
/** 수 앞에 붙는, 재서 나온 값이라는 말 */
const CUE_BEFORE_RE =
  /(?:측정|실측|결과|시험값|쟀더니|재니까?|재보니|재봤는데|재봤더니|잰\s*게|잰\s*거|찍어보니|떠보니|나온\s*게|값|수치)\s*(?:은|는|이|가|도|:|=)?\s*$/u;

const CIRCLED_DIGITS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
/** 지운 자리 표시 — 공백이 아니므로 다음 단계의 \\s* 가 건너지 못한다. 돌려주기 전에 공백으로 바꾼다 */
const HOLE_MARK = '\u2063';
const HOLE_FILL = ` ${HOLE_MARK} `;
const HOLE_MARK_RE = /\u2063/gu;

// ───── 표 펴기 ─────
/** 칸 이름 끝에 적은 단위 — "측정공기량(%)" · "호칭강도(MPa)" · "재령(일)" */
const TABLE_UNIT_RE = /\s*[(（]\s*(mm|cm|%|MPa|kg\/㎥|kg\/m3|kg\/m³|℃|°C|일|kgf\/㎠|kgf\/cm2|kgf\/cm²|kg\/㎠|kg\/cm2|psi|ppm|㎥)\s*[)）]\s*$/iu;
/** 칸에 든 값이 수(또는 범위·±)인가 */
const TABLE_NUMBER_CELL_RE = /^-?\d+(?:\.\d+)?(?:\s*(?:[~\-]|±)\s*-?\d+(?:\.\d+)?)?$/u;
/** 회차 칸의 이름 — 그 칸의 수는 "N회"로 편다 */
const ROUND_HEADER_RE = /^(?:회차|회|차수|시험\s*회차|시험\s*차수)$/u;

function tableSeparator(line: string): RegExp | null {
  if (line.includes('\t')) return /\t+/u;
  if (line.includes('|')) return /\s*\|\s*/u;
  if (line.includes(',')) return /\s*,\s*/u;
  return null;
}

function tableCells(line: string, sep: RegExp): string[] {
  const cells = line.split(sep).map((c) => c.trim());
  // 줄 앞뒤의 칸 구분 기호("| a | b |")가 만드는 빈 칸은 칸이 아니다
  if (sep.source.includes('|')) {
    while (cells.length > 0 && cells[0] === '' && line.trim().startsWith('|')) cells.shift();
    while (cells.length > 0 && cells[cells.length - 1] === '' && line.trim().endsWith('|')) cells.pop();
  }
  return cells;
}

/** 머리글 줄 — 칸이 둘 이상이고, 칸마다 이름(글자)이 있고 수만 적힌 칸이 없다 */
function isHeaderRow(cells: string[]): boolean {
  if (cells.length < 2) return false;
  return cells.every((c) => c.length > 0 && /[가-힣A-Za-z]/u.test(c) && !/\d/u.test(c.replace(TABLE_UNIT_RE, '')));
}

/**
 * 표(머리글 줄 + 자료 줄)를 "칸 이름 값" 문장으로 편다 — 값이 어느 칸의 값인지를 이름이 바로 앞에 붙은 모양으로 바꾼다.
 *   "부위,목표공기량(%),측정공기량(%) ⏎ 기초,4.5,6.4" → "부위 기초, 목표공기량 4.5%, 측정공기량 6.4%"
 *   "항목 | 기준 | 결과 ⏎ 공기량(%) | 4.5±1.5 | 5.3"   → "공기량 기준 4.5±1.5%, 공기량 결과 5.3%" (첫 칸이 단위 붙은 항목 이름이면 줄의 이름)
 *   "회차 | 시험값 ⏎ 1 | 31.2"                        → "1회 시험값 31.2"
 * 빈 칸은 싣지 않는다 — 측정 칸이 비면 측정값이 없는 줄이 된다.
 * 표가 아니면(머리글 줄이 없거나 칸 수가 다르면) 글을 그대로 둔다.
 */
export function linearizeTables(text: string): string {
  if (typeof text !== 'string' || !text.includes('\n')) return text;
  const lines = text.split(/\r?\n/u);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const sep = tableSeparator(line);
    const header = sep ? tableCells(line, sep) : [];
    if (!sep || !isHeaderRow(header)) {
      out.push(line);
      continue;
    }
    const rows: string[][] = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const next = lines[j] as string;
      if (tableSeparator(next)?.source !== sep.source) break;
      const cells = tableCells(next, sep);
      if (cells.length !== header.length || isHeaderRow(cells)) break;
      if (!cells.some((c) => /\d/u.test(c))) break;
      rows.push(cells);
    }
    if (rows.length === 0) {
      out.push(line);
      continue;
    }
    const names = header.map((h) => h.replace(TABLE_UNIT_RE, '').trim());
    const units = header.map((h) => h.match(TABLE_UNIT_RE)?.[1] ?? '');
    for (const cells of rows) {
      const parts: string[] = [];
      let start = 0;
      let rowName = '';
      let rowUnit = '';
      const first = cells[0] ?? '';
      if (TABLE_UNIT_RE.test(first)) {
        // 첫 칸이 단위 붙은 항목 이름 — 이 줄의 값은 그 항목의 값이다
        rowName = first.replace(TABLE_UNIT_RE, '').trim();
        rowUnit = first.match(TABLE_UNIT_RE)?.[1] ?? '';
        start = 1;
      } else if (ROUND_HEADER_RE.test(names[0] ?? '') && /^\d+$/u.test(first)) {
        parts.push(`${first}회`);
        start = 1;
      }
      for (let k = start; k < cells.length; k += 1) {
        const cell = cells[k] as string;
        if (cell === '') continue;
        const unit = rowUnit || units[k] || '';
        const value = unit && TABLE_NUMBER_CELL_RE.test(cell) ? `${cell}${unit}` : cell;
        parts.push(`${rowName ? `${rowName} ` : ''}${names[k] ?? ''} ${value}`.trim());
      }
      out.push(parts.join(', '));
    }
    i = j - 1;
  }
  return out.join('\n');
}

/** 측정값의 단위 표기 — 단위가 붙은 수가 번호·칸 규칙에 먹혔는지 볼 때 쓴다 */
const MEASURE_UNIT_AFTER: Readonly<Record<string, RegExp>> = {
  mm: /^\s*mm(?![A-Za-z²³])/iu,
  '%': /^\s*%/u,
  MPa: /^\s*MPa/iu,
  'kg/㎥': /^\s*kg\s*\/\s*(?:㎥|m3|m³)/iu,
  '℃': /^\s*(?:℃|°C|degC)/iu,
};

/**
 * 이 기준의 단위가 붙은 수를 번호·기록 칸·세는 말로 읽어 지운 곳 — 지운 글 조각을 돌려준다.
 * "오후 차량 0.27 kg/㎥" 의 "차량 0.27" 처럼 측정값이 번호로 지워지면 남은 값 하나로 판정하게 된다.
 * 단위가 붙은 수는 측정값일 가능성이 높으므로, 이런 곳이 있으면 판정하지 않는다.
 */
export function swallowedMeasuredValues(text: string, unit: string | null | undefined): string[] {
  const after = unit ? MEASURE_UNIT_AFTER[unit] : undefined;
  if (!after || typeof text !== 'string') return [];
  const found: string[] = [];
  let t = text.replace(MIX_CODE_ALL_RE, ' ').replace(DATE_TIME_RE, ' ').replace(REFERENCE_RE, ' ');
  for (const re of [IDENTIFIER_RE, FIELD_VALUE_RE]) {
    t = t.replace(re, (m: string, ...rest: unknown[]) => {
      const whole = rest[rest.length - 1] as string;
      const offset = rest[rest.length - 2] as number;
      if (/\d$/u.test(m) && after.test(whole.slice(offset + m.length))) found.push(m.trim());
      return ' ';
    });
  }
  return found;
}
/**
 * 읽기 전에 표기를 고른다 — 뜻은 바꾸지 않는다.
 *   자릿점("1,000㎡"), 동그라미 숫자("①회" → "1회", 그 밖의 번호 표시는 지운다), 한 글자 단위 기호("㎜" · "％"),
 *   말로 적은 단위("180미리" · "20센치" · "5프로" · "24메가"), "N/mm²"(= MPa), 염화물 이온 표기 "Cl-", 붙여 쓴 영문 이름표("SL165" → "SL 165"), 띄어 적은 규격("규격은 25 24 150" → "25-24-150"), 이름 옆에 적은 단위("슬럼프(cm): 12.5" → "12.5cm")
 */
export function normalizeNotation(text: string): string {
  return linearizeTables(text)
    .replace(/([①-⑳])\s*(?=회|차|번)/gu, (_, c: string) => String(CIRCLED_DIGITS.indexOf(c) + 1))
    .replace(/[①-⑳]/gu, ' ')
    .replace(/(?<![\d.,])(?:\d{1,2}(?:,\d{3})+|\d{3}(?:,000)+)(?![\d,])/gu, (n) => n.replace(/,/gu, ''))
    .replace(/㎜/gu, 'mm')
    .replace(/％/gu, '%')
    .replace(/㎫/gu, 'MPa')
    .replace(/㎏/gu, 'kg')
    .replace(/N\s*\/\s*(?:mm²|mm2|㎟)/gu, 'MPa')
    .replace(/(?<![A-Za-z])Cl\s*[-⁻](?=\s|$)/giu, 'Cl ')
    // 이름 옆에 적은 단위를 값으로 옮긴다 — "슬럼프(cm): 12.5" 는 12.5cm 다
    .replace(
      /\((mm|cm|%|MPa|kg\/㎥|kg\/m3|℃)\)([\s:：=|]*)(-?\d+(?:\.\d+)?)(?![\d.])(?!\s*(?:mm|cm|%|MPa|kg|℃))/giu,
      (_, unit: string, gap: string, value: string) => `${gap || ' '}${value}${unit}`,
    )
    .replace(/(?<![A-Za-z])(SLUMP|SL|AIR|CL|TEMP|OMC)(?=\d)/giu, '$1 ')
    .replace(/(규격\s*(?:은|는|이|가|:)?\s*)(10|13|15|19|20|25|40)\s+(1[5-9]|[2-9]\d)\s+(\d{2,3})(?!\d)/gu, '$1$2-$3-$4')
    .replace(/(\d)(?:센티미터|센치미터|센치|센티)(?![가-힣])/gu, '$1cm')
    .replace(/(\d)(?:미리미터|밀리미터|미리|밀리)(?![가-힣])/gu, '$1mm')
    .replace(/(\d)(?:퍼센트|프로|퍼)(?![가-힣])/gu, '$1%')
    .replace(/(\d)(?:메가파스칼|메가)(?![가-힣])/gu, '$1MPa');
}

/** 측정값이 아닌 수(날짜·시각·레미콘 규격·기준과 측점 번호·식별 번호·기록의 다른 칸·세는 말이 붙은 수)를 걷어 낸다 */
export function stripNonValues(text: string): string {
  return stripNonValuesWithHoles(text).replace(HOLE_MARK_RE, ' ');
}

/**
 * 지운 자리를 표시로 남긴다 — 뒤 단계가 지운 자리를 건너 앞뒤 글을 이어 읽지 않게 한다.
 * ("슬럼프 175 차량 2호" 에서 "차량 2" 를 지운 뒤 "175 … 호" 를 세는 말로 이어 읽어 측정값 175 를 지우던 것)
 */
function stripNonValuesWithHoles(text: string): string {
  return text
    .replace(MIX_CODE_ALL_RE, HOLE_FILL)
    .replace(DATE_TIME_RE, HOLE_FILL)
    .replace(REFERENCE_RE, HOLE_FILL)
    .replace(IDENTIFIER_RE, HOLE_FILL)
    .replace(FIELD_VALUE_RE, HOLE_FILL)
    .replace(COUNTER_RE, HOLE_FILL);
}

/**
 * 글에 적힌 수를 이어 적은 묶음으로 나눈다.
 * 값 사이에 공백·구분 기호·잇는 말만 있으면 한 묶음이다. 단위는 묶음의 어느 값에 붙어 있어도 묶음 전체의 단위로 본다
 * ("160, 175, 190mm" 는 mm 값 셋). 서로 다른 단위가 붙은 수는 한 묶음으로 잇지 않는다("185mm, 25℃").
 * 묶음마다 바로 앞에 적힌 측정 항목 이름을 함께 읽는다.
 * 측정값이 아닌 수는 부르는 쪽이 먼저 걷어 낸다(stripNonValues · stripNonMeasurements) — 여기서 다시 걷어 내지 않는다.
 */
export function readValueRuns(clean: string): ValueRun[] {
  const runs: ValueRun[] = [];
  let current: ValueRun | null = null;
  let lastEnd = 0;
  for (const m of clean.matchAll(VALUE_TOKEN_RE)) {
    const value = Number(m[1]);
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const after = clean.slice(end);
    const unit = normalizeUnit(m[2]) ?? (KOREAN_DEGREE_RE.test(after) ? '℃' : FOREIGN_UNIT_RE.test(after) ? FOREIGN_UNIT : null);
    const gap = clean.slice(lastEnd, start);
    const joined = current !== null && LIST_JOIN_RE.test(gap) && (current.unit === null || unit === null || current.unit === unit);
    const cue = CUE_AFTER_RE.test(after) || CUE_BEFORE_RE.test(gap);
    if (joined && current) {
      current.values.push(value);
      current.unit ??= unit;
      current.cue ||= cue;
    } else {
      current = { values: [value], unit, label: lastQuantityWord(gap), generic: GENERIC_VALUE_LABEL_RE.test(gap), cue, nearWord: nearWordOf(gap) };
      runs.push(current);
    }
    lastEnd = end;
  }
  return runs;
}

/** 기준을 적은 표현 — 측정값이 아니다 ("150±25" · "3~6%" · "95% 이상" · "0.3 넘었으니" · "0.1 모자란데" · "≥ 95%" · "기준 95%") */
const CRITERION_STATEMENT_RES: readonly RegExp[] = [
  // 차이를 여럿 이어 적은 것 — "0.1, 0.2 모자란"
  new RegExp(`(?:\\d+(?:\\.\\d+)?\\s*[,·]\\s*)+\\d+(?:\\.\\d+)?\\s*(?:${UNIT_INLINE})?\\s*(?:모자|부족|차이|오버)`, 'giu'),
  new RegExp(TOLERANCE_RE.source, 'giu'),
  new RegExp(RANGE_RE.source, 'giu'),
  new RegExp(`-?\\d+(?:\\.\\d+)?\\s*(?:${UNIT_INLINE})?\\s*(?:만|도|은|는|이|가|에|을|를)?\\s*(?:이상|이하|초과|미만|이내|넘|모자|부족|미달|차이|오버|밑돌|웃돌|보다|까지|안쪽)`, 'giu'),
  new RegExp(`[±]\\s*\\d+(?:\\.\\d+)?\\s*(?:${UNIT_INLINE})?`, 'giu'),
  new RegExp(`(?:≤|≥|<=|>=|<|>)\\s*-?\\d+(?:\\.\\d+)?\\s*(?:${UNIT_INLINE})?`, 'giu'),
  // 견주어 적은 수 — "95에 거의 붙었으니" · "반올림하면 6이라"
  new RegExp(`-?\\d+(?:\\.\\d+)?\\s*(?:${UNIT_INLINE})?\\s*(?:에|과|와|이랑)\\s*(?:거의|가깝|가까|근접|붙|근사|육박|걸치|턱걸이|못\\s*미)`, 'giu'),
  new RegExp(`반올림\\s*(?:하면|해서|하여|해도|시|으로)?\\s*-?\\d+(?:\\.\\d+)?\\s*(?:${UNIT_INLINE})?`, 'giu'),
  // 가정으로 적은 수 — "반올림해서 95로 볼 수 있나요" · "95%로 쳐도 되나요"
  new RegExp(`-?\\d+(?:\\.\\d+)?\\s*(?:${UNIT_INLINE})?\\s*(?:으로|로)\\s*(?:볼|보면|봐도|보아도|쳐도|치면|칠|인정|간주|처리)`, 'giu'),
  // 무엇과 견준 차이 — "기준보다 0.02 높다" · "전 차보다 10mm 낮게"
  new RegExp(
    // 견준 말과 수 사이에 낱말이 끼어도("호칭 180 대비 슬럼프가 30mm 높게") 그 수는 차이다
    `(?:보다|대비|비해|비하여|비교해|비교하여)\\s*(?:[^\\d\\n.,]{1,10}?\\s*)?(?:약\\s*)?-?\\d+(?:\\.\\d+)?\\s*(?:${UNIT_INLINE})?\\s*(?:정도|가량|쯤)?\\s*(?:더\\s*)?(?:높|낮|많|적|크|작|올라|내려|떨어|초과|미달|모자|부족|빠|못\\s*미)`,
    'giu',
  ),
  // 가정한 차이 — "10mm만 낮았어도" · "0.3만 낮았어도" · "2만 더 높았으면" · "0.5 더 나왔으면"
  new RegExp(
    `-?\\d+(?:\\.\\d+)?\\s*(?:${UNIT_INLINE})?\\s*(?:만|정도만|이라도|씩)\\s*(?:더\\s*)?(?:높|낮|많|적|크|작|올라|내려|올랐|내렸|떨어|나왔|들어|빠)`,
    'giu',
  ),
  new RegExp(
    `-?\\d+(?:\\.\\d+)?\\s*(?:${UNIT_INLINE})?\\s*(?:정도|가량)?\\s*더\\s*(?:높|낮|많|적|크|작|올라|내려|떨어|나왔|들어|빠)`,
    'giu',
  ),
  new RegExp(
    `(?:관리\\s*)?(?:기준|허용|상한|하한|규정|시방)(?:값|치|범위|기준)?\\s*(?:은|는|이|가|인|:|=)?\\s*[(（]?\\s*-?\\d+(?:\\.\\d+)?\\s*(?:${UNIT_INLINE})?\\s*[)）]?`,
    'giu',
  ),
  // 정해 둔 값 — "목표공기량 4.5%" · "지정 공기량은 4.5" · "설계 다짐도 95" (측정값이 아니다)
  new RegExp(
    `(?:목표|지정|설계|계획|호칭|소요|주문)\\s*(?:공기량|슬럼프|다짐도|염화물(?:량)?|온도|강도|값|치)?\\s*(?:은|는|이|가|인|을|를|:|=)?\\s*[(（]?\\s*-?\\d+(?:\\.\\d+)?\\s*(?:${UNIT_INLINE})?\\s*[)）]?`,
    'giu',
  ),
];

/**
 * 측정값이 아닌 수와 기준을 적은 표현을 걷어 낸다 — 남는 수만 측정값 후보다.
 * 번호·날짜를 먼저 걷어 낸다. 기준 표현을 먼저 걷어 내면 "STA.3+240~3+380" 의 "240~3" 을 범위로 읽어 번호가 깨진다.
 */
export function stripNonMeasurements(text: string): string {
  let clean = stripNonValuesWithHoles(text);
  for (const re of CRITERION_STATEMENT_RES) clean = clean.replace(re, HOLE_FILL);
  return clean.replace(HOLE_MARK_RE, ' ');
}

/** 조건으로 읽은 수(기준 강도·기온보정값·기온) — 값 하나를 고를 때 뺀다 */
function contextValues(context: ObservationContext): Set<number> {
  const values = new Set<number>();
  for (const v of [context.fcn, context.fcq, context.fck, context.durabilityFc, context.tempCorrection, context.ambientTemperature]) {
    if (v !== undefined) values.add(v);
  }
  return values;
}

/**
 * 조건을 적은 표현("호칭강도 27MPa" · "fck=24" · "기온보정강도 3MPa" · "외기온도 33℃")을 걷어 낸다.
 * 값이 같은 수를 빼는 것이 아니라 적힌 자리를 걷어 낸다 — "압축강도 24MPa, fck 24MPa" 에서 측정값 24 는 남는다.
 */
function stripContextStatements(text: string): string {
  let clean = text;
  for (const [label, flags] of CONTEXT_LABELS) {
    clean = clean.replace(new RegExp(`${label}${CONTEXT_NUM}\\s*(?:MPa)?`, `g${flags}`), ' ');
  }
  return clean.replace(new RegExp(`${AMBIENT_TEMPERATURE_RE.source}\\s*도?`, 'giu'), ' ');
}

/**
 * 이 묶음이 판정할 항목의 값일 수 있는가.
 *   단위: 판정기준의 단위가 붙었거나 단위 없이 적었다 (다른 단위가 붙은 수는 아니다)
 *   이름: 앞에 다른 항목의 이름이 적혀 있지 않다 ("함수비 11.2%" 는 다짐도의 값이 아니다)
 * 이름도 단위도 없는 수("재시험 6.5")는 값일 수 있다고 본다 — 놓치는 것보다 되묻는 쪽이 안전하다.
 */
export function isCandidateRun(
  run: ValueRun,
  wantedUnit: string | null,
  ownQuantities: readonly string[],
  unitless: UnitlessRule = 'all',
): boolean {
  const ownLabelled = run.label !== null && ownQuantities.includes(run.label);
  const saidAsValue = run.generic && run.label === null;
  const unitOk = wantedUnit === null || run.unit === wantedUnit || (run.unit === null && (unitless === 'all' || ownLabelled || saidAsValue));
  const labelOk = run.label === null || ownQuantities.length === 0 || ownQuantities.includes(run.label);
  return unitOk && labelOk;
}

/** 수 바로 앞 낱말 — 조사·기호를 건너뛴 마지막 낱말 */
function nearWordOf(gap: string): string | null {
  const m = gap.match(/([가-힣A-Za-z]{2,})[\s:：=_]*(?:[(（][^)）]{0,10}[)）])?[\s:：=_]*$/u);
  return m ? (m[1] as string) : null;
}

/**
 * 수 바로 앞 낱말이 이 시험 항목이 아닌 다른 양의 이름인가 ("오차 0.1%" · "AE제 첨가량 … 질량의 0.05%" · "진척률 96%").
 * 그 수는 그 양의 값일 수 있다. 측정 항목 이름(공기량·다짐도…)이 들어 있거나 측정값을 가리키는 말(결과·측정값·실측)이면 다른 양이 아니다.
 * 이런 수를 후보에서 빼지는 않는다 — 빼면 남은 값 하나로 판정하게 될 수 있다("함유량이 0.32였으나 … 0.28"). 후보에 섞이면 판정하지 않는다.
 */
export function labelledByOtherMeasure(word: string | null): boolean {
  if (!word) return false;
  const bare = word.replace(PARTICLE_TAIL_RE, '');
  // 측정 항목 이름이 든 낱말은 기존 규칙(앞에 적힌 항목 이름)이 가린다
  if (lastQuantityWord(word) !== null || NEUTRAL_MEASURE_PART_RE.test(word)) return false;
  if (COUNTER_NOUN_RE.test(bare)) return false;
  if (OTHER_MEASURE_DO_RE.test(word) || OTHER_MEASURE_DO_RE.test(bare)) return true;
  return bare.length >= 2 && OTHER_MEASURE_NOUN_RE.test(bare);
}

/**
 * 단위 없이 적은 수를 후보로 세는 범위.
 *   all         모두 센다 (무엇인지 모르는 수가 남으면 되묻는다)
 *   ownLabelled 앞에 이 항목의 이름이나 측정값을 가리키는 말("시험값")이 적힌 것만 센다 — 압축강도. 문장에 다른 수가 많다(재령·공시체 수)
 */
export type UnitlessRule = 'all' | 'ownLabelled';

export interface MeasuredCandidates {
  /** 서로 다른 후보 값 — 적힌 순서 */
  values: number[];
  /** 후보에 판정기준의 단위가 붙은 수가 있으면 그 단위, 모두 단위 없이 적혔으면 null */
  unit: string | null;
  /** 어느 후보에도 단위가 붙어 있지 않다 */
  unitless: boolean;
  /** 어느 후보에도 단위·항목 이름·재서 나온 값이라는 말이 붙어 있지 않다 — 측정값이라는 근거가 없는 수다 */
  unsupported: boolean;
  /** 바로 앞에 다른 양의 이름이 붙은 후보가 있다("오차 0.1%") — 판정하지 않는다 */
  otherMeasureLabelled: boolean;
  /** 이 항목의 값일 수 있는 수 목록이 다른 단위로 끝나 후보에서 빠졌다("0.26, 0.33, 7F") — 판정하지 않는다 */
  foreignUnitList: boolean;
}

/**
 * 다른 단위가 마지막 값에만 붙은 목록이 있는가 — "0.26, 0.33, 7F".
 * 이어 적은 값은 마지막 값의 단위를 함께 쓰는 것으로 읽는데, 그 단위가 이 항목의 단위가 아니면 목록 전체가 후보에서 빠진다.
 * 앞의 값들이 이 항목의 측정값이었다면 남은 값 하나로 판정하게 되므로, 다른 항목의 이름이 붙지 않은 그런 목록이 있으면 판정하지 않는다.
 */
export function hasForeignUnitList(runs: readonly ValueRun[], wantedUnit: string | null, ownQuantities: readonly string[]): boolean {
  return runs.some(
    (run) =>
      run.values.length >= 2 &&
      run.unit !== null &&
      wantedUnit !== null &&
      run.unit !== wantedUnit &&
      // 이 항목의 이름이 붙었거나 재서 나온 값이라는 말 바로 뒤의 목록만 — "염화물 3회 측정 0.26, 0.33, 7F".
      // 이름 없는 다른 양의 목록("펌프카 2대(52m, 43m)" · "타설량 18/45㎥")은 이 항목의 값이 아니다
      ((run.label !== null && ownQuantities.includes(run.label)) || MEASURED_CUE_WORD_RE.test(run.nearWord ?? '')),
  );
}
/** 재서 나온 값이라는 말 — 이 말 바로 뒤의 수는 측정값이다 */
const MEASURED_CUE_WORD_RE = /측정|결과|시험|실측|나온/u;

/** 이 묶음이 측정값이라는 근거가 있는가 — 단위, 이 항목의 이름, 재서 나온 값이라는 말 */
export function isSupported(run: ValueRun, ownQuantities: readonly string[]): boolean {
  return hasEvidence(run, ownQuantities) || run.generic || run.cue;
}

/** 이 묶음에 단위나 이 항목의 이름이 붙어 있는가 */
export function hasEvidence(run: ValueRun, ownQuantities: readonly string[]): boolean {
  return run.unit !== null || (run.label !== null && ownQuantities.includes(run.label));
}

/**
 * 판정할 항목의 측정값 후보를 모두 모은다. 판정은 후보가 정확히 하나일 때만 한다 —
 * 문장 어디에 어떤 모양으로 적었든(이어 적든, "1호차 4.5%, 2호차 6.5%" 처럼 떨어져 있든) 후보가 둘 이상이면 고르지 않는다.
 *
 *   1. 측정값이 아닌 수를 걷어 낸다: 날짜·시각·레미콘 규격·기준과 측점 번호·세는 말이 붙은 수·기준을 적은 표현·조건을 적은 표현
 *   2. 남은 수 가운데 이 항목의 값일 수 있는 것(isCandidateRun)이 후보다
 * @param ownQuantities 판정기준이 다루는 항목의 이름 (quantityWordsIn 으로 기준 이름에서 얻는다)
 * @param unitless 단위 없이 적은 수를 어디까지 후보로 셀지
 */
export function readMeasuredCandidates(
  text: string,
  unit: string | null | undefined,
  ownQuantities: readonly string[] = [],
  unitless: UnitlessRule = 'all',
): MeasuredCandidates {
  const wanted = normalizeUnit(unit ?? undefined);
  const clean = stripNonMeasurements(stripContextStatements(text));
  const allRuns = readValueRuns(clean);
  const runs = allRuns.filter((run) => isCandidateRun(run, wanted, ownQuantities, unitless));
  const values = [...new Set(runs.flatMap((run) => run.values))];
  return {
    values,
    unit: runs.some((run) => run.unit !== null) ? wanted : null,
    unitless: runs.length > 0 && runs.every((run) => run.unit === null),
    unsupported: runs.length > 0 && !runs.some((run) => isSupported(run, ownQuantities)),
    otherMeasureLabelled: runs.some((run) => labelledByOtherMeasure(run.nearWord ?? null)),
    foreignUnitList: hasForeignUnitList(allRuns, wanted, ownQuantities),
  };
}

const OP_MAP: Readonly<Record<string, string>> = {
  '≤': 'le',
  '<=': 'le',
  '이하': 'le',
  '미만': 'lt',
  '<': 'lt',
  '≥': 'ge',
  '>=': 'ge',
  '이상': 'ge',
  '초과': 'gt',
  '>': 'gt',
};

/**
 * R1: 컨텍스트 수치(fcn/fck/외기온도/부재) 자동 추출.
 * observation 문자열을 별도 정규식 세트로 스캔.
 */
export function parseContext(text: string): ObservationContext {
  if (typeof text !== 'string' || !text.trim()) return {};
  const ctx: ObservationContext = {};

  const read = (label: string, flags: string): number | undefined => {
    const m = text.match(new RegExp(`${label}${CONTEXT_NUM}`, flags));
    return m ? Number(m[1]) : undefined;
  };
  const [fcn, fcq, fck, durabilityFc, tempCorrection] = CONTEXT_LABELS.map(([label, flags]) => read(label, flags));
  if (fcn !== undefined) ctx.fcn = fcn;
  if (fcq !== undefined) ctx.fcq = fcq;
  if (fck !== undefined) ctx.fck = fck;
  if (durabilityFc !== undefined) ctx.durabilityFc = durabilityFc;
  if (tempCorrection !== undefined) ctx.tempCorrection = tempCorrection;

  // 공시체·생산 방식
  // 코어 강도를 말할 때만 코어 기준이다 — "코어 떠야 합니까" · "코어 채취 계획" 은 코어 시험값이 아니다
  if (/코어\s*(?:공시체|강도|압축|시험값|시험\s*결과|평균|\d+\s*개)/u.test(text)) ctx.strengthCase = 'core';
  else if (/현장\s*양생/u.test(text)) ctx.strengthCase = 'field_cured';
  else if (/배치\s*플랜트|현장\s*배합/u.test(text)) ctx.strengthCase = 'site_batch';

  // "공시체 3개 평균"은 1회의 시험값이다. "3회"를 함께 말했으면 여러 번의 시험으로 본다.
  if (/공시체\s*\d+\s*개/u.test(text) && !/\d+\s*회/u.test(text)) ctx.specimenAverage = true;

  // 구조·시공 조건
  if (/단층/u.test(text)) ctx.storyType = 'single';
  else if (/다층|고층/u.test(text)) ctx.storyType = 'multi';
  if (/필러/u.test(text)) ctx.fillerShoring = true;
  if (/한중|동절기|겨울철/u.test(text)) ctx.weather = 'cold';
  else if (/서중|하절기|여름철|혹서기/u.test(text)) ctx.weather = 'hot';

  // 외기온도 / 외기 N℃ / 기온 N℃
  const tempM = text.match(AMBIENT_TEMPERATURE_RE);
  if (tempM) ctx.ambientTemperature = Number(tempM[1]);

  // 부재 키워드 — R5 거푸집 라우팅 준비
  const memberRe = /(슬래브|보\s|기둥|벽체?|기초|푸팅|footing|slab|beam|column|wall)/iu;
  const memberM = text.match(memberRe);
  if (memberM) ctx.memberKeyword = (memberM[1] ?? '').trim();

  // 설계기준압축강도를 호칭강도로 바꿔 쓰지 않는다 — 호칭강도는 품질기준강도에 기온보정강도를 더한
  // 값이라 더 클 수 있다. 어느 강도를 기준으로 삼을지는 판정 단계(strength.ts)가 정한다.
  return ctx;
}

/** 기준 강도를 적은 부분 — 시험값 목록에서 뺀다 */
const STRENGTH_LABEL_RE =
  /(?:호칭강도|설계기준\s*압축?강도|품질기준강도|내구성기준\s*압축?강도|배합강도|f\s*c[knqr])\s*[:=은는이가]?\s*-?\d+(?:\.\d+)?\s*(?:MPa)?/giu;

/** 압축강도 판정이 다루는 항목 이름 */
const STRENGTH_QUANTITIES: readonly string[] = ['강도'];
const ORDINALS: Readonly<Record<string, number>> = { 첫: 1, 두: 2, 세: 3, 네: 4, 다섯: 5 };
/** 회 표시를 걷어 내기 전에 숨겨 두는 글자 — 세는 말("3회")로 지워지지 않게 한다 (사용자 영역 문자 U+E000 + 회 번호) */
const ROUND_MARK_BASE = 0xe000;
const ROUND_MARK = '[\\uE000-\\uE0FF]';
/**
 * 회마다 적은 강도 기록의 한 회 — "1회(1호차): 25.2, 26.0, 25.6" · "2회\t24.0\t23.5" · "시험 3회: 31.8" · "첫 번째 36.2MPa" · "3회 시험 결과 26.5, 20.1, 27.0".
 * 회 표시는 숨겨 둔 글자로 바뀐 뒤에 읽는다.
 */
const ROUND_RE = new RegExp(
  `(${ROUND_MARK})(?:\\s*\\([^)]*\\))?(?:\\s*(?:시험\\s*결과|시험값|시험|결과|평균|강도))?(?:이|은|는|가)?[\\s:：|]*((?:-?\\d+(?:\\.\\d+)?(?:\\s*MPa|(?![A-Za-z㎡㎥㎤°%℃\\d]|\\.\\d))[\\s,，、·ㆍ/|]*)+)`,
  'gu',
);

/** 이 묶음이 강도 값일 수 있는가 — MPa 가 붙었거나, 단위 없이 적혔고 다른 항목의 이름이 붙지 않았다 */
function isStrengthRun(run: ValueRun): boolean {
  return run.unit === 'MPa' || (run.unit === null && (run.label === null || STRENGTH_QUANTITIES.includes(run.label)));
}

/**
 * 회마다 적은 압축강도 기록을 읽는다.
 *   회가 둘 이상이면 회마다의 시험값이다 — 한 회에 값이 여럿이면 그 회의 공시체 값이므로 평균한다.
 *   회가 하나이고 값의 수가 회 수와 같으면("시험값 3회: 21.0, 20.4, 21.6") 그 수만큼의 시험값이다.
 *   회가 하나이고 값이 여럿이면 그 회의 공시체 값이다.
 * 글에 적힌 강도 값이 모두 어느 회에 들어가야 읽은 것으로 본다 — 회에 들지 못한 값이 남거나 회마다 값의 수가 다르면
 * 기록의 짜임을 다 읽지 못한 것이므로, 일부만으로 평균을 내지 않고 되묻게 한다.
 */
function readStrengthRounds(text: string): ObservationToken | null {
  if (!/MPa|강도/iu.test(text)) return null;
  const mark = (n: number): string => String.fromCharCode(ROUND_MARK_BASE + Math.min(n, 255));
  const marked = text
    .replace(STRENGTH_LABEL_RE, ' ')
    // 회별 값과 함께 적은 평균("연속 3회 평균은 35.7MPa")은 회별 값에서 나온 수다 — 값으로 세지 않는다
    .replace(/연속\s*\d+\s*회\s*(?:의\s*)?(?:시험값\s*(?:의\s*)?)?평균\s*(?:은|는|이|가|:|=)?\s*-?\d+(?:\.\d+)?\s*(?:MPa)?/gu, ' ')
    .replace(/(?<![\d.])(\d{1,2})\s*회차?/gu, (_, n: string) => mark(Number(n)))
    .replace(/(첫|두|세|네|다섯)\s*번째/gu, (_, w: string) => mark(ORDINALS[w] ?? 0));
  const clean = stripNonMeasurements(stripContextStatements(marked)).replace(
    // 회별 값과 함께 적은 평균·최저·최고는 회별 값에서 나온 수다 — 값으로 세지 않는다
    new RegExp(`(?<!${ROUND_MARK}\\s*)(?:평균|최저|최고|최소|최대)\\s*(?:값|치)?\\s*(?:은|는|이|가|:|=)?\\s*-?\\d+(?:\\.\\d+)?\\s*(?:MPa)?`, 'gu'),
    ' ',
  );
  const rounds = [...clean.matchAll(ROUND_RE)].map((m) => ({
    round: (m[1] ?? '').charCodeAt(0) - ROUND_MARK_BASE,
    values: (m[2]?.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number),
  }));
  const average = (list: number[]): number => list.reduce((a, b) => a + b, 0) / list.length;
  const seriesOf = (values: number[], flags: Pick<ObservationToken, 'perTest' | 'specimens' | 'listUnclear'>): ObservationToken => ({
    kind: 'series',
    unit: 'MPa',
    original: text,
    values,
    n: values.length,
    mean: average(values),
    min: Math.min(...values),
    max: Math.max(...values),
    ...flags,
  });
  const distinct = new Set(rounds.map((r) => r.round));
  const several = rounds.length >= 2 && distinct.size === rounds.length;
  const only = rounds.length === 1 ? rounds[0] : undefined;
  if (!several && !(only && only.values.length >= 2)) return null;

  // 글의 강도 값이 모두 회에 들어갔는가, 회마다 값의 수가 같은가
  const written = readValueRuns(clean.replace(new RegExp(ROUND_MARK, 'gu'), ' '))
    .filter(isStrengthRun)
    .flatMap((r) => r.values);
  const inRounds = rounds.flatMap((r) => r.values);
  const sameSize = new Set(rounds.map((r) => r.values.length)).size === 1;
  if (written.length !== inRounds.length || !sameSize) return seriesOf(written.length > 0 ? written : inRounds, { listUnclear: true });

  if (several) return seriesOf(rounds.map((r) => average(r.values)), { perTest: true });
  const one = only as { round: number; values: number[] };
  return one.round === one.values.length ? seriesOf(one.values, { perTest: true }) : seriesOf(one.values, { specimens: true });
}

/**
 * 압축강도 시험값이 하나일 때 그 값. 단위(MPa)가 붙었거나 앞에 강도라고 적힌 수만 본다 —
 * 재령("28일")이나 공시체 수를 시험값으로 읽지 않는다.
 */
export function readStrengthScalar(text: string): ObservationToken | null {
  const found = readMeasuredCandidates(text.replace(STRENGTH_LABEL_RE, ' '), 'MPa', STRENGTH_QUANTITIES, 'ownLabelled');
  const value = found.values[0];
  return found.values.length === 1 && value !== undefined ? { kind: 'scalar', value, unit: 'MPa', original: text } : null;
}

/**
 * R1: 시리즈 (n회 평균/최저/최고/values) 인식.
 * "연속 3회 평균 25 최저 21" / "3회 시험값 23 24 22" / "코어 4개 평균 22 최저 17"
 */
function detectSeries(text: string): ObservationToken | null {
  const rounds = readStrengthRounds(text);
  if (rounds) return rounds;
  const meanRe = /평균\s*(-?\d+(?:\.\d+)?)\s*(MPa|mpa|mm|kg\/㎥|kg\/m3|kg\/m³|%|℃)?/iu;
  const minRe = /최저\s*(-?\d+(?:\.\d+)?)\s*(MPa|mpa|mm|kg\/㎥|kg\/m3|kg\/m³|%|℃)?/iu;
  const maxRe = /최고\s*(-?\d+(?:\.\d+)?)\s*(MPa|mpa|mm|kg\/㎥|kg\/m3|kg\/m³|%|℃)?/iu;
  const nRe = /(?:연속\s*)?(\d+)\s*(?:회|개|차)\s*(?:시험값|평균|공시체)?/u;
  const valuesRe = /(?:시험값|values?)\s*[:：]?\s*((?:-?\d+(?:\.\d+)?\s+){2,}-?\d+(?:\.\d+)?)/iu;

  const meanM = text.match(meanRe);
  const minM = text.match(minRe);
  const maxM = text.match(maxRe);
  const nM = text.match(nRe);
  const valuesM = text.match(valuesRe);

  // 이어 적은 강도 값 — "25.1, 26.4, 27.8 MPa" · "25.1MPa 26.4MPa 27.8MPa" · "26.5, 20.1, 27.0 (MPa, 각 3개 평균)"
  // 기준 강도(호칭강도 27MPa 등)는 시험값이 아니므로 먼저 걷어 낸다.
  // MPa 가 붙은 묶음을 받는다. 단위를 따로 적었거나("단위 MPa") 강도·공시체를 말하는 글에서는 단위 없이 이어 적은 묶음도 받는다(다른 항목의 이름이 붙은 것은 빼고).
  const unitDeclared = /MPa|공시체|시험체|압축|강도/iu.test(text);
  const strengthRuns =
    meanM || minM || maxM || valuesM
      ? []
      : readValueRuns(stripNonMeasurements(stripContextStatements(text.replace(STRENGTH_LABEL_RE, ' ')))).filter(
          (r) => r.unit === 'MPa' || (unitDeclared && isStrengthRun(r)),
        );
  const listRun = strengthRuns.find((r) => r.values.length >= 2);
  // 묶음 밖에 강도 값이 더 있으면 기록을 다 읽지 못한 것이다 — 묶음만으로 평균을 내지 않는다
  const strayValues = listRun ? strengthRuns.filter((r) => r !== listRun).flatMap((r) => r.values) : [];
  // 이어 적지 않고 떨어져 적은 강도 값("1호차 26MPa, 2호차 20MPa")도 하나만 고르지 않는다 — 모두 모아 무엇인지 되묻게 한다
  const scattered =
    listRun || meanM || minM || maxM || valuesM ? null : readMeasuredCandidates(text.replace(STRENGTH_LABEL_RE, ' '), 'MPa', STRENGTH_QUANTITIES, 'ownLabelled');
  const listValues = listRun ? [...listRun.values, ...strayValues] : scattered && scattered.values.length >= 2 ? scattered.values : null;

  // series로 분류할 신호: 평균·최저·최고 중 하나라도 있거나 명시 values 배열이 있을 때.
  if (!meanM && !minM && !maxM && !valuesM && !listValues) return null;

  const token: ObservationToken = {
    kind: 'series',
    unit: normalizeUnit(meanM?.[2] ?? minM?.[2] ?? maxM?.[2] ?? undefined),
    original: text,
  };
  if (meanM) token.mean = Number(meanM[1]);
  if (minM) token.min = Number(minM[1]);
  if (maxM) token.max = Number(maxM[1]);
  if (nM) token.n = Number(nM[1]);
  if (listValues) {
    token.unit = 'MPa';
    token.values = listValues;
    token.mean = listValues.reduce((a, b) => a + b, 0) / listValues.length;
    token.min = Math.min(...listValues);
    token.max = Math.max(...listValues);
    // 값들이 무엇인지 문장에서 읽는다 — 읽히지 않으면 판정 단계가 되묻는다.
    //   회마다의 시험값: 값의 수와 같은 "N회", "연속", "회별·각 N개 평균"
    //   한 회의 공시체 값: "공시체", 값의 수와 같은 "N개"
    const count = listValues.length;
    const counted = (unitWord: string): boolean =>
      [...text.matchAll(new RegExp(`(\\d+)\\s*${unitWord}`, 'gu'))].some((m) => Number(m[1]) === count);
    const eachIsATest = (count >= 2 && counted('회(?!차)')) || /연속|회별|회차별|차수별|각\s*회|각각?\s*(?:공시체\s*)?(?:\d+|한|두|세|네)\s*개\s*(?:의\s*)?평균/u.test(text);
    if (strayValues.length > 0) token.listUnclear = true;
    else if (eachIsATest) token.perTest = true;
    else if (/공시체|시험체/u.test(text) || counted('개')) token.specimens = true;
    else token.listUnclear = true;
    token.n = count;
  } else if (meanM && !minM && !maxM && !valuesM && !/코어/u.test(text)) {
    // 평균 하나만 적었다 — 연속 3회 시험값의 평균인지 공시체 평균(1회 시험값)인지 문장에서 읽는다
    const severalTests = /연속/u.test(text) || [...text.matchAll(/(\d+)\s*회(?!차)/gu)].some((m) => Number(m[1]) >= 2);
    if (!severalTests) {
      if (/공시체|시험체/u.test(text)) token.specimens = true;
      else token.meanUnclear = true;
    }
  }
  if (valuesM && valuesM[1]) {
    const vals = valuesM[1].trim().split(/\s+/).map((s) => Number(s));
    token.values = vals;
    if (token.mean === undefined) token.mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (token.min === undefined) token.min = Math.min(...vals);
    if (token.max === undefined) token.max = Math.max(...vals);
    if (token.n === undefined) token.n = vals.length;
  }
  return token;
}

/**
 * 글에서 측정값 하나를 고른다.
 * 자연어에는 여러 숫자가 나온다("28일 압축강도 26MPa"). 기준 강도·기온처럼 조건으로 읽은 수는 빼고,
 * 단위가 붙은 수를 먼저 고른다.
 * @param unitOnly 단위가 붙은 수만 받는다 (기준 표현 옆의 측정값을 찾을 때)
 */
function pickScalar(clean: string, original: string, context: ObservationContext, unitOnly: boolean): ObservationToken | null {
  const exclude = contextValues(context);

  const all = Array.from(clean.matchAll(SCALAR_GLOBAL_RE));
  const candidates = all.filter((m) => !exclude.has(Number(m[1])));
  // 조건으로 읽은 수가 아닌 것 가운데 단위가 붙은 것 → 아무 수 → (조건 수까지 포함해) 단위가 붙은 것 → 아무 수
  const chosen = unitOnly
    ? candidates.find((m) => m[2])
    : (candidates.find((m) => m[2]) ?? candidates[0] ?? all.find((m) => m[2]) ?? all[0]);
  if (!chosen) return null;
  return { kind: 'scalar', value: Number(chosen[1]), unit: normalizeUnit(chosen[2]), original };
}

export function parseObservation(text: string): { tokens: ObservationToken[]; context: ObservationContext } {
  if (typeof text !== 'string' || !text.trim()) return { tokens: [], context: {} };
  // 날짜·시각·레미콘 규격(25-24-150)·기준 번호(KS F 2421)는 측정값이 아니다 — 범위(a-b)나 수치로 잘못 읽지 않게 걷어 낸다.
  // 세는 말이 붙은 수("공시체 3개")는 남긴다 — 시험 횟수를 읽는 데 쓴다.
  const norm = text.trim().replace(DATE_TIME_RE, ' ').replace(MIX_CODE_RE, ' ').replace(REFERENCE_RE, ' ');
  const tokens: ObservationToken[] = [];
  const context = parseContext(text);
  /** 기준 표현(150±25 · 125~175)을 걷어 낸 나머지에 측정값이 있으면 함께 싣는다 */
  const withMeasured = (matched: string): { tokens: ObservationToken[]; context: ObservationContext } => {
    const measured = pickScalar(norm.replace(matched, ' '), text, context, true);
    if (measured) tokens.push(measured);
    return { tokens, context };
  };

  // R1: series 우선 검사 (평균·최저 등 키워드 존재 시)
  const series = detectSeries(norm);
  if (series) {
    tokens.push(series);
    return { tokens, context };
  }

  const tol = norm.match(TOLERANCE_RE);
  if (tol) {
    const target = Number(tol[1]);
    const pm = Number(tol[2]);
    tokens.push({
      kind: 'tolerance',
      value: target,
      plusMinus: pm,
      min: target - pm,
      max: target + pm,
      unit: normalizeUnit(tol[3]),
      original: text,
    });
    return withMeasured(tol[0]);
  }

  const rng = norm.match(RANGE_RE);
  if (rng) {
    const a = Number(rng[1]);
    const b = Number(rng[2]);
    tokens.push({
      kind: 'range',
      min: Math.min(a, b),
      max: Math.max(a, b),
      unit: normalizeUnit(rng[3]),
      original: text,
    });
    return withMeasured(rng[0]);
  }

  const cmp = norm.match(COMPARE_RE);
  if (cmp) {
    const raw = cmp[1] ?? '';
    tokens.push({
      kind: 'compare',
      operator: OP_MAP[raw] ?? 'eq',
      value: Number(cmp[2]),
      unit: normalizeUnit(cmp[3]),
      original: text,
    });
    return { tokens, context };
  }

  const scalar = pickScalar(norm, text, context, false);
  if (scalar) {
    tokens.push(scalar);
    return { tokens, context };
  }

  tokens.push({ kind: 'qualitative', unit: null, original: text });
  return { tokens, context };
}

export function normalizeUnit(u: string | undefined): string | null {
  if (!u) return null;
  const lower = u.toLowerCase();
  return UNIT_ALIAS[lower] ?? u;
}

export function unitsCompatible(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return true;
  const na = UNIT_ALIAS[a.toLowerCase()] ?? a;
  const nb = UNIT_ALIAS[b.toLowerCase()] ?? b;
  return na === nb;
}
