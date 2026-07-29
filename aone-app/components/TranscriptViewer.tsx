"use client";

/**
 * 전사본 뷰어 (FIX 14) — 파일 목록이 아니라 본문을 타임스탬프 블록으로 보여준다.
 *
 * - 각 블록에 앵커 id를 달아 개념 카드의 "근거 · 1주차 03:38"에서 이동해 온다
 * - 교수 강조로 판정된 발화는 배경 톤으로 구분한다 (아이콘 없음)
 * - 전사본이 길어(운체 7주차 1,198줄) content-visibility로 화면 밖 렌더를 미룬다
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseTranscript,
  type TranscriptBlock,
} from "@/lib/transcript";

export interface TranscriptHighlight {
  /** 블록 앵커 id ("t-02:21" · "l-75") */
  anchor: string;
  /** 그 블록 안에서 강조할 발화 원문 */
  quote: string;
  /** emphasis(교수 강조) 인지 examHint(시험 언급) 인지 */
  kind: "emphasis" | "exam";
}

/** 인용문이 들어간 자리만 배경을 입힌다 — 문자열 매칭(원문 저장이라 가능) */
function markQuote(text: string, quotes: string[]): React.ReactNode {
  // 유효한 인용만 남긴다 — 빈 문자열이 섞이면 indexOf가 항상 0을 반환해 무한 재귀가 된다
  const valid = quotes.filter((q) => q && q.length >= 4);
  if (valid.length === 0) return text;
  // 가장 긴 인용부터 찾아 부분 겹침을 줄인다
  const sorted = [...valid].sort((a, b) => b.length - a.length);
  for (const q of sorted) {
    const at = text.indexOf(q);
    if (at === -1) continue;
    return (
      <>
        {text.slice(0, at)}
        <mark className="rounded bg-amber-200/70 px-0.5 text-gray-900">
          {q}
        </mark>
        {markQuote(text.slice(at + q.length), sorted.filter((x) => x !== q))}
      </>
    );
  }
  return text;
}

function Block({
  block,
  highlights,
  focused,
  unitName,
}: {
  block: TranscriptBlock;
  highlights: TranscriptHighlight[];
  focused: boolean;
  unitName: string;
}) {
  const emphasized = highlights.some((h) => h.kind === "emphasis");
  const quotes = highlights.map((h) => h.quote).filter(Boolean);

  return (
    <div
      id={block.id}
      data-testid="transcript-block"
      data-focused={focused ? "1" : undefined}
      className={`scroll-mt-24 rounded-xl px-4 py-3 transition-colors duration-500 ${
        focused
          ? "bg-primary/[0.10] ring-2 ring-primary/40"
          : emphasized
            ? "bg-amber-50/80"
            : ""
      }`}
      style={{ contentVisibility: "auto", containIntrinsicSize: "0 88px" }}
    >
      <div className="mb-1 flex items-center gap-2">
        {block.time ? (
          <>
            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-primary">
              {block.time}
            </span>
            {block.speaker && (
              <span className="text-[11px] text-gray-400">{block.speaker}</span>
            )}
          </>
        ) : (
          /* C형 — 시각이 없다. 가짜 시각을 만들지 않고 발화 순번으로 표기 */
          <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
            {unitName} · {block.lineNo}번째 발화
          </span>
        )}
        {emphasized && (
          <span className="text-[11px] font-medium text-amber-600">
            교수님 강조
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-gray-700">
        {markQuote(block.text, quotes)}
      </p>
    </div>
  );
}

export default function TranscriptViewer({
  text,
  unitName,
  highlights,
  focusAnchor,
  onFocusHandled,
}: {
  /** transcript.txt 원문 */
  text: string;
  /** "1주차" — C형 블록 표기에 쓴다 */
  unitName: string;
  /** 이 전사본에 붙은 강조·시험언급 발화 */
  highlights: TranscriptHighlight[];
  /** 근거 클릭으로 넘어온 앵커 — 도착하면 스크롤 + 강조 */
  focusAnchor?: string | null;
  onFocusHandled?: () => void;
}) {
  const parsed = useMemo(() => parseTranscript(text), [text]);
  const [focused, setFocused] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  /**
   * 앵커 → 블록 id.
   * 시각 앵커("t-02:21")는 블록 id와 같고, 줄 앵커("l-75")는 lineRange로 찾는다.
   */
  const resolveAnchor = useMemo(() => {
    const byId = new Set(parsed?.blocks.map((b) => b.id) ?? []);
    return (anchor: string): string | null => {
      if (!parsed) return null;
      if (byId.has(anchor)) return anchor;
      const line = anchor.match(/^l-(\d+)$/);
      if (!line) return null;
      const n = Number(line[1]);
      const b = parsed.blocks.find(
        (x) => n >= x.lineRange[0] && n <= x.lineRange[1],
      );
      return b?.id ?? null;
    };
  }, [parsed]);

  /** 블록 id → 그 블록에 속한 하이라이트 */
  const byAnchor = useMemo(() => {
    const m = new Map<string, TranscriptHighlight[]>();
    for (const h of highlights) {
      const id = resolveAnchor(h.anchor);
      if (!id) continue;
      const cur = m.get(id);
      if (cur) cur.push(h);
      else m.set(id, [h]);
    }
    return m;
  }, [resolveAnchor, highlights]);

  /** 근거에서 넘어온 앵커가 실제로 어느 블록인지 */
  const targetId = useMemo(
    () => (focusAnchor ? resolveAnchor(focusAnchor) : null),
    [resolveAnchor, focusAnchor],
  );

  useEffect(() => {
    if (!targetId) return;
    setFocused(targetId);
    // content-visibility 때문에 레이아웃이 잡힌 뒤 스크롤해야 정확하다
    const t = window.setTimeout(() => {
      rootRef.current
        ?.querySelector(`#${CSS.escape(targetId)}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      onFocusHandled?.();
    }, 120);
    return () => window.clearTimeout(t);
  }, [targetId, onFocusHandled]);

  if (!parsed) {
    return (
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
        {text}
      </p>
    );
  }

  return (
    <div ref={rootRef} data-testid="transcript-viewer">
      {parsed.intro && (
        <p className="mb-4 whitespace-pre-wrap border-b border-black/5 pb-4 text-xs leading-relaxed text-gray-400">
          {parsed.intro}
        </p>
      )}
      <div className="space-y-1">
        {parsed.blocks.map((b) => (
          <Block
            key={b.id}
            block={b}
            unitName={unitName}
            highlights={byAnchor.get(b.id) ?? []}
            focused={focused === b.id}
          />
        ))}
      </div>
    </div>
  );
}
