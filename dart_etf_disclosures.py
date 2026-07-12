"""Open DART fund disclosures for Korean ETFs (rebalance / prospectus changes)."""

from __future__ import annotations

import html as htmlmod
import io
import re
import zipfile
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import requests

from dart_data import (
    DART_BASE,
    _dart_api_key,
    _dart_get,
    _esc,
    _normalize_name,
    load_corp_directory,
)

KST = ZoneInfo("Asia/Seoul")
LOOKBACK_DAYS = 365
LIST_PAGE_COUNT = 100
MAX_LIST_PAGES = 4
MAX_MATCHED_FILINGS = 8
MAX_DOCS_TO_PARSE = 3
VIEWER_URL = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}"

BRAND_TOKENS = (
    "KODEX",
    "TIGER",
    "SOL",
    "ACE",
    "RISE",
    "HANARO",
    "KOSEF",
    "KINDEX",
    "TIMEFOLIO",
    "ARIRANG",
    "MASTER",
    "TREX",
    "FOCUS",
    "WON",
    "PLUS",
    "HK",
    "BNK",
)

REBALANCE_HINTS = (
    "리밸",
    "정기변경",
    "구성종목",
    "편입",
    "편출",
    "지수방법",
    "투자한도",
    "포트폴리오",
    "기재정정",
    "변경등록",
    "신탁계약",
    "투자설명서",
    "일괄신고",
)

PRIORITY_REPORT_HINTS = (
    "기재정정",
    "투자설명서",
    "일괄신고",
    "신탁계약",
    "주요사항",
    "정정",
)

ISSUER_ALIASES: dict[str, list[str]] = {
    "삼성자산운용": ["삼성자산운용"],
    "미래에셋자산운용": ["미래에셋자산운용"],
    "한국투자신탁운용": ["한국투자신탁운용", "한투운용"],
    "kb자산운용": ["KB자산운용", "케이비자산운용"],
    "신한자산운용": ["신한자산운용"],
    "한화자산운용": ["한화자산운용"],
    "키움투자자산운용": ["키움투자자산운용", "키움자산운용"],
    "엔에이치아문디자산운용": ["NH-Amundi자산운용", "엔에이치아문디자산운용", "NH아문디"],
    "우리자산운용": ["우리자산운용"],
    "교보악사자산운용": ["교보악사자산운용"],
    "대신자산운용": ["대신자산운용"],
    "하나자산운용": ["하나자산운용"],
    "타임폴리오자산운용": ["타임폴리오자산운용"],
}


def _dart_get_soft(path: str, params: dict[str, Any]) -> dict | None:
    try:
        return _dart_get(path, params)
    except RuntimeError as exc:
        text = str(exc)
        if "(013)" in text or "조회된 데이타가 없습니다" in text:
            return None
        raise


def resolve_issuer_corp(issuer: str) -> dict[str, str] | None:
    issuer = (issuer or "").strip()
    if not issuer:
        return None
    corps = load_corp_directory()
    norm = _normalize_name(issuer)
    norm_compact = re.sub(r"(주식회사|㈜|유한회사)$", "", norm)

    alias_targets: list[str] = [issuer]
    for key, names in ISSUER_ALIASES.items():
        key_n = _normalize_name(key)
        if key_n == norm_compact or key_n in norm_compact or norm_compact in key_n:
            alias_targets.extend(names)
        elif any(_normalize_name(n) == norm or _normalize_name(n) in norm for n in names):
            alias_targets.extend(names)

    def _is_manager_name(name: str) -> bool:
        return any(
            tip in name
            for tip in ("자산운용", "투자신탁운용", "아문디", "Amundi", "투자운용")
        )

    def _names_match(target: str, corp_name: str) -> bool:
        t = _normalize_name(target)
        c = _normalize_name(corp_name)
        if not t or not c:
            return False
        if t == c:
            return True
        # Avoid false positives like corp_name "자" inside "삼성자산운용"
        if len(c) >= 6 and c in t:
            return True
        if len(t) >= 6 and t in c:
            return True
        return False

    candidates: list[dict] = []
    for corp in corps:
        cname = corp["corp_name"]
        if not any(_names_match(t, cname) for t in alias_targets):
            continue
        if _is_manager_name(cname):
            candidates.append(corp)

    if not candidates:
        # Secondary: issuer text contained in a manager corp name
        for corp in corps:
            cname = corp["corp_name"]
            if not _is_manager_name(cname):
                continue
            cn = _normalize_name(cname)
            if norm_compact and len(norm_compact) >= 4 and norm_compact in cn:
                candidates.append(corp)

    if not candidates:
        return None

    # Prefer exact / shortest manager name
    candidates.sort(
        key=lambda c: (
            0 if _normalize_name(c["corp_name"]) == norm_compact else 1,
            len(c["corp_name"]),
            c["corp_name"],
        )
    )
    best = candidates[0]
    return {"corp_code": best["corp_code"], "corp_name": best["corp_name"]}


