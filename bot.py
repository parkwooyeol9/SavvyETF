import html
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests
from dotenv import load_dotenv

from etf_compare import parse_comp_tickers
from news_crawler import format_news_messages
from naver_news import format_naver_news_messages
from stock_crawler import (
    ensure_universe_caches,
    format_rankings_message,
    get_ranking_tickers,
    get_top_leader_ticker,
    get_warmup_status,
    is_cache_ready,
    is_cache_warmup_running,
    parse_rank_command,
    start_cache_watchdog,
    start_universe_cache_warmup,
    warmup_deferred_caches,
    warmup_startup_caches,
)
from etf_sector_scheduler import start_etf_sector_scheduler
from etf_us_new_scheduler import start_etf_us_new_scheduler
from etfcheck_scheduler import start_etfcheck_scheduler
from esg_scheduler import start_esg_scheduler
from reddit_scheduler import start_reddit_scheduler
from summary_kor_intra_scheduler import start_summary_kor_intra_scheduler
from summary_kor_scheduler import start_summary_kor_scheduler
from summary_nxt_scheduler import start_summary_nxt_scheduler
from summary_scheduler import start_summary_scheduler
from scheduler_grace import mark_service_started

PROJECT_DIR = Path(__file__).resolve().parent
WEB_DIR = PROJECT_DIR / "web"
ENV_FILE = PROJECT_DIR / ".env"
KNOWN_CHATS_FILE = PROJECT_DIR / "data" / "known_chats.json"
BLOCKED_CHATS_FILE = PROJECT_DIR / "data" / "blocked_chats.json"
load_dotenv(ENV_FILE)

STARTUP_TEXT = """SavvyETF Bot is online.

What each command returns:

/port AAPL MSFT GOOGL
→ Portfolio backtest chart + technical chart per stock

/coin BTC
→ Crypto technical analysis chart

/etf
→ Top 3 price-up+volume surge & top 3 price-down+volume surge ETFs

/etf_sector
→ Sector rotation by last completed daily return + chart (XL* + themes vs SPY)

/etf memb EEM
→ US ETF current holdings Top10 chart + Excel (Yahoo; iShares full CU when available)

/etf_us_new
→ 미국 신규 상장 ETF (Nasdaq + Yahoo inception) + 구성 Top holdings

/etf_holdings EEM 005930
→ ETF 내 특정 종목 편입비 시계열 차트 + 표 + Excel (iShares/Naver)

/etfcheck
→ ETF CHECK 수급·거래대금·신규상장 (HTTP only, no browser)

/sp   (or /nas)
→ Same rankings for S&P 500 / NASDAQ 100

/kospi  (or /kosdaq)
→ Same rankings for KOSPI 200 / KOSDAQ 100

/etf_pre  /sp_pre  /nas_pre
→ Pre-market % vs previous close

/heatmap sp
→ Treemap of top names by market cap (color = daily return)

/macro
→ Macro risk monitor: chart, metrics, Finnhub/EDGAR, AI macro risk comment

/news
→ Headlines for the 6 tickers from your last /etf, /sp, or /nas result

/news_naver
→ Naver News headlines for last ranking (or /news_naver 삼성전자)

/summary
→ ETF + S&P 500 brief, heatmap, AI briefing (scheduled 07:00 KST)

/summary_pre
→ Premarket brief: /sp_pre only (ETF excluded); PDF + 21:50 KST schedule

/summary_kor
→ KOSPI 200 + KOSDAQ 100 brief (Yahoo .KS/.KQ) + Naver News + DART + PDF/web

/summary_kor_intra
→ Same as /summary_kor using Naver 1m vs previous close (auto 11:00 KST)

/summary_nxt
→ Nextrade brief: KRX vs NXT focus, TOP/movers, MTD (auto 08:30·16:40 KST)

/aibriefing
→ Trending market news (5-10 articles) read + Korean AI brief (3-4 lines)

/data_briefing [kor]
→ Gemini 3-paragraph briefing from latest boards/notes/news (kor first; us/etf/esg later)

/reddit
→ WSB hot topics + Gemini KR + /financial for top 2 tickers (web + PDF)

/adr TSM ASML ARM
→ ADR listing impact analysis (charts + Excel) for underlying shares

/idx
→ MSCI ACWI/World/EM country top5 → major markets index/futures/FX returns

/idx rule
→ MSCI·FTSE·UCITS 등 지수/펀드 편입비 한도 비교 (차트+표)

/event [keyword]
→ Event study (US/JP/KR/CN indices) + impact comment + PDF

/comp QQQ IVV QNDX
→ ETF charts, metrics, AI pick, Excel workbook

/financial AAPL
→ S&P 500 fundamental analysis: PER, PBR, ROE, margins, EPS growth + charts

/fin_estimate NVDA 삼성전자
→ 미·한 컨센서스(2026–2028) + 2000년~분기 재무 Excel 업로드

/nxt
→ NXT 데이터 허브: live / 월누적 / dailyvol / daily / movers / stock / compare …
→ 예: /nxt 2026-06 · /nxt dailyvol 2026-06 · /nxt help

/dart 삼성전자
→ 한국 상장사 DART 재무분석: 매출·이익·ROE·성장률 + 차트

/esg 삼성전자
→ DART ESG 허브 (실적·배당·소유·주주환원·중대재해 스크리닝)

/dart etf memb 0167A0
→ 국내 ETF 편입종목·구성비(Naver) + DART 펀드공시(리밸/변경) 파싱

Auto schedule (KST):
  /summary 07:00 · /summary_pre 21:50 · /reddit 21:00  → US channel
  /summary_nxt 08:30 / 16:40 · /summary_kor_intra 11:00 · /summary_kor 15:40  → Korea channel
  /etf_sector 07:00 · /etf_us_new 07:20 (US session days) · /etfcheck 15:40 (KRX days)  → legacy ETF channel
  /esg monitor 09:00 daily · /esg accident 09:30 · /esg overview 09:45 (KRX)  → SavvyESG channel

Type /help for the full command list.
"""

# Telegram sendMessage limit is 4096 chars — keep help split and concise.
HELP_TEXT_SHORT = "알 수 없는 명령어입니다. 전체 안내는 /help 를 입력하세요."


def build_help_messages() -> list[dict]:
    """Korean help guide split to stay under Telegram's 4096-char limit."""
    msg1 = """<b>SavvyETF Bot — 명령어 안내</b>

<b>📊 시장 · 랭킹</b>
<code>/etf</code> <code>/sp</code> <code>/nas</code> — ETF·S&P500·NASDAQ100 등락+거래량 상위
<code>/etf_sector</code> — 섹터 로테이션 (전일 수익률 + 차트, XL*/테마 vs SPY)
<code>/etf memb EEM</code> — 미국 ETF 편입비중 Top10 + Excel
<code>/etf_us_new</code> — 미국 신규 상장 ETF + 구성종목
<code>/etf_holdings EEM 005930</code> — ETF 편입비 시계열 + Excel
<code>/etfcheck</code> — ETF CHECK 수급·거래대금·신규상장
<code>/kospi</code> <code>/kosdaq</code> — KOSPI200·KOSDAQ100 (전일 종가 기준 캐시)
<code>/kospi_intra</code> <code>/kosdaq_intra</code> — 장중 수익률 (Naver 1분봉 vs 전일 종가)
<code>/etf_pre</code> <code>/sp_pre</code> <code>/nas_pre</code> — 프리마켓 등락률
<code>/heatmap sp</code> — 시가총액 트리맵 (색=일간 수익률)

<b>🌍 글로벌 · 매크로 · 이벤트</b>
<code>/idx</code> — MSCI 국가비중 → 주요국 지수·선물·FX
<code>/idx rule</code> — MSCI·FTSE·UCITS 편입비 한도 비교 (차트+표)
<code>/macro</code> — 매크로 리스크 대시보드
<code>/event</code> — 과거 유사 이벤트 스터디 (미·일·한·중, PDF)
<code>/adr TSM</code> — ADR 상장 영향 분석

<b>📰 뉴스</b>
<code>/news</code> — 직전 랭킹 6종목 헤드라인
<code>/news_naver</code> — 네이버 뉴스 (키워드 선택 가능)"""

    msg2 = """<b>📋 브리핑 · 자동 스케줄 (KST)</b>
<code>/summary</code> 07:00 — 미국 마감 브리핑 (US 채널)
<code>/summary_pre</code> 21:50 — 프리마켓 (US 채널)
<code>/reddit</code> 21:00 — WSB 핫토픽 + 재무 (US 채널)
<code>/summary_kor</code> 15:40 — 한국 마감 (Korea 채널)
<code>/summary_kor_intra</code> 11:00 — 한국 장중 (Korea 채널)
<code>/summary_nxt</code> 08:30·16:40 — NXT 브리핑 (Korea 채널)
<code>/etf_sector</code> 07:00 — 섹터 로테이션 (레거시 ETF 채널, 미국 휴장 제외)
<code>/etf_us_new</code> 07:20 — 미국 신규 상장 ETF (레거시 ETF 채널, 미국 휴장 제외)
<code>/etfcheck</code> 15:40 — ETF CHECK (레거시 ETF 채널, 한국 휴장 제외)
<code>/esg monitor</code> 09:00 daily · <code>/esg accident</code> 09:30 · <code>/esg</code> 개요 09:45 — SavvyESG 채널 (accident/overview는 한국 휴장 제외)
<code>/aibriefing</code> — 트렌딩 뉴스 요약
<code>/data_briefing</code> — 직전 데이터·뉴스 기반 3문단 시황 (국내 우선)

<b>🔬 종목 · ETF 분석</b>
<code>/financial AAPL</code> — S&P500 펀더멘털
<code>/fin_estimate NVDA 삼성전자</code> — 컨센서스+분기재무 Excel
<code>/nxt</code> — NXT 허브 (live/월간/시장/TOP)
<code>/nxt help</code> — 하위 명령 전체
<code>/nxt 2026-06</code> — 월간 NXT 거래대금 누적
<code>/nxt dailyvol 2026-06</code> — 시장 일별 대금·점유율
<code>/dart 삼성전자</code> — DART 재무
<code>/esg monitor</code> — Climate Risk Monitor (유럽 이상기후·지진)
<code>/esg 삼성전자</code> — ESG·거버넌스 (실적/배당/소유/환원/중대재해)
<code>/dart etf memb 0167A0</code> — ETF 편입·DART 공시
<code>/etf memb EEM</code> — 미국 ETF 현재 편입비중 Top10 + Excel
<code>/etf_us_new</code> — 미국 신규 상장 ETF + 구성종목
<code>/etf_holdings EEM 005930</code> — ETF 내 종목 편입비 시계열 + Excel
<code>/comp QQQ IVV</code> — ETF 비교 + 엑셀
<code>/port AAPL MSFT</code> — 포트 백테스트
<code>/coin BTC</code> — 코인 차트

<b>ℹ️ 기타</b>
<code>/help</code> — 이 안내 다시 보기"""

    return [
        {"text": msg1.strip(), "parse_mode": "HTML"},
        {"text": msg2.strip(), "parse_mode": "HTML"},
    ]


# Backward-compatible single string (first page only; do not send as one Telegram message).
HELP_TEXT = build_help_messages()[0]["text"]


def summary_public_url() -> str:
    from summary_builder import resolve_summary_public_url

    return resolve_summary_public_url()


def load_known_chats() -> set[int]:
    if not KNOWN_CHATS_FILE.exists():
        return set()
    try:
        with KNOWN_CHATS_FILE.open(encoding="utf-8") as handle:
            data = json.load(handle)
        return {int(chat_id) for chat_id in data}
    except (json.JSONDecodeError, TypeError, ValueError):
        return set()


def load_blocked_chats() -> set[int]:
    if not BLOCKED_CHATS_FILE.exists():
        return set()
    try:
        with BLOCKED_CHATS_FILE.open(encoding="utf-8") as handle:
            data = json.load(handle)
        return {int(chat_id) for chat_id in data}
    except (json.JSONDecodeError, TypeError, ValueError):
        return set()


def save_blocked_chats(chat_ids: set[int]) -> None:
    BLOCKED_CHATS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with BLOCKED_CHATS_FILE.open("w", encoding="utf-8") as handle:
        json.dump(sorted(chat_ids), handle)


def _parse_chat_id_env(var_name: str) -> set[int]:
    ids: set[int] = set()
    for raw_id in os.environ.get(var_name, "").split(","):
        raw_id = raw_id.strip()
        if not raw_id:
            continue
        try:
            ids.add(int(raw_id))
        except ValueError:
            print(f"Ignoring invalid {var_name} entry: {raw_id!r}")
    return ids


def env_chat_ids() -> set[int]:
    """Legacy / fallback pins from TELEGRAM_CHAT_ID (comma-separated)."""
    return _parse_chat_id_env("TELEGRAM_CHAT_ID")


def env_chat_ids_us() -> set[int]:
    """US schedule recipients (/summary, /summary_pre, /reddit) from TELEGRAM_CHAT_ID_US."""
    return _parse_chat_id_env("TELEGRAM_CHAT_ID_US")


def env_chat_ids_kor() -> set[int]:
    """Korea / NXT schedule recipients from TELEGRAM_CHAT_ID_KOR."""
    return _parse_chat_id_env("TELEGRAM_CHAT_ID_KOR")


def env_chat_ids_esg() -> set[int]:
    """SavvyESG channel recipients from TELEGRAM_CHAT_ID_ESG."""
    return _parse_chat_id_env("TELEGRAM_CHAT_ID_ESG")


