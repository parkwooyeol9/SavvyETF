"""Lightweight KakaoTalk notify for scheduled /summary briefs.

Uses Kakao Developers "나에게 보내기" (talk memo) — sends to the linked
Kakao account only. Optional Open Builder skill webhook for on-demand replies.

Setup (once):
1. Create an app at https://developers.kakao.com
2. Enable Kakao Login + 카카오톡 메시지 (talk_message scope)
3. Platform → Web → add Redirect URI:
     https://<your-host>/kakao/callback
4. Render env:
     KAKAO_REST_API_KEY=...
     KAKAO_CLIENT_SECRET=...          # if enabled
     KAKAO_REDIRECT_URI=https://.../kakao/callback
     KAKAO_NOTIFY_ENABLED=true
5. Open https://<your-host>/kakao/auth while logged into Kakao, approve once.
   Tokens are stored in data/kakao_tokens.json (or set KAKAO_REFRESH_TOKEN).
"""

from __future__ import annotations

import json
import os
import urllib.parse
from pathlib import Path
from typing import Any

import requests

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
TOKEN_PATH = DATA_DIR / "kakao_tokens.json"

KAUTH = "https://kauth.kakao.com"
KAPI = "https://kapi.kakao.com"


def kakao_notify_enabled() -> bool:
    if os.environ.get("KAKAO_NOTIFY_ENABLED", "false").lower() in {"0", "false", "no"}:
        return False
    return bool(os.environ.get("KAKAO_REST_API_KEY", "").strip())


def _rest_api_key() -> str:
    return os.environ.get("KAKAO_REST_API_KEY", "").strip()


def _client_secret() -> str:
    return os.environ.get("KAKAO_CLIENT_SECRET", "").strip()


def _redirect_uri() -> str:
    explicit = os.environ.get("KAKAO_REDIRECT_URI", "").strip()
    if explicit:
        return explicit
    base = (
        os.environ.get("RENDER_EXTERNAL_URL", "").strip().rstrip("/")
        or os.environ.get("SUMMARY_PUBLIC_URL", "").strip().rstrip("/").removesuffix("/summary")
    )
    if base:
        return f"{base}/kakao/callback"
    return "http://localhost:8080/kakao/callback"


