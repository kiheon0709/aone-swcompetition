"use client";

import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Images,
  Info,
  ScrollText,
  ThumbsUp,
  X,
} from "lucide-react";

/** past_exams.json 스키마 */
interface PastExam {
  year: number;
  id: string;
  semester: string;
  source: string;
  likes: number;
  strategy_ko: string;
  question_type: string;
  example_questions: string[];
}

interface PastExamsDoc {
  source: string;
  note: string;
  exams: PastExam[];
}

/** 이미지 족보 — public/exams/ */
interface ExamImage {
  src: string;
  label: string;
}

const EXAM_IMAGES: ExamImage[] = [
  { src: "/exams/exam-2018-1.png", label: "2018 중간 · 문제지" },
  { src: "/exams/exam-2012-1.jpg", label: "2012 중간 · 문제지" },
];

/**
 * 문제 문장에서 관련 개념 태그 추출.
 * 스냅샷 개념 목록과 문자열 매칭 — 없으면 빈 배열(태그 미표시).
 */
const conceptTagsOf = (question: string, concepts: string[]): string[] =>
  concepts.filter((c) => c.length >= 2 && question.includes(c)).slice(0, 3);

interface ExamViewerProps {
  /** 원문 JSON 문자열 (page.tsx가 이미 fetch해 둔 것) */
  raw: string | null;
  /** 스냅샷 개념명 — 문항 태그 매칭용 */
  concepts: string[];
}

/**
 * 기출 뷰어 — 연도별 카드 + 이미지 갤러리.
 * 원시 JSON은 절대 노출하지 않는다. 파싱 실패 시 안내 문구만 보여준다.
 */
export default function ExamViewer({ raw, concepts }: ExamViewerProps) {
  const [lightbox, setLightbox] = useState<number | null>(null);

  // 라이트박스: ←/→/Esc
  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight")
        setLightbox((i) => ((i ?? 0) + 1) % EXAM_IMAGES.length);
      if (e.key === "ArrowLeft")
        setLightbox((i) =>
          ((i ?? 0) - 1 + EXAM_IMAGES.length) % EXAM_IMAGES.length
        );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  let doc: PastExamsDoc | null = null;
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as PastExamsDoc;
      if (Array.isArray(parsed.exams)) doc = parsed;
    } catch {
      doc = null;
    }
  }

  // 연도 내림차순 (최신 기출 먼저)
  const exams = doc ? [...doc.exams].sort((a, b) => b.year - a.year) : [];

  return (
    <div className="space-y-8" data-testid="exam-viewer">
      {/* 출처 안내 */}
      {doc?.note && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-300/50 bg-amber-50/70 px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-amber-900">{doc.source}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
              {doc.note}
            </p>
          </div>
        </div>
      )}

      {/* 연도별 기출 카드 */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight text-gray-900">
          <ScrollText className="h-4 w-4 text-primary" aria-hidden />
          연도별 기출 · {exams.length}건
        </h3>

        {raw === null ? (
          <p className="text-sm text-gray-400">기출 자료 불러오는 중…</p>
        ) : exams.length === 0 ? (
          <p className="text-sm text-gray-400">
            정리된 기출 문항이 없습니다.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {exams.map((e) => (
              <article
                key={e.id}
                className="glass-card rounded-2xl p-5"
                data-testid="exam-year-card"
              >
                <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <h4 className="text-base font-bold tracking-tight text-gray-900">
                      {e.year}년 중간
                    </h4>
                    <span className="text-xs font-medium text-gray-400">
                      {e.semester} · 문항 {e.example_questions.length}개
                    </span>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-black/[0.04] px-2.5 py-1 text-[11px] font-semibold text-gray-500">
                    <ThumbsUp className="h-3 w-3" aria-hidden />
                    {e.likes}
                  </span>
                </header>

                <p className="mb-3 rounded-xl bg-primary/[0.05] px-3 py-2 text-xs leading-relaxed text-gray-600">
                  <span className="font-semibold text-primary">출제 경향 · </span>
                  {e.strategy_ko}
                </p>

                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  {e.question_type}
                </p>

                <ul className="space-y-2">
                  {e.example_questions.map((q, i) => {
                    const tags = conceptTagsOf(q, concepts);
                    return (
                      <li
                        key={i}
                        className="rounded-xl border border-black/[0.05] bg-white/60 px-3 py-2.5"
                      >
                        <p className="flex gap-2 text-[13px] leading-relaxed text-gray-700">
                          <span
                            className="shrink-0 font-mono text-[11px] font-semibold text-primary/70"
                            aria-hidden
                          >
                            Q{i + 1}
                          </span>
                          <span className="min-w-0">{q}</span>
                        </p>
                        {tags.length > 0 && (
                          <p className="mt-1.5 flex flex-wrap gap-1.5 pl-6">
                            {tags.map((t) => (
                              <span
                                key={t}
                                className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"
                              >
                                {t}
                              </span>
                            ))}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 이미지 족보 갤러리 */}
      <section data-testid="exam-gallery">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold tracking-tight text-gray-900">
          <Images className="h-4 w-4 text-primary" aria-hidden />
          2012~2018 기출 (이미지)
        </h3>
        <p className="mb-3 text-xs text-gray-400">
          스캔·촬영한 족보 이미지도 그대로 올려두면 함께 보관됩니다 · 이미지{" "}
          {EXAM_IMAGES.length}장
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {EXAM_IMAGES.map((img, i) => (
            <button
              key={img.src}
              onClick={() => setLightbox(i)}
              title={img.label}
              data-testid={`exam-thumb-${i}`}
              className="press-scale group overflow-hidden rounded-xl border border-black/[0.08] bg-white text-left shadow-sm transition-colors duration-200 hover:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.src}
                alt={img.label}
                loading="lazy"
                className="h-32 w-full object-cover object-top"
              />
              <span className="block truncate px-2 py-1.5 text-[11px] font-medium text-gray-500 group-hover:text-gray-900">
                {img.label}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* 라이트박스 — 확대 + 좌우 이동 */}
      {lightbox !== null && (
        <div
          className="fixed inset-0 z-[70] flex flex-col bg-black/85 backdrop-blur-sm"
          data-testid="exam-lightbox"
          onClick={() => setLightbox(null)}
        >
          <div className="flex shrink-0 items-center justify-between px-6 py-4">
            <p className="text-sm font-semibold text-white">
              {EXAM_IMAGES[lightbox].label}
              <span className="ml-2 font-normal text-white/50">
                {lightbox + 1} / {EXAM_IMAGES.length}
              </span>
            </p>
            <button
              onClick={() => setLightbox(null)}
              aria-label="닫기"
              className="rounded-lg p-1.5 text-white/70 transition-colors duration-200 hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <div
            className="flex min-h-0 flex-1 items-center gap-3 px-4 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() =>
                setLightbox(
                  (i) => ((i ?? 0) - 1 + EXAM_IMAGES.length) % EXAM_IMAGES.length
                )
              }
              aria-label="이전 이미지"
              className="shrink-0 rounded-full bg-white/10 p-2.5 text-white transition-colors duration-200 hover:bg-white/20"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden />
            </button>

            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={EXAM_IMAGES[lightbox].src}
                alt={EXAM_IMAGES[lightbox].label}
                className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
              />
            </div>

            <button
              onClick={() =>
                setLightbox((i) => ((i ?? 0) + 1) % EXAM_IMAGES.length)
              }
              aria-label="다음 이미지"
              className="shrink-0 rounded-full bg-white/10 p-2.5 text-white transition-colors duration-200 hover:bg-white/20"
            >
              <ChevronRight className="h-6 w-6" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