def _all_pinned_chat_ids() -> set[int]:
    return (
        env_chat_ids()
        | env_chat_ids_us()
        | env_chat_ids_kor()
        | env_chat_ids_esg()
    )


def block_chat(chat_id: int, reason: str) -> None:
    # Env-pinned chats must keep receiving schedules across redeploys / flaky errors.
    if chat_id in _all_pinned_chat_ids():
        print(
            f"Skip blocking pinned chat_id={chat_id}: {reason}"
        )
        return
    blocked = load_blocked_chats()
    if chat_id in blocked:
        return
    blocked.add(chat_id)
    save_blocked_chats(blocked)
    remove_known_chat(chat_id)
    print(f"Chat {chat_id} removed from delivery list: {reason}")


def unblock_chat(chat_id: int) -> None:
    blocked = load_blocked_chats()
    if chat_id not in blocked:
        return
    blocked.remove(chat_id)
    save_blocked_chats(blocked)
    print(f"Chat {chat_id} unblocked for delivery")


def remove_known_chat(chat_id: int) -> None:
    chats = load_known_chats()
    if chat_id not in chats:
        return
    chats.remove(chat_id)
    KNOWN_CHATS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with KNOWN_CHATS_FILE.open("w", encoding="utf-8") as handle:
        json.dump(sorted(chats), handle)


def save_known_chat(chat_id: int) -> None:
    chats = load_known_chats()
    if chat_id in chats:
        return
    chats.add(chat_id)
    KNOWN_CHATS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with KNOWN_CHATS_FILE.open("w", encoding="utf-8") as handle:
        json.dump(sorted(chats), handle)


def register_delivery_chat(chat_id: int) -> None:
    """Clear soft-block; persist known_chats only for pinned/allowlisted chats.

    Public channel readers never hit this. Strangers using /help are not stored
    as broadcast targets (schedules use env channel IDs only anyway).
    """
    from bot_access import access_mode, env_allowed_chat_ids

    if access_mode() == "allowlist":
        allowed = env_allowed_chat_ids() | _all_pinned_chat_ids()
        if chat_id not in allowed:
            return
    unblock_chat(chat_id)
    save_known_chat(chat_id)


def startup_chat_ids() -> set[int]:
    """All broadcast targets: known chats + env pins, minus non-pinned blocks."""
    pinned = _all_pinned_chat_ids()
    blocked = load_blocked_chats() - pinned
    return (load_known_chats() | pinned) - blocked


def broadcast_targets(*, audience: str = "default") -> set[int]:
    """
    Resolve scheduled-delivery recipients.

    - us / default: /summary, /summary_pre, /reddit → TELEGRAM_CHAT_ID_US only
    - kor: /summary_kor*, /summary_nxt → TELEGRAM_CHAT_ID_KOR only
    - legacy / etf: /etfcheck, /etf_sector → TELEGRAM_CHAT_ID only
    - esg: /esg schedules → TELEGRAM_CHAT_ID_ESG only (SavvyESG)

    Never falls back to known_chats (strangers who DM'd the bot).
    """
    us = env_chat_ids_us()
    kor = env_chat_ids_kor()
    esg = env_chat_ids_esg()
    dedicated = us | kor | esg

    if audience == "kor":
        if not kor:
            print(
                "Korea broadcast skipped: set TELEGRAM_CHAT_ID_KOR to the Korea channel id."
            )
            return set()
        blocked = load_blocked_chats() - kor
        return kor - blocked

    if audience == "esg":
        if not esg:
            print(
                "ESG broadcast skipped: set TELEGRAM_CHAT_ID_ESG to the SavvyESG channel id."
            )
            return set()
        blocked = load_blocked_chats() - esg
        return esg - blocked

    if audience in {"legacy", "etf"}:
        legacy = env_chat_ids() - dedicated
        if not legacy:
            print(
                "Legacy ETF broadcast skipped: set TELEGRAM_CHAT_ID to the ETF channel id "
                "(distinct from US / Korea / ESG channel ids)."
            )
            return set()
        blocked = load_blocked_chats() - legacy
        return legacy - blocked

    # US / general schedules — env pin only (no known_chats fallback)
    if audience in {"us", "default"}:
        if not us:
            print(
                "US broadcast skipped: set TELEGRAM_CHAT_ID_US to the US channel id."
            )
            return set()
        blocked = load_blocked_chats() - us
        return us - blocked
    return set()


def broadcast_messages_us(token: str, messages: list[str] | list[dict]) -> int:
    """US scheduled briefs (/summary, /summary_pre, /reddit) → TELEGRAM_CHAT_ID_US."""
    return broadcast_messages(token, messages, audience="us")


def broadcast_messages_kor(token: str, messages: list[str] | list[dict]) -> int:
    """Korea / NXT scheduled briefs → TELEGRAM_CHAT_ID_KOR only."""
    return broadcast_messages(token, messages, audience="kor")


def broadcast_messages_legacy(token: str, messages: list[str] | list[dict]) -> int:
    """ETF channel schedules (/etfcheck, /etf_sector) → TELEGRAM_CHAT_ID only."""
    return broadcast_messages(token, messages, audience="legacy")


def broadcast_messages_esg(token: str, messages: list[str] | list[dict]) -> int:
    """SavvyESG schedules (/esg monitor|accident|overview) → TELEGRAM_CHAT_ID_ESG only."""
    return broadcast_messages(token, messages, audience="esg")


def _telegram_error_description(response: requests.Response) -> str:
    try:
        payload = response.json()
        if isinstance(payload, dict):
            return str(payload.get("description", ""))
    except ValueError:
        pass
    return response.text


def _is_unreachable_chat_error(response: requests.Response) -> bool:
    """True when the chat should be dropped from future broadcasts.

    Rights / parse failures are retriable (esp. channels waiting for Post Messages)
    and must not permanently blacklist a recipient.
    """
    if response.status_code in {403, 404}:
        description = _telegram_error_description(response).lower()
        # Channel not yet granted Post Messages — keep trying after admin fixes it.
        if any(
            phrase in description
            for phrase in (
                "have no rights",
                "need administrator",
                "not enough rights",
                "chat_write_forbidden",
            )
        ):
            return False
        return True
    if response.status_code == 400:
        description = _telegram_error_description(response).lower()
        return any(
            phrase in description
            for phrase in (
                "chat not found",
                "peer_id_invalid",
                "group chat was upgraded",
                "bot was kicked",
                "user is deactivated",
                "bot can't initiate conversation",
                "can't initiate conversation",
                "bot is not a member",
                "group chat was deactivated",
                "blocked by the user",
                "user_is_blocked",
            )
        )
    return False


def send_text(
    token: str,
    chat_id: int,
    text: str,
    parse_mode: str | None = None,
    *,
    button_url: str | None = None,
    button_text: str = "Open in browser",
) -> bool:
    payload: dict = {"chat_id": chat_id, "text": text}
    if parse_mode:
        payload["parse_mode"] = parse_mode
    if button_url:
        payload["reply_markup"] = {
            "inline_keyboard": [[{"text": button_text, "url": button_url}]]
        }
    try:
        response = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json=payload,
            timeout=60,
        )
    except requests.RequestException as exc:
        print(f"sendMessage network error for chat {chat_id}: {exc}")
        return False

    if response.ok:
        return True

    description = _telegram_error_description(response)
    print(f"sendMessage failed for chat {chat_id}: {response.text}")
    # Only permanently drop truly unreachable chats. A bare HTTP 400 (e.g. HTML
    # parse_mode / caption limits) must NOT blacklist a channel forever.
    if _is_unreachable_chat_error(response):
        block_chat(chat_id, description)
    return False


def _send_message_payload(token: str, chat_id: int, message: str | dict) -> bool:
    if isinstance(message, dict):
        return bool(send_reply(token, chat_id, message))
    return bool(send_text(token, chat_id, message))


def broadcast_messages(
    token: str,
    messages: list[str] | list[dict],
    *,
    audience: str = "default",
) -> int:
    """Send messages to audience targets. Returns number of chats delivered to."""
    chat_ids = broadcast_targets(audience=audience)
    if not chat_ids:
        print(
            f"Broadcast skipped (audience={audience}): no chat IDs configured. "
            "Set TELEGRAM_CHAT_ID_US / TELEGRAM_CHAT_ID_KOR / TELEGRAM_CHAT_ID / "
            "TELEGRAM_CHAT_ID_ESG on Render."
        )
        return 0
    if not messages:
        print("Broadcast skipped: empty message list.")
        return 0
    print(
        f"Broadcasting {len(messages)} message(s) to {len(chat_ids)} chat(s) "
        f"(audience={audience})."
    )
    delivered = 0
    for chat_id in chat_ids:
        ok = True
        for message in messages:
            try:
                if not _send_message_payload(token, chat_id, message):
                    ok = False
                    print(f"Broadcast send failed for chat {chat_id}")
                    break
                time.sleep(0.35)
            except requests.RequestException as exc:
                ok = False
                print(f"Broadcast failed for chat {chat_id}: {exc}")
                break
        if ok:
            delivered += 1
    if delivered == 0:
        print("Broadcast failed: no chats received messages.")
    return delivered


_greeted_this_session: set[int] = set()
_last_ranking_by_chat: dict[int, dict] = {}
# chat_id -> unix time when /event prompted for a keyword
_pending_event_by_chat: dict[int, float] = {}
_PENDING_EVENT_TTL_SEC = 30 * 60
_bot_username: str | None = None


def _redact_telegram(text: str, token: str) -> str:
    """Never log the bot token (Telegram puts it in request URLs)."""
    if token and token in text:
        return text.replace(token, "***")
    return text


def clear_telegram_webhook(token: str) -> None:
    """Polling and webhooks cannot run together; clear any leftover webhook."""
    try:
        response = requests.get(
            f"https://api.telegram.org/bot{token}/deleteWebhook",
            params={"drop_pending_updates": "false"},
            timeout=30,
        )
        if response.ok and (response.json() or {}).get("ok"):
            print("Telegram webhook cleared (polling mode).")
        else:
            print(f"Telegram deleteWebhook: {_redact_telegram(response.text[:200], token)}")
    except requests.RequestException as exc:
        print(f"Telegram deleteWebhook failed: {_redact_telegram(str(exc), token)}")


def fetch_bot_username(token: str) -> str | None:
    try:
        response = requests.get(f"https://api.telegram.org/bot{token}/getMe", timeout=30)
        if not response.ok:
            print(f"Could not fetch bot username: HTTP {response.status_code}")
            return None
        payload = response.json()
        if payload.get("ok"):
            return payload["result"].get("username")
    except requests.RequestException as exc:
        print(f"Could not fetch bot username: {_redact_telegram(str(exc), token)}")
    return None


def normalize_command_text(text: str) -> str:
    normalized = text.strip()
    if _bot_username:
        normalized = re.sub(
            rf"@{re.escape(_bot_username)}\b",
            "",
            normalized,
            flags=re.IGNORECASE,
        ).strip()
    return normalized


def extract_incoming_message(update: dict) -> dict | None:
    for key in ("message", "edited_message", "channel_post", "edited_channel_post"):
        message = update.get(key)
        if message and message.get("text"):
            return message
    return None


def extract_chat_id_from_update(update: dict) -> int | None:
    message = extract_incoming_message(update)
    if message:
        return message["chat"]["id"]

    member_update = update.get("my_chat_member") or update.get("chat_member")
    if member_update:
        return member_update.get("chat", {}).get("id")
    return None


def fetch_pending_updates(token: str) -> tuple[list[dict], int | None]:
    try:
        response = requests.get(
            f"https://api.telegram.org/bot{token}/getUpdates",
            params={
                "allowed_updates": json.dumps(
                    [
                        "message",
                        "edited_message",
                        "channel_post",
                        "edited_channel_post",
                        "my_chat_member",
                    ]
                )
            },
            timeout=35,
        )
    except requests.RequestException as exc:
        print(f"fetch_pending_updates failed: {_redact_telegram(str(exc), token)}")
        return [], None

    if response.status_code == 409:
        print(
            "Telegram 409 on startup getUpdates — another poller holds the token. "
            "Retrying after 15s…"
        )
        time.sleep(15)
        return [], None

    if not response.ok:
        print(
            f"fetch_pending_updates HTTP {response.status_code}: "
            f"{_redact_telegram(response.text[:200], token)}"
        )
        return [], None

    payload = response.json()
    if not payload.get("ok"):
        return [], None

    updates = payload.get("result", [])
    last_update_id = updates[-1]["update_id"] if updates else None
    return updates, last_update_id


def chat_ids_from_updates(updates: list[dict]) -> set[int]:
    chat_ids: set[int] = set()
    for update in updates:
        chat_id = extract_chat_id_from_update(update)
        if chat_id is not None:
            chat_ids.add(chat_id)
    return chat_ids


def process_my_chat_member(token: str, update: dict) -> None:
    member_update = update.get("my_chat_member")
    if not member_update:
        return

    chat = member_update.get("chat", {})
    chat_id = chat.get("id")
    if chat_id is None:
        return

    new_status = member_update.get("new_chat_member", {}).get("status")
    if new_status in {"administrator", "member"}:
        register_delivery_chat(chat_id)
        chat_type = chat.get("type", "unknown")
        print(f"Bot added to {chat_type} {chat_id}")
        if chat_type == "channel":
            # Channels need Post Messages (admin). Pin ID in Render TELEGRAM_CHAT_ID
            # so schedules survive ephemeral disk resets.
            ok = send_text(
                token,
                chat_id,
                (
                    "SavvyETF Bot is ready in this channel.\n"
                    f"Channel chat_id: {chat_id}\n"
                    "Tip: US → TELEGRAM_CHAT_ID_US; Korea/NXT → TELEGRAM_CHAT_ID_KOR; "
                    "ETF → TELEGRAM_CHAT_ID; ESG → TELEGRAM_CHAT_ID_ESG "
                    "(comma-separated ids OK).\n"
                    "Bot must be channel admin with Post Messages.\n"
                    "Try /help"
                ),
            )
            if not ok:
                print(
                    f"Channel {chat_id} registered but welcome post failed — "
                    "grant Post Messages to the bot, then post /help in the channel."
                )
    elif new_status in {"left", "kicked"}:
        block_chat(chat_id, f"bot status is {new_status}")


