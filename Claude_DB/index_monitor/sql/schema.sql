-- Index Monitor 적재 스키마 (SQLite/PostgreSQL 공용 문법)
-- 원칙: 공지(이벤트) 단위 + 종목 변경 행 + 시점 스냅샷을 분리한다.
--  · 편출입 이력은 constituent_change 에 '공지 기준'으로 쌓고
--  · 스냅샷(ETF 보유종목/Datastream 구성종목)으로 실제 반영 여부를 사후 검증한다.

CREATE TABLE index_master (
    index_id        TEXT PRIMARY KEY,      -- 'MSCI_KOREA', 'KOSPI200', 'SP500' ...
    provider        TEXT NOT NULL,         -- MSCI / S&P DJI / Nasdaq / FTSE Russell / KRX / Nikkei
    name            TEXT NOT NULL,
    region          TEXT,
    selection       TEXT,                  -- rules / committee / hybrid
    weighting       TEXT,                  -- FF mcap, modified cap, price-weighted ...
    review_freq     TEXT,                  -- 'Feb/May/Aug/Nov' 등
    methodology_url TEXT
);

CREATE TABLE review_event (
    event_id        TEXT PRIMARY KEY,      -- '{index_id}:{YYYY-MM}:{type}'
    index_id        TEXT REFERENCES index_master(index_id),
    review_label    TEXT,                  -- '2026-08 분기', '2026-07 Fast Entry'
    event_type      TEXT CHECK (event_type IN ('regular','adhoc','fast_entry','weight','reclass')),
    cutoff_date     DATE,                  -- 가격/심사 기준일 (MSCI: 직전월 말 10영업일 중 임의일)
    announce_date   DATE,
    effective_date  DATE,                  -- 지수에 처음 반영되는 날(장 시작 기준)
    source_url      TEXT,
    source_tier     TEXT                   -- official_pdf / official_pr / primary_news / wiki / secondary
);

CREATE TABLE constituent_change (
    event_id          TEXT REFERENCES review_event(event_id),
    action            TEXT CHECK (action IN ('ADD','DEL','WEIGHT','MIGRATE')),
    security_name_raw TEXT NOT NULL,       -- 공지 원문 표기 그대로 (MSCI는 이름만 제공)
    security_id       TEXT,                -- ISIN 또는 KRX 6자리, 매핑 후 채움
    ticker            TEXT,
    country           TEXT,
    note              TEXT,
    est_flow_krw      NUMERIC,             -- 증권사 추정 패시브 수급(선택)
    PRIMARY KEY (event_id, action, security_name_raw)
);

CREATE TABLE constituent_snapshot (
    index_id    TEXT,
    as_of       DATE,
    security_id TEXT,
    weight      NUMERIC,
    source      TEXT,                      -- 'Datastream L-list', 'iShares EWY holdings', 'KODEX200 PDF'
    PRIMARY KEY (index_id, as_of, security_id)
);

-- MSCI 등 이름만 주는 소스를 ISIN/코드로 잇는 사전
CREATE TABLE security_map (
    provider          TEXT,
    security_name_raw TEXT,
    security_id       TEXT,
    PRIMARY KEY (provider, security_name_raw)
);

-- 스냅샷 diff로 공지 누락 검증: 직전 스냅샷 대비 새로 생긴/사라진 종목
-- SELECT cur.security_id, 'ADD' FROM constituent_snapshot cur
--  LEFT JOIN constituent_snapshot prev
--    ON prev.index_id = cur.index_id AND prev.as_of = :prev AND prev.security_id = cur.security_id
--  WHERE cur.index_id = :idx AND cur.as_of = :cur AND prev.security_id IS NULL;
