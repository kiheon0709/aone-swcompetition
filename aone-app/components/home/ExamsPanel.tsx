"use client";

import { useState } from "react";
import { GraduationCap, Plus, Trash2 } from "lucide-react";
import { dday, ddayLabel, formatDateK, type Exam } from "./homeData";

interface ExamsPanelProps {
  exams: Exam[];
  /** 과목 선택지 — 파일시스템 매니페스트(files.json)의 subjects */
  subjects: string[];
  onAdd: (exam: Omit<Exam, "id">) => void;
  onRemove: (id: string) => void;
}

/** 다가오는 시험 — D-day 배지, 임박순 정렬, 인라인 추가 폼 */
export default function ExamsPanel({
  exams,
  subjects,
  onAdd,
  onRemove,
}: ExamsPanelProps) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [date, setDate] = useState("");

  /** 아직 고르지 않았으면 매니페스트의 첫 과목 */
  const effectiveSubject = subject || subjects[0] || "";

  const sorted = [...exams].sort((a, b) => a.date.localeCompare(b.date));

  const submit = () => {
    if (!title.trim() || !date || !effectiveSubject) return;
    onAdd({ subject: effectiveSubject, title: title.trim(), date });
    setTitle("");
    setDate("");
    setAdding(false);
  };

  return (
    <section className="glass-card flex min-h-0 flex-1 flex-col rounded-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-gray-900">
          <GraduationCap className="h-4 w-4 text-primary" aria-hidden />
          다가오는 시험
          <span className="text-xs font-medium text-gray-400">
            {sorted.length}
          </span>
        </h2>
        <button
          onClick={() => setAdding((v) => !v)}
          className="press-scale flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary transition-colors duration-200 hover:bg-primary/10"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          추가
        </button>
      </div>

      {adding && (
        <div className="mb-3 space-y-2 rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="시험 이름 (예: 중간고사)"
            autoFocus
            className="w-full rounded-lg border border-black/[0.08] bg-white px-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:border-primary/60 focus:outline-none"
          />
          <div className="flex gap-2">
            {subjects.length > 0 ? (
              <select
                value={effectiveSubject}
                onChange={(e) => setSubject(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-black/[0.08] bg-white px-2 py-1.5 text-xs text-gray-900 focus:border-primary/60 focus:outline-none"
              >
                {subjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : (
              // 과목이 아직 없는 신규 사용자 — 과목명을 직접 입력해 시험을 만들 수 있게 한다
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="과목명 (예: 데이터통신)"
                className="min-w-0 flex-1 rounded-lg border border-black/[0.08] bg-white px-2 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:border-primary/60 focus:outline-none"
              />
            )}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-black/[0.08] bg-white px-2 py-1.5 text-xs text-gray-900 focus:border-primary/60 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <button
              onClick={() => setAdding(false)}
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors duration-200 hover:bg-black/[0.04]"
            >
              취소
            </button>
            <button
              onClick={submit}
              disabled={!title.trim() || !date || !effectiveSubject}
              className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-white transition-colors duration-200 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              추가
            </button>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="py-6 text-center text-xs text-gray-400">
          예정된 시험이 없어요
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {sorted.map((exam) => {
            const diff = dday(exam.date);
            return (
              <li
                key={exam.id}
                className="group flex items-center gap-3 border-b border-black/5 py-2.5 last:border-b-0"
              >
                <span
                  className={`w-14 shrink-0 rounded-lg py-1 text-center text-[11px] font-bold tabular-nums ${
                    diff < 0
                      ? "bg-black/[0.04] text-gray-400 line-through"
                      : diff <= 7
                        ? "bg-red-500/10 text-red-600"
                        : "bg-primary/10 text-primary"
                  }`}
                >
                  {ddayLabel(diff)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-gray-900">
                    {exam.subject} {exam.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    {formatDateK(exam.date)}
                  </p>
                </div>
                <button
                  onClick={() => onRemove(exam.id)}
                  className="shrink-0 rounded-lg p-1 text-gray-300 opacity-0 transition-all duration-200 hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 focus:outline-none focus-visible:opacity-100"
                  title="삭제"
                  aria-label={`${exam.subject} ${exam.title} 삭제`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
