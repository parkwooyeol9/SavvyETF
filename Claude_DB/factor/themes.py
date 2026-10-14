"""ACWI 종목 분류 사전 — GICS 산업 한글명·산업그룹, 투자 테마.

국가·지역은 config.SUFFIX_COUNTRY / engine._country, 섹터·산업은 원자료 GICS(TR.GICS*) 를 그대로 쓴다.
여기서는 (1) 산업 → 산업그룹(GICS 2단계) 매핑과 한글명, (2) 섹터를 가로지르는 투자 테마를 정의한다.

테마는 한 종목이 여러 테마에 속할 수 있다(다중 분류). 정의 방식:
    codes      : Datastream 코드(RIC) 직접 지정 — 2026-10 ACWI 유니버스(2,266종목) 이름을 보고 고름
    industries : 이 GICS 산업 전체 포함
    exclude    : 위에서 뺄 코드
유니버스가 바뀌면(편입 종목) 새 종목은 industries 규칙으로만 들어가므로, 정기변경 후 `groups.py` 출력의
`theme_missing_codes`(사전에 있는데 유니버스에 없는 코드)와 `out/groups/classification.csv` 를 보고 코드를 고친다.
"""
from __future__ import annotations

# ── GICS 산업 → (산업그룹, 산업 한글명) ──
INDUSTRY = {
    # 에너지
    "Energy Equipment & Services": ("에너지", "에너지 장비·서비스"),
    "Oil, Gas & Consumable Fuels": ("에너지", "석유·가스·석탄"),
    # 소재
    "Chemicals": ("소재", "화학"),
    "Construction Materials": ("소재", "건자재"),
    "Containers & Packaging": ("소재", "용기·포장"),
    "Metals & Mining": ("소재", "금속·광업"),
    "Paper & Forest Products": ("소재", "종이·임산물"),
    # 산업재
    "Aerospace & Defense": ("자본재", "항공우주·방산"),
    "Building Products": ("자본재", "건축자재·설비"),
    "Construction & Engineering": ("자본재", "건설·엔지니어링"),
    "Electrical Equipment": ("자본재", "전기장비"),
    "Industrial Conglomerates": ("자본재", "복합기업"),
    "Machinery": ("자본재", "기계"),
    "Trading Companies & Distributors": ("자본재", "상사·유통"),
    "Commercial Services & Supplies": ("상업·전문 서비스", "상업 서비스"),
    "Professional Services": ("상업·전문 서비스", "전문 서비스"),
    "Air Freight & Logistics": ("운송", "항공화물·물류"),
    "Passenger Airlines": ("운송", "항공사"),
    "Marine Transportation": ("운송", "해운"),
    "Ground Transportation": ("운송", "육상운송"),
    "Transportation Infrastructure": ("운송", "운송 인프라"),
    # 경기소비재
    "Automobile Components": ("자동차·부품", "자동차부품"),
    "Automobiles": ("자동차·부품", "자동차"),
    "Household Durables": ("내구소비재·의류", "가정용 내구재"),
    "Leisure Products": ("내구소비재·의류", "레저용품"),
    "Textiles, Apparel & Luxury Goods": ("내구소비재·의류", "의류·럭셔리"),
    "Hotels, Restaurants & Leisure": ("소비자 서비스", "호텔·외식·레저"),
    "Diversified Consumer Services": ("소비자 서비스", "교육 등 소비자 서비스"),
    "Distributors": ("소비재 유통", "유통업체"),
    "Broadline Retail": ("소비재 유통", "종합소매·이커머스"),
    "Specialty Retail": ("소비재 유통", "전문소매"),
    # 필수소비재
    "Consumer Staples Distribution & Retail": ("필수소비재 유통", "필수소비재 유통"),
    "Beverages": ("음식료·담배", "음료·주류"),
    "Food Products": ("음식료·담배", "식품"),
    "Tobacco": ("음식료·담배", "담배"),
    "Household Products": ("가정·개인용품", "가정용품"),
    "Personal Care Products": ("가정·개인용품", "개인용품·화장품"),
    # 헬스케어
    "Health Care Equipment & Supplies": ("헬스케어 장비·서비스", "의료기기"),
    "Health Care Providers & Services": ("헬스케어 장비·서비스", "의료 서비스"),
    "Health Care Technology": ("헬스케어 장비·서비스", "헬스케어 기술"),
    "Biotechnology": ("제약·바이오", "바이오"),
    "Pharmaceuticals": ("제약·바이오", "제약"),
    "Life Sciences Tools & Services": ("제약·바이오", "생명과학 도구·CDMO"),
    # 금융
    "Banks": ("은행", "은행"),
    "Financial Services": ("금융서비스", "금융서비스·결제"),
    "Consumer Finance": ("금융서비스", "소비자금융"),
    "Capital Markets": ("금융서비스", "증권·자산운용·거래소"),
    "Mortgage Real Estate Investment Trusts (REITs)": ("금융서비스", "모기지 리츠"),
    "Insurance": ("보험", "보험"),
    # IT
    "IT Services": ("소프트웨어·서비스", "IT 서비스"),
    "Software": ("소프트웨어·서비스", "소프트웨어"),
    "Communications Equipment": ("하드웨어·장비", "통신장비"),
    "Technology Hardware, Storage & Peripherals": ("하드웨어·장비", "컴퓨터·스토리지·주변기기"),
    "Electronic Equipment, Instruments & Components": ("하드웨어·장비", "전자장비·부품"),
    "Semiconductors & Semiconductor Equipment": ("반도체", "반도체·장비"),
    # 커뮤니케이션
    "Diversified Telecommunication Services": ("통신서비스", "유선통신"),
    "Wireless Telecommunication Services": ("통신서비스", "무선통신"),
    "Media": ("미디어·엔터", "미디어·광고"),
    "Entertainment": ("미디어·엔터", "엔터·게임"),
    "Interactive Media & Services": ("미디어·엔터", "인터넷 포털·SNS"),
    # 유틸리티
    "Electric Utilities": ("유틸리티", "전력"),
    "Gas Utilities": ("유틸리티", "가스"),
    "Multi-Utilities": ("유틸리티", "복합 유틸리티"),
    "Water Utilities": ("유틸리티", "수도"),
    "Independent Power and Renewable Electricity Producers": ("유틸리티", "발전·신재생 발전"),
    # 부동산
    "Diversified REITs": ("리츠", "복합 리츠"),
    "Industrial REITs": ("리츠", "물류 리츠"),
    "Office REITs": ("리츠", "오피스 리츠"),
    "Residential REITs": ("리츠", "주거 리츠"),
    "Retail REITs": ("리츠", "리테일 리츠"),
    "Health Care REITs": ("리츠", "헬스케어 리츠"),
    "Specialized REITs": ("리츠", "특수 리츠(데이터센터·통신탑 등)"),
    "Real Estate Management & Development": ("부동산 개발·관리", "부동산 개발·관리"),
}

