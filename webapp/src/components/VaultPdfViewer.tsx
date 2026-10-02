"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { adminAuthHeaders } from "@/lib/adminSession";
import { formatVaultSize } from "@/lib/adminVaultMeta";

type ViewerFile = { id: string; filename: string; size: number };
type PageImage = { n: number; url: string; width: number; height: number };

/** Long edge of a rendered page, in device pixels; keeps slides crisp when captured. */
const TARGET_PX = 2000;
const PDFJS_BASE = "/pdfjs/";

async function fetchPdfBytes(
  postId: string,
  fileId: string,
  secret: string,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let total = 1;
  for (let part = 0; part < total; part += 1) {
    const params = new URLSearchParams({ post: postId, file: fileId, part: String(part) });
    const res = await fetch(`/api/admin-vault/file?${params}`, {
      cache: "no-store",
      headers: adminAuthHeaders(secret),
      signal,
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(json?.error || `HTTP ${res.status}`);
    }
    total = Math.max(1, Number(res.headers.get("X-Vault-Parts")) || 1);
    parts.push(new Uint8Array(await res.arrayBuffer()));
    onProgress(part + 1, total);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지 변환 실패"))), "image/png"),
  );
}

export default function VaultPdfViewer({
  postId,
  file,
  secret,
  onClose,
  onDownload,
}: {
  postId: string;
  file: ViewerFile;
  secret: string;
  onClose: () => void;
  onDownload: () => void;
}) {
  const [pages, setPages] = useState<PageImage[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [status, setStatus] = useState<string | null>("불러오는 중…");
  const [error, setError] = useState<string | null>(null);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    let destroy: (() => Promise<void>) | null = null;
    setPages([]);
    setPageCount(0);
    setError(null);
    setStatus("불러오는 중…");

    (async () => {
      try {
        const data = await fetchPdfBytes(
          postId,
          file.id,
          secret,
          (done, total) => {
            if (!cancelled && total > 1) setStatus(`불러오는 중… ${done}/${total}`);
          },
          ctrl.signal,
        );
        if (cancelled) return;
        setStatus("페이지 그리는 중…");
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}pdf.worker.min.mjs`;
        const task = pdfjs.getDocument({
          data,
          cMapUrl: `${PDFJS_BASE}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
          wasmUrl: `${PDFJS_BASE}wasm/`,
          iccUrl: `${PDFJS_BASE}iccs/`,
        });
        destroy = () => task.destroy();
        const doc = await task.promise;
        if (cancelled) return;
        setPageCount(doc.numPages);
        for (let n = 1; n <= doc.numPages; n += 1) {
          if (cancelled) return;
          setStatus(`페이지 그리는 중… ${n}/${doc.numPages}`);
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(4, TARGET_PX / Math.max(base.width, base.height));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          await page.render({ canvas, viewport }).promise;
          const blob = await canvasToBlob(canvas);
          page.cleanup();
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          urlsRef.current.push(url);
          setPages((cur) => [...cur, { n, url, width: canvas.width, height: canvas.height }]);
        }
        setStatus(null);
      } catch (exc) {
        if (cancelled) return;
        setStatus(null);
        setError(exc instanceof Error ? exc.message : "PDF를 열 수 없습니다.");
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
      void destroy?.();
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
      urlsRef.current = [];
    };
  }, [postId, file.id, secret]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stem = file.filename.replace(/\.pdf$/i, "");

  return createPortal(
    <div className="research-lightbox vault-viewer" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="research-lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <div className="research-lightbox-bar">
          <div>
            <strong>{file.filename}</strong>
            <span className="meta-soft">
              {formatVaultSize(file.size)}
              {pageCount ? ` · ${pageCount}쪽` : ""}
              {status ? ` · ${status}` : ""}
            </span>
          </div>
          <div className="research-item-actions">
            <button type="button" className="chip" onClick={onDownload}>
              원본 다운로드
            </button>
            <button type="button" className="chip" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
        {error ? <p className="empty warn">{error}</p> : null}
        <div className="vault-pages">
          {pages.map((p) => (
            <figure key={p.n} className="vault-page">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                width={p.width}
                height={p.height}
                alt={`${file.filename} ${p.n}쪽`}
              />
              <figcaption>
                <span>
                  {p.n} / {pageCount}
                </span>
                <a className="chip" href={p.url} download={`${stem}-p${p.n}.png`}>
                  PNG 저장
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
