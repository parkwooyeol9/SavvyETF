"""Push locally collected ETF weight snapshots to R2 right now (no scheduler wait).

Use when snapshots were collected on a machine without R2 keys (e.g. Claude's
2026-11-05 run of DGRO·HDV·VFLO·VYM·XLK) and must reach the website immediately.

    python etf_weight_push_local.py                      # dry run: shows what would change
    python etf_weight_push_local.py --apply              # upload snapshots/raw/latest + merge universe
    python etf_weight_push_local.py --apply --archive-etfcheck
        # also moves remote etfcheck snapshots of these tickers to
        # etf_weights/{T}/archive_etfcheck/ (copied first, never deleted uncopied)
        # so the history chart is not a mix of official and etfcheck weights.
    python etf_weight_push_local.py DGRO VYM --apply     # subset

Safety
------
* universe.json is MERGED with the remote one (Roundhill / iShares entries kept).
* latest.json follows ``should_replace_latest`` (issuer file > etfcheck, then date),
  so this never downgrades a newer official remote snapshot.
* Requires R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME.
"""

from __future__ import annotations
import path_setup  # noqa: F401  # numbered folders on sys.path

import argparse
import json
import sys
from datetime import datetime
from typing import Any

from etf_weight_monitor import (
    DATA_ROOT,
    KST,
    _basis_rank,
    list_snapshot_days,
    load_latest,
    load_snapshot,
    should_replace_latest,
)
from etf_weight_official import PRIORITY_TICKERS


def _universe_entry(t: str, snap: dict[str, Any]) -> dict[str, Any]:
    return {
        "ticker": t,
        "name": snap.get("name") or t,
        "issuer": snap.get("issuer"),
        "group": "priority",
        "as_of": snap.get("as_of"),
        "as_of_basis": snap.get("as_of_basis"),
        "aum_usd": snap.get("aum_usd"),
        "holdings": snap.get("count"),
    }


def push(tickers: tuple[str, ...], *, apply: bool, archive_etfcheck: bool) -> dict[str, Any]:
    from r2_briefs import _bucket, _client, _copy_object, _key_exists, r2_configured
    from r2_data import get_json, list_prefix_keys, put_bytes, put_json

    if not r2_configured():
        raise SystemExit("R2 not configured — set R2_* in .env (same values as the deployed bot).")

    mode = "APPLY" if apply else "DRY-RUN"
    report: dict[str, Any] = {"mode": mode, "tickers": {}}
    latest_for_universe: dict[str, dict[str, Any]] = {}

    for t in tickers:
        info: dict[str, Any] = {"snapshots": [], "raw": [], "archived": [], "latest": None}
        days = list_snapshot_days(t)
        if not days:
            info["skip"] = "no local snapshots"
            report["tickers"][t] = info
            continue

        # 1) snapshots + raw files
        for day in days:
            snap = load_snapshot(t, day)
            if not snap:
                continue
            key = f"etf_weights/{t}/snapshots/{day}.json"
            info["snapshots"].append(f"{key} ({snap.get('source')})")
            if apply:
                put_json(key, snap)
            raw_dir = DATA_ROOT / t / "raw"
            raw = raw_dir / f"{day}.csv"
            if raw.is_file():
                info["raw"].append(f"etf_weights/{t}/raw/{day}.csv")
                if apply:
                    put_bytes(f"etf_weights/{t}/raw/{day}.csv", raw.read_bytes(), "text/csv; charset=utf-8")

        # 2) latest pointer
        local_latest = load_latest(t)
        remote_latest = get_json(f"etf_weights/{t}/latest.json")
        chosen = remote_latest
        if local_latest and should_replace_latest(local_latest, remote_latest):
            chosen = local_latest
            info["latest"] = (
                f"replace remote {((remote_latest or {}).get('as_of'), (remote_latest or {}).get('source'))} "
                f"→ local {(local_latest.get('as_of'), local_latest.get('source'))}"
            )
            if apply:
                put_json(f"etf_weights/{t}/latest.json", local_latest)
        else:
            info["latest"] = f"keep remote {((remote_latest or {}).get('as_of'), (remote_latest or {}).get('source'))}"
        if chosen:
            latest_for_universe[t] = chosen

        # 3) optional: move remote etfcheck snapshots out of the history prefix
        if archive_etfcheck and _basis_rank(chosen) == 2:
            client = _client() if apply else None
            for key in list_prefix_keys(f"etf_weights/{t}/snapshots/"):
                if not key.endswith(".json"):
                    continue
                day = key.rsplit("/", 1)[-1].removesuffix(".json")
                if day in days:
                    continue  # just overwritten with the local (official) snapshot
                remote = get_json(key)
                if _basis_rank(remote) != 0:
                    continue
                dest = f"etf_weights/{t}/archive_etfcheck/{day}.json"
                info["archived"].append(f"{key} → {dest}")
                if apply:
                    if not _key_exists(client, dest):
                        _copy_object(client, key, dest)
                    if _key_exists(client, dest):
                        client.delete_object(Bucket=_bucket(), Key=key)
        report["tickers"][t] = info

    # 4) universe merge
    remote_u = get_json("etf_weights/universe.json") or {}
    by_t = {e["ticker"]: e for e in remote_u.get("tickers") or [] if e.get("ticker")}
    for t, snap in latest_for_universe.items():
        by_t[t] = {**by_t.get(t, {}), **_universe_entry(t, snap)}
    entries = sorted(by_t.values(), key=lambda e: (e.get("issuer") or "", e["ticker"]))
    report["universe"] = {"remote_before": len(remote_u.get("tickers") or []), "after": len(entries)}
    if apply:
        put_json(
            "etf_weights/universe.json",
            {"updated_at": datetime.now(KST).isoformat(), "count": len(entries), "tickers": entries},
        )
    return report


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tickers", nargs="*", help="default: priority set")
    ap.add_argument("--apply", action="store_true", help="actually write to R2 (default: dry run)")
    ap.add_argument("--archive-etfcheck", action="store_true", help="move remote etfcheck snapshots to archive_etfcheck/")
    a = ap.parse_args(argv)
    tickers = tuple(t.upper() for t in a.tickers) or PRIORITY_TICKERS
    print(json.dumps(push(tickers, apply=a.apply, archive_etfcheck=a.archive_etfcheck), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main(sys.argv[1:])