def process_telegram_update(token: str, update: dict) -> None:
    if update.get("my_chat_member"):
        process_my_chat_member(token, update)
        return

    message = extract_incoming_message(update)
    if not message:
        return

    chat_id = message["chat"]["id"]
    chat_type = message["chat"].get("type", "private")
    command_text = normalize_command_text(message["text"])
    from_user = message.get("from") or {}
    user_id = from_user.get("id")
    try:
        user_id_int = int(user_id) if user_id is not None else None
    except (TypeError, ValueError):
        user_id_int = None

    from bot_access import (
        check_heavy_cooldown,
        denied_access_message,
        is_interaction_allowed,
    )

    if not is_interaction_allowed(
        chat_id=chat_id,
        user_id=user_id_int,
        pinned_chat_ids=_all_pinned_chat_ids(),
        command_text=command_text,
    ):
        send_text(token, chat_id, denied_access_message())
        return

    # Persist only allowlisted / pinned chats for broadcast safety; public light
    # users can still run /help without being added to known_chats.
    register_delivery_chat(chat_id)
    if chat_type != "channel":
        maybe_send_deferred_startup_guide(token, chat_id)

    cooldown_msg = check_heavy_cooldown(chat_id, command_text)
    if cooldown_msg:
        send_text(token, chat_id, cooldown_msg)
        return

    replies = handle_telegram_message(command_text, chat_id)
    if not isinstance(replies, list):
        replies = [replies]

    for reply in replies:
        send_reply(token, chat_id, reply)


# Keep getUpdates responsive: heavy commands run off the poll loop.
# Cap workers to limit RAM on Render Starter (512MB).
_UPDATE_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="tg-cmd")
_chat_inflight: dict[int, Future] = {}
_chat_inflight_lock = threading.Lock()


def _run_telegram_update(token: str, update: dict, chat_id: int | None) -> None:
    update_id = update.get("update_id")
    try:
        print(f"Handling update {update_id} (chat={chat_id})")
        process_telegram_update(token, update)
    except Exception as exc:
        print(f"Update handler error (update={update_id}, chat={chat_id}): {exc}")
        if chat_id is not None:
            send_text(
                token,
                chat_id,
                "Command failed. Please try again later.",
            )
    finally:
        if chat_id is not None:
            with _chat_inflight_lock:
                _chat_inflight.pop(chat_id, None)
        print(f"Finished update {update_id} (chat={chat_id})")


def enqueue_telegram_update(token: str, update: dict) -> None:
    """Poller calls this and returns to getUpdates immediately."""
    chat_id = extract_chat_id_from_update(update)

    with _chat_inflight_lock:
        if chat_id is not None:
            existing = _chat_inflight.get(chat_id)
            if existing is not None and not existing.done():
                send_text(
                    token,
                    chat_id,
                    "Still working on your previous command. Please wait a moment.",
                )
                return
        future = _UPDATE_EXECUTOR.submit(_run_telegram_update, token, update, chat_id)
        if chat_id is not None:
            _chat_inflight[chat_id] = future


def _is_private_chat_id(chat_id: int) -> bool:
    """Telegram private (1:1 bot DM) ids are positive; channels/groups are negative."""
    return chat_id > 0


def send_startup_guide_to_chat(token: str, chat_id: int) -> bool:
    if chat_id in _greeted_this_session:
        return False
    if not send_text(token, chat_id, STARTUP_TEXT):
        return False
    _greeted_this_session.add(chat_id)
    save_known_chat(chat_id)
    print(f"Startup guide sent to chat {chat_id}")
    return True


def broadcast_startup_guide(token: str, extra_chat_ids: set[int] | None = None) -> bool:
    """Notify that the bot is online after redeploy.

    Only private 1:1 chats (positive ids) get the startup guide — never channels
    or groups. Scheduled briefs still go to TELEGRAM_CHAT_ID_* channels as usual.
    Public channel join is unrestricted (Telegram); this is DM-only notice.
    """
    chat_ids = startup_chat_ids()
    if extra_chat_ids:
        chat_ids |= extra_chat_ids

    private_ids = {c for c in chat_ids if _is_private_chat_id(c)}
    skipped = len(chat_ids) - len(private_ids)
    if skipped:
        print(
            f"Startup guide: skipping {skipped} channel/group chat(s); "
            f"private DMs only."
        )

    if not private_ids:
        print("Startup guide deferred: no private (bot DM) chat IDs yet.")
        print("It will be sent the next time you message the bot in a 1:1 chat.")
        return False

    sent_any = False
    for chat_id in sorted(private_ids):
        if send_startup_guide_to_chat(token, chat_id):
            sent_any = True
    return sent_any


def maybe_send_deferred_startup_guide(token: str, chat_id: int) -> None:
    # Channels already skip this caller; also guard groups if invoked elsewhere.
    if not _is_private_chat_id(chat_id):
        return
    if chat_id not in _greeted_this_session:
        send_startup_guide_to_chat(token, chat_id)


def _ranking_loading_reply(universe: str) -> list[dict]:
    label = {
        "etf": "ETF",
        "sp": "S&P 500",
        "nas": "NASDAQ 100",
        "kospi": "KOSPI 200",
        "kosdaq": "KOSDAQ 100",
    }.get(universe, universe.upper())
    status = get_warmup_status(universe)
    if status.get("phase") == "failed" and status.get("error"):
        start_universe_cache_warmup(universe, force=True)
        return [
            {
                "text": (
                    f"{label} cache build failed earlier:\n{status['error']}\n\n"
                    f"Retrying now. Send /{universe} again in ~30–60 seconds."
                )
            }
        ]
    if is_cache_warmup_running(universe) or status.get("running"):
        detail = status.get("message") or "still building"
        hint = (
            "KOSPI/KOSDAQ first build can take a few minutes."
            if universe in {"kospi", "kosdaq"}
            else "S&P/NASDAQ usually finish within ~1 minute."
        )
        return [
            {
                "text": (
                    f"{label} rankings are still loading ({detail}).\n"
                    f"{hint} Try /{universe} again shortly."
                )
            }
        ]
    start_universe_cache_warmup(universe)
    return [
        {
            "text": (
                f"Loading {label} rankings "
                f"(Yahoo chart → same-day disk cache).\n"
                f"First build usually takes under a minute. Try /{universe} again shortly."
            )
        }
    ]


# Mobile Telegram wraps long <pre> rows; keep one event per short block.
_EVENT_PROMPT_TEXT = """어떤 이벤트 스터디를 원하십니까?

<b>참고 — 이벤트 중요도 · 영향 자산</b>

★★★★★ <b>중앙은행</b> (Fed, ECB, BOJ)
영향: 모든 자산

★★★★★ <b>미국 CPI · PCE · 고용지표</b>
영향: 미국 주식, 채권, 달러

★★★★★ <b>전쟁 · 대형 테러</b>
영향: 주식, 원유, 금

★★★★★ <b>금융위기</b>
영향: 전 자산

★★★★☆ <b>미국 대통령 / 중간선거</b>
영향: 주식, 섹터

★★★★☆ <b>중국 경기 및 정책</b>
영향: 원자재, 아시아

★★★★☆ <b>대형 자연재해</b>
영향: 특정 국가 및 산업

★★★★☆ <b>기업 실적 시즌</b>
영향: 개별주 · 지수

★★★☆☆ <b>지정학적 회담</b>
영향: 환율, 원자재

예: <code>일본 지진</code> · <code>리먼</code> · <code>코로나</code> · <code>우크라이나</code>"""


def _is_pending_event_reply(chat_id: int, text: str) -> bool:
    """True when chat is waiting for an /event keyword and text is not a slash command."""
    if not text or text.lstrip().startswith("/"):
        return False
    started = _pending_event_by_chat.get(chat_id)
    if started is None:
        return False
    if time.time() - started > _PENDING_EVENT_TTL_SEC:
        _pending_event_by_chat.pop(chat_id, None)
        return False
    return True


def _handle_event_command(normalized: str, chat_id: int) -> list[dict]:
    lower = normalized.lower().strip()
    query = ""

    if lower.startswith("/event"):
        # /event | /event@Bot | /event 일본 지진
        parts = normalized.split(maxsplit=1)
        if len(parts) >= 2:
            query = parts[1].strip()
        if not query:
            _pending_event_by_chat[chat_id] = time.time()
            return [{"text": _EVENT_PROMPT_TEXT, "parse_mode": "HTML"}]
    else:
        # Follow-up keyword after the prompt
        query = normalized.strip()

    _pending_event_by_chat.pop(chat_id, None)
    if not query:
        return [{"text": _EVENT_PROMPT_TEXT, "parse_mode": "HTML"}]

    try:
        from event_pipeline import run_event_pipeline

        replies: list[dict] = [
            {
                "text": (
                    f"🔎 Event study: 「{query}」\n"
                    "과거 유사 사례 일자 조사 → /idx 국가 지수 t=0 비교 중…"
                )
            }
        ]
        result = run_event_pipeline(query, public_url=summary_public_url())
        replies.extend(result.get("telegram_messages") or [])
        return replies
    except Exception as exc:
        return [{"text": f"/event failed: {exc}"}]