def _etf_match_tokens(etf_name: str, ticker: str = "") -> list[str]:
    raw = (etf_name or "").upper()
    compact = re.sub(r"\s+", "", raw)
    tokens: list[str] = []

    for brand in BRAND_TOKENS:
        if brand in compact:
            tokens.append(brand)

    # Latin/number chunks (AI, TOP2, S&P500 → SP500 pieces)
    compact_latin = compact.replace("&", "")
    for chunk in re.findall(r"[A-Z][A-Z0-9]{1,}", compact_latin):
        if chunk not in tokens and chunk not in {"ETF", "KR", "USD", "H"}:
            tokens.append(chunk)
    if "SP500" in compact_latin and "SP500" not in tokens:
        tokens.append("SP500")
    if "S&P500" in raw.replace(" ", "") and "SP500" not in tokens:
        tokens.append("SP500")

    # Hangul runs length >= 2
    for chunk in re.findall(r"[가-힣]{2,}", etf_name or ""):
        if chunk not in {"증권", "상장", "지수", "투자", "신탁", "액티브", "플러스"}:
            tokens.append(chunk)

    if ticker and len(ticker) >= 4:
        tokens.append(ticker.upper())

    # Dedupe preserving order
    seen: set[str] = set()
    out: list[str] = []
    for token in tokens:
        key = token.upper()
        if key in seen:
            continue
        seen.add(key)
        out.append(token)
    return out


def _filing_match_score(report_nm: str, tokens: list[str]) -> int:
    name = report_nm or ""
    name_u = name.upper().replace(" ", "")
    if not tokens:
        return 0

    brand_set = {b.upper() for b in BRAND_TOKENS}
    specific = [
        t
        for t in tokens
        if t.upper() not in brand_set and not re.fullmatch(r"[0-9A-Z]{6}", t.upper())
    ]

    score = 0
    brand_hits = 0
    specific_hits = 0
    for token in tokens:
        t = token.upper().replace(" ", "")
        if len(t) < 2 or t not in name_u:
            continue
        if token.upper() in brand_set:
            brand_hits += 1
            score += 2
        else:
            specific_hits += 1
            score += 4

    # If we have distinctive tokens (e.g. KODEX200, 반도체), brand-only hits are noise.
    if specific and specific_hits == 0:
        return 0
    if brand_hits == 0 and specific_hits == 0:
        return 0

    for hint in PRIORITY_REPORT_HINTS:
        if hint in name:
            score += 2
    for hint in REBALANCE_HINTS:
        if hint in name:
            score += 1
    if "상장지수" in name or "ETF" in name_u:
        score += 2
    return score


