"use client";

import { useState } from "react";

export default function ExcelButton({ onClick, label = "엑셀 다운로드" }: { onClick: () => Promise<void>; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <button
      type="button"
      className="ghost-btn"
      disabled={busy}
      title={err || "차트 포함 엑셀(.xlsx) 다운로드"}
      onClick={async () => {
        setBusy(true);
        setErr(null);
        try {
          await onClick();
        } catch (exc) {
          setErr(exc instanceof Error ? exc.message : String(exc));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "만드는 중…" : err ? "엑셀 실패 · 다시" : label}
    </button>
  );
}