def handle_telegram_message(message, chat_id: int):
    normalized = message.strip()
    lower = normalized.lower()

    # Any slash command clears a pending /event keyword prompt (except /event itself).
    if lower.startswith("/") and not lower.startswith("/event"):
        _pending_event_by_chat.pop(chat_id, None)

    token0 = lower.split()[0] if lower else ""
    if token0 == "/help" or lower == "help":
        return build_help_messages()
    if token0 == "/start":
        return [
            {
                "text": (
                    "SavvyETF Bot입니다.\n"
                    "명령어 전체 안내는 <code>/help</code> 를 입력하세요."
                ),
                "parse_mode": "HTML",
            }
        ]

    if lower.startswith("/summary_pre"):
        try:
            from summary_pre_builder import generate_summary_pre

            replies: list[dict] = [
                {"text": "🌅 Building premarket brief (/sp_pre, ETF excluded)…"}
            ]
            summary = generate_summary_pre(public_url=summary_public_url())
            replies.extend(summary["telegram_messages"])
            return replies
        except Exception as exc:
            return [{"text": f"Error building premarket summary: {exc}"}]

    if lower.startswith("/summary_kor_intra"):
        try:
            from summary_kor_builder import generate_summary_kor_intra

            replies: list[dict] = [
                {
                    "text": (
                        "🇰🇷 Building Korea intraday brief "
                        "(Naver 1분봉 vs 전일 종가 · KOSPI200 + KOSDAQ100)…"
                    )
                }
            ]
            summary = generate_summary_kor_intra(public_url=summary_public_url())
            replies.extend(summary["telegram_messages"])
            return replies
        except Exception as exc:
            return [{"text": f"Error building Korea intraday summary: {exc}"}]

    if lower.startswith("/summary_nxt"):
        try:
            from summary_nxt_builder import generate_summary_nxt

            replies: list[dict] = [
                {"text": "📡 Building NXT (Nextrade) brief…"}
            ]
            summary = generate_summary_nxt(public_url=summary_public_url())
            replies.extend(summary["telegram_messages"])
            return replies
        except Exception as exc:
            return [{"text": f"Error building NXT summary: {exc}"}]

    if lower.startswith("/summary_kor"):
        try:
            from summary_kor_builder import generate_summary_kor

            replies: list[dict] = [
                {"text": "🇰🇷 Building Korea brief (KOSPI200 + KOSDAQ100)…"}
            ]
            summary = generate_summary_kor(public_url=summary_public_url())
            replies.extend(summary["telegram_messages"])
            return replies
        except Exception as exc:
            return [{"text": f"Error building Korea summary: {exc}"}]

    if lower.startswith("/summary"):
        try:
            from summary_builder import SUMMARY_UNIVERSES, caches_ready, generate_and_save_summary
            from stock_crawler import ensure_fresh_rankings_cache

            if not caches_ready():
                missing = ensure_universe_caches(SUMMARY_UNIVERSES)
                if missing:
                    labels = ", ".join(
                        {"etf": "ETF", "sp": "S&P 500", "nas": "NASDAQ 100"}.get(u, u)
                        for u in missing
                    )
                    return [
                        {
                            "text": (
                                f"Summary caches are loading ({labels}). "
                                "First run may take 2–5 minutes — try /summary again shortly."
                            )
                        }
                    ]
            stale = [
                universe
                for universe in SUMMARY_UNIVERSES
                if not ensure_fresh_rankings_cache(universe, blocking=True)
            ]
            if stale:
                labels = ", ".join(
                    {"etf": "ETF", "sp": "S&P 500", "nas": "NASDAQ 100"}.get(u, u)
                    for u in stale
                )
                return [
                    {
                        "text": (
                            f"Waiting for latest session bars ({labels}). "
                            "Yahoo has not published the expected daily data yet — "
                            "try /summary again shortly."
                        )
                    }
                ]
            summary = generate_and_save_summary(
                public_url=summary_public_url(),
                force_macro=True,
            )
            return summary["telegram_messages"]
        except Exception as exc:
            return [{"text": f"Error building summary: {exc}"}]

    if lower in {"/aibriefing", "/ai_briefing", "/ai briefing"} or lower.startswith("/aibriefing "):
        try:
            from ai_briefing import format_ai_briefing_telegram, generate_ai_briefing

            briefing = generate_ai_briefing()
            return format_ai_briefing_telegram(briefing, include_sources=True)
        except Exception as exc:
            return [{"text": f"Error generating AI briefing: {exc}"}]

    if (
        lower in {"/data_briefing", "/databriefing", "/data_brief"}
        or lower.startswith("/data_briefing ")
        or lower.startswith("/databriefing ")
    ):
        try:
            parts = normalized.split()
            market = (parts[1] if len(parts) > 1 else "kor").strip().lower()
            market_aliases = {
                "kor": "kr",
                "korea": "kr",
                "kr": "kr",
                "국내": "kr",
                "us": "us",
                "usa": "us",
                "미국": "us",
                "etf": "etf",
                "esg": "esg",
            }
            market_key = market_aliases.get(market)
            if market_key is None:
                return [
                    {
                        "text": (
                            "Usage: /data_briefing [kor|us|etf|esg]\n"
                            "Currently supported: kor (국내시황)."
                        )
                    }
                ]
            if market_key != "kr":
                return [
                    {
                        "text": (
                            f"/data_briefing {market} is reserved for later wiring.\n"
                            "지금은 국내시황만 지원합니다 → /data_briefing kor"
                        )
                    }
                ]

            from data_briefing import (
                format_data_briefing_telegram,
                generate_data_briefing_from_kor_summary,
            )
            from summary_analyst import collect_leader_charts, generate_chart_notes
            from summary_kor_builder import (
                build_kor_market_summary,
                ensure_kor_caches,
                _attach_dart_for_leaders,
            )

            replies: list[dict] = [
                {
                    "text": (
                        "📝 Building Korea data briefing from boards / chart notes / Naver news…"
                    )
                }
            ]
            missing = ensure_kor_caches(force=False)
            if missing:
                return [
                    {
                        "text": (
                            "Korea caches not ready. Run /summary_kor first, "
                            "then retry /data_briefing kor."
                        )
                    }
                ]
            summary = build_kor_market_summary(intraday=False)
            leader_charts = collect_leader_charts(summary)
            summary["leader_charts"] = leader_charts
            chart_notes = generate_chart_notes(summary, leader_charts)
            summary["dart_by_universe"] = _attach_dart_for_leaders(summary)
            briefing = generate_data_briefing_from_kor_summary(
                summary,
                chart_notes_ko=chart_notes,
            )
            replies.extend(format_data_briefing_telegram(briefing))
            return replies
        except Exception as exc:
            return [{"text": f"Error generating data briefing: {exc}"}]

    if lower in {"/reddit", "/wsb"} or lower.startswith("/reddit "):
        try:
            from reddit_builder import generate_and_save_reddit_brief

            replies: list[dict] = [
                {
                    "text": (
                        "🟠 Crawling r/wallstreetbets + /financial for top tickers…"
                    )
                }
            ]
            brief = generate_and_save_reddit_brief(public_url=summary_public_url())
            replies.extend(brief.get("telegram_messages") or [])
            return replies
        except Exception as exc:
            return [{"text": f"Error building Reddit brief: {exc}"}]

    if lower.startswith("/news_naver"):
        try:
            parts = normalized.split(maxsplit=1)
            query = parts[1].strip() if len(parts) > 1 else ""
            if query:
                messages = format_naver_news_messages(query=query)
                return [{"text": text} for text in messages]

            context = _last_ranking_by_chat.get(chat_id)
            if not context:
                return [
                    {
                        "text": (
                            "No recent ranking found.\n"
                            "Run /kospi or /kosdaq first, then /news_naver.\n"
                            "Or search directly: /news_naver 삼성전자"
                        )
                    }
                ]
            messages = format_naver_news_messages(
                context["tickers"],
                context_label=context["label"],
                universe=context.get("universe"),
            )
            return [{"text": text} for text in messages]
        except Exception as exc:
            return [{"text": f"Error fetching Naver news: {exc}"}]

    if lower.startswith("/news"):
        try:
            context = _last_ranking_by_chat.get(chat_id)
            if not context:
                return [
                    {
                        "text": (
                            "No recent ranking found.\n"
                            "Run /etf, /sp, or /nas first, then use /news."
                        )
                    }
                ]
            messages = format_news_messages(
                context["tickers"],
                context_label=context["label"],
                universe=context.get("universe"),
            )
            return [{"text": text} for text in messages]
        except Exception as exc:
            return [{"text": f"Error fetching news: {exc}"}]

    if lower.startswith("/dart"):
        try:
            from dart_etf_memb import is_dart_etf_memb_command, parse_dart_etf_memb_query
            from dart_pipeline import run_dart_analysis, run_dart_etf_memb

            if is_dart_etf_memb_command(normalized):
                query = parse_dart_etf_memb_query(normalized)
                replies: list[dict] = [{"text": f"ETF 편입종목 조회 중: {query}…"}]
                result = run_dart_etf_memb(query)
                replies.extend(result["telegram_messages"])
                return replies

            from dart_data import parse_dart_query

            query = parse_dart_query(normalized)
            replies = [{"text": f"DART 재무분석 중: {query}…"}]
            result = run_dart_analysis(query)
            replies.extend(result["telegram_messages"])
            return replies
        except ValueError as exc:
            return [
                {
                    "text": (
                        "Usage:\n"
                        "/dart 한국기업명\n"
                        "  Example: /dart 삼성전자 | /dart 005930\n"
                        "/dart etf memb TICKER|NAME\n"
                        "  Example: /dart etf memb 0167A0\n"
                        "  Example: /dart etf memb SOL AI반도체TOP2플러스\n\n"
                        f"{exc}"
                    )
                }
            ]
        except Exception as exc:
            return [{"text": f"DART analysis failed: {exc}"}]

    if lower.startswith("/esg") or lower.startswith("/governance"):
        try:
            from esg_pipeline import is_esg_command, parse_esg_command, run_esg

            if not is_esg_command(normalized):
                return [{"text": "Unknown command. Try /esg help"}]
            mode, query = parse_esg_command(normalized)
            if mode == "help":
                return run_esg("help")["telegram_messages"]
            label = query or ("Climate Risk" if mode == "monitor" else "전체")
            replies = [{"text": f"ESG 조회 중 ({mode}): {label}…"}]
            result = run_esg(mode, query)
            replies.extend(result["telegram_messages"])
            return replies
        except ValueError as exc:
            return [
                {
                    "text": (
                        "Usage:\n"
                        "/esg monitor\n"
                        "/esg 삼성전자\n"
                        "/esg fin|div|own|return 기업\n"
                        "/esg accident [기업]\n"
                        "/esg help\n\n"
                        f"{exc}"
                    )
                }
            ]
        except Exception as exc:
            return [{"text": f"/esg failed: {exc}"}]

    if lower.startswith("/financial"):
        try:
            from financial_data import parse_financial_ticker
            from financial_pipeline import run_financial_analysis

            symbol = parse_financial_ticker(normalized)
            replies: list[dict] = [{"text": f"Analyzing {symbol} fundamentals…"}]
            result = run_financial_analysis(symbol)
            replies.extend(result["telegram_messages"])
            return replies
        except ValueError as exc:
            return [
                {
                    "text": (
                        "Usage: /financial TICKER\n"
                        "Example: /financial AAPL\n"
                        "Example: /financial MSFT\n\n"
                        f"{exc}"
                    )
                }
            ]
        except Exception as exc:
            return [{"text": f"Financial analysis failed: {exc}"}]

    if lower.startswith("/nxt"):
        try:
            from nxt_data import run_nxt

            replies: list[dict] = [
                {"text": "📡 Fetching NXT (Nextrade) data…"}
            ]
            result = run_nxt(normalized)
            replies.extend(result["telegram_messages"])
            return replies
        except ValueError as exc:
            return [
                {
                    "text": (
                        "Usage: /nxt [subcommand|yyyy-mm|TICKER…]\n"
                        "  /nxt help\n"
                        "  /nxt · /nxt live [TICKER…]\n"
                        "  /nxt 2026-06 [TICKER…]\n"
                        "  /nxt dailyvol 2026-06\n"
                        "  /nxt daily 2026-06-30 [N]\n"
                        "  /nxt movers 2026-06-30\n"
                        "  /nxt stock 005930 [2026-06]\n"
                        "  /nxt compare 2026-05 2026-06\n"
                        "  /nxt share 2026-06 · /nxt close 2026-07-13\n\n"
                        f"{exc}"
                    )
                }
            ]
        except Exception as exc:
            return [{"text": f"NXT lookup failed: {exc}"}]

    if lower.startswith("/fin_estimate"):
        try:
            from fin_estimate import run_fin_estimate

            replies: list[dict] = [
                {
                    "text": (
                        "📈 Building estimates + quarterly history Excel "
                        "(FMP / SEC / DART)…"
                    )
                }
            ]
            result = run_fin_estimate(normalized)
            replies.extend(result["telegram_messages"])
            return replies
        except ValueError as exc:
            return [
                {
                    "text": (
                        "Usage: /fin_estimate TICKER [TICKER…]\n"
                        "Example: /fin_estimate NVDA\n"
                        "Example: /fin_estimate NVDA 삼성전자\n"
                        "Example: /fin_estimate NVDA 005930 AAPL\n\n"
                        f"{exc}"
                    )
                }
            ]
        except Exception as exc:
            return [{"text": f"Fin estimate failed: {exc}"}]

    if lower.startswith("/comp"):
        tickers = parse_comp_tickers(normalized)
        if len(tickers) < 2:
            return [
                {
                    "text": (
                        "Usage: /comp ETF1 ETF2 [ETF3 ...]\n"
                        "Example: /comp QQQ IVV QNDX\n"
                        "Example: /comp SPY, VOO, IVV"
                    )
                }
            ]
        try:
            from etf_compare_pipeline import run_etf_comparison

            result = run_etf_comparison(tickers)
            replies: list[dict] = [{"text": "Building ETF comparison…"}]
            replies.extend(result.get("telegram_messages") or [
                {
                    "text": result["text_summary"],
                    "document_path": str(result["excel_path"]),
                    "parse_mode": "HTML",
                }
            ])
            return replies
        except Exception as exc:
            return [{"text": f"ETF comparison failed: {exc}"}]

    if lower.startswith("/adr"):
        parts = normalized.split()
        symbols = [p.upper() for p in parts[1:] if p.strip()]
        if not symbols:
            return [{"text": "Usage: /adr TSM ASML ARM\n\n" + HELP_TEXT_SHORT}]
        try:
            from adr_pipeline import run_adr_analysis

            result = run_adr_analysis(symbols)
            replies: list[dict] = [
                {"text": "Analyzing ADR impact…"},
                {"text": result["text_summary"]},
                {"text": "ADR Impact — Summary chart", "photo": result["panel_chart"]},
                {
                    "text": "ADR Impact — Aligned overlay (t=0 rebased returns)",
                    "photo": result["overlay_chart"],
                },
            ]
            for sym, buf in result["single_charts"].items():
                replies.append({"text": f"{sym} — event chart", "photo": buf})
            replies.append(
                {
                    "text": "ADR Impact — Excel workbook",
                    "document_path": str(result["excel_path"]),
                }
            )
            return replies
        except Exception as exc:
            return [{"text": f"ADR analysis failed: {exc}"}]

    if lower.startswith("/idx"):
        try:
            from idx_rules import is_idx_rule_command, run_idx_rules

            if is_idx_rule_command(normalized):
                replies: list[dict] = [
                    {"text": "📐 Building index / fund weight-cap comparison…"}
                ]
                result = run_idx_rules()
                replies.extend(result.get("telegram_messages") or [])
                return replies

            from idx_pipeline import run_idx_dashboard

            replies = [
                {"text": "🌍 Building MSCI country / major-market dashboard…"}
            ]
            result = run_idx_dashboard()
            replies.extend(result.get("telegram_messages") or [])
            return replies
        except Exception as exc:
            return [{"text": f"/idx failed: {exc}"}]

    if lower.startswith("/event") or _is_pending_event_reply(chat_id, normalized):
        return _handle_event_command(normalized, chat_id)

    if lower.startswith("/heatmap"):
        try:
            from heatmap import is_size_cache_ready, parse_heatmap_command, plot_market_heatmap
            from stock_crawler import ensure_fresh_rankings_cache

            universe, top_n = parse_heatmap_command(normalized)
            if not ensure_fresh_rankings_cache(universe, blocking=True):
                return _ranking_loading_reply(universe)
            replies: list[dict] = []
            if not is_size_cache_ready(universe):
                replies.append(
                    {
                        "text": (
                            "Building market-cap/AUM cache for heatmap "
                            "(first run may take 1–2 minutes)…"
                        )
                    }
                )
            chart_buf, caption, _ = plot_market_heatmap(universe, top_n=top_n)
            replies.append({"text": caption, "photo": chart_buf})
            return replies
        except ValueError as exc:
            return [{"text": f"Invalid heatmap command: {exc}\n\nUsage: /heatmap sp | /heatmap nas 20 | /heatmap etf 30"}]
        except Exception as exc:
            return [{"text": f"Heatmap failed: {exc}"}]

    from etf_us_new import is_etf_us_new_command

    if is_etf_us_new_command(normalized):
        try:
            from etf_us_new import run_etf_us_new

            replies: list[dict] = [
                {"text": "미국 신규 상장 ETF 조회 중 (Nasdaq + Yahoo)…"}
            ]
            result = run_etf_us_new()
            replies.extend(result["telegram_messages"])
            return replies
        except Exception as exc:
            return [{"text": f"/etf_us_new failed: {exc}"}]

    from etf_memb_us import is_etf_memb_command

    if is_etf_memb_command(normalized):
        try:
            from etf_memb_us import parse_etf_memb_query, run_etf_memb_us

            ticker = parse_etf_memb_query(normalized)
            replies: list[dict] = [
                {"text": f"US ETF 편입비중 조회 중: {ticker}…"}
            ]
            result = run_etf_memb_us(ticker)
            replies.extend(result["telegram_messages"])
            return replies
        except ValueError as exc:
            return [
                {
                    "text": (
                        "Usage: /etf memb <TICKER>\n"
                        "Example: /etf memb EEM\n"
                        "Example: /etf_memb QQQ\n"
                        f"{exc}"
                    )
                }
            ]
        except Exception as exc:
            return [{"text": f"/etf memb failed: {exc}"}]

    from etf_holdings import is_etf_holdings_command

    if is_etf_holdings_command(normalized):
        try:
            from etf_holdings import parse_etf_holdings_query, run_etf_holdings

            etf, holding = parse_etf_holdings_query(normalized)
            replies: list[dict] = [
                {"text": f"ETF 편입비 시계열 조회 중: {etf} / {holding}…"}
            ]
            result = run_etf_holdings(etf, holding)
            replies.extend(result["telegram_messages"])
            return replies
        except ValueError as exc:
            return [
                {
                    "text": (
                        "Usage: /etf_holdings <ETF> <holding>\n"
                        "Example: /etf_holdings EEM 005930\n"
                        "Example: /etf holdings EEM 삼성전자\n"
                        f"{exc}"
                    )
                }
            ]
        except Exception as exc:
            return [{"text": f"/etf_holdings failed: {exc}"}]

    from etf_sector import is_etf_sector_command

    if is_etf_sector_command(normalized):
        try:
            from etf_sector import (
                build_etf_sector_board,
                format_etf_sector_telegram,
                plot_etf_sector_board,
            )
            from web_publish import chart_to_image_payload, publish_brief, section_from_html

            board = build_etf_sector_board()
            chart = plot_etf_sector_board(board)
            text = format_etf_sector_telegram(board)
            try:
                image_payload = chart_to_image_payload(
                    chart,
                    id="sector_rotation",
                    caption=f"ETF Sector Rotation · {board.get('session_as_of', '')}",
                )
                publish_brief(
                    "etf",
                    "etf_sector",
                    title="ETF 시황 /etf_sector",
                    generated_at=board.get("generated_at_kst")
                    or board.get("generated_at_et"),
                    sections=section_from_html(text, heading="Sector rotation"),
                    images=[image_payload],
                    meta={"session_as_of": board.get("session_as_of")},
                )
            except Exception as pub_exc:
                print(f"web_publish etf_sector skipped: {pub_exc}")
            chart.seek(0)
            return [
                {
                    "text": text,
                    "parse_mode": "HTML",
                    "photo": chart,
                }
            ]
        except Exception as exc:
            return [{"text": f"/etf_sector failed: {exc}"}]

    from etfcheck import is_etfcheck_command

    if is_etfcheck_command(normalized):
        try:
            from etfcheck import (
                build_etfcheck_brief,
                format_etfcheck_telegram,
                parse_etfcheck_mode,
            )
            from web_publish import publish_brief, section_from_html

            mode = parse_etfcheck_mode(normalized)
            brief = build_etfcheck_brief(mode=mode)
            text = format_etfcheck_telegram(brief)
            try:
                publish_brief(
                    "etf",
                    "etfcheck",
                    title="ETF 시황 /etfcheck",
                    generated_at=brief.get("generated_at_display")
                    or brief.get("generated_at"),
                    sections=section_from_html(text, heading="ETF CHECK"),
                    meta={"mode": mode},
                )
                from etf_memb_publish import publish_etf_memb_from_brief

                publish_etf_memb_from_brief(brief)
            except Exception as pub_exc:
                print(f"web_publish etfcheck skipped: {pub_exc}")
            return [
                {
                    "text": text,
                    "parse_mode": "HTML",
                }
            ]
        except ValueError as exc:
            return [{"text": str(exc)}]
        except Exception as exc:
            return [{"text": f"/etfcheck failed: {exc}"}]

    if lower.startswith("/macro"):
        try:
            from macro_data import macro_cache_ready
            from macro_pipeline import run_macro_dashboard

            parts = normalized.split()
            force = len(parts) > 1 and parts[1].lower() == "refresh"
            replies: list[dict] = []
            if force or not macro_cache_ready():
                replies.append(
                    {"text": "Building macro risk dashboard…" if force else "Loading macro data…"}
                )
            result = run_macro_dashboard(force=force)
            replies.extend(result.get("telegram_messages") or [
                {
                    "text": result["text_summary"],
                    "photo": result["chart"],
                    "parse_mode": "HTML",
                }
            ])
            return replies
        except Exception as exc:
            return [{"text": f"Macro dashboard failed: {exc}"}]

    if normalized.startswith("/port"):
        try:
            from analysis import analyze_stock, simulate_portfolio

            tickers = normalized.split()[1:]
            if not tickers:
                return [{"text": "Please provide stock tickers after /port (e.g. /port AAPL MSFT GOOGL)"}]

            portfolio_return, simulator = simulate_portfolio(tickers)
            responses = []

            plot_buffer = simulator.plot_returns()
            responses.append(
                {
                    "text": (
                        f"Portfolio Overview:\n"
                        f"Tickers: {', '.join(tickers)}\n"
                        f"Expected Annual Return: {portfolio_return:.2f}%"
                    ),
                    "photo": plot_buffer,
                }
            )

            for ticker in tickers:
                try:
                    plot_buffer = analyze_stock(ticker)
                    responses.append(
                        {
                            "text": f"Technical Analysis for {ticker.upper()}",
                            "photo": plot_buffer,
                        }
                    )
                except Exception as exc:
                    responses.append({"text": f"Error analyzing {ticker}: {exc}"})

            return responses
        except Exception as exc:
            return [{"text": f"Error simulating portfolio: {exc}"}]

    if lower.startswith("/coin"):
        try:
            from analysis import analyze_crypto

            parts = normalized.split()
            if len(parts) < 2:
                return [{"text": "Please provide a coin symbol (e.g. /coin BTC)"}]

            symbol = parts[1]
            plot_buffer = analyze_crypto(symbol)
            return [
                {
                    "text": f"Technical Analysis for {symbol.upper()}",
                    "photo": plot_buffer,
                }
            ]
        except Exception as exc:
            return [{"text": f"Error analyzing cryptocurrency: {str(exc)}"}]

    if lower.startswith(("/etf_pre", "/sp_pre", "/nas_pre")):
        try:
            from premarket_rankings import (
                format_premarket_telegram,
                build_premarket_rankings,
                parse_premarket_command,
            )

            universe = parse_premarket_command(normalized)
            label = {"etf": "ETF", "sp": "S&P 500", "nas": "NASDAQ 100"}[universe]
            replies: list[dict] = [
                {
                    "text": (
                        f"Fetching {label} pre-market quotes via Finnhub "
                        f"(~30 quotes/min to avoid rate limits; "
                        f"S&P 500 can take ~15–20 min)…"
                    )
                }
            ]
            result = build_premarket_rankings(universe)
            replies.append({"text": format_premarket_telegram(result), "parse_mode": "HTML"})
            tickers = [row["ticker"] for row in (result["gainers"] + result["losers"])]
            if tickers:
                _last_ranking_by_chat[chat_id] = {
                    "tickers": tickers,
                    "label": f"{result['label']} pre-market",
                    "universe": universe,
                }
            return replies
        except ValueError as exc:
            return [
                {
                    "text": (
                        "Usage: /etf_pre | /sp_pre | /nas_pre\n"
                        "Returns live/pre-market % vs previous close (Finnhub).\n\n"
                        f"{exc}"
                    )
                }
            ]
        except Exception as exc:
            return [{"text": f"Pre-market ranking failed: {exc}"}]

    if lower.startswith(("/kospi_intra", "/kosdaq_intra")):
        try:
            from kr_intra_rankings import parse_kr_intraday_command, run_kr_intraday_rankings
            from stock_crawler import UNIVERSES

            universe, mode = parse_kr_intraday_command(normalized)
            label = UNIVERSES[universe]["label"]
            replies: list[dict] = [
                {
                    "text": (
                        f"🇰🇷 {label} 장중 랭킹 조회 중…\n"
                        "Naver 1분봉 종가 vs 전일 종가"
                    )
                }
            ]
            result = run_kr_intraday_rankings(universe, mode)
            _last_ranking_by_chat[chat_id] = {
                "tickers": result["tickers"],
                "label": result["context_label"],
                "universe": universe,
            }
            responses = [{"text": result["text"]}]
            leader = result.get("leader_ticker")
            if leader:
                from kr_names import format_kr_ticker_label

                responses.append(
                    {
                        "text": f"📈 {label} 장중 1위: {format_kr_ticker_label(leader)}",
                        "chart_ticker": leader,
                    }
                )
            replies.extend(responses)
            return replies
        except ValueError as exc:
            return [
                {
                    "text": (
                        "Usage: /kospi_intra | /kosdaq_intra [surge|dropvol]\n"
                        f"{exc}"
                    )
                }
            ]
        except Exception as exc:
            return [{"text": f"Korea intraday ranking failed: {exc}"}]

    if lower.startswith(("/etf", "/sp", "/nas", "/kospi", "/kosdaq")) and not lower.startswith(
        (
            "/etf_pre",
            "/sp_pre",
            "/nas_pre",
            "/etfcheck",
            "/etf_holdings",
            "/etfholdings",
            "/etf_holding",
            "/etf_sector",
            "/kospi_intra",
            "/kosdaq_intra",
        )
    ):
        # Avoid matching /etf_pre etc.; require command token exactly
        # (`/etf holdings` is handled earlier by is_etf_holdings_command)
        first = lower.split()[0]
        if first not in {"/etf", "/sp", "/nas", "/kospi", "/kosdaq"}:
            return [{"text": HELP_TEXT_SHORT}]
        try:
            universe, mode = parse_rank_command(normalized)
            from stock_crawler import ensure_fresh_rankings_cache, get_cache_session_label

            if not ensure_fresh_rankings_cache(universe, blocking=True):
                return _ranking_loading_reply(universe)
            tickers, context_label = get_ranking_tickers(
                universe=universe,
                mode=mode,
            )
            _last_ranking_by_chat[chat_id] = {
                "tickers": tickers,
                "label": context_label,
                "universe": universe,
            }
            text = format_rankings_message(universe=universe, mode=mode)
            text = f"{text}\n\n({get_cache_session_label(universe)})"
            responses = [{"text": text}]
            leader = get_top_leader_ticker(universe, mode)
            if leader:
                label = {
                    "etf": "ETF",
                    "sp": "S&P 500",
                    "nas": "NASDAQ 100",
                    "kospi": "KOSPI 200",
                    "kosdaq": "KOSDAQ 100",
                }[universe]
                leader_label = leader.upper()
                if universe == "etf":
                    from etf_names import format_etf_ticker_label

                    leader_label = format_etf_ticker_label(leader)
                elif universe in {"kospi", "kosdaq"}:
                    from kr_names import format_kr_ticker_label

                    leader_label = format_kr_ticker_label(leader)
                responses.append(
                    {
                        "text": f"📈 {label} top leader: {leader_label}",
                        "chart_ticker": leader,
                    }
                )
            return responses
        except ValueError as exc:
            return [{"text": f"Invalid command: {exc}\n\n{HELP_TEXT_SHORT}"}]
        except Exception as exc:
            return [{"text": f"Error ranking stocks: {exc}"}]

    return [{"text": HELP_TEXT_SHORT}]


