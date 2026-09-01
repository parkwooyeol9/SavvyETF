"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CardItem = {
  id: string;
  date: string;
  order: number;
  caption: string;
  key: string;
  url: string;
  contentType: string;
  uploaded_at: string;
};

type DayGroup = {
  date: string;
  items: CardItem[];
};

const SECRET_KEY = "savvy_cardnews_admin";

function kstToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function friendlyError(msg: string): string {
  if (/R2 not configured/i.test(msg) || /저장소/.test(msg)) {
    return "카드뉴스 저장소가 아직 연결되지 않았습니다. 배포 환경의 R2 설정을 확인해 주세요.";
  }
  if (/관리자 비밀번호가 아직/.test(msg)) {
    return "관리자 비밀번호가 아직 설정되지 않았습니다. Vercel에 CARDNEWS_ADMIN_SECRET을 넣어 주세요.";
  }
  return msg;
}

function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const weekday = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("ko-KR", {
    weekday: "short",
    timeZone: "UTC",
  });
  return `${y}년 ${m}월 ${d}일 (${weekday})`;
}

function loadSecret(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(SECRET_KEY) || "";
}

function saveSecret(secret: string) {
  window.sessionStorage.setItem(SECRET_KEY, secret);
}

function clearSecret() {
  window.sessionStorage.removeItem(SECRET_KEY);
}

function mediaUrl(item: CardItem): string {
  if (item.key) return `/api/cardnews/media/${item.key}`;
  return item.url;
}

function extForType(type: string): string {
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  return "jpg";
}

function downloadFile(file: File) {
  const href = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = href;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(href);
}

async function fetchCardBlob(item: CardItem): Promise<Blob> {
  const res = await fetch(mediaUrl(item), { cache: "no-store" });
  if (!res.ok) throw new Error("이미지를 가져오지 못했습니다.");
  return res.blob();
}

function blobToFile(item: CardItem, blob: Blob, index: number): File {
  const type = blob.type || item.contentType || "image/jpeg";
  return new File(
    [blob],
    `savvyetf-cardnews-${item.date}-${String(item.order || index + 1).padStart(2, "0")}.${extForType(type)}`,
    { type },
  );
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const href = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(href);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(href);
      reject(new Error("이미지 로드 실패"));
    };
    img.src = href;
  });
}

async function stitchCards(blobs: Blob[]): Promise<File> {
  const images = await Promise.all(blobs.map(loadImage));
  const width = Math.max(...images.map((img) => img.naturalWidth));
  const gap = 20;
  const pad = 20;
  const heights = images.map((img) =>
    Math.round((img.naturalHeight * width) / img.naturalWidth),
  );
  const canvas = document.createElement("canvas");
  canvas.width = width + pad * 2;
  canvas.height =
    pad * 2 + heights.reduce((sum, h) => sum + h, 0) + gap * Math.max(0, images.length - 1);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#0b1018";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = pad;
  images.forEach((img, i) => {
    ctx.drawImage(img, pad, y, width, heights[i]!);
    y += heights[i]! + gap;
  });
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error("카드 합치기 실패"))),
      "image/jpeg",
      0.92,
    );
  });
  return new File([blob], `savvyetf-cardnews-${Date.now()}.jpg`, {
    type: "image/jpeg",
  });
}

async function shareCards(items: CardItem[]): Promise<"shared" | "downloaded"> {
  if (!items.length) throw new Error("공유할 카드가 없습니다.");
  const blobs = await Promise.all(items.map(fetchCardBlob));
  const files = items.map((item, i) => blobToFile(item, blobs[i]!, i));
  const title = `SavvyETF 카드뉴스 ${items[0]!.date}`;
  try {
    if (navigator.share && navigator.canShare?.({ files })) {
      await navigator.share({ title, text: title, files });
      return "shared";
    }
  } catch (exc) {
    if (exc instanceof Error && exc.name === "AbortError") throw exc;
  }
  const stacked = await stitchCards(blobs);
  const named = new File([stacked], `savvyetf-cardnews-${items[0]!.date}.jpg`, {
    type: "image/jpeg",
  });
  if (navigator.share && navigator.canShare?.({ files: [named] })) {
    await navigator.share({ title, text: title, files: [named] });
    return "shared";
  }
  downloadFile(named);
  return "downloaded";
}

