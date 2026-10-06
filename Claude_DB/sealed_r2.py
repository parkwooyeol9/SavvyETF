"""라이선스 데이터를 공개 R2 버킷에 암호화해 올린다.

버킷이 R2_PUBLIC_BASE_URL 로 공개돼 있어서 평문 JSON 을 두면 키 경로만 알아도 받을 수 있다.
그래서 gzip → AES-256-GCM 으로 봉인한 바이트만 올리고, 복호화는 웹앱 서버(관리자 API)에서만 한다.

  형식: b"SVD1" + nonce(12) + 암호문‖태그(16), AAD = b"SVD1"   (webapp/src/lib/sealedData.ts 와 같음)

업로드는 R2 키 없이 사이트를 거친다: 관리자 비밀번호로 /api/private-upload 에 서명 URL 을 받아 R2 에 직접 PUT.
설정은 환경변수 또는 Claude_DB/.env.local (gitignore):
  SEALED_DATA_KEY     base64 32바이트 (Vercel 프로덕션에도 같은 값)
  PRIVATE_UPLOAD_TOKEN 업로드 전용 토큰 (Vercel 프로덕션에도 같은 값). 없으면 SAVVY_ADMIN_SECRET(관리자 비밀번호)
  SAVVY_SITE_URL      기본 https://savvyetf.com
"""
from __future__ import annotations

import base64
import gzip
import json
import math
import os
import secrets
import ssl
import urllib.request
from pathlib import Path
from typing import Any

MAGIC = b"SVD1"
ENV_FILE = Path(__file__).resolve().parent / ".env.local"


def _env(name: str, default: str = "") -> str:
    if os.environ.get(name, "").strip():
        return os.environ[name].strip()
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            k, _, v = line.partition("=")
            if k.strip() == name and v.strip():
                return v.strip().strip('"')
    return default


def _key() -> bytes:
    raw = _env("SEALED_DATA_KEY")
    if not raw:
        raise SystemExit(f"SEALED_DATA_KEY 가 없습니다. {ENV_FILE} 에 넣거나 `python -m Claude_DB.sealed_r2 --new-key` 로 만드세요.")
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise SystemExit("SEALED_DATA_KEY 는 base64 로 인코딩한 32바이트여야 합니다.")
    return key


def _finite(obj: Any) -> Any:
    """NaN/inf → None: the reader is JSON.parse, which rejects them."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _finite(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_finite(v) for v in obj]
    return obj


def seal(obj: Any) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    text = json.dumps(_finite(obj), ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    body = gzip.compress(text.encode("utf-8"), mtime=0)
    nonce = secrets.token_bytes(12)
    return MAGIC + nonce + AESGCM(_key()).encrypt(nonce, body, MAGIC)


def open_sealed(blob: bytes) -> Any:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    if blob[:4] != MAGIC:
        raise ValueError("봉인 형식이 아닙니다")
    body = AESGCM(_key()).decrypt(blob[4:16], blob[16:], MAGIC)
    return json.loads(gzip.decompress(body))


def upload(blobs: dict[str, bytes]) -> None:
    """{R2 키: 봉인 바이트} → 사이트에서 서명 URL 을 받아 PUT."""
    site = _env("SAVVY_SITE_URL", "https://savvyetf.com").rstrip("/")
    admin = _env("PRIVATE_UPLOAD_TOKEN") or _env("SAVVY_ADMIN_SECRET")
    if not admin:
        raise SystemExit(f"PRIVATE_UPLOAD_TOKEN 또는 SAVVY_ADMIN_SECRET 이 없습니다. {ENV_FILE} 에 넣으세요.")
    try:                                             # python.org 빌드는 시스템 인증서를 안 씀
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        ctx = ssl.create_default_context()
    keys = list(blobs)
    urls: dict[str, str] = {}
    for i in range(0, len(keys), 50):
        req = urllib.request.Request(
            f"{site}/api/private-upload", method="POST",
            data=json.dumps({"keys": keys[i:i + 50]}).encode(),
            headers={"Authorization": f"Bearer {admin}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60, context=ctx) as res:
            urls.update(json.load(res)["urls"])
    for k, blob in blobs.items():
        put = urllib.request.Request(urls[k], method="PUT", data=blob, headers={
            "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store"})
        with urllib.request.urlopen(put, timeout=120, context=ctx) as res:
            if res.status >= 300:
                raise RuntimeError(f"{k}: HTTP {res.status}")


def main():
    import argparse

    ap = argparse.ArgumentParser(description="봉인 키 생성")
    ap.add_argument("--new-key", action="store_true", help="새 SEALED_DATA_KEY 를 .env.local 에 추가 (이미 있으면 중단)")
    a = ap.parse_args()
    if a.new_key:
        if _env("SEALED_DATA_KEY"):
            raise SystemExit("이미 SEALED_DATA_KEY 가 있습니다. 바꾸면 R2 의 기존 데이터를 열 수 없습니다.")
        with ENV_FILE.open("a", encoding="utf-8") as fp:
            fp.write(f"SEALED_DATA_KEY={base64.b64encode(secrets.token_bytes(32)).decode()}\n")
        print(f"{ENV_FILE} 에 저장했습니다. 같은 값을 Vercel 프로덕션 SEALED_DATA_KEY 로 등록하세요.")


if __name__ == "__main__":
    main()
