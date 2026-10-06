"""ACWI 팩터 모델 설정 — 엑셀 열 매핑, 팩터 정의, 가중치, 국가 매핑.

엑셀(UNIVERSE (2) 시트)의 원자료 열만 읽습니다. 계산 열(W, X, AA~AJ, BE~BO)은 무시하고
파이썬에서 다시 계산합니다. Datastream/Refinitiv 새로고침 후에도 열 위치만 같으면 그대로 동작합니다.
"""

SHEETS = ["UNIVERSE (2)", "UNIVERSE"]   # 앞에서부터 찾음
FIRST_ROW = 4          # 데이터 시작 행 (1-based)
LAST_ROW = 2314        # 데이터 마지막 행 (엑셀 수식 범위 $4:$2314 와 동일)

# 엑셀 열 → 내부 필드명 (원자료만)
RAW_COLUMNS = {
    "A": "wgt",            # ACWI 비중 (소수, 0.049 = 4.9%)
    "B": "code",           # Datastream 코드
    "D": "price",          # 현재가 (현지통화)
    "E": "mv_local",       # 시가총액 (현지통화, 백만)  ※ USD 아님
    "F": "ret_1m",         # 1M 수익률 (%)
    "G": "ret_3m",         # 3M 수익률 (%)
    "H": "ret_12m",        # 12M 수익률 (%)
    "I": "eps_ntm",        # 12M Fwd EPS (현지통화)
    "J": "bps_ntm",        # 12M Fwd BPS
    "K": "roe_ntm",        # 12M Fwd ROE (%)
    "L": "ni_ntm",         # 12M Fwd 순이익 (현지통화, 백만)
    "M": "dps_ntm",        # 12M Fwd DPS
    "N": "sales_ntm",      # 12M Fwd 매출 (현지통화, 백만)
    "O": "ni_ntm_chg",     # NTM 순이익 추정치 1Y 변화 (%)
    "P": "dps_ntm_chg",    # NTM DPS 추정치 1Y 변화 (%)
    "Q": "sales_ntm_chg",  # NTM 매출 추정치 1Y 변화 (%)
    "R": "ric",
    "S": "isin",
    "T": "de",             # Total Debt % Common Equity (%)
    "U": "px_sd_1y",       # SDN#(X,1Y) — '주가 수준'의 1년 표준편차 (가격 단위!)
    "V": "fcf_yield",      # 12M Fwd FCF Yield (%)
    "AK": "name",
    "AL": "industry",
    "AM": "sector",
    "AN": "eps_cy25", "AO": "eps_cy26", "AP": "eps_cy27",
    "AQ": "rev_cy25", "AR": "rev_cy26", "AS": "rev_cy27",
    "AT": "asset_cat",
    "AI": "xl_composite",  # 사용자 엑셀이 계산해 둔 종합점수 (캐시값, 비교용)
    "AJ": "xl_rank",       # 사용자 엑셀 순위
}

# ── 디스크립터: (필드, 방향, 설명) ── 방향 +1 = 클수록 좋음
FACTORS = {
    "value": {
        "label": "가치",
        "descriptors": [
            ("ep", +1, "Fwd E/P (=1/PER)"),
            ("bp", +1, "Fwd B/P (=1/PBR)"),
            ("fcfy", +1, "Fwd FCF Yield"),
        ],
    },
    "size": {
        "label": "사이즈",
        "descriptors": [("ln_mcap", -1, "ln(시가총액 USD) — 작을수록 +")],
    },
    "dividend": {
        "label": "배당",
        "descriptors": [
            ("dy", +1, "Fwd 배당수익률"),
            ("dps_g", +1, "DPS 추정치 1Y 변화"),
        ],
    },
    "growth": {
        "label": "성장",
        "descriptors": [
            ("eps_g", +1, "EPS 성장률 CY27/CY26"),
            ("sales_g", +1, "매출 성장률 CY27/CY26"),
        ],
    },
    "momentum": {
        "label": "모멘텀",
        "descriptors": [
            ("mom_12_1", +1, "12-1M 수익률 (복리, 시계열 있으면 RI 총수익)"),
            ("eps_rev_3m", +1, "EPS NTM 3M 리비전 (시계열 시트 있을 때만)"),
        ],
    },
    "quality": {
        "label": "퀄리티",
        "descriptors": [
            ("roe", +1, "Fwd ROE"),
            ("de", -1, "부채비율 D/E (금융 제외)"),
            ("vol", -1, "변동성 (시계열 있으면 일간수익률 1Y 연율, 없으면 SD/가격 프록시)"),
        ],
    },
}
FACTOR_KEYS = list(FACTORS)
DEFAULT_WEIGHTS = {k: 1 / 6 for k in FACTOR_KEYS}

WINSOR = (0.01, 0.99)     # 디스크립터 원값 전체 유니버스 1%/99% 윈저라이징
Z_CLIP = 3.0              # 섹터 Z 를 ±3 으로 절단
NEUTRALIZE = "sector_region"   # "sector_region"(섹터×지역 중립, 기본) | "sector"(섹터 중립만, 원본 방식)
MIN_GROUP_N = 10          # 섹터×지역 그룹 표본이 이보다 적으면 섹터 전체 통계 사용
MIN_SECTOR_N = 5          # 섹터 표본도 이보다 적으면 전체 유니버스 통계 사용