def _handle_telegram_send_response(
    response: requests.Response,
    chat_id: int,
    *,
    method: str,
    fallback_text: str = "",
    token: str = "",
    parse_mode: str | None = None,
) -> bool:
    if response.ok:
        return True

    description = _telegram_error_description(response)
    print(f"{method} failed for chat {chat_id}: {response.text}")
    if _is_unreachable_chat_error(response):
        block_chat(chat_id, description)
        return False
    if fallback_text and token:
        return send_text(token, chat_id, fallback_text, parse_mode=parse_mode)
    return False


def send_reply(token, chat_id, reply) -> bool:
    photo = reply.get("photo")
    photo_path = reply.get("photo_path")
    chart_ticker = reply.get("chart_ticker")
    document_path = reply.get("document_path")

    if photo is None and chart_ticker:
        try:
            from analysis import analyze_stock

            photo = analyze_stock(chart_ticker)
        except Exception as exc:
            return send_text(
                token,
                chat_id,
                f"{reply.get('text', chart_ticker)}\nChart error: {exc}",
                parse_mode=reply.get("parse_mode"),
            )

    text = reply.get("text", "")
    parse_mode = reply.get("parse_mode")

    if photo is None and photo_path is not None:
        path = Path(photo_path)
        payload: dict = {"chat_id": chat_id}
        if text:
            payload["caption"] = text[:1024]
        if parse_mode and text:
            payload["parse_mode"] = parse_mode
        with path.open("rb") as handle:
            response = requests.post(
                f"https://api.telegram.org/bot{token}/sendPhoto",
                data=payload,
                files={"photo": ("photo.jpg", handle, "image/jpeg")},
                timeout=60,
            )
        return _handle_telegram_send_response(
            response,
            chat_id,
            method="sendPhoto",
            fallback_text=text,
            token=token,
            parse_mode=parse_mode,
        )

    if photo is not None:
        from chart_buffers import photo_to_upload_bytes
        from io import BytesIO

        try:
            png_bytes = photo_to_upload_bytes(photo)
        except Exception as exc:
            return send_text(
                token,
                chat_id,
                f"{text}\nChart upload error: {exc}".strip(),
                parse_mode=parse_mode,
            )
        payload: dict = {"chat_id": chat_id}
        if text:
            payload["caption"] = text[:1024]
        if parse_mode and text:
            payload["parse_mode"] = parse_mode
        response = requests.post(
            f"https://api.telegram.org/bot{token}/sendPhoto",
            data=payload,
            files={"photo": ("chart.png", BytesIO(png_bytes), "image/png")},
            timeout=60,
        )
        return _handle_telegram_send_response(
            response,
            chat_id,
            method="sendPhoto",
            fallback_text=text,
            token=token,
            parse_mode=parse_mode,
        )

    if document_path is not None:
        try:
            path = Path(document_path)
            data: dict = {"chat_id": chat_id}
            if text:
                data["caption"] = text[:1024]
            button_url = reply.get("button_url")
            button_text = reply.get("button_text", "Open in browser")
            if button_url:
                data["reply_markup"] = json.dumps(
                    {"inline_keyboard": [[{"text": button_text, "url": button_url}]]}
                )
            mime = _web_content_type(path)
            with path.open("rb") as handle:
                response = requests.post(
                    f"https://api.telegram.org/bot{token}/sendDocument",
                    data=data,
                    files={"document": (path.name, handle, mime)},
                    timeout=180,
                )
            return _handle_telegram_send_response(
                response,
                chat_id,
                method="sendDocument",
                fallback_text=text,
                token=token,
            )
        except Exception as exc:
            return send_text(token, chat_id, f"{text}\nDocument error: {exc}".strip())

    button_url = reply.get("button_url")
    button_text = reply.get("button_text", "Open in browser")
    return send_text(
        token,
        chat_id,
        text,
        parse_mode=parse_mode,
        button_url=button_url,
        button_text=button_text,
    )


