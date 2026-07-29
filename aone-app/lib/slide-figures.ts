/**
 * 슬라이드 PDF 페이지에서 "그림 영역만" 잘라낸다 (FIX 12).
 *
 * 페이지 전체를 붙이면 제목·글머리표·푸터가 함께 들어와 노트 본문과 중복되므로,
 * operator list의 이미지 XObject bbox만 크롭한다.
 *
 * 추출 우선순위 (지시서 §추출 방식):
 *   1) paintImageXObject / paintJpegXObject 의 transform 행렬로 페이지 좌표 bbox 산출 → 크롭
 *   2) 실패 시 아무것도 반환하지 않는다 (페이지 전체로 대체하지 않는다)
 *
 * 새 라이브러리를 쓰지 않고 기존 pdfjs-dist 경로만 재사용한다.
 */

export interface SlideFigure {
  /** 크롭 이미지 (dataURL) */
  dataUrl: string;
  /** 페이지 번호 (1-base) */
  page: number;
  /** 페이지 좌표계 bbox — 디버그 표시용 */
  rect: { x: number; y: number; w: number; h: number };
  /** 크롭 픽셀 크기 */
  width: number;
  height: number;
}

/** 너무 작은 조각(아이콘·불릿)과 페이지 전체에 가까운 것은 그림으로 보지 않는다 */
const MIN_SIDE_RATIO = 0.12; // 페이지 짧은 변의 12% 미만이면 버림
const MAX_AREA_RATIO = 0.92; // 페이지 면적의 92% 이상이면 배경으로 보고 버림
const PAD = 4; // 크롭 여백(px)

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsPromise: Promise<PdfjsModule> | null = null;
async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
      m.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return m;
    });
  }
  return pdfjsPromise;
}

/**
 * 한 페이지에서 이미지 XObject들의 bbox를 구한다.
 * operator list를 훑으며 transform 스택을 따라가고, paintImage* 시점의 CTM을 bbox로 쓴다.
 */
async function figureRectsOfPage(
  pdfjs: PdfjsModule,
  page: Awaited<ReturnType<PDFDocumentProxyLike["getPage"]>>,
): Promise<{ x: number; y: number; w: number; h: number }[]> {
  const OPS = pdfjs.OPS;
  const ops = await page.getOperatorList();
  const view = page.view; // [x0, y0, x1, y1]
  const pw = view[2] - view[0];
  const ph = view[3] - view[1];

  // 단위 정사각형 → 페이지 좌표 변환 행렬을 추적한다.
  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const mul = (a: number[], b: number[]): number[] => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];

  const rects: { x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS.save) {
      stack.push(ctm.slice());
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    } else if (fn === OPS.transform) {
      ctm = mul(ctm, ops.argsArray[i] as number[]);
    } else if (
      // 이 pdfjs 버전은 JPEG도 paintImageXObject로 들어온다 (paintJpegXObject 없음)
      fn === OPS.paintImageXObject ||
      fn === OPS.paintImageXObjectRepeat ||
      fn === OPS.paintInlineImageXObject
    ) {
      // 이미지는 단위 정사각형에 그려지고 CTM이 배치를 결정한다.
      const [a, b, c, d, e, f] = ctm;
      const xs = [e, a + e, c + e, a + c + e];
      const ys = [f, b + f, d + f, b + d + f];
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      const w = x1 - x0;
      const h = y1 - y0;
      if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) continue;
      const shortSide = Math.min(pw, ph);
      if (Math.min(w, h) < shortSide * MIN_SIDE_RATIO) continue;
      if ((w * h) / (pw * ph) > MAX_AREA_RATIO) continue;
      rects.push({ x: x0, y: y0, w, h });
    }
  }

  // 겹치는 조각(같은 도해를 여러 이미지로 쪼갠 경우)은 하나로 합친다.
  return mergeOverlapping(rects);
}

