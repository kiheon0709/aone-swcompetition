"use client";

import { useMemo } from "react";
import {
  LECTURE_COLOR_CLASSES,
  WEEKDAYS,
  type Lecture,
  type Weekday,
} from "./homeData";

const timeToMinutes = (t: string): number => {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const pctOf = (minutes: number, startMin: number, totalMin: number): number =>
  ((minutes - startMin) / totalMin) * 100;

const addDays = (date: Date, n: number): Date => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

const DOW_TO_WEEKDAY: Record<number, Weekday | undefined> = {
  1: "월",
  2: "화",
  3: "수",
  4: "목",
  5: "금",
};

/** 주간 시간표 그리드 — 월~금, 09시~18시 (19시 등 더 늦게 끝나는 강의가 있으면 확장).
 *  30분 단위 시간도 분 기준 비율 배치로 그대로 수용한다.
 *  높이는 부모 flex 컨테이너를 채우며 셀 높이가 자동 축소된다. */
export default function TimetableGrid({ lectures }: { lectures: Lecture[] }) {
  const now = useMemo(() => new Date(), []);

  const startHour = 9;
  const endHour = useMemo(
    () =>
      lectures.reduce(
        (acc, l) => Math.max(acc, Math.ceil(timeToMinutes(l.end) / 60)),
        18
      ),
    [lectures]
  );

  const startMin = startHour * 60;
  const endMin = endHour * 60;
  const totalMin = endMin - startMin;
  const hours = Array.from(
    { length: endHour - startHour + 1 },
    (_, i) => startHour + i
  );

  const todayDow = now.getDay();
  const monday = addDays(now, 1 - (todayDow === 0 ? 7 : todayDow));
  const weekDates = WEEKDAYS.map((_, i) => addDays(monday, i));
  const todayWeekday = DOW_TO_WEEKDAY[todayDow];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showNowLine =
    Boolean(todayWeekday) && nowMin >= startMin && nowMin < endMin;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 요일 헤더 */}
      <div className="ml-9 flex border-b border-black/[0.06] pb-2">
        {WEEKDAYS.map((day, i) => {
          const date = weekDates[i];
          const isToday = todayWeekday === day;
          return (
            <div key={day} className="flex-1 text-center">
              <p
                className={
                  isToday
                    ? "text-xs font-bold text-primary"
                    : "text-xs font-semibold text-gray-500"
                }
              >
                {day}
              </p>
              <p
                className={`text-[10px] tabular-nums ${
                  isToday ? "font-semibold text-primary/80" : "text-gray-300"
                }`}
              >
                {date.getMonth() + 1}/{date.getDate()}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 pb-1 pt-1.5">
        {/* 시간 라벨 */}
        <div className="relative w-9 shrink-0">
          {hours.map((h) => (
            <div
              key={h}
              className="absolute right-2.5 -translate-y-1/2"
              style={{ top: `${pctOf(h * 60, startMin, totalMin)}%` }}
            >
              <span className="text-[10px] leading-none tabular-nums text-gray-300">
                {h}
              </span>
            </div>
          ))}
        </div>

        {/* 요일 컬럼 */}
        <div className="relative flex flex-1">
          {WEEKDAYS.map((day) => {
            const isToday = todayWeekday === day;
            const colLectures = lectures.filter((l) => l.weekday === day);
            return (
              <div
                key={day}
                className={`relative h-full flex-1 border-l border-black/[0.05] ${
                  isToday ? "bg-primary/[0.03]" : ""
                }`}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-black/[0.05]"
                    style={{ top: `${pctOf(h * 60, startMin, totalMin)}%` }}
                  />
                ))}

                {colLectures.map((lec) => {
                  const topMin = timeToMinutes(lec.start);
                  const botMin = timeToMinutes(lec.end);
                  // 알 수 없는 색(구버전·손상 데이터)이 와도 크래시하지 않도록 blue로 폴백
                  const color = LECTURE_COLOR_CLASSES[lec.color] ?? LECTURE_COLOR_CLASSES.blue;
                  return (
                    <div
                      key={lec.id}
                      className={`absolute left-0.5 right-0.5 overflow-hidden rounded-lg border px-1.5 pt-1 ${color.block}`}
                      style={{
                        top: `${pctOf(topMin, startMin, totalMin)}%`,
                        height: `${((botMin - topMin) / totalMin) * 100}%`,
                      }}
                      title={`${lec.subject} ${lec.start}~${lec.end} · ${lec.room}`}
                    >
                      <span
                        className={`block truncate text-[11px] font-semibold leading-tight ${color.title}`}
                      >
                        {lec.subject}
                      </span>
                      <span
                        className={`mt-0.5 block truncate text-[9.5px] leading-tight ${color.sub}`}
                      >
                        {lec.room}
                      </span>
                    </div>
                  );
                })}

                {isToday && showNowLine && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-10"
                    style={{ top: `${pctOf(nowMin, startMin, totalMin)}%` }}
                  >
                    <div className="relative flex items-center">
                      <span className="absolute -left-1 -top-[3.5px] h-1.5 w-1.5 rounded-full bg-primary" />
                      <div className="h-px w-full bg-primary" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
