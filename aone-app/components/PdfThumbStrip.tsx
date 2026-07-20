"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

import { signalMetaOf, type SignalLevel } from "@/lib/signal";

interface ThumbItem {
  page: number;
  title?: string;
  examTip?: boolean;
  /** 신호 레벨 — 있으면 상/중/하 색 점, examTip이면 high로 넘어온다 */
  signal?: SignalLevel;
}

interface PdfThumbStripProps {
  url: string;
  items: ThumbItem[];
  page: number;
  onPageChange: (page: number) => void;
}

/** 썸네일 최대 렌더 페이지 — 데모 성능 상한 */
const MAX_THUMBS = 40;
const THUMB_WIDTH = 150;

/**
 * 세로 페이지 미리보기 목차.
 * 보이는 항목만 렌더(IntersectionObserver) + 캔버스 캐시로 재렌더를 막는다.
 */
export default function PdfThumbStrip({
  url,
  items,
  page,
  onPageChange,
}: PdfThumbStripProps) {
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  /** 이미 렌더된 페이지 — 스크롤을 되돌아와도 다시 그리지 않는다 */
  const renderedRef = useRef<Set<number>>(new Set());
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [docReady, setDocReady] = useState(false);

  const shown = items.slice(0, MAX_THUMBS);

  // 문서 로드 (뷰어와 별개 인스턴스 — 썸네일 전용)
  useEffect(() => {
    let cancelled = false;
    setDocReady(false);
    renderedRef.current.clear();
    (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const task = pdfjs.getDocument({ url });
      loadingTaskRef.current = task;
      const doc = await task.promise;
      if (cancelled) return;
      docRef.current = doc;
      setDocReady(true);
    })().catch(() => {
      if (!cancelled) setDocReady(false);
    });
    return () => {
      cancelled = true;
      loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
      docRef.current = null;
    };
  }, [url]);

  // 보이는 범위 추적
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const p = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting && p) next.add(p);
          }
          return next;
        });
      },
      { root, rootMargin: "300px 0px" }
    );
    for (const el of root.querySelectorAll("[data-page]")) io.observe(el);
    return () => io.disconnect();
  }, [shown.length, docReady]);

  // 보이는 페이지 렌더 (캐시된 페이지는 건너뜀)
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !docReady) return;
    let cancelled = false;
    (async () => {
      for (const p of visible) {
        if (cancelled || renderedRef.current.has(p) || p > doc.numPages) continue;
        const canvas = canvasRefs.current.get(p);
        if (!canvas) continue;
        renderedRef.current.add(p); // 중복 렌더 가드 (await 전에 선점)
        try {
          const pdfPage = await doc.getPage(p);
          if (cancelled) return;
          const base = pdfPage.getViewport({ scale: 1 });
          const scale = THUMB_WIDTH / base.width;
          const viewport = pdfPage.getViewport({ scale });
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${THUMB_WIDTH}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await pdfPage.render({
            canvas,
            canvasContext: ctx,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          }).promise;
        } catch {
          renderedRef.current.delete(p); // 실패 시 재시도 허용
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, docReady]);

  // 현재 페이지 항목으로 스크롤
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-page="${page}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [page]);

  return (
    <div
      ref={listRef}
      className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
      data-testid="thumb-strip"
    >
      {shown.map((it) => {
        const active = it.page === page;
        return (
          <button
            key={it.page}
            data-page={it.page}
            data-testid={`thumb-${it.page}`}
            onClick={() => onPageChange(it.page)}
            title={it.title ?? `p.${it.page}`}
            className={`group mb-2 block w-full rounded-xl p-1.5 text-left transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
              active ? "bg-primary/10" : "hover:bg-black/[0.04]"
            }`}
          >
            <span
              className={`relative block overflow-hidden rounded-lg border bg-white transition-colors duration-200 ${
                active
                  ? "border-primary ring-2 ring-primary/40"
                  : "border-black/[0.08] group-hover:border-black/20"
              }`}
            >
              <canvas
                ref={(el) => {
                  if (el) canvasRefs.current.set(it.page, el);
                  else canvasRefs.current.delete(it.page);
                }}
                className="block w-full"
                style={{ aspectRatio: "4 / 3" }}
              />
              {it.signal && (
                <span
                  className={`absolute right-1.5 top-1.5 inline-block h-2 w-2 rounded-full ring-2 ring-white ${signalMetaOf(it.signal).dotClass}`}
                  title={
                    it.examTip
                      ? "시험 팁 있음"
                      : `${signalMetaOf(it.signal).label} 개념`
                  }
                  aria-label={
                    it.examTip
                      ? "시험 팁 있음"
                      : `${signalMetaOf(it.signal).label} 개념`
                  }
                />
              )}
            </span>
            <span className="mt-1.5 flex items-baseline gap-1.5 px-0.5">
              <span
                className={`shrink-0 font-mono text-[10px] ${
                  active ? "font-semibold text-primary" : "text-gray-400"
                }`}
              >
                {String(it.page).padStart(2, "0")}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-[11px] leading-tight ${
                  active ? "font-semibold text-primary" : "text-gray-500"
                }`}
              >
                {it.title ?? `p.${it.page}`}
              </span>
            </span>
          </button>
        );
      })}
      {items.length > MAX_THUMBS && (
        <p className="px-2 py-2 text-[11px] leading-relaxed text-gray-400">
          미리보기는 {MAX_THUMBS}페이지까지 표시됩니다 · 전체 {items.length}p
        </p>
      )}
      {!docReady && (
        <p className="px-2 py-3 text-[11px] text-gray-400">미리보기 준비 중…</p>
      )}
    </div>
  );
}