def list_issuer_fund_filings(
    corp_code: str,
    *,
    lookback_days: int = LOOKBACK_DAYS,
    max_pages: int = MAX_LIST_PAGES,
) -> list[dict[str, Any]]:
    end = datetime.now(KST)
    bgn = end - timedelta(days=lookback_days)
    collected: list[dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        payload = _dart_get_soft(
            "list.json",
            {
                "corp_code": corp_code,
                "bgn_de": bgn.strftime("%Y%m%d"),
                "end_de": end.strftime("%Y%m%d"),
                "pblntf_ty": "G",
                "page_no": str(page),
                "page_count": str(LIST_PAGE_COUNT),
                "sort": "date",
                "sort_mth": "desc",
            },
        )
        if not payload:
            break
        batch = payload.get("list") or []
        if not batch:
            break
        collected.extend(batch)
        total_page = int(payload.get("total_page") or 1)
        if page >= total_page:
            break
    return collected


def select_etf_filings(
    filings: list[dict[str, Any]],
    tokens: list[str],
    *,
    limit: int = MAX_MATCHED_FILINGS,
) -> list[dict[str, Any]]:
    scored: list[tuple[int, dict[str, Any]]] = []
    for item in filings:
        report_nm = str(item.get("report_nm") or "")
        score = _filing_match_score(report_nm, tokens)
        if score <= 0:
            continue
        scored.append((score, item))
    scored.sort(
        key=lambda pair: (
            pair[0],
            str(pair[1].get("rcept_dt") or ""),
            str(pair[1].get("rcept_no") or ""),
        ),
        reverse=True,
    )
    # Deduplicate by report stem (ignore [기재정정] prefix noise loosely)
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for score, item in scored:
        key = re.sub(r"^\[.*?\]", "", str(item.get("report_nm") or "")).strip()
        key = re.sub(r"\s+", "", key)[:80]
        if key in seen:
            # keep higher-score / newer already first
            continue
        seen.add(key)
        enriched = dict(item)
        enriched["match_score"] = score
        enriched["url"] = VIEWER_URL.format(rcept_no=item.get("rcept_no"))
        enriched["change_flags"] = _change_flags(str(item.get("report_nm") or ""))
        out.append(enriched)
        if len(out) >= limit:
            break
    return out


def _change_flags(report_nm: str) -> list[str]:
    flags: list[str] = []
    for flag in ("기재정정", "첨부정정", "첨부추가", "변경등록", "정정"):
        if flag in report_nm or f"[{flag}]" in report_nm:
            flags.append(flag)
    if "투자설명서" in report_nm:
        flags.append("투자설명서")
    if "일괄신고" in report_nm:
        flags.append("일괄신고")
    if "신탁계약" in report_nm:
        flags.append("신탁계약")
    # unique
    return list(dict.fromkeys(flags))


def _decode_bytes(raw: bytes) -> str:
    for enc in ("utf-8", "cp949", "euc-kr"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _xml_to_plain(text: str) -> str:
    plain = re.sub(r"(?is)<script.*?>.*?</script>", " ", text)
    plain = re.sub(r"(?is)<style.*?>.*?</style>", " ", plain)
    plain = re.sub(r"(?s)<[^>]+>", " ", plain)
    plain = htmlmod.unescape(plain)
    plain = re.sub(r"[ \t\r\f\v]+", " ", plain)
    plain = re.sub(r"\n{3,}", "\n\n", plain)
    return plain.strip()


def download_document_text(rcept_no: str) -> str | None:
    key = _dart_api_key()
    if not key:
        return None
    response = requests.get(
        f"{DART_BASE}/document.xml",
        params={"crtfc_key": key, "rcept_no": rcept_no},
        timeout=45,
    )
    response.raise_for_status()
    content = response.content
    if content[:2] != b"PK":
        # Often XML error payload (014 file missing)
        return None
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        names = sorted(
            archive.namelist(),
            key=lambda n: archive.getinfo(n).file_size,
            reverse=True,
        )
        chunks: list[str] = []
        for name in names[:4]:
            if name.endswith("/"):
                continue
            raw = archive.read(name)
            chunks.append(_xml_to_plain(_decode_bytes(raw)))
        return "\n".join(c for c in chunks if c).strip() or None


def _extract_correction_reasons(plain: str) -> list[str]:
    reasons: list[str] = []
    match = re.search(
        r"3\.\s*정정\s*사유\s*(.+?)(?:4\.\s*정정요구|5\.\s*정정사항|$)",
        plain,
        re.S,
    )
    if match:
        blob = match.group(1)
        for line in re.split(r"[\n\-•]+", blob):
            cleaned = re.sub(r"\s+", " ", line).strip(" .-")
            if 4 <= len(cleaned) <= 160:
                reasons.append(cleaned)
    if reasons:
        return reasons[:6]

    # Fallback: sentences containing rebalance hints
    for hint in REBALANCE_HINTS:
        idx = plain.find(hint)
        if idx < 0:
            continue
        window = plain[max(0, idx - 30) : idx + 140]
        window = re.sub(r"\s+", " ", window).strip()
        if window and window not in reasons:
            reasons.append(window)
        if len(reasons) >= 4:
            break
    return reasons


def parse_filing_document(filing: dict[str, Any]) -> dict[str, Any]:
    rcept_no = str(filing.get("rcept_no") or "")
    out = {
        "rcept_no": rcept_no,
        "rcept_dt": filing.get("rcept_dt"),
        "report_nm": filing.get("report_nm"),
        "url": filing.get("url") or VIEWER_URL.format(rcept_no=rcept_no),
        "change_flags": filing.get("change_flags") or [],
        "match_score": filing.get("match_score"),
        "summary_bullets": [],
        "parse_error": None,
    }
    try:
        plain = download_document_text(rcept_no)
        if not plain:
            out["parse_error"] = "원문 파일 없음(Open DART 014) — 뷰어 링크 참고"
            out["summary_bullets"] = [
                "원문 ZIP을 받지 못해 제목·플래그만 표시합니다.",
            ]
            return out
        bullets = _extract_correction_reasons(plain)
        if not bullets:
            # Generic lead snippet
            lead = re.sub(r"\s+", " ", plain[:280]).strip()
            if lead:
                bullets = [lead + ("…" if len(plain) > 280 else "")]
        out["summary_bullets"] = bullets[:6]
        out["plain_chars"] = len(plain)
    except Exception as exc:
        out["parse_error"] = str(exc)
        out["summary_bullets"] = ["문서 파싱 실패 — 뷰어 링크 참고"]
    return out


def fetch_etf_disclosures(
    *,
    etf_name: str,
    ticker: str,
    issuer: str,
) -> dict[str, Any]:
    """Crawl Open DART fund filings for an ETF and parse top rebalance-related docs."""
    result: dict[str, Any] = {
        "issuer": issuer,
        "issuer_corp": None,
        "tokens": _etf_match_tokens(etf_name, ticker),
        "filings": [],
        "parsed": [],
        "error": None,
        "note": (
            "Open DART 펀드공시(G)에서 운용사 기준 검색 후 ETF명으로 필터합니다. "
            "편입비는 네이버 CU, 공시 해석은 DART입니다."
        ),
    }
    try:
        if not _dart_api_key():
            result["error"] = "DART_API_KEY not set"
            return result

        issuer_corp = resolve_issuer_corp(issuer)
        if not issuer_corp:
            result["error"] = f"운용사 DART corp_code를 찾지 못함: {issuer or '(empty)'}"
            return result
        result["issuer_corp"] = issuer_corp

        filings = list_issuer_fund_filings(issuer_corp["corp_code"])
        matched = select_etf_filings(filings, result["tokens"])
        result["filings"] = [
            {
                "rcept_no": f.get("rcept_no"),
                "rcept_dt": f.get("rcept_dt"),
                "report_nm": f.get("report_nm"),
                "url": f.get("url"),
                "change_flags": f.get("change_flags"),
                "match_score": f.get("match_score"),
            }
            for f in matched
        ]
        if not matched:
            result["error"] = (
                f"최근 {LOOKBACK_DAYS}일 내 '{etf_name}' 관련 펀드공시를 찾지 못했습니다."
            )
            return result

        # Prefer parsing 기재정정 / 투자설명서; skip empty 014 docs when possible.
        to_parse = sorted(
            matched,
            key=lambda f: (
                1
                if any(
                    x in str(f.get("report_nm") or "")
                    for x in ("기재정정", "정정", "투자설명서")
                )
                else 0,
                f.get("match_score") or 0,
                str(f.get("rcept_dt") or ""),
            ),
            reverse=True,
        )

        parsed: list[dict[str, Any]] = []
        for filing in to_parse[: max(MAX_DOCS_TO_PARSE * 2, MAX_DOCS_TO_PARSE)]:
            print(
                f"DART ETF doc parse: {filing.get('rcept_no')} "
                f"{str(filing.get('report_nm') or '')[:60]}"
            )
            item = parse_filing_document(filing)
            parsed.append(item)
            good = [
                p
                for p in parsed
                if not p.get("parse_error") and (p.get("summary_bullets") or [])
            ]
            if len(good) >= MAX_DOCS_TO_PARSE:
                break
            if len(parsed) >= MAX_DOCS_TO_PARSE and len(good) >= 1:
                # Keep a couple of link-only rows if at least one parsed well.
                break
        result["parsed"] = parsed[: max(MAX_DOCS_TO_PARSE, len(parsed))]
    except Exception as exc:
        result["error"] = str(exc)
        print(f"DART ETF disclosures failed: {exc}")
    return result


def format_etf_disclosures_telegram(disclosures: dict[str, Any] | None) -> str:
    if not disclosures:
        return ""
    lines = ["<b>📄 DART 펀드공시 · 리밸런싱/변경</b>"]
    issuer_corp = disclosures.get("issuer_corp") or {}
    if issuer_corp:
        lines.append(
            f"운용사: {_esc(issuer_corp.get('corp_name', ''))} "
            f"(<code>{_esc(issuer_corp.get('corp_code', ''))}</code>)"
        )
    tokens = disclosures.get("tokens") or []
    if tokens:
        lines.append("검색토큰: " + ", ".join(f"<code>{_esc(t)}</code>" for t in tokens[:8]))

    if disclosures.get("error") and not disclosures.get("filings"):
        lines.append(f"<i>{_esc(str(disclosures['error']))}</i>")
        if disclosures.get("note"):
            lines.append(f"<i>{_esc(disclosures['note'])}</i>")
        return "\n".join(lines)

    parsed_by_no = {
        str(p.get("rcept_no")): p for p in (disclosures.get("parsed") or []) if p.get("rcept_no")
    }

    lines.append("")
    lines.append("<b>관련 공시</b>")
    for idx, filing in enumerate(disclosures.get("filings") or [], start=1):
        report = _esc(str(filing.get("report_nm") or ""))
        dt = _esc(str(filing.get("rcept_dt") or ""))
        url = filing.get("url") or ""
        flags = filing.get("change_flags") or []
        flag_txt = f" · {', '.join(_esc(f) for f in flags)}" if flags else ""
        if url:
            lines.append(f"{idx}. <a href=\"{_esc(url)}\">{dt}</a>{flag_txt}")
        else:
            lines.append(f"{idx}. {dt}{flag_txt}")
        lines.append(f"   {report}")

        parsed = parsed_by_no.get(str(filing.get("rcept_no")))
        if not parsed:
            continue
        for bullet in (parsed.get("summary_bullets") or [])[:3]:
            lines.append(f"   • {_esc(bullet)}")
        if parsed.get("parse_error"):
            lines.append(f"   <i>{_esc(str(parsed['parse_error']))}</i>")

    if disclosures.get("note"):
        lines.extend(["", f"<i>{_esc(disclosures['note'])}</i>"])
    lines.append("<i>Not financial advice.</i>")
    return "\n".join(lines)