def _web_content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    return {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".ico": "image/x-icon",
        ".pdf": "application/pdf",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }.get(suffix, "application/octet-stream")


def _read_web_file(relative_path: str) -> tuple[bytes, str] | None:
    target = (WEB_DIR / relative_path).resolve()
    if not str(target).startswith(str(WEB_DIR.resolve())):
        return None
    if not target.is_file():
        return None
    return target.read_bytes(), _web_content_type(target)


def start_web_server():
    port = int(os.environ.get("PORT", "8080"))

    class AppHandler(BaseHTTPRequestHandler):
        def _send(self, body: bytes, content_type: str, status: int = 200) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _admin_secret_ok(self) -> bool:
            secret = (
                os.environ.get("BOT_ADMIN_SECRET", "").strip()
                or os.environ.get("HEALTH_CHECK_SECRET", "").strip()
            )
            if not secret:
                return False
            auth = self.headers.get("Authorization", "")
            bearer = (
                auth[7:].strip() if auth.lower().startswith("bearer ") else ""
            )
            qs = parse_qs(urlparse(self.path).query)
            token_q = (qs.get("token") or [""])[0]
            return bearer == secret or token_q == secret

        def _bot_web_api_ok(self) -> bool:
            secret = os.environ.get("BOT_WEB_API_SECRET", "").strip()
            if not secret:
                return True
            auth = self.headers.get("Authorization", "")
            bearer = (
                auth[7:].strip() if auth.lower().startswith("bearer ") else ""
            )
            qs = parse_qs(urlparse(self.path).query)
            token_q = (qs.get("token") or [""])[0]
            header_key = (self.headers.get("X-Bot-Web-Key") or "").strip()
            return bearer == secret or token_q == secret or header_key == secret

        def _reject_unauthorized(self, cors: bool = False) -> None:
            body = b'{"ok":false,"error":"Unauthorized"}'
            if cors:
                self._send_cors_json(body, status=401)
            else:
                self._send(body, "application/json; charset=utf-8", 401)

        def do_HEAD(self):
            # Render / proxies sometimes probe with HEAD; BaseHTTP 501 kills health.
            path = urlparse(self.path).path
            if path in {"/", "/index.html", "/health"}:
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_error(404)

        def do_GET(self):
            path = urlparse(self.path).path

            if path == "/api/web-briefs":
                try:
                    from web_briefs_store import load_all_briefs

                    briefs = load_all_briefs()
                    body = json.dumps(
                        {
                            "ok": True,
                            "source": "render-local",
                            "briefs": briefs,
                        },
                        ensure_ascii=False,
                    ).encode("utf-8")
                    self._send(body, "application/json; charset=utf-8")
                except Exception as exc:
                    err = json.dumps(
                        {"ok": False, "error": str(exc)[:400]},
                        ensure_ascii=False,
                    ).encode("utf-8")
                    self.send_response(500)
                    self.send_header(
                        "Content-Type", "application/json; charset=utf-8"
                    )
                    self.send_header("Content-Length", str(len(err)))
                    self.end_headers()
                    self.wfile.write(err)
                return

            if path.startswith("/api/web-briefs/images/"):
                parts = [p for p in path.split("/") if p]
                # api web-briefs images {tab} {slot} {file}
                if len(parts) == 6 and parts[5].endswith(".png"):
                    tab, slot, fname = parts[3], parts[4], parts[5]
                    image_id = fname[:-4]
                    try:
                        from web_briefs_store import load_image_bytes

                        raw = load_image_bytes(tab, slot, image_id)
                    except Exception:
                        raw = None
                    if raw:
                        self.send_response(200)
                        self.send_header("Content-Type", "image/png")
                        self.send_header("Cache-Control", "public, max-age=60")
                        self.send_header("Content-Length", str(len(raw)))
                        self.end_headers()
                        self.wfile.write(raw)
                        return
                self.send_error(404)
                return

            if path == "/health":
                import importlib.util
                import threading as _threading

                from heavy_work import heavy_work_status
                from scheduler_grace import past_startup_grace, startup_grace_status
                from summary_scheduler import _load_state

                health_secret = os.environ.get("HEALTH_CHECK_SECRET", "").strip()
                if health_secret:
                    auth = self.headers.get("Authorization", "")
                    qs = parse_qs(urlparse(self.path).query)
                    token_q = (qs.get("token") or [""])[0]
                    bearer = (
                        auth[7:].strip()
                        if auth.lower().startswith("bearer ")
                        else ""
                    )
                    if token_q != health_secret and bearer != health_secret:
                        self.send_response(401)
                        self.send_header("Content-Type", "application/json")
                        self.end_headers()
                        self.wfile.write(b'{"ok":false,"error":"Unauthorized"}')
                        return

                kor_spec = importlib.util.find_spec("summary_kor_builder")
                state = _load_state()
                env_ids = env_chat_ids()
                env_chat = bool(env_ids)
                chat_count = len(startup_chat_ids())
                thread_names = {t.name for t in _threading.enumerate()}
                from bot_access import access_mode, env_allowed_chat_ids, env_allowed_user_ids

                payload = {
                    "ok": True,
                    "summary_kor_builder": kor_spec is not None,
                    "access_mode": access_mode(),
                    "allowlist_configured": bool(
                        env_allowed_chat_ids() or env_allowed_user_ids()
                    ),
                    "scheduler": {
                        "past_startup_grace": past_startup_grace(),
                        "startup_grace": startup_grace_status(),
                        "heavy_work": heavy_work_status(),
                        "telegram_chat_id_env": env_chat,
                        "broadcast_chat_count": chat_count,
                        "broadcast_env_count": len(env_ids),
                        "broadcast_env_us_count": len(env_chat_ids_us()),
                        "broadcast_env_kor_count": len(env_chat_ids_kor()),
                        "broadcast_env_esg_count": len(env_chat_ids_esg()),
                        "broadcast_known_count": len(load_known_chats()),
                        "broadcast_blocked_count": len(load_blocked_chats()),
                        # Counts only — never expose raw chat IDs publicly
                        "broadcast_targets_us_count": len(
                            broadcast_targets(audience="us")
                        ),
                        "broadcast_targets_kor_count": len(
                            broadcast_targets(audience="kor")
                        ),
                        "broadcast_targets_legacy_count": len(
                            broadcast_targets(audience="legacy")
                        ),
                        "broadcast_targets_esg_count": len(
                            broadcast_targets(audience="esg")
                        ),
                        "broadcast_chat_kinds": {
                            "private_or_group": sum(
                                1 for c in startup_chat_ids() if c > 0
                            ),
                            "channel_or_supergroup": sum(
                                1 for c in startup_chat_ids() if c < 0
                            ),
                        },
                        "threads_alive": {
                            "summary-scheduler": "summary-scheduler" in thread_names,
                            "reddit-scheduler": "reddit-scheduler" in thread_names,
                            "summary-kor-intra-scheduler": (
                                "summary-kor-intra-scheduler" in thread_names
                            ),
                            "summary-kor-scheduler": (
                                "summary-kor-scheduler" in thread_names
                            ),
                            "summary-nxt-scheduler": (
                                "summary-nxt-scheduler" in thread_names
                            ),
                            "etfcheck-scheduler": "etfcheck-scheduler" in thread_names,
                            "etf-sector-scheduler": (
                                "etf-sector-scheduler" in thread_names
                            ),
                            "esg-scheduler": "esg-scheduler" in thread_names,
                        },
                        "last_fixed_slot": state.get("last_fixed_slot"),
                        "last_summary_pre_slot": state.get("last_summary_pre_slot"),
                        "last_reddit_slot": state.get("last_reddit_slot"),
                        "last_summary_kor_intra_slot": state.get(
                            "last_summary_kor_intra_slot"
                        ),
                        "last_summary_kor_slot": state.get("last_summary_kor_slot"),
                        "last_summary_nxt_slot": state.get("last_summary_nxt_slot"),
                        "last_etfcheck_slot": state.get("last_etfcheck_slot"),
                        "last_etf_sector_slot": state.get("last_etf_sector_slot"),
                        "last_esg_monitor_slot": state.get("last_esg_monitor_slot"),
                        "last_esg_accident_slot": state.get("last_esg_accident_slot"),
                        "last_esg_overview_slot": state.get("last_esg_overview_slot"),
                        "last_summary_error": state.get("last_summary_error"),
                        "last_summary_nxt_error": state.get("last_summary_nxt_error"),
                        "last_summary_kor_intra_error": state.get(
                            "last_summary_kor_intra_error"
                        ),
                        "last_etfcheck_error": state.get("last_etfcheck_error"),
                        "last_etf_sector_error": state.get("last_etf_sector_error"),
                        "last_esg_monitor_error": state.get("last_esg_monitor_error"),
                        "last_esg_accident_error": state.get("last_esg_accident_error"),
                        "last_esg_overview_error": state.get("last_esg_overview_error"),
                        "last_summary_attempt_at": state.get("last_summary_attempt_at"),
                        "summary_scheduler_heartbeat": state.get(
                            "summary_scheduler_heartbeat"
                        ),
                        "reddit_scheduler_heartbeat": state.get(
                            "reddit_scheduler_heartbeat"
                        ),
                        "summary_nxt_scheduler_heartbeat": state.get(
                            "summary_nxt_scheduler_heartbeat"
                        ),
                        "etfcheck_scheduler_heartbeat": state.get(
                            "etfcheck_scheduler_heartbeat"
                        ),
                        "etf_sector_scheduler_heartbeat": state.get(
                            "etf_sector_scheduler_heartbeat"
                        ),
                        "esg_scheduler_heartbeat": state.get(
                            "esg_scheduler_heartbeat"
                        ),
                    },
                    "schedule": {
                        "summary_kst": os.environ.get(
                            "SUMMARY_SCHEDULE_HOURS_KST", "7:00"
                        ),
                        "summary_pre_kst": os.environ.get(
                            "SUMMARY_PRE_SCHEDULE_KST", "21:50"
                        ),
                        "reddit_kst": os.environ.get(
                            "REDDIT_SCHEDULE_HOURS_KST", "21"
                        ),
                        "summary_kor_intra_kst": os.environ.get(
                            "SUMMARY_KOR_INTRA_SCHEDULE_HOURS_KST", "11"
                        ),
                        "summary_kor_kst": os.environ.get(
                            "SUMMARY_KOR_SCHEDULE_KST", "15:40"
                        ),
                        "summary_nxt_kst": os.environ.get(
                            "SUMMARY_NXT_SCHEDULE_KST", "8:30,16:40"
                        ),
                        "etf_sector_kst": os.environ.get(
                            "ETF_SECTOR_SCHEDULE_KST", "7:00"
                        ),
                        "etfcheck_kst": os.environ.get(
                            "ETFCHECK_SCHEDULE_KST", "15:40"
                        ),
                        "esg_monitor_kst": os.environ.get(
                            "ESG_MONITOR_SCHEDULE_KST", "9:00"
                        ),
                        "esg_accident_kst": os.environ.get(
                            "ESG_ACCIDENT_SCHEDULE_KST", "9:30"
                        ),
                        "esg_overview_kst": os.environ.get(
                            "ESG_OVERVIEW_SCHEDULE_KST", "9:45"
                        ),
                        "note": (
                            "US→TELEGRAM_CHAT_ID_US; Korea→TELEGRAM_CHAT_ID_KOR; "
                            "ETF→TELEGRAM_CHAT_ID; ESG→TELEGRAM_CHAT_ID_ESG."
                        ),
                    },
                }
                try:
                    from urllib.parse import urlparse as _urlparse

                    from web_publish import publish_configured

                    pub_url = (os.environ.get("WEB_PUBLISH_URL") or "").strip()
                    last_pub = None
                    try:
                        from web_briefs_store import last_publish_status

                        last_pub = last_publish_status()
                    except Exception:
                        last_pub = None
                    payload["web_publish"] = {
                        "configured": publish_configured(),
                        "url_set": bool(pub_url),
                        "secret_set": bool(
                            (os.environ.get("WEB_INGEST_SECRET") or "").strip()
                        ),
                        "url_host": (
                            _urlparse(pub_url).netloc if pub_url else None
                        ),
                        "url_path": (
                            _urlparse(pub_url).path if pub_url else None
                        ),
                        "local_fallback": True,
                        "last": last_pub,
                    }
                except Exception as pub_diag_exc:
                    payload["web_publish"] = {
                        "configured": False,
                        "error": str(pub_diag_exc),
                    }
                try:
                    from market_data_freshness import (
                        expected_latest_daily_date,
                        is_yf_daily_data_ready,
                        latest_yf_daily_bar,
                    )
                    from stock_crawler import get_cache_session_label, rankings_cache_is_fresh_for_session

                    yf_ready, yf_detail = is_yf_daily_data_ready()
                    bar_date, bar_vol = latest_yf_daily_bar()
                    payload["market_data"] = {
                        "expected_session": (
                            expected_latest_daily_date().isoformat()
                            if expected_latest_daily_date()
                            else None
                        ),
                        "yahoo_ready": yf_ready,
                        "yahoo_detail": yf_detail,
                        "yahoo_bar_date": bar_date.isoformat() if bar_date else None,
                        "yahoo_bar_volume": bar_vol,
                        "caches": {
                            u: {
                                "label": get_cache_session_label(u),
                                "fresh": rankings_cache_is_fresh_for_session(u),
                            }
                            for u in ("etf", "sp", "nas")
                        },
                    }
                except Exception as exc:
                    payload["market_data"] = {"error": str(exc)[:240]}
                self._send(
                    json.dumps(payload).encode("utf-8"),
                    "application/json; charset=utf-8",
                )
                return

            if path in {"/", "/index.html"}:
                payload = _read_web_file("index.html")
                if payload:
                    self._send(*payload)
                    return

            if path.startswith("/css/"):
                payload = _read_web_file(path.lstrip("/"))
                if payload:
                    self._send(*payload)
                    return

            if path == "/summary":
                from summary_builder import load_summary_html

                body_text = load_summary_html()
                if not body_text:
                    body_text = (
                        "<html><body><p>Summary not generated yet. "
                        "Use /summary in Telegram or wait for the scheduled brief.</p></body></html>"
                    )
                self._send(body_text.encode("utf-8"), "text/html; charset=utf-8")
                return

            if path == "/summary_kor":
                from summary_kor_builder import load_summary_kor_html

                body_text = load_summary_kor_html()
                if not body_text:
                    body_text = (
                        "<html><body><p>Korea summary not generated yet. "
                        "Use /summary_kor in Telegram first.</p></body></html>"
                    )
                self._send(body_text.encode("utf-8"), "text/html; charset=utf-8")
                return

            if path == "/summary_nxt":
                from summary_nxt_builder import load_summary_nxt_html

                body_text = load_summary_nxt_html()
                if not body_text:
                    body_text = (
                        "<html><body><p>NXT summary not generated yet. "
                        "Use /summary_nxt in Telegram first.</p></body></html>"
                    )
                self._send(body_text.encode("utf-8"), "text/html; charset=utf-8")
                return

            if path == "/summary_kor_intra":
                from summary_kor_builder import load_summary_kor_intra_html

                body_text = load_summary_kor_intra_html()
                if not body_text:
                    body_text = (
                        "<html><body><p>Korea intraday summary not generated yet. "
                        "Use /summary_kor_intra in Telegram first.</p></body></html>"
                    )
                self._send(body_text.encode("utf-8"), "text/html; charset=utf-8")
                return

            if path == "/reddit":
                from reddit_builder import load_reddit_html

                body_text = load_reddit_html()
                if not body_text:
                    body_text = (
                        "<html><body><p>Reddit / WSB brief not generated yet. "
                        "Use /reddit in Telegram first.</p></body></html>"
                    )
                self._send(body_text.encode("utf-8"), "text/html; charset=utf-8")
                return

            if path == "/summary.pdf":
                from summary_pdf import SUMMARY_PDF_PATH

                if SUMMARY_PDF_PATH.is_file():
                    data = SUMMARY_PDF_PATH.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header(
                        "Content-Disposition",
                        'attachment; filename="savvyetf-summary.pdf"',
                    )
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self._send(
                    b"PDF not generated yet. Run /summary in Telegram first.",
                    "text/plain; charset=utf-8",
                    status=404,
                )
                return

            if path == "/summary_pre.pdf":
                from summary_pdf import SUMMARY_PRE_PDF_PATH

                if SUMMARY_PRE_PDF_PATH.is_file():
                    data = SUMMARY_PRE_PDF_PATH.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header(
                        "Content-Disposition",
                        'attachment; filename="savvyetf-summary-pre.pdf"',
                    )
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self._send(
                    b"Premarket PDF not generated yet. Run /summary_pre in Telegram first.",
                    "text/plain; charset=utf-8",
                    status=404,
                )
                return

            if path == "/summary_kor.pdf":
                from summary_pdf import SUMMARY_KOR_PDF_PATH

                if SUMMARY_KOR_PDF_PATH.is_file():
                    data = SUMMARY_KOR_PDF_PATH.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header(
                        "Content-Disposition",
                        'attachment; filename="savvyetf-summary-kor.pdf"',
                    )
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self._send(
                    b"Korea PDF not generated yet. Run /summary_kor in Telegram first.",
                    "text/plain; charset=utf-8",
                    status=404,
                )
                return

            if path == "/summary_kor_intra.pdf":
                from summary_pdf import SUMMARY_KOR_INTRA_PDF_PATH

                if SUMMARY_KOR_INTRA_PDF_PATH.is_file():
                    data = SUMMARY_KOR_INTRA_PDF_PATH.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header(
                        "Content-Disposition",
                        'attachment; filename="savvyetf-summary-kor-intra.pdf"',
                    )
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self._send(
                    b"Korea intraday PDF not generated yet. "
                    b"Run /summary_kor_intra in Telegram first.",
                    "text/plain; charset=utf-8",
                    status=404,
                )
                return

            if path == "/reddit.pdf":
                from summary_pdf import REDDIT_PDF_PATH

                if REDDIT_PDF_PATH.is_file():
                    data = REDDIT_PDF_PATH.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header(
                        "Content-Disposition",
                        'attachment; filename="savvyetf-reddit.pdf"',
                    )
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self._send(
                    b"Reddit PDF not generated yet. Run /reddit in Telegram first.",
                    "text/plain; charset=utf-8",
                    status=404,
                )
                return

            if path == "/event":
                from event_report import load_event_html

                body_text = load_event_html()
                if not body_text:
                    body_text = (
                        "<html><body><p>Event study not generated yet. "
                        "Use /event in Telegram first.</p></body></html>"
                    )
                self._send(body_text.encode("utf-8"), "text/html; charset=utf-8")
                return

            if path == "/event.pdf":
                from event_pdf import EVENT_PDF_PATH

                if EVENT_PDF_PATH.is_file():
                    data = EVENT_PDF_PATH.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header(
                        "Content-Disposition",
                        'attachment; filename="savvyetf-event.pdf"',
                    )
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self._send(
                    b"Event PDF not generated yet. Run /event in Telegram first.",
                    "text/plain; charset=utf-8",
                    status=404,
                )
                return

            if path in {"/kakao", "/kakao/"}:
                from kakao_notify import kakao_notify_enabled, status_payload

                if not kakao_notify_enabled() or not self._admin_secret_ok():
                    self._reject_unauthorized()
                    return

                st = status_payload()
                auth = html.escape(st.get("authorize_url") or "")
                body = f"""<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><title>SavvyETF Kakao</title>
<style>body{{font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;line-height:1.5}}
code{{background:#f2f2f2;padding:0.1rem 0.3rem}}a.button{{display:inline-block;margin-top:1rem;padding:0.7rem 1rem;
background:#fee500;color:#191919;text-decoration:none;border-radius:8px;font-weight:700}}</style></head>
<body>
<h1>Kakao notify setup</h1>
<p>스케줄된 <code>/summary</code> 결과를 카카오톡 <b>나에게 보내기</b>로 받습니다.</p>
<ul>
<li>enabled: <code>{st['enabled']}</code></li>
<li>REST API key: <code>{st['has_rest_api_key']}</code></li>
<li>access token: <code>{st['has_access_token']}</code></li>
<li>refresh token: <code>{st['has_refresh_token']}</code></li>
<li>redirect: <code>{html.escape(st['redirect_uri'])}</code></li>
</ul>
<p>1) Developers에서 카카오 로그인 + talk_message 동의 항목을 켜세요.<br>
2) Redirect URI를 위 주소로 등록하세요.<br>
3) 아래 버튼으로 한 번 로그인/동의하세요.</p>
{"<a class='button' href='" + auth + "'>카카오 계정 연결</a>" if auth else "<p><b>KAKAO_REST_API_KEY</b> env가 필요합니다.</p>"}
<p class="meta">Open Builder 스킬 URL: <code>/kakao/skill</code> (POST)</p>
</body></html>"""
                self._send(body.encode("utf-8"), "text/html; charset=utf-8")
                return

            if path == "/kakao/auth":
                from kakao_notify import build_authorize_url, _rest_api_key, kakao_notify_enabled

                if not kakao_notify_enabled() or not self._admin_secret_ok():
                    self._reject_unauthorized()
                    return
                if not _rest_api_key():
                    self._send(b"KAKAO_REST_API_KEY not set", "text/plain; charset=utf-8", 400)
                    return
                self.send_response(302)
                self.send_header("Location", build_authorize_url())
                self.end_headers()
                return

            if path == "/kakao/callback":
                from kakao_notify import (
                    exchange_code_for_tokens,
                    kakao_notify_enabled,
                    validate_oauth_state,
                )

                if not kakao_notify_enabled():
                    self._reject_unauthorized()
                    return
                query = parse_qs(urlparse(self.path).query)
                code = (query.get("code") or [""])[0]
                err = (query.get("error") or [""])[0]
                state = (query.get("state") or [""])[0]
                if err:
                    self._send(
                        f"Kakao auth error: {err}".encode("utf-8"),
                        "text/plain; charset=utf-8",
                        400,
                    )
                    return
                if not validate_oauth_state(state):
                    self._send(b"Invalid OAuth state", "text/plain; charset=utf-8", 400)
                    return
                if not code:
                    self._send(b"Missing code", "text/plain; charset=utf-8", 400)
                    return
                try:
                    exchange_code_for_tokens(code)
                except Exception as exc:
                    print(f"Kakao token exchange failed: {exc}")
                    self._send(
                        b"Token exchange failed",
                        "text/plain; charset=utf-8",
                        500,
                    )
                    return
                self._send(
                    b"Kakao connected. Scheduled summaries will also go to KakaoTalk (memo to me).",
                    "text/plain; charset=utf-8",
                )
                return

            if path == "/kakao/status":
                from kakao_notify import kakao_notify_enabled, status_payload

                if not kakao_notify_enabled() or not self._admin_secret_ok():
                    self._reject_unauthorized()
                    return
                body = json.dumps(status_payload(), ensure_ascii=False, indent=2).encode("utf-8")
                self._send(body, "application/json; charset=utf-8")
                return

            if path == "/kakao/test":
                from kakao_notify import kakao_notify_enabled, send_scheduled_summary_to_kakao

                if not kakao_notify_enabled() or not self._admin_secret_ok():
                    self._reject_unauthorized()
                    return
                # Minimal payload for a live smoke test
                summary = {
                    "generated_at_display": "Kakao test ping",
                    "ticker_count": 0,
                    "universes": [],
                    "ai_analysis": {
                        "market_brief_ko": "SavvyETF Kakao notify test. Open the web brief link."
                    },
                }
                ok = send_scheduled_summary_to_kakao(summary, public_url=summary_public_url())
                if ok:
                    self._send(b"Kakao test memo sent (check Chat with myself).", "text/plain; charset=utf-8")
                else:
                    self._send("Kakao test failed — see server logs.".encode("utf-8"), "text/plain; charset=utf-8", 500)
                return

            # --- Vercel dashboard APIs ---
            if path.startswith("/api/web/"):
                if not self._bot_web_api_ok():
                    self._reject_unauthorized(cors=True)
                    return

            if path == "/api/web/catalog":
                from web_api import etf_catalog_payload

                body = json.dumps(etf_catalog_payload(), ensure_ascii=False).encode("utf-8")
                self._send_cors_json(body)
                return

            if path == "/api/web/heatmap":
                from web_api import heatmap_payload

                query = parse_qs(urlparse(self.path).query)
                universe = (query.get("universe") or ["etf"])[0]
                top_raw = (query.get("top_n") or [""])[0]
                include_image = (query.get("image") or ["1"])[0] not in {"0", "false", "no"}
                try:
                    top_n = int(top_raw) if top_raw else None
                except ValueError:
                    top_n = None
                payload = heatmap_payload(universe, top_n, include_image=include_image)
                status = 200 if payload.get("ok") else 503
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self._send_cors_json(body, status=status)
                return

            if path == "/api/web/heatmap.png":
                from web_api import heatmap_png

                query = parse_qs(urlparse(self.path).query)
                universe = (query.get("universe") or ["etf"])[0]
                top_raw = (query.get("top_n") or [""])[0]
                try:
                    top_n = int(top_raw) if top_raw else None
                except ValueError:
                    top_n = None
                result = heatmap_png(universe, top_n)
                if isinstance(result, dict):
                    body = json.dumps(result, ensure_ascii=False).encode("utf-8")
                    self._send_cors_json(body, status=503)
                    return
                png_bytes, _caption = result
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(png_bytes)))
                self.send_header("Cache-Control", "public, max-age=120")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(png_bytes)
                return

            if path == "/api/web/why-etf":
                from web_api import why_etf_insights

                payload = why_etf_insights()
                status = 200 if payload.get("ok") else 500
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self._send_cors_json(body, status=status)
                return

            self._send(b"not found", "text/plain; charset=utf-8", status=404)

        def _send_cors_json(self, body: bytes, status: int = 200) -> None:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            path = urlparse(self.path).path
            if path.startswith("/api/web/"):
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_error(404)

        def do_POST(self):
            path = urlparse(self.path).path

            if path == "/api/web-briefs":
                # Seed/upsert local brief store (same secret as Vercel ingest).
                ingest_secret = (os.environ.get("WEB_INGEST_SECRET") or "").strip()
                seed_secret = (os.environ.get("BRIEF_SEED_SECRET") or "").strip()
                allowed = {s for s in (ingest_secret, seed_secret) if s}
                if not allowed:
                    self._send(
                        b'{"ok":false,"error":"WEB_INGEST_SECRET unset"}',
                        "application/json; charset=utf-8",
                        503,
                    )
                    return
                auth = self.headers.get("Authorization", "")
                bearer = (
                    auth[7:].strip() if auth.lower().startswith("bearer ") else ""
                )
                if bearer not in allowed:
                    self._reject_unauthorized()
                    return
                length = int(self.headers.get("Content-Length") or 0)
                if length > 12_000_000:
                    self._send(
                        b'{"ok":false,"error":"Payload too large"}',
                        "application/json; charset=utf-8",
                        413,
                    )
                    return
                raw = self.rfile.read(length) if length else b"{}"
                try:
                    req = json.loads(raw.decode("utf-8") or "{}")
                except (UnicodeDecodeError, json.JSONDecodeError):
                    self._send(
                        b'{"ok":false,"error":"Invalid JSON"}',
                        "application/json; charset=utf-8",
                        400,
                    )
                    return
                try:
                    from web_briefs_store import upsert_brief

                    # Bulk: { "briefs": { "kr": {slots...}, ... } }
                    if isinstance(req.get("briefs"), dict):
                        from web_briefs_store import replace_tab

                        written = []
                        replace = bool(req.get("replace"))
                        for tab, tab_body in req["briefs"].items():
                            slots = (tab_body or {}).get("slots") or {}
                            if not isinstance(slots, dict):
                                continue
                            if replace:
                                replace_tab(tab, slots)
                                written.extend(f"{tab}/{k}" for k in slots)
                                continue
                            for slot_key, slot in slots.items():
                                if not isinstance(slot, dict):
                                    continue
                                upsert_brief(
                                    tab,
                                    slot.get("slot") or slot_key,
                                    title=slot.get("title") or slot_key,
                                    generated_at=slot.get("generated_at")
                                    or slot.get("received_at")
                                    or "",
                                    html=slot.get("html"),
                                    sections=slot.get("sections"),
                                    images=slot.get("images"),
                                    meta=slot.get("meta") or {},
                                )
                                written.append(f"{tab}/{slot_key}")
                        body = json.dumps(
                            {"ok": True, "written": written},
                            ensure_ascii=False,
                        ).encode("utf-8")
                        self._send(body, "application/json; charset=utf-8")
                        return

                    # Single slot (same shape as Vercel /api/ingest)
                    tab = upsert_brief(
                        req.get("tab") or "",
                        req.get("slot") or "",
                        title=req.get("title") or "",
                        generated_at=req.get("generated_at") or "",
                        html=req.get("html"),
                        sections=req.get("sections"),
                        images=req.get("images"),
                        meta=req.get("meta") or {},
                    )
                    body = json.dumps(
                        {"ok": True, "tab": tab},
                        ensure_ascii=False,
                    ).encode("utf-8")
                    self._send(body, "application/json; charset=utf-8")
                except Exception as exc:
                    err = json.dumps(
                        {"ok": False, "error": str(exc)[:400]},
                        ensure_ascii=False,
                    ).encode("utf-8")
                    self._send(err, "application/json; charset=utf-8", 400)
                return

            if path == "/api/web/simulate":
                if not self._bot_web_api_ok():
                    self._reject_unauthorized(cors=True)
                    return
                from web_api import simulate_allocation

                length = int(self.headers.get("Content-Length") or 0)
                if length > 64_000:
                    self._send_cors_json(
                        json.dumps(
                            {"ok": False, "error": "Request body too large"}
                        ).encode("utf-8"),
                        status=413,
                    )
                    return
                raw = self.rfile.read(length) if length else b"{}"
                try:
                    req = json.loads(raw.decode("utf-8") or "{}")
                except (UnicodeDecodeError, json.JSONDecodeError):
                    self._send_cors_json(
                        json.dumps({"ok": False, "error": "Invalid JSON"}).encode("utf-8"),
                        status=400,
                    )
                    return
                tickers = req.get("tickers") or []
                weights = req.get("weights")
                payload = simulate_allocation(
                    tickers,
                    weights=weights,
                    start_date=req.get("start_date"),
                    end_date=req.get("end_date"),
                    initial_capital=float(req.get("initial_capital") or 10_000),
                    benchmark=req.get("benchmark") or "SPY",
                )
                status = 200 if payload.get("ok") else 400
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self._send_cors_json(body, status=status)
                return

            if path == "/kakao/skill":
                from kakao_notify import build_skill_response, kakao_notify_enabled
                from summary_builder import SUMMARY_META_PATH, resolve_summary_public_url

                if not kakao_notify_enabled() or not self._admin_secret_ok():
                    self._reject_unauthorized()
                    return
                length = int(self.headers.get("Content-Length") or 0)
                if length:
                    self.rfile.read(length)  # body unused for this lightweight skill
                meta = None
                if SUMMARY_META_PATH.is_file():
                    try:
                        meta = json.loads(SUMMARY_META_PATH.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        meta = None
                payload = build_skill_response(meta, public_url=summary_public_url() or resolve_summary_public_url())
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self._send(body, "application/json; charset=utf-8")
                return

            self._send(b"not found", "text/plain; charset=utf-8", status=404)

        def log_message(self, format, *args):
            return

    server = HTTPServer(("0.0.0.0", port), AppHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(
        f"Web server listening on port {port} "
        f"( / , /summary , /summary_kor , /summary_kor_intra , /summary_nxt , /reddit , /event , /summary.pdf , /summary_pre.pdf , /summary_kor.pdf , /summary_kor_intra.pdf , /reddit.pdf , /event.pdf , /kakao , /kakao/skill , /health , /api/web/heatmap , /api/web/simulate )"
    )


def get_bot_token() -> str:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    placeholder = "your_bot_token_from_botfather"
    if not token or token == placeholder:
        if not ENV_FILE.exists():
            print(f".env file not found at: {ENV_FILE}")
            print("Run:  bash setup.sh")
        else:
            print(f"Edit {ENV_FILE} and set TELEGRAM_BOT_TOKEN to your token from @BotFather.")
        sys.exit(1)
    return token


def start_telegram_bot(token: str):
    global _bot_username
    clear_telegram_webhook(token)
    _bot_username = fetch_bot_username(token)
    if _bot_username:
        print(f"Bot username: @{_bot_username}")

    print("Starting Telegram bot (async command workers)...")
    from bot_access import access_mode, env_allowed_chat_ids, env_allowed_user_ids

    mode = access_mode()
    print(
        f"Telegram access_mode={mode} "
        f"(allowed_chats={len(env_allowed_chat_ids())}, "
        f"allowed_users={len(env_allowed_user_ids())})"
    )
    if mode == "open":
        print(
            "WARNING: TELEGRAM_ACCESS_MODE=open — anyone can run commands. "
            "For public launch set TELEGRAM_ACCESS_MODE=allowlist and "
            "TELEGRAM_ALLOWED_CHAT_IDS / TELEGRAM_ALLOWED_USER_IDS."
        )
    # Pin env recipients so channels/1:1 survive blocked_chats leftovers + redeploys.
    for chat_id in _all_pinned_chat_ids():
        register_delivery_chat(chat_id)
    targets = startup_chat_ids()
    print(
        f"Broadcast targets: {len(targets)} "
        f"(legacy={len(env_chat_ids())}, us={len(env_chat_ids_us())}, "
        f"kor={len(env_chat_ids_kor())}, known={len(load_known_chats())}, "
        f"blocked={len(load_blocked_chats())})"
    )

    pending_updates, last_update_id = fetch_pending_updates(token)
    for chat_id in chat_ids_from_updates(pending_updates):
        register_delivery_chat(chat_id)
    broadcast_startup_guide(token, chat_ids_from_updates(pending_updates))

    # Never block the poll loop on command handlers — including backlog at boot.
    for update in pending_updates:
        enqueue_telegram_update(token, update)

    while True:
        try:
            params = {
                "timeout": 25,
                "allowed_updates": json.dumps(
                    [
                        "message",
                        "edited_message",
                        "channel_post",
                        "edited_channel_post",
                        "my_chat_member",
                    ]
                ),
            }
            if last_update_id is not None:
                params["offset"] = last_update_id + 1

            response = requests.get(
                f"https://api.telegram.org/bot{token}/getUpdates",
                params=params,
                timeout=35,
            )

            # 409 = another getUpdates long-poll is active (local bot, old Render
            # instance during deploy, etc.). Wait and retry; never log the token URL.
            if response.status_code == 409:
                print(
                    "Telegram 409 Conflict: another getUpdates poller is using this bot token. "
                    "Stop any local bot.py / extra Render instance. Retrying in 20s…"
                )
                time.sleep(20)
                continue

            if not response.ok:
                print(
                    f"Telegram getUpdates HTTP {response.status_code}: "
                    f"{_redact_telegram(response.text[:200], token)}"
                )
                time.sleep(5)
                continue

            payload = response.json()

            if not payload.get("ok"):
                print(f"Telegram API error: {payload}")
                time.sleep(5)
                continue

            for update in payload.get("result", []):
                last_update_id = update["update_id"]
                enqueue_telegram_update(token, update)

        except requests.RequestException as exc:
            print(f"Network error in bot loop: {_redact_telegram(str(exc), token)}")
            time.sleep(5)
        except Exception as exc:
            print(f"Error in bot loop: {_redact_telegram(str(exc), token)}")
            time.sleep(5)


def _refresh_summary_caches_for_schedule() -> bool:
    """Force-refresh /summary universes so heatmap/rankings use the verified session bar."""
    from summary_builder import SUMMARY_UNIVERSES
    from stock_crawler import ensure_fresh_rankings_cache

    ok = True
    for universe in SUMMARY_UNIVERSES:
        if not ensure_fresh_rankings_cache(universe, blocking=True):
            print(f"Schedule refresh: {universe} still session-stale after force rebuild.")
            ok = False
    return ok


if __name__ == "__main__":
    token = get_bot_token()
    mark_service_started()
    start_web_server()
    if os.environ.get("BOT_DEFER_CACHE_WARMUP", "true").lower() not in {"0", "false", "no"}:
        threading.Thread(
            target=warmup_startup_caches,
            name="cache-warmup",
            daemon=True,
        ).start()
        threading.Thread(
            target=warmup_deferred_caches,
            name="deferred-cache-warmup",
            daemon=True,
        ).start()
        start_cache_watchdog()
    else:
        warmup_startup_caches()
        warmup_deferred_caches()
        start_cache_watchdog()
    start_summary_scheduler(
        token=token,
        broadcast_fn=broadcast_messages_us,
        refresh_cache_fn=_refresh_summary_caches_for_schedule,
        public_url=summary_public_url(),
    )
    start_reddit_scheduler(token=token, broadcast_fn=broadcast_messages_us)
    start_summary_kor_intra_scheduler(
        token=token,
        broadcast_fn=broadcast_messages_kor,
        public_url=summary_public_url(),
    )
    start_summary_kor_scheduler(
        token=token,
        broadcast_fn=broadcast_messages_kor,
        public_url=summary_public_url(),
    )
    start_summary_nxt_scheduler(
        token=token,
        broadcast_fn=broadcast_messages_kor,
        public_url=summary_public_url(),
    )
    start_etf_sector_scheduler(token=token, broadcast_fn=broadcast_messages_legacy)
    start_etf_us_new_scheduler(token=token, broadcast_fn=broadcast_messages_legacy)
    start_etfcheck_scheduler(token=token, broadcast_fn=broadcast_messages_legacy)
    start_esg_scheduler(token=token, broadcast_fn=broadcast_messages_esg)
    start_telegram_bot(token)