export default function CardNewsTab() {
  const [days, setDays] = useState<DayGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [date, setDate] = useState(kstToday);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState<CardItem | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cardnews", { cache: "no-store" });
      const json = (await res.json()) as {
        ok: boolean;
        days?: DayGroup[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setDays(json.days || []);
      setError(null);
    } catch (exc) {
      setError(friendlyError(exc instanceof Error ? exc.message : "로드 실패"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const stored = loadSecret();
    if (!stored) return;
    void (async () => {
      const res = await fetch("/api/cardnews/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: stored }),
      });
      if (res.ok) {
        setSecret(stored);
        setUnlocked(true);
      } else {
        clearSecret();
      }
    })();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const total = useMemo(
    () => days.reduce((n, day) => n + day.items.length, 0),
    [days],
  );

  async function onUnlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cardnews/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: password }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "비밀번호가 올바르지 않습니다.");
      }
      saveSecret(password);
      setSecret(password);
      setUnlocked(true);
      setAuthOpen(false);
      setPassword("");
    } catch (exc) {
      setError(friendlyError(exc instanceof Error ? exc.message : "인증 실패"));
    } finally {
      setBusy(false);
    }
  }

  function onLock() {
    clearSecret();
    setSecret("");
    setUnlocked(false);
    setAuthOpen(false);
  }

  async function uploadFiles(files: FileList | File[]) {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) {
      setError("이미지 파일을 올려 주세요.");
      return;
    }
    if (!secret) {
      setError("관리자 인증이 필요합니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (let i = 0; i < list.length; i += 1) {
        const file = list[i];
        setProgress(`${i + 1}/${list.length} 올리는 중…`);
        const body = new FormData();
        body.set("date", date);
        body.set("file", file);
        const res = await fetch("/api/cardnews", {
          method: "POST",
          headers: { Authorization: `Bearer ${secret}` },
          body,
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) {
          throw new Error(json.error || `${file.name} 업로드 실패`);
        }
      }
      await load();
    } catch (exc) {
      setError(friendlyError(exc instanceof Error ? exc.message : "업로드 실패"));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function onDelete(id: string) {
    if (!secret) return;
    if (!window.confirm("이 카드를 삭제할까요?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/cardnews?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${secret}` },
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "삭제 실패");
      }
      if (open?.id === id) setOpen(null);
      await load();
    } catch (exc) {
      setError(friendlyError(exc instanceof Error ? exc.message : "삭제 실패"));
    } finally {
      setBusy(false);
    }
  }

  async function onShareDay(day: DayGroup) {
    setShareNote(null);
    setError(null);
    try {
      const how = await shareCards(day.items);
      setShareNote(
        how === "shared" ? "공유 창을 열었습니다." : "카드뉴스 이미지를 저장했습니다.",
      );
    } catch (exc) {
      if (exc instanceof Error && exc.name === "AbortError") return;
      setError(friendlyError(exc instanceof Error ? exc.message : "공유 실패"));
    }
  }

  return (
    <div className="edu-tab cardnews-tab">
      <section className="feature-block">
        <div className="cardnews-head">
          <div>
            <h1 className="feature-title">카드뉴스</h1>
            <p className="feature-lead">
              매일 세 장의 카드뉴스를 날짜순으로 모아 둡니다. 날짜마다 세 장을
              한꺼번에 카카오톡·텔레그램으로 공유할 수 있습니다.
            </p>
          </div>
          {unlocked ? (
            <button type="button" className="ghost-btn" onClick={onLock}>
              관리 종료
            </button>
          ) : (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setAuthOpen((v) => !v)}
            >
              {authOpen ? "닫기" : "관리자"}
            </button>
          )}
        </div>

        {authOpen && !unlocked ? (
          <form className="cardnews-auth" onSubmit={(e) => void onUnlock(e)}>
            <label>
              관리자 비밀번호
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <button type="submit" className="community-submit" disabled={busy}>
              {busy ? "확인 중…" : "잠금 해제"}
            </button>
          </form>
        ) : null}

        {unlocked ? (
          <div
            className={`cardnews-drop ${dragging ? "dragging" : ""}`}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              const next = e.relatedTarget as Node | null;
              if (!next || !e.currentTarget.contains(next)) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void uploadFiles(e.dataTransfer.files);
            }}
          >
            <label className="cardnews-date">
              게시 날짜
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <p>
              {date} 카드 {days.find((d) => d.date === date)?.items.length || 0}
              장 · JPEG/PNG를 여기로 끌어다 놓거나 파일을 선택하세요. 하루에 세
              장 올리는 것을 권장합니다.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="community-submit"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? progress || "올리는 중…" : "이미지 선택"}
            </button>
          </div>
        ) : null}

        {error ? <p className="empty warn">{error}</p> : null}
        {shareNote ? <p className="meta-soft">{shareNote}</p> : null}
      </section>

      {loading ? <p className="empty">불러오는 중…</p> : null}
      {!loading && !days.length ? (
        <p className="empty">아직 올라온 카드뉴스가 없습니다.</p>
      ) : null}

      {days.map((day) => (
        <section key={day.date} className="feature-block cardnews-day">
          <div className="cardnews-day-head">
            <h2>{formatDay(day.date)}</h2>
            <div className="cardnews-day-actions">
              <span className="meta-soft">{day.items.length}장</span>
              <button
                type="button"
                className="chip active"
                onClick={() => void onShareDay(day)}
              >
                {day.items.length}장 공유
              </button>
            </div>
          </div>
          <ul className="cardnews-grid">
            {day.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="cardnews-thumb"
                  onClick={() => {
                    setShareNote(null);
                    setOpen(item);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.url}
                    alt={item.caption || `${day.date} 카드 ${item.order}`}
                    loading="lazy"
                  />
                </button>
                {item.caption ? <p className="cardnews-caption">{item.caption}</p> : null}
                {unlocked ? (
                  <div className="cardnews-card-actions">
                    <button
                      type="button"
                      className="ghost-btn danger-btn"
                      disabled={busy}
                      onClick={() => void onDelete(item.id)}
                    >
                      삭제
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {!loading && total > 0 ? (
        <p className="meta-soft cardnews-count">전체 {total}장</p>
      ) : null}

      {open ? (
        <div
          className="cardnews-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(null)}
        >
          <div
            className="cardnews-lightbox-inner"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={open.url} alt={open.caption || `${open.date} 카드`} />
            <div className="cardnews-lightbox-bar">
              <span>{formatDay(open.date)}</span>
              <div className="charttrade-share-row">
                <button
                  type="button"
                  className="chip active"
                  onClick={() => {
                    const day = days.find((d) => d.date === open.date);
                    if (day) void onShareDay(day);
                  }}
                >
                  {days.find((d) => d.date === open.date)?.items.length || 1}장 공유
                </button>
                {unlocked ? (
                  <button
                    type="button"
                    className="ghost-btn danger-btn"
                    onClick={() => void onDelete(open.id)}
                  >
                    삭제
                  </button>
                ) : null}
                <button type="button" className="chip" onClick={() => setOpen(null)}>
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