# ── 거래소 접미사 → (국가, 통화) ──
SUFFIX_COUNTRY = {
    "N": ("미국", "USD"), "OQ": ("미국", "USD"), "O": ("미국", "USD"), "K": ("미국", "USD"), "Z": ("미국", "USD"),
    "T": ("일본", "JPY"), "NS": ("인도", "INR"), "BO": ("인도", "INR"),
    "SS": ("중국", "CNY"), "SZ": ("중국", "CNY"), "HK": ("중국", "HKD"),
    "TO": ("캐나다", "CAD"), "TW": ("대만", "TWD"), "TWO": ("대만", "TWD"),
    "KS": ("한국", "KRW"), "KQ": ("한국", "KRW"), "L": ("영국", "GBp"),
    "DE": ("독일", "EUR"), "PA": ("프랑스", "EUR"), "AX": ("호주", "AUD"),
    "ST": ("스웨덴", "SEK"), "S": ("스위스", "CHF"), "SA": ("브라질", "BRL"),
    "SE": ("사우디", "SAR"), "MI": ("이탈리아", "EUR"), "AS": ("네덜란드", "EUR"),
    "J": ("남아공", "ZAc"), "KL": ("말레이시아", "MYR"), "MC": ("스페인", "EUR"),
    "MX": ("멕시코", "MXN"), "JK": ("인도네시아", "IDR"), "SI": ("싱가포르", "SGD"),
    "WA": ("폴란드", "PLN"), "CO": ("덴마크", "DKK"), "HE": ("핀란드", "EUR"),
    "BK": ("태국", "THB"), "BR": ("벨기에", "EUR"), "OL": ("노르웨이", "NOK"),
    "IS": ("튀르키예", "TRY"), "SN": ("칠레", "CLP"), "PS": ("필리핀", "PHP"),
    "TA": ("이스라엘", "ILA"), "QA": ("카타르", "QAR"), "AD": ("UAE", "AED"),
    "DU": ("UAE", "AED"), "AT": ("그리스", "EUR"), "KW": ("쿠웨이트", "KWD"),
    "LS": ("포르투갈", "EUR"), "I": ("아일랜드", "EUR"), "NZ": ("뉴질랜드", "NZD"),
    "VI": ("오스트리아", "EUR"), "BU": ("헝가리", "HUF"), "CA": ("이집트", "EGP"),
    "CN": ("콜롬비아", "COP"), "PR": ("체코", "CZK"), "LU": ("룩셈부르크", "EUR"),
    "MM": ("러시아", "RUB"),
}
# 미국 거래소에 상장됐지만 MSCI 상 다른 국가로 분류되는 종목 (코드 기준 예외)
CODE_COUNTRY_OVERRIDE = {
    "QGEN.K": "네덜란드", "WSE.O": "영국", "SE.N": "싱가포르", "BVN.N": "페루",
    "PDD.OQ": "중국", "HTHT.OQ": "중국", "TME.N": "중국", "FUTU.OQ": "중국",
    "VIPS.N": "중국", "BZ.OQ": "중국", "TAL.N": "중국", "LEGN.OQ": "중국",
    "SHOP.OQ": "캐나다", "BN.N": "캐나다", "QSR.N": "캐나다", "BAM.N": "캐나다", "OTEX.OQ": "캐나다",
    "BEPC.N": "캐나다", "NU.N": "브라질", "XP.OQ": "브라질", "STNE.OQ": "브라질", "JBS.N": "브라질",
    "BAP.N": "페루", "TEVA.N": "이스라엘", "TSEM.OQ": "이스라엘", "NVMI.OQ": "이스라엘",
    "CHKP.OQ": "이스라엘", "MNDY.OQ": "이스라엘", "GRAB.OQ": "싱가포르",
}
# 홍콩 상장 중 홍콩(선진) 분류로 보는 케이만/버뮤다 법인 (이름 일부)
HK_DM_NAME_HINTS = ["CK Hutchison", "CK Asset", "CK Infrastructure", "WH Group", "Sands China",
                    "Wharf", "Jardine", "Hongkong Land", "Galaxy Entertainment", "Techtronic",
                    "ESR Group", "Budweiser Brewing", "Prudential", "AIA Group", "Swire"]

DM_COUNTRIES = {"미국", "일본", "영국", "캐나다", "프랑스", "독일", "스위스", "호주", "네덜란드", "스웨덴",
                "덴마크", "이탈리아", "스페인", "홍콩", "싱가포르", "핀란드", "벨기에", "노르웨이", "이스라엘",
                "아일랜드", "뉴질랜드", "오스트리아", "포르투갈", "룩셈부르크"}

SECTOR_KO = {
    "Information Technology": "IT", "Financials": "금융", "Industrials": "산업재",
    "Consumer Discretionary": "경기소비재", "Materials": "소재", "Health Care": "헬스케어",
    "Consumer Staples": "필수소비재", "Utilities": "유틸리티", "Communication Services": "커뮤니케이션",
    "Energy": "에너지", "Real Estate": "부동산",
}

