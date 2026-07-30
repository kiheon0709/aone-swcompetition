"use client";

/**
 * FIX 12 디버그 페이지 — 슬라이드에서 잘라낸 "그림"만 한 화면에 나열한다.
 * 잘림·오검출을 눈으로 확인하기 위한 임시 화면이며, 학습 카드에는 아직 연결하지 않는다.
 *
 * 확인 대상: 데이터통신 3주차 PDF 3개 (practice_01 / theory_01 / theory_02)
 *
 * ── 라우트가 아니다 (2단계) ──
 * `app/_debug/`는 밑줄로 시작하므로 Next App Router가 라우트로 잡지 않는다.
 * 그래서 `next build`가 이 화면을 export하지 않고, 배포 산출물에도 들어가지 않는다.
 * FIX 12를 이어서 할 때는 이 파일을 `app/debug/figures/page.tsx`로 되돌리면
 * `/debug/figures`로 다시 열린다. 추출 로직(`lib/slide-figures.ts`)은 그대로 둔다.
 */

import { useEffect, useState } from "react";
import { extractFigures, type SlideFigure } from "@/lib/slide-figures";

const DOCS = [
  { slug: "practice_01", label: "(실습) 20260317-실습3주차" },
  { slug: "theory_01", label: "(이론) 2-데이터통신-1비트만들기-사인함수" },
  { slug: "theory_02", label: "(이론) 3-데이터통신-1-아날로그-소리-변환" },
];
const UNIT = "데이터통신__3주차";

interface DocResult {
  slug: string;
  label: string;
  figures: SlideFigure[];
  error: string | null;
  ms: number;
}

export default function FiguresDebugPage() {
  const [results, setResults] = useState<DocResult[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const acc: DocResult[] = [];
      for (const d of DOCS) {
        const url = `/lecture-pdfs/${encodeURIComponent(UNIT)}/${d.slug}.pdf`;
        const t0 = performance.now();
        try {
          console.log("[figures] start", d.slug, url);
          // 디버그 화면은 앞 12쪽만 — 전 페이지는 렌더가 오래 걸린다
          const figures = await extractFigures(
            url,
            Array.from({ length: 12 }, (_, i) => i + 1),
          );
          console.log("[figures] done", d.slug, figures.length);
          if (cancelled) return;
          acc.push({
            ...d,
            figures,
            error: null,
            ms: Math.round(performance.now() - t0),
          });
        } catch (e) {
          console.error("[figures] error", d.slug, e);
          if (cancelled) return;
          acc.push({
            ...d,
            figures: [],
            error: e instanceof Error ? e.message : String(e),
            ms: Math.round(performance.now() - t0),
          });
        }
        setResults([...acc]);
      }
      if (!cancelled) setBusy(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const total = results.reduce((n, r) => n + r.figures.length, 0);

  return (
    <main className="mx-auto max-w-[1200px] p-8">
      <h1 className="text-2xl font-bold tracking-tight text-gray-900">
        FIX 12 · 그림 추출 디버그
      </h1>
      <p className="mt-1 text-sm text-gray-500">
        데이터통신 3주차 PDF 3개에서 이미지 XObject bbox만 크롭한 결과입니다.
        페이지 전체가 아니라 도해만 잡히는지, 잘리거나 엉뚱한 게 섞이지 않는지
        확인하세요.
      </p>
      <p className="mt-2 text-sm font-semibold text-gray-900">
        {busy ? "추출 중…" : "추출 완료"} · 총 {total}개
      </p>

      {results.map((r) => (
        <section key={r.slug} className="mt-10">
          <h2 className="text-base font-bold text-gray-900">
            {r.label}{" "}
            <span className="ml-2 text-xs font-medium text-gray-400">
              {r.slug}.pdf · 그림 {r.figures.length}개 · {r.ms}ms
            </span>
          </h2>
          {r.error && (
            <p className="mt-2 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">
              오류: {r.error}
            </p>
          )}
          <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {r.figures.map((f, i) => (
              <figure
                key={i}
                className="rounded-xl border border-black/10 bg-white p-2 shadow-sm"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={f.dataUrl}
                  alt={`p.${f.page} 그림 ${i + 1}`}
                  className="h-auto w-full rounded-lg border border-black/5"
                />
                <figcaption className="mt-2 text-[11px] leading-relaxed text-gray-500">
                  <span className="font-semibold text-gray-700">
                    p.{f.page}
                  </span>{" "}
                  · {f.width}×{f.height}px
                  <br />
                  bbox {Math.round(f.rect.x)},{Math.round(f.rect.y)}{" "}
                  {Math.round(f.rect.w)}×{Math.round(f.rect.h)}
                </figcaption>
              </figure>
            ))}
          </div>
          {!busy && r.figures.length === 0 && !r.error && (
            <p className="mt-2 text-sm text-gray-400">추출된 그림이 없습니다.</p>
          )}
        </section>
      ))}
    </main>
  );
}
