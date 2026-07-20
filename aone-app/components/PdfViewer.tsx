"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";

interface PdfViewerProps {
  url: string;
  page: number;
  onPageChange: (page: number) => void;
  onNumPages?: (numPages: number) => void;
  /** 캔버스 영역 최대 높이 (기본 72vh — 리더 모드에서는 "100%"로 남은 공간 전부) */
  maxHeight?: string;
  /** true면 툴바를 캔버스 위에 겹쳐 띄운다 (리더 모드 — 세로 공간 절약) */
  compact?: boolean;
}

/**
 * pdfjs-dist 캔버스 뷰어.
 * 배율은 컨테이너 크기에 맞춘다 — 폭 기준(fit-width)이 기본이되,
 * 그 배율로 세로가 넘치면 fit-height로 자동 전환해 슬라이드 한 장이 화면에 꽉 차게 한다.
 * 컨테이너 크기 변화(창 리사이즈·패널 접기)는 ResizeObserver로 감지해 다시 렌더한다.
 * 워커는 /pdf.worker.min.mjs (public) 사용.
 */
export default function PdfViewer({
  url,
  page,
  onPageChange,
  onNumPages,
  maxHeight = "72vh",
  compact = false,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  /** 문서 세대 토큰 — url 교체 시 증가. 렌더가 자기 세대 문서인지 가드한다 */
  const docGenRef = useRef(0);

  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 컨테이너 실측 크기 — 창 리사이즈·패널 접기에 따라 갱신되고 렌더를 다시 트리거한다 */
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // 문서 로드
  useEffect(() => {
    let cancelled = false;
    const gen = docGenRef.current + 1;
    docGenRef.current = gen;
    setLoading(true);
    setError(null);
    setNumPages(0);
    (async () => {
      // legacy 빌드: 구형 WebKit(Tauri)·크로미움에서도 동작하는 폴리필 포함
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const task = pdfjs.getDocument({ url });
      loadingTaskRef.current = task;
      const doc = await task.promise;
      if (cancelled) return;
      docRef.current = doc;
      setNumPages(doc.numPages);
      onNumPages?.(doc.numPages);
      setLoading(false);
    })().catch((e: unknown) => {
      if (!cancelled) {
        setLoading(false);
        setError(e instanceof Error ? e.message : String(e));
      }
    });
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      // 페이지 리소스 해제 후 로딩 태스크 파기 — 워커/문서 메모리 누수 방지 (장시간 OOM).
      // 이 pdfjs 버전은 PDFDocumentProxy.destroy가 없고 loadingTask.destroy가 문서를 파기한다.
      void docRef.current?.cleanup();
      docRef.current = null;
      void loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
    };
    // onNumPages는 렌더마다 새 함수여도 재로드하지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // 컨테이너 크기 추적 — 창 리사이즈·사이드바/패널 접기 모두 여기로 들어온다
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const read = () =>
      setBox((prev) => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        return prev.w === w && prev.h === h ? prev : { w, h };
      });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 페이지 렌더 — 폭/높이 중 더 빡빡한 쪽에 맞춘다 (fit-width → 넘치면 fit-height)
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || numPages === 0 || box.w === 0) return;
    let cancelled = false;
    const gen = docGenRef.current;
    const pageNo = Math.min(Math.max(1, page), numPages);
    (async () => {
      const p = await doc.getPage(pageNo);
      // url 교체로 문서 세대가 바뀌었으면 stale docRef — 렌더 중단
      if (cancelled || gen !== docGenRef.current) return;
      const base = p.getViewport({ scale: 1 });
      // 스크롤바·패딩 여유 2px
      const availW = Math.max(200, box.w - 2);
      // compact(리더)에서는 컨테이너 높이가 고정 → 세로도 맞춘다.
      // 일반 모드 컨테이너는 높이가 내용에 따라 늘어나므로(순환) 폭 기준만 쓴다.
      const fitW = availW / base.width;
      const fit =
        compact && box.h > 0
          ? Math.min(fitW, Math.max(200, box.h - 2) / base.height)
          : fitW;
      const scale = fit * zoom;
      const viewport = p.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      renderTaskRef.current?.cancel();
      const task = p.render({
        canvas,
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      renderTaskRef.current = task;
      await task.promise;
    })().catch((e: unknown) => {
      const name = (e as { name?: string } | null)?.name;
      if (!cancelled && name !== "RenderingCancelledException") {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [page, zoom, numPages, box, compact]);

  const clamped = numPages > 0 ? Math.min(Math.max(1, page), numPages) : page;

  const toolbar = (
    <div
      className={
        compact
          ? "pointer-events-none absolute inset-x-0 bottom-3 z-10 flex items-center justify-center gap-2"
          : "mb-3 flex items-center justify-between gap-2"
      }
    >
      <div
        className={`pointer-events-auto flex items-center gap-1 rounded-xl border border-black/[0.05] p-1 shadow-sm ${
          compact ? "bg-white/90 backdrop-blur-md" : "bg-white"
        }`}
      >
        <button
          onClick={() => onPageChange(clamped - 1)}
          disabled={clamped <= 1}
          title="이전 페이지"
          aria-label="이전 페이지"
          className="press-scale rounded-lg p-1.5 text-gray-600 transition-colors duration-200 hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <span className="min-w-[64px] px-1 text-center font-mono text-xs font-medium text-gray-700">
          {numPages > 0 ? `${clamped} / ${numPages}` : "– / –"}
        </span>
        <button
          onClick={() => onPageChange(clamped + 1)}
          disabled={numPages === 0 || clamped >= numPages}
          title="다음 페이지"
          aria-label="다음 페이지"
          className="press-scale rounded-lg p-1.5 text-gray-600 transition-colors duration-200 hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div
        className={`pointer-events-auto flex items-center gap-1 rounded-xl border border-black/[0.05] p-1 shadow-sm ${
          compact ? "bg-white/90 backdrop-blur-md" : "bg-white"
        }`}
      >
        <button
          onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.2) * 10) / 10))}
          disabled={zoom <= 0.6}
          title="축소"
          aria-label="축소"
          className="press-scale rounded-lg p-1.5 text-gray-600 transition-colors duration-200 hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <ZoomOut className="h-4 w-4" aria-hidden />
        </button>
        <span className="min-w-[44px] text-center font-mono text-xs text-gray-500">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.2) * 10) / 10))}
          disabled={zoom >= 2}
          title="확대"
          aria-label="확대"
          className="press-scale rounded-lg p-1.5 text-gray-600 transition-colors duration-200 hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <ZoomIn className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );

  return (
    <div className={compact ? "relative flex h-full min-h-0 flex-col" : ""}>
      {!compact && toolbar}

      {/* 캔버스 — 리더(compact)에서는 남은 공간 전부를 차지한다 */}
      <div
        ref={containerRef}
        className={`overflow-auto rounded-xl border border-black/[0.06] bg-white/70 ${
          compact ? "flex min-h-0 flex-1 items-center justify-center" : ""
        }`}
        style={compact ? undefined : { maxHeight }}
      >
        {error && (
          <p className="p-6 text-sm text-gray-500">
            PDF를 불러오지 못했습니다: {error}
          </p>
        )}
        {!error && loading && (
          <div className="flex h-64 items-center justify-center">
            <span className="spinner spinner-dark" aria-hidden />
            <span className="ml-2 text-sm text-gray-400">PDF 불러오는 중…</span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          data-testid="pdf-canvas"
          className={loading || error ? "hidden" : "block"}
        />
      </div>

      {compact && toolbar}
    </div>
  );
}