# ── 통화 ──
# Datastream 가격(X)·MV 는 '거래 통화', I/B/E/S 추정치(EPS·BPS·DPS·순이익·매출)는 '보고 통화'라서
# 영국(펜스 vs 파운드/달러), 칠레·인도네시아·멕시코(현지 vs 달러), 북유럽(현지 vs 유로), ADR(달러 vs 위안) 등에서
# P/E·P/B·배당수익률이 수십~수천 배 틀어진다. 아래 환율로 보고통화를 추정해 보정한다.
# 근본 해결: Datastream 요청을 X~U$, EPS1FD12~U$, BPS1FD12~U$, DPS1FD12~U$, MV~U$ 처럼 같은 통화로 받기.
FX_ASOF = "2026-10-01"
FX_PER_USD = {  # 1 USD 당 통화 (open.er-api.com, 2026-10-01 00:02 UTC)
    "USD": 1.0, "GBP": 0.753798, "EUR": 0.881813, "CNY": 6.716878, "HKD": 7.846697, "JPY": 157.298282,
    "KRW": 1355.838011, "TWD": 31.908932, "INR": 95.997282, "SGD": 1.277638, "SEK": 10.003958,
    "NOK": 9.609239, "DKK": 6.586139, "CHF": 0.835134, "CLP": 973.46915, "IDR": 17903.534018,
    "MXN": 18.077867, "PHP": 62.754655, "BRL": 5.200393, "ZAR": 16.415882, "AUD": 1.438252,
    "CAD": 1.421278, "TRY": 49.048442, "SAR": 3.75, "AED": 3.6725, "MYR": 4.078529, "THB": 33.580261,
    "PLN": 3.84929, "ILS": 3.068956, "QAR": 3.64, "KWD": 0.308528, "EGP": 51.965687, "COP": 3333.963413,
    "CZK": 21.547067, "HUF": 323.038522, "NZD": 1.774167, "PEN": 3.442479, "RUB": 80.0,
}
SUBUNIT = {"GBp": ("GBP", 100), "ZAc": ("ZAR", 100), "ILA": ("ILS", 100)}   # 보조단위 호가
# USD 추정치 파일에서 현지 주가를 USD 로 바꿀 때 시험할 호가단위 (앞이 기본값).
# Datastream X 는 영국=펜스가 대부분, 남아공·이스라엘=랜드·셰켈 단위로 들어온다(2026-10 확인).
PRICE_UNIT_CANDIDATES = {"GBp": [100, 1], "ZAc": [1, 100], "ILA": [1, 100]}
# 거래소 기본 통화와 다른 통화로 호가되는 종목 (예: Verisure 는 스톡홀름 상장이지만 EUR 호가)
PRICE_CCY_OVERRIDE = {"VSURE.ST": "EUR"}
# 거래통화별로 추정치가 나올 수 있는 보고통화 후보 (자국 통화는 항상 후보)
REPORT_CANDIDATES = {   # 앞쪽이 우선 (거리 차이가 0.4 이내면 앞 후보 선택)
    "GBp": ["GBP", "USD", "EUR"], "ZAc": ["ZAR", "USD", "EUR", "GBP"], "ILA": ["ILS", "USD"],
    "SEK": ["EUR", "USD"], "NOK": ["USD", "EUR"], "DKK": ["EUR", "USD"], "CHF": ["USD", "EUR"],
    "EUR": ["USD"], "CLP": ["USD"], "IDR": ["USD"], "PHP": ["USD"], "MXN": ["USD"], "COP": ["USD"],
    "BRL": ["USD"], "SGD": ["CNY", "USD"], "CAD": ["USD"], "AUD": ["USD"], "NZD": ["USD"],
}
# FCF 수익률 앵커가 있을 때만 보정하는 시장 (자국통화 고PER 종목이 많아 중앙값 규칙은 위험)
ANCHOR_ONLY_CANDIDATES = {"HKD": ["USD", "CNY"], "MYR": ["USD"], "THB": ["USD"], "PLN": ["EUR", "USD"],
                          "INR": ["USD"], "TWD": ["USD"], "KRW": ["USD"], "JPY": ["USD"], "TRY": ["USD", "EUR"],
                          "SAR": ["USD"], "AED": ["USD"], "QAR": ["USD"], "KWD": ["USD"], "CNY": ["USD", "HKD"]}
# 미국 상장 해외기업(ADR 등): 국가별 보고통화 후보
USD_FOREIGN_CANDIDATES = {"중국": ["CNY", "HKD"], "브라질": ["BRL"], "페루": ["PEN"]}
FX_FIX_ANCHOR_GAIN = 1.8  # FCF 수익률 앵커: |log(E/P ÷ FCF수익률)| 이 이만큼(≈6배) 이상 줄어야 적용 (ROE≥3% 종목만)
FX_FIX_MIN_GAIN = 1.4     # 보정 후 (P/E, P/B) 의 그룹 중앙값 대비 log 거리 합이 이만큼(≈4배) 이상 줄어야 적용