/** 서로 겹치거나 맞닿은 사각형을 합친다 — 한 도해가 여러 XObject로 쪼개진 경우 대응 */
function mergeOverlapping(
  rects: { x: number; y: number; w: number; h: number }[],
): { x: number; y: number; w: number; h: number }[] {
  const out = rects.slice();
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        const overlapX = a.x < b.x + b.w + 8 && b.x < a.x + a.w + 8;
        const overlapY = a.y < b.y + b.h + 8 && b.y < a.y + a.h + 8;
        if (!overlapX || !overlapY) continue;
        const x0 = Math.min(a.x, b.x);
        const y0 = Math.min(a.y, b.y);
        const x1 = Math.max(a.x + a.w, b.x + b.w);
        const y1 = Math.max(a.y + a.h, b.y + b.h);
        out.splice(j, 1);
        out[i] = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        changed = true;
        break outer;
      }
    }
  }
  return out;
}

interface PDFDocumentProxyLike {
  numPages: number;
  getPage(n: number): Promise<{
    view: number[];
    getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
    getViewport(o: { scale: number }): {
      width: number;
      height: number;
      scale: number;
    };
    render(o: {
      canvas: HTMLCanvasElement;
      viewport: unknown;
    }): { promise: Promise<void> };
  }>;
}

/**
 * PDF 한 편에서 그림을 추출한다.
 * @param url    PDF URL
 * @param pages  추출할 페이지(1-base). 비우면 전 페이지.
 * @param scale  렌더 배율 (크롭 해상도)
 */
export async function extractFigures(
  url: string,
  pages?: number[],
  scale = 1.5,
): Promise<SlideFigure[]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ url });
  const doc = (await task.promise) as unknown as PDFDocumentProxyLike;
  const out: SlideFigure[] = [];
  try {
    const targets =
      pages && pages.length > 0
        ? pages.filter((p) => p >= 1 && p <= doc.numPages)
        : Array.from({ length: doc.numPages }, (_, i) => i + 1);

    for (const pageNo of targets) {
      const page = await doc.getPage(pageNo);
      const rects = await figureRectsOfPage(pdfjs, page);
      if (rects.length === 0) continue;

      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      // pdfjs v6는 오프스크린(미부착) 캔버스에 렌더하면 완료되지 않는다.
      // 화면 밖에 붙여 두고 렌더한 뒤 제거한다.
      canvas.style.cssText =
        "position:fixed;left:-99999px;top:0;pointer-events:none;";
      document.body.appendChild(canvas);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        canvas.remove();
        continue;
      }
      // pdfjs v6: canvas를 넘기는 것이 권장 경로다.
      // 렌더가 걸리면 그 페이지만 건너뛰고 계속 진행한다(전체가 멈추지 않게).
      try {
        await Promise.race([
          page.render({ canvas, viewport }).promise,
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("render timeout")), 15000),
          ),
        ]);
      } catch (e) {
        console.warn("[figures] render skip page", pageNo, e);
        canvas.remove();
        continue;
      }

      // 페이지 좌표(y는 아래가 0) → 캔버스 좌표(y는 위가 0)
      const view = page.view;
      for (const r of rects) {
        const cx = (r.x - view[0]) * scale;
        const cy = (view[3] - (r.y + r.h)) * scale;
        const cw = r.w * scale;
        const ch = r.h * scale;
        const sx = Math.max(0, Math.floor(cx - PAD));
        const sy = Math.max(0, Math.floor(cy - PAD));
        const sw = Math.min(canvas.width - sx, Math.ceil(cw + PAD * 2));
        const sh = Math.min(canvas.height - sy, Math.ceil(ch + PAD * 2));
        if (sw <= 0 || sh <= 0) continue;

        const crop = document.createElement("canvas");
        crop.width = sw;
        crop.height = sh;
        const cctx = crop.getContext("2d");
        if (!cctx) continue;
        cctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        out.push({
          dataUrl: crop.toDataURL("image/png"),
          page: pageNo,
          rect: r,
          width: sw,
          height: sh,
        });
      }
      canvas.remove();
    }
  } finally {
    // 이 pdfjs 버전은 loadingTask.destroy가 문서를 파기한다 (PdfViewer.tsx와 동일)
    void task.destroy();
  }
  return out;
}
