"""Money Flow ETL (Render) — refresh R2 snapshot used by Vercel /api/money-flow.

MVP: Vercel builds on demand + caches; this job is optional for scheduled refresh.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import requests

KST = ZoneInfo("Asia/Seoul")
WEBAPP = os.environ.get("WEBAPP_PUBLIC_URL", "https://savvyetf.vercel.app").rstrip("/")


def run_money_flow_etl() -> dict[str, Any]:
    """Trigger webapp builder via cron secret if configured; else no-op note."""
    secret = (os.environ.get("CRON_SECRET") or "").strip()
    url = f"{WEBAPP}/api/cron/money-flow-refresh"
    if not secret:
        return {"ok": False, "error": "CRON_SECRET not set — skip remote refresh"}
    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {secret}", "Accept": "application/json"},
        timeout=90,
    )
    try:
        body = resp.json()
    except Exception:
        body = {"raw": resp.text[:300]}
    return {
        "ok": resp.status_code < 400,
        "status": resp.status_code,
        "at": datetime.now(timezone.utc).isoformat(),
        "body": body,
    }


if __name__ == "__main__":
    print(json.dumps(run_money_flow_etl(), ensure_ascii=False, indent=2))
