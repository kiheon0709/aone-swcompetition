/**
 * 학습노트·강의 요약 마크다운을 "개념 1개 = 카드 1장"으로 쪼갠다 (FIX 11).
 *
 * 생성 로직·프롬프트·DB 스키마는 건드리지 않는다 — 이미 만들어진 마크다운을
 * 표시용으로 파싱만 한다. 파싱에 실패하면 blocks를 비워 반환하고,
 * 호출부는 기존 통짜 렌더로 폴백한다.
 *
 * 노트 마크다운의 실제 형태(실측):
 *   # 데이터통신 학습노트 — 5주차까지
 *   > ⚠️ **시험 대비 경고**: …            ← 카드 아님(머리말)
 *   ---
 *   ## 1. 아날로그-디지털 변환 ⚠️          ← 카드 시작
 *   **정의 요약:** …                      ← 정의 박스
 *   **교수님 설명:**
 *   > "…" — (1주차 강의 14:58)            ← 인용 + 출처 칩
 */

/** 카드 안의 인용 한 줄 — 본문과 출처를 분리해 칩으로 보여준다 */
export interface NoteQuote {
  /** 따옴표 안 발화 원문 */
  text: string;
  /** "1주차 강의 14:58" · "1주차 2025-Q7" — 없으면 null */
  source: string | null;
}

/** 개념 1개 = 카드 1장 */
export interface NoteCard {
  /** 목차 앵커용 — 카드 순번 기반(중복 제목이 있어도 충돌하지 않는다) */
  id: string;
  /** "아날로그-디지털 변환" (번호·⚠️ 제거) */
  title: string;
  /** 제목에 ⚠️가 붙어 있었는가 — 시험 신호 표시 */
  flagged: boolean;
  /** **정의 요약:** 뒤의 한 문단 */
  definition: string | null;
  /** 정의·인용을 뺀 나머지 본문 문단 */
  body: string[];
  /** 인용 블록 */
  quotes: NoteQuote[];
}

export interface ParsedNote {
  /** 첫 h1 제목 — 없으면 null */
  title: string | null;
  /** 카드 앞의 머리말(시험 대비 경고 등) 원문 마크다운 */
  intro: string | null;
  cards: NoteCard[];
}

/** "…" — (1주차 강의 14:58) → { text, source } */
function parseQuoteLine(raw: string): NoteQuote | null {
  // 인용 기호와 앞뒤 공백 제거
  const line = raw.replace(/^>\s?/, "").trim();
  if (!line) return null;
  // — (출처) 형태를 뒤에서 떼어낸다. em dash·hyphen 모두 허용.
  const m = line.match(/^(.*?)\s*[—–-]\s*\(([^)]+)\)\s*$/);
  const text = (m ? m[1] : line).trim().replace(/^"|"$/g, "").replace(/^"|"$/g, "");
  if (!text) return null;
  return { text, source: m ? m[2].trim() : null };
}

/**
 * 마크다운을 카드 배열로 변환한다.
 * `## ` 헤딩을 카드 경계로 삼는다. 헤딩이 하나도 없으면 cards를 비워 반환한다.
 */
export function parseNoteCards(markdown: string): ParsedNote {
  const empty: ParsedNote = { title: null, intro: null, cards: [] };
  if (!markdown || !markdown.trim()) return empty;

  const lines = markdown.split("\n");
  let title: string | null = null;
  const introLines: string[] = [];
  // [헤딩줄, 본문…] 묶음
  const sections: { heading: string; lines: string[] }[] = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      current = { heading: h2[1].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) {
      current.lines.push(line);
      continue;
    }
    const h1 = line.match(/^#\s+(.*)$/);
    if (h1 && title === null) {
      title = h1[1].trim();
      continue;
    }
    introLines.push(line);
  }

  if (sections.length === 0) return { ...empty, title };

  const cards: NoteCard[] = sections.map((sec, i) => {
    // 제목에서 "1. " 번호와 ⚠️를 떼어낸다
    const flagged = /⚠️/.test(sec.heading);
    const heading = sec.heading.replace(/⚠️/g, "").replace(/^\d+\.\s*/, "").trim();

    let definition: string | null = null;
    const body: string[] = [];
    const quotes: NoteQuote[] = [];

    // 문단 단위로 훑는다 (빈 줄이 구분자).
    // 인용 블록은 ">" 하나만 있는 줄로 항목이 나뉘므로 그 줄은 건너뛴다.
    let buf: string[] = [];
    const flush = () => {
      const para = buf.join("\n").trim();
      buf = [];
      if (!para) return;
      // "**교수님 설명:**" 라벨이 빈 줄 없이 인용 블록 위에 붙어 오므로 먼저 떼어낸다.
      const stripped = para.replace(/^\*\*[^*\n]+:?\*\*\s*\n/, "");
      if (stripped.startsWith(">")) {
        for (const l of stripped.split("\n")) {
          if (l.replace(/^>\s*/, "").trim() === "") continue; // ">" 단독 구분줄
          const q = parseQuoteLine(l);
          if (q) quotes.push(q);
        }
        return;
      }
      const def = para.match(/^\*\*정의 요약:?\*\*\s*([\s\S]*)$/);
      if (def && definition === null) {
        definition = def[1].trim();
        return;
      }
      // "**교수님 설명:**" 같은 라벨 단독 줄은 버린다 (인용이 뒤따르므로)
      if (/^\*\*[^*]+:?\*\*$/.test(para)) return;
      // 구분선 제거
      if (/^-{3,}$/.test(para)) return;
      body.push(para);
    };

    for (const l of sec.lines) {
      if (l.trim() === "") {
        flush();
        continue;
      }
      buf.push(l);
    }
    flush();

    return {
      id: `note-card-${i + 1}`,
      title: heading,
      flagged,
      definition,
      body,
      quotes,
    };
  });

  const intro = introLines.join("\n").trim() || null;
  return { title, intro, cards };
}
