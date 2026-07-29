"use client";

/**
 * 학습노트·강의 요약을 "개념 1개 = 카드 1장"으로 보여준다 (FIX 11).
 * 색·간격은 시험 대비 > 학습 가이드 화면의 카드 스타일을 기준으로 맞췄다.
 *
 * 표시만 담당한다 — 마크다운 원문을 수정하거나 재생성하지 않는다.
 * 파싱에 실패해 카드가 0개면 렌더하지 않고, 호출부가 기존 통짜 뷰로 폴백한다.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, List } from "lucide-react";
import { parseNoteCards, type NoteCard } from "@/lib/note-cards";

/** 출처 칩 — "1주차 강의 03:38" / "1주차 2025-Q2" */
function SourceChip({ source }: { source: string }) {
  const isExam = /\d{4}-Q\d+/.test(source);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        isExam
          ? "bg-amber-500/10 text-amber-700"
          : "bg-primary/10 text-primary"
      }`}
    >
      {source}
    </span>
  );
}

function Card({ card }: { card: NoteCard }) {
  return (
    <article
      id={card.id}
      data-testid="note-card"
      className="glass-card scroll-mt-24 rounded-2xl px-6 py-5"
    >
      {/* ① 개념명 — 카드 헤더 */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-bold tracking-tight text-gray-900">
          {card.title}
        </h3>
        {card.flagged && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-600">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            시험 신호
          </span>
        )}
      </div>

      {/* ② 한 줄 정의 — 강조 배경 박스 */}
      {card.definition && (
        <p className="mt-3 rounded-xl border border-primary/15 bg-primary/[0.05] px-4 py-3 text-[13.5px] leading-relaxed text-gray-800">
          {card.definition}
        </p>
      )}

      {/* ③ 설명·비유 본문 */}
      {card.body.map((p, i) => (
        <p
          key={i}
          className="mt-3 text-[13.5px] leading-relaxed text-gray-700"
        >
          {p}
        </p>
      ))}

      {/* ④ 교수 인용 — 좌측 세로선 + 출처 칩 */}
      {card.quotes.length > 0 && (
        <ul className="mt-4 space-y-2.5">
          {card.quotes.map((q, i) => (
            <li
              key={i}
              className="border-l-2 border-primary/25 pl-3.5 text-[13px] leading-relaxed text-gray-600"
            >
              <span>&ldquo;{q.text}&rdquo;</span>
              {q.source && (
                <span className="ml-2 inline-block align-middle">
                  <SourceChip source={q.source} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export default function NoteCards({ markdown }: { markdown: string }) {
  const parsed = useMemo(() => parseNoteCards(markdown), [markdown]);
  const [tocOpen, setTocOpen] = useState(false);

  if (parsed.cards.length === 0) return null;

  return (
    <div data-testid="note-cards">
      {/* 목차 — 클릭하면 해당 카드로 스크롤 */}
      <div className="glass-card mb-4 rounded-2xl px-5 py-4">
        <button
          onClick={() => setTocOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          <List className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="text-sm font-semibold text-gray-900">
            개념 {parsed.cards.length}개
          </span>
          <span className="ml-auto text-xs font-medium text-gray-400">
            {tocOpen ? "목차 접기 ↑" : "목차 펼치기 ↓"}
          </span>
        </button>
        {tocOpen && (
          <nav className="mt-3 flex flex-wrap gap-1.5 border-t border-black/[0.06] pt-3">
            {parsed.cards.map((c, i) => (
              <a
                key={c.id}
                href={`#${c.id}`}
                className="press-scale rounded-full border border-black/[0.06] bg-white/80 px-3 py-1 text-xs text-gray-700 transition-colors duration-200 hover:border-primary/40 hover:text-primary"
              >
                <span className="mr-1 text-gray-400">{i + 1}</span>
                {c.title}
              </a>
            ))}
          </nav>
        )}
      </div>

      {/* 카드 목록 — 본문 폭 제한(한 줄 45~75자) */}
      <div className="mx-auto w-full max-w-[720px] space-y-3">
        {parsed.cards.map((c) => (
          <Card key={c.id} card={c} />
        ))}
      </div>
    </div>
  );
}