REIT_INDUSTRIES = [k for k, (g, _) in INDUSTRY.items() if g == "리츠"] + ["Mortgage Real Estate Investment Trusts (REITs)"]
SOLAR = ["FSLR.OQ", "601012.SS", "600438.SS", "WAAN.NS", "688303.SS", "3800.HK", "0968.HK"]

# ── 투자 테마 (순서 = 화면 순서) ──
THEMES: dict[str, dict] = {
    "mag7": {
        "label": "매그니피센트 7", "desc": "애플·MS·알파벳·아마존·메타·엔비디아·테슬라",
        "codes": ["AAPL.OQ", "MSFT.OQ", "GOOGL.OQ", "GOOG.OQ", "AMZN.OQ", "META.OQ", "NVDA.OQ", "TSLA.OQ"],
    },
    "semi_all": {
        "label": "반도체 (전체)", "desc": "GICS 반도체·장비 산업 + 삼성전자, 태양광 웨이퍼·모듈 제외",
        "industries": ["Semiconductors & Semiconductor Equipment"],
        "codes": ["005930.KS", "005935.KS"], "exclude": SOLAR,
    },
    "ai_semi": {
        "label": "AI 반도체", "desc": "GPU·ASIC·HBM·파운드리·AI 연결칩",
        "codes": ["NVDA.OQ", "AVGO.OQ", "AMD.OQ", "MRVL.OQ", "2330.TW", "MU.OQ", "000660.KS", "005930.KS", "005935.KS",
                  "688256.SS", "688041.SS", "ALAB.OQ", "CRDO.OQ", "3443.TW", "3661.TW", "2454.TW", "5274.TWO",
                  "688008.SS", "INTC.OQ", "3711.TW"],
    },
    "memory": {
        "label": "메모리·스토리지", "desc": "D램·낸드·HDD·스토리지 시스템",
        "codes": ["MU.OQ", "000660.KS", "005930.KS", "005935.KS", "285A.T", "STX.OQ", "WDC.OQ", "301308.SZ",
                  "603986.SS", "P.N", "NTAP.OQ"],
    },
    "semi_equip": {
        "label": "반도체 장비·소재", "desc": "전공정·후공정 장비, 웨이퍼·특수가스·소재·테스트",
        "codes": ["ASML.AS", "LRCX.OQ", "AMAT.OQ", "KLAC.OQ", "8035.T", "6857.T", "002371.SZ", "TER.OQ", "ASMI.AS",
                  "688012.SS", "6146.T", "688072.SS", "6920.T", "ENTG.OQ", "300604.SZ", "7735.T", "042700.KS",
                  "BESI.AS", "NVMI.OQ", "6488.TWO", "Q.N", "VACN.S", "4063.T", "2449.TW", "2360.TW", "7769.TW",
                  "5016.T", "3529.TWO"],
    },
    "ai_infra": {
        "label": "AI 데이터센터 인프라", "desc": "AI 서버·네트워크·광모듈·PCB/기판·냉각·데이터센터·GPU 클라우드",
        "codes": ["ANET.N", "CIEN.N", "LITE.OQ", "COHR.N", "300308.SZ", "300502.SZ", "300394.SZ", "DELL.N", "SMCI.OQ",
                  "HPE.N", "2382.TW", "6669.TW", "3231.TW", "2317.TW", "601138.SS", "VRT.N", "3017.TW", "2308.TW",
                  "CLS.TO", "2345.TW", "2059.TW", "2376.TW", "2356.TW", "3665.TW", "APH.N", "GLW.N", "5803.T",
                  "002837.SZ", "EQIX.OQ", "DLR.N", "CRWV.OQ", "NBIS.OQ", "IREN.OQ", "9698.HK", "300476.SZ",
                  "2383.TW", "600183.SS", "002463.SZ", "2368.TW", "3037.TW", "4062.T", "BE.N", "3653.TW"],
    },
    "hyperscaler": {
        "label": "하이퍼스케일러·클라우드", "desc": "대형 클라우드·AI 플랫폼 사업자",
        "codes": ["MSFT.OQ", "AMZN.OQ", "GOOGL.OQ", "GOOG.OQ", "META.OQ", "ORCL.N", "9988.HK", "0700.HK", "9888.HK",
                  "CRWV.OQ", "NBIS.OQ"],
    },
    "software": {
        "label": "소프트웨어·SaaS", "desc": "GICS 소프트웨어 + 클라우드 IT서비스, 비트코인 보유·채굴·자율주행 제외",
        "industries": ["Software"],
        "codes": ["SNOW.N", "NET.N", "TWLO.N", "OKTA.OQ", "MDB.OQ", "VEEV.N", "PME.AX"],
        "exclude": ["MSTR.OQ", "IREN.OQ", "NBIS.OQ", "9660.HK", "2026.HK"],
    },
    "cyber": {
        "label": "사이버보안", "desc": "네트워크·엔드포인트·클라우드 보안",
        "codes": ["PANW.OQ", "CRWD.OQ", "FTNT.OQ", "ZS.OQ", "CHKP.OQ", "GEN.OQ", "OKTA.OQ", "NET.N"],
    },
    "grid": {
        "label": "전력망·전력기기", "desc": "변압기·차단기·전선·송배전 설비·전력 EPC",
        "codes": ["GEV.N", "SCHN.PA", "ABBN.S", "ETN.N", "ENR1n.DE", "HUBB.N", "PRY.MI", "LEGD.PA", "010120.KS",
                  "298040.KS", "267260.KS", "6501.T", "ABB.NS", "HITN.NS", "CGPO.NS", "SIEE.NS", "GETD.NS", "1519.TW",
                  "1504.TW", "600406.SS", "600089.SS", "PWR.N", "5803.T", "5802.T", "POLC.NS", "WEGE3.SA", "BHEL.NS",
                  "6504.T", "601727.SS", "6503.T"],
    },
    "nuclear": {
        "label": "원자력", "desc": "원전 운영·기자재·우라늄·SMR",
        "codes": ["CEG.OQ", "CCO.TO", "OKLO.N", "034020.KS", "601985.SS", "1816.HK", "VST.N", "015760.KS", "9503.T",
                  "7011.T", "000720.KS"],
    },
    "renewable": {
        "label": "태양광·풍력·신재생", "desc": "태양광 밸류체인·풍력·인버터·신재생/수력 발전",
        "codes": SOLAR + ["300274.SZ", "VWS.CO", "ORSTED.CO", "EDPR.LS", "600905.SS", "0916.HK", "BREN.JK", "SUZL.NS",
                          "NEE.N", "RWEG.DE", "2082.SE", "BEPC.N", "MEL.NZ", "600900.SS", "600674.SS", "NHPC.NS"],
    },
    "ev_battery": {
        "label": "전기차·2차전지", "desc": "전기차·배터리·양극재/리튬·전장/자율주행",
        "codes": ["TSLA.OQ", "002594.SZ", "1211.HK", "RIVN.OQ", "2015.HK", "9866.HK", "9868.HK", "9863.HK", "601127.SS",
                  "300750.SZ", "3750.HK", "373220.KS", "006400.KS", "300014.SZ", "003670.KS", "247540.KQ", "086520.KQ",
                  "603799.SS", "002460.SZ", "1772.HK", "002709.SZ", "000792.SZ", "000408.SZ", "051910.KS", "6752.T",
                  "002050.SZ", "601689.SS", "2525.HK", "9660.HK", "2026.HK"],
    },
    "defense": {
        "label": "방산", "desc": "방위산업 체계·무기·방산 전자",
        "codes": ["LMT.N", "NOC.N", "GD.N", "RTX.N", "LHX.N", "BAES.L", "RHMG.DE", "TCFP.PA", "012450.KS", "ASELS.IS",
                  "SAABb.ST", "HIAE.NS", "ESLT.TA", "LDOF.MI", "BAJE.NS", "KOG.OL", "STEG.SI", "AM.PA", "CW.N",
                  "CSG.AS", "079550.KS", "272210.KS", "HAGG.DE", "047810.KS", "064350.KS", "LDOS.N", "SLIN.NS",
                  "2357.HK", "600893.SS", "7011.T", "7012.T", "7013.T", "IDR.MC"],
    },
    "aero": {
        "label": "민항·우주", "desc": "민항기·엔진·부품·MRO·우주",
        "codes": ["GE.N", "AIR.PA", "SAF.PA", "RR.L", "BA.N", "HWM.N", "TDG.N", "MTXGn.DE", "HEIa.N", "HEI.N",
                  "FTAI.OQ", "BBDb.TO", "EMBJ3.SA", "TXT.N", "CAE.TO", "MRON.L", "RKLB.OQ", "ASTS.OQ"],
    },
    "shipbuilding": {
        "label": "조선·해양", "desc": "조선·해양플랜트·선박엔진·선박 AS",
        "codes": ["329180.KS", "042660.KS", "009540.KS", "010140.KS", "600150.SS", "YAZG.SI", "443060.KS",
                  "267250.KS", "WRT1V.HE"],
    },
    "robotics": {
        "label": "로봇·자동화", "desc": "산업용 로봇·FA·모션제어·수술로봇·휴머노이드",
        "codes": ["6954.T", "6861.T", "ROK.N", "6273.T", "300124.SZ", "6383.T", "9880.HK", "ISRG.OQ", "1590.TW",
                  "TER.OQ", "EMR.N", "2395.TW", "6479.T", "6594.T", "002050.SZ", "SIEGn.DE", "ABBN.S", "9660.HK"],
    },
    "bigpharma": {
        "label": "글로벌 빅파마", "desc": "시총 상위 다국적 제약사",
        "codes": ["LLY.N", "JNJ.N", "MRK.N", "ROPC.S", "RO.S", "NOVN.S", "AZN.L", "PFE.N", "NOVOb.CO", "BMY.N",
                  "SASY.PA", "GSK.L", "ABBV.N", "AMGN.OQ", "GILD.OQ", "4502.T", "BAYGn.DE", "MRCG.DE", "4568.T"],
    },
    "bio_cdmo": {
        "label": "바이오 CDMO·CRO", "desc": "위탁개발생산·임상시험수탁·바이오공정 소재",
        "codes": ["207940.KS", "LONN.S", "603259.SS", "2359.HK", "2269.HK", "2268.HK", "DIVI.NS", "IQV.N", "1548.HK",
                  "STDM.PA", "SATG_p.DE", "WST.N", "TMO.N", "DHR.N"],
    },
    "gold": {
        "label": "금·귀금속 광산", "desc": "금·은·백금 생산·스트리밍",
        "codes": ["NEM.N", "AEM.TO", "ABX.TO", "WPM.TO", "2259.HK", "AU.N", "FNV.TO", "GFIJ.J", "K.TO", "FRES.L",
                  "NST.AX", "VALJ.J", "PAAS.TO", "EVN.AX", "CDE.N", "600489.SS", "600547.SS", "1787.HK", "LUG.TO",
                  "EDV.TO", "AGI.TO", "2099.HK", "HARJ.J", "IMPJ.J", "000426.SZ", "SSWJ.J", "1818.HK", "NPHJ.J",
                  "BVN.N", "PEOLES.MX", "601899.SS", "2899.HK"],
    },
    "base_metals": {
        "label": "구리·비철금속", "desc": "구리·알루미늄·아연·니켈 등 비철 및 종합광산",
        "codes": ["SCCO.N", "FCX.N", "GMEXICOB.MX", "601899.SS", "2899.HK", "ANTO.L", "603993.SS", "3993.HK", "FM.TO",
                  "LUN.TO", "TECKb.TO", "IVN.TO", "KGH.WA", "BOL.ST", "1208.HK", "1258.HK", "0358.HK", "AMMN.JK",
                  "HALC.NS", "NHY.OL", "S32.AX", "1378.HK", "002379.SZ", "2600.HK", "PMET.KL", "5713.T", "VDAN.NS",
                  "GLEN.L", "AAL.L", "BHP.AX", "RIO.L", "RIO.AX", "BRMS.JK"],
    },
    "strategic_min": {
        "label": "희토류·리튬·전략광물", "desc": "희토류·텅스텐·리튬·코발트",
        "codes": ["600111.SS", "LYC.AX", "000657.SZ", "600549.SS", "002460.SZ", "1772.HK", "000792.SZ", "000408.SZ",
                  "603799.SS"],
    },
    "steel": {
        "label": "철강·철광석", "desc": "철강·스테인리스·철광석",
        "codes": ["NUE.N", "STLD.OQ", "MT.AS", "JSTL.NS", "TISC.NS", "5401.T", "600019.SS", "RS.N", "005490.KS",
                  "JINT.NS", "2002.TW", "5411.T", "JIST.NS", "APLA.NS", "GGBR4.SA", "EREGL.IS", "NMDC.NS",
                  "VALE3.SA", "FMG.AX"],
    },
    "luxury": {
        "label": "럭셔리", "desc": "명품 패션·주얼리·시계·슈퍼카·면세",
        "codes": ["LVMH.PA", "HRMS.PA", "CFR.S", "PRTP.PA", "MONC.MI", "PNDORA.CO", "UHR.S", "6181.HK", "RACE.MI",
                  "TPR.N", "1929.HK", "TITN.NS", "EL.N", "P911_p.DE", "601888.SS"],
    },
    "beauty": {
        "label": "뷰티·화장품", "desc": "화장품·더마·뷰티 리테일",
        "codes": ["OREP.PA", "EL.N", "BEIG.DE", "4452.T", "278470.KS", "4911.T", "090430.KS", "2367.HK", "ULTA.OQ",
                  "GALD.S"],
    },
    "platform": {
        "label": "인터넷 플랫폼·이커머스", "desc": "검색·SNS·이커머스·배달/모빌리티·온라인여행·버티컬 플랫폼",
        "codes": ["AMZN.OQ", "9988.HK", "PDD.OQ", "PRX.AS", "MELI.OQ", "SE.N", "EBAY.OQ", "9618.HK", "NPNJn.J",
                  "ALEP.WA", "4755.T", "VIPS.N", "GOTO.JK", "GOOGL.OQ", "GOOG.OQ", "META.OQ", "0700.HK", "9888.HK",
                  "4689.T", "RDDT.N", "035420.KS", "1024.HK", "035720.KS", "PINS.N", "SNAP.N", "INED.NS", "9626.HK",
                  "3690.HK", "ETEA.NS", "DASH.OQ", "ABNB.OQ", "BKNG.OQ", "EXPE.OQ", "9961.HK", "DHER.DE", "SWIG.NS",
                  "UBER.N", "GRAB.OQ", "SHOP.OQ", "ZALG.DE", "3092.T", "FSNE.NS", "0780.HK", "6618.HK", "0241.HK",
                  "Z.OQ", "REA.AX", "CAR.AX", "G24n.DE", "AUTOA.L", "BZ.OQ"],
    },
    "china_internet": {
        "label": "중국 인터넷", "desc": "중국 인터넷·플랫폼·게임·콘텐츠",
        "codes": ["0700.HK", "9988.HK", "PDD.OQ", "3690.HK", "9618.HK", "9888.HK", "1024.HK", "9999.HK", "9961.HK",
                  "9626.HK", "BZ.OQ", "VIPS.N", "TME.N", "6618.HK", "0241.HK", "0780.HK", "1357.HK", "9899.HK",
                  "0772.HK", "FUTU.OQ"],
    },
    "content": {
        "label": "게임·엔터·콘텐츠", "desc": "게임·음악·영상 스트리밍·공연·캐릭터 IP",
        "codes": ["NFLX.OQ", "DIS.N", "SPOT.N", "9999.HK", "WBD.OQ", "7974.T", "LYV.N", "TTWO.OQ", "UMG.AS", "RBLX.N",
                  "FWONK.OQ", "9766.T", "002602.SZ", "9697.T", "3659.T", "9602.T", "3293.TWO", "259960.KS", "CDR.WA",
                  "EVDG.DE", "TME.N", "352820.KS", "3888.HK", "0136.HK", "9899.HK", "6758.T", "7832.T", "8136.T",
                  "9992.HK", "0772.HK"],
    },
    "fintech": {
        "label": "결제·핀테크", "desc": "카드 네트워크·결제·디지털 은행·온라인 증권·가상자산 거래",
        "codes": ["V.N", "MA.N", "AXP.N", "PYPL.OQ", "XYZ.N", "ADYEN.AS", "CPAY.N", "FISV.OQ", "GPN.N", "AFRM.OQ",
                  "FIS.N", "TOST.N", "WSE.O", "PAYT.NS", "JKHY.OQ", "STNE.OQ", "NU.N", "SOFI.OQ", "HOOD.OQ",
                  "COIN.OQ", "323410.KS", "FUTU.OQ", "300059.SZ", "PBFI.NS"],
    },
    "crypto": {
        "label": "가상자산 관련", "desc": "거래소·비트코인 보유/채굴 기업",
        "codes": ["COIN.OQ", "MSTR.OQ", "HOOD.OQ", "IREN.OQ", "XYZ.N"],
    },
    "travel": {
        "label": "여행·레저", "desc": "항공·호텔·크루즈·카지노·공항·온라인여행·면세",
        "industries": ["Passenger Airlines"],
        "codes": ["BKNG.OQ", "ABNB.OQ", "EXPE.OQ", "MAR.OQ", "HLT.N", "RCL.N", "CCL.N", "H.N", "IHG.L", "ACCP.PA",
                  "9961.HK", "0780.HK", "HTHT.OQ", "4661.T", "AMA.MC", "LVS.N", "0027.HK", "1928.HK", "IHTL.NS",
                  "WTB.L", "AENA.MC", "ADP.PA", "AOT_n.BK", "GAPB.MX", "ASURB.MX", "OMAB.MX", "GMRI.NS", "AIA.NZ",
                  "601888.SS"],
    },
    "jp_trading": {
        "label": "일본 종합상사", "desc": "미쓰비시·이토추·미쓰이·스미토모·마루베니·도요타통상",
        "codes": ["8058.T", "8001.T", "8031.T", "8053.T", "8002.T", "8015.T"],
    },
    "reits": {
        "label": "리츠", "desc": "GICS 리츠 전 산업",
        "industries": REIT_INDUSTRIES,
    },
}


def theme_members(stocks) -> dict[str, list[str]]:
    """stocks: DataFrame(code, industry). 반환: 테마 키 → 코드 목록 (유니버스에 있는 것만)."""
    have = set(stocks["code"])
    out = {}
    for k, t in THEMES.items():
        s = set(c for c in t.get("codes", []) if c in have)
        if t.get("industries"):
            s |= set(stocks.loc[stocks["industry"].isin(t["industries"]), "code"])
        s -= set(t.get("exclude", []))
        out[k] = sorted(s)
    return out