def _load_tokens() -> dict[str, str]:
    tokens: dict[str, str] = {}
    if TOKEN_PATH.is_file():
        try:
            payload = json.loads(TOKEN_PATH.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                tokens.update({k: str(v) for k, v in payload.items() if v})
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            pass
    # Env overrides / bootstrap
    for key, env_key in (
        ("access_token", "KAKAO_ACCESS_TOKEN"),
        ("refresh_token", "KAKAO_REFRESH_TOKEN"),
    ):
        value = os.environ.get(env_key, "").strip()
        if value:
            tokens[key] = value
    return tokens


def _save_tokens(tokens: dict[str, str]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    current = _load_tokens()
    current.update({k: v for k, v in tokens.items() if v})
    TOKEN_PATH.write_text(json.dumps(current, indent=2), encoding="utf-8")
    print(f"Kakao tokens saved to {TOKEN_PATH}")


def build_authorize_url(state: str = "savvyetf") -> str:
    params = {
        "client_id": _rest_api_key(),
        "redirect_uri": _redirect_uri(),
        "response_type": "code",
        "scope": "talk_message",
        "state": state,
    }
    return f"{KAUTH}/oauth/authorize?{urllib.parse.urlencode(params)}"


def exchange_code_for_tokens(code: str) -> dict[str, str]:
    data = {
        "grant_type": "authorization_code",
        "client_id": _rest_api_key(),
        "redirect_uri": _redirect_uri(),
        "code": code,
    }
    secret = _client_secret()
    if secret:
        data["client_secret"] = secret
    response = requests.post(f"{KAUTH}/oauth/token", data=data, timeout=30)
    response.raise_for_status()
    payload = response.json()
    tokens = {
        "access_token": str(payload.get("access_token") or ""),
        "refresh_token": str(payload.get("refresh_token") or ""),
    }
    if not tokens["access_token"]:
        raise RuntimeError(f"Kakao token exchange failed: {payload}")
    _save_tokens(tokens)
    return tokens


def refresh_access_token() -> str:
    tokens = _load_tokens()
    refresh = tokens.get("refresh_token", "").strip()
    if not refresh:
        raise RuntimeError(
            "Kakao refresh_token missing. Visit /kakao/auth once to authorize."
        )
    data = {
        "grant_type": "refresh_token",
        "client_id": _rest_api_key(),
        "refresh_token": refresh,
    }
    secret = _client_secret()
    if secret:
        data["client_secret"] = secret
    response = requests.post(f"{KAUTH}/oauth/token", data=data, timeout=30)
    response.raise_for_status()
    payload = response.json()
    access = str(payload.get("access_token") or "")
    if not access:
        raise RuntimeError(f"Kakao token refresh failed: {payload}")
    update = {"access_token": access}
    if payload.get("refresh_token"):
        update["refresh_token"] = str(payload["refresh_token"])
    _save_tokens(update)
    return access


def _access_token() -> str:
    tokens = _load_tokens()
    access = tokens.get("access_token", "").strip()
    if access:
        return access
    return refresh_access_token()


def _summary_urls(public_url: str = "") -> tuple[str, str]:
    from summary_builder import resolve_summary_pdf_public_url, resolve_summary_public_url

    web = public_url.strip() if public_url else resolve_summary_public_url()
    pdf = resolve_summary_pdf_public_url(web)
    return web, pdf


def build_summary_template(summary: dict, public_url: str = "") -> dict[str, Any]:
    web, pdf = _summary_urls(public_url)
    when = str(summary.get("generated_at_display", "")).strip()
    tickers = summary.get("ticker_count", 0)
    universes = summary.get("universes") or []
    names = ", ".join(str(u.get("name") or u.get("key") or "") for u in universes[:3])
    ai = (summary.get("ai_analysis") or {}).get("market_brief_ko") or ""
    snippet = " ".join(line.strip() for line in ai.splitlines() if line.strip())[:120]
    if snippet:
        snippet = snippet + ("…" if len(snippet) >= 120 else "")

    description_parts = [p for p in (when, f"뉴스 티커 {tickers}개", names) if p]
    description = " · ".join(description_parts)
    if snippet:
        description = f"{description}\n{snippet}" if description else snippet

    return {
        "object_type": "feed",
        "content": {
            "title": "SavvyETF Market Brief",
            "description": description[:200] or "오늘의 마켓 브리프가 준비되었습니다.",
            "link": {
                "web_url": web,
                "mobile_web_url": web,
            },
        },
        "buttons": [
            {
                "title": "웹 브리프 열기",
                "link": {"web_url": web, "mobile_web_url": web},
            },
            {
                "title": "PDF 다운로드",
                "link": {"web_url": pdf, "mobile_web_url": pdf},
            },
        ],
    }


def send_memo_template(template_object: dict[str, Any], *, retry_on_401: bool = True) -> bool:
    access = _access_token()
    response = requests.post(
        f"{KAPI}/v2/api/talk/memo/default/send",
        headers={"Authorization": f"Bearer {access}"},
        data={"template_object": json.dumps(template_object, ensure_ascii=False)},
        timeout=30,
    )
    if response.status_code == 401 and retry_on_401:
        refresh_access_token()
        return send_memo_template(template_object, retry_on_401=False)
    if not response.ok:
        print(f"Kakao memo send failed: HTTP {response.status_code} {response.text[:300]}")
        return False
    payload = response.json() if response.content else {}
    # result_code 0 = success
    if isinstance(payload, dict) and payload.get("result_code", 0) not in {0, "0", None}:
        print(f"Kakao memo send rejected: {payload}")
        return False
    print("Kakao memo (나에게 보내기) sent.")
    return True


def send_scheduled_summary_to_kakao(summary: dict, public_url: str = "") -> bool:
    if not kakao_notify_enabled():
        return False
    try:
        template = build_summary_template(summary, public_url=public_url)
        return send_memo_template(template)
    except Exception as exc:
        print(f"Kakao summary notify skipped: {exc}")
        return False


def build_skill_response(summary_meta: dict | None, public_url: str = "") -> dict[str, Any]:
    """Kakao i Open Builder skill response (v2.0)."""
    web, pdf = _summary_urls(public_url)
    when = ""
    if summary_meta:
        when = str(summary_meta.get("generated_at_display") or "")
    description = (
        f"{when}\n스케줄된 마켓 브리프 링크입니다."
        if when
        else "아직 생성된 브리프가 없습니다. 스케줄 시각 이후 다시 확인해 주세요."
    )
    return {
        "version": "2.0",
        "template": {
            "outputs": [
                {
                    "basicCard": {
                        "title": "SavvyETF Market Brief",
                        "description": description[:200],
                        "buttons": [
                            {
                                "action": "webLink",
                                "label": "웹 브리프",
                                "webLinkUrl": web,
                            },
                            {
                                "action": "webLink",
                                "label": "PDF",
                                "webLinkUrl": pdf,
                            },
                        ],
                    }
                }
            ],
            "quickReplies": [
                {"action": "message", "label": "브리프", "messageText": "브리프"},
            ],
        },
    }


def status_payload() -> dict[str, Any]:
    tokens = _load_tokens()
    return {
        "enabled": kakao_notify_enabled(),
        "has_rest_api_key": bool(_rest_api_key()),
        "has_access_token": bool(tokens.get("access_token")),
        "has_refresh_token": bool(tokens.get("refresh_token")),
        "redirect_uri": _redirect_uri(),
        "authorize_url": build_authorize_url() if _rest_api_key() else "",
    }
