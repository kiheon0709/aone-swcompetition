"use client";

/**
 * 파일타입 SVG 아이콘 세트 — 24px 커스텀 글리프 + 둥근 파스텔 타일.
 * 문서 화면 헤더·파일 카드 및 홈 주차 파일 카드 공용.
 */

export type FileIconType =
  | "pdf"
  | "ppt"
  | "doc"
  | "txt"
  | "audio"
  | "code"
  | "exam"
  | "folder"
  | "generic";

interface IconMeta {
  tile: string;
  color: string;
}

/** 타입별 고유 색 — 기존 파스텔·블루 팔레트(-500/10 타일 + -600 글리프)와 동일 톤 */
const ICON_META: Record<FileIconType, IconMeta> = {
  pdf: { tile: "bg-rose-500/10", color: "text-rose-600" },
  ppt: { tile: "bg-orange-500/10", color: "text-orange-600" },
  doc: { tile: "bg-blue-500/10", color: "text-blue-600" },
  txt: { tile: "bg-violet-500/10", color: "text-violet-600" },
  audio: { tile: "bg-pink-500/10", color: "text-pink-600" },
  code: { tile: "bg-emerald-500/10", color: "text-emerald-600" },
  exam: { tile: "bg-amber-500/10", color: "text-amber-600" },
  folder: { tile: "bg-sky-500/10", color: "text-sky-600" },
  generic: { tile: "bg-gray-500/10", color: "text-gray-500" },
};

/** 앱 파일 엔트리(type + 이름) → 아이콘 타입 */
export function fileIconTypeOf(fileType: string, name = ""): FileIconType {
  const lower = name.toLowerCase();
  if (/\.(m4a|mp3|wav|ogg|flac)$/.test(lower)) return "audio";
  if (/\.(json|py|c|cpp|js|ts|sh)$/.test(lower)) return "code";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".ppt") || lower.endsWith(".pptx")) return "ppt";
  switch (fileType) {
    case "transcript":
      return "txt";
    case "theory":
      return "pdf"; // 이론 강의 슬라이드 원본은 PDF
    case "practice":
      return "ppt"; // 실습 슬라이드는 pptx 기반
    case "past_exam":
      return "exam";
    case "report":
    case "doc":
      return "doc";
    case "folder":
      return "folder";
    default:
      return "generic";
  }
}

/** 파일 외곽(접힌 모서리) 공통 패스 */
const FileOutline = () => (
  <>
    <path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8l-5.5-5.5Z" />
    <path d="M14 2.5V8h5.5" />
  </>
);

/** 라벨형(뱃지 텍스트) 글리프 — PDF / PPT */
const LabelGlyph = ({ label }: { label: string }) => (
  <>
    <FileOutline />
    <rect
      x="2.6"
      y="11.6"
      width="13.4"
      height="6.8"
      rx="1.7"
      fill="currentColor"
      stroke="none"
    />
    <text
      x="9.3"
      y="16.75"
      textAnchor="middle"
      fontSize="4.7"
      fontWeight="700"
      fill="#fff"
      stroke="none"
      style={{ letterSpacing: "0.04em" }}
    >
      {label}
    </text>
  </>
);

const GLYPHS: Record<FileIconType, JSX.Element> = {
  pdf: <LabelGlyph label="PDF" />,
  ppt: <LabelGlyph label="PPT" />,
  doc: (
    <>
      <FileOutline />
      <path d="M8 12h8M8 15.2h8M8 18.4h5" />
    </>
  ),
  // 전사(txt) — 발화 블록: 화자 점 + 대사 줄
  txt: (
    <>
      <FileOutline />
      <circle cx="8.2" cy="12.4" r="0.55" fill="currentColor" />
      <path d="M10.6 12.4H16M8 15.6h6.4" />
      <circle cx="8.2" cy="18.6" r="0.55" fill="currentColor" />
      <path d="M10.6 18.6h4.2" />
    </>
  ),
  // 오디오 — 웨이브폼 바
  audio: (
    <>
      <path d="M3.5 10.2v3.6M7.75 7v10M12 3.8v16.4M16.25 7v10M20.5 10.2v3.6" />
    </>
  ),
  code: (
    <>
      <path d="m8.5 7.5-5 4.5 5 4.5M15.5 7.5l5 4.5-5 4.5M13.4 4.5l-2.8 15" />
    </>
  ),
  // 기출 — 시험지 + 채점 체크
  exam: (
    <>
      <FileOutline />
      <path d="m8.2 14.6 2.3 2.3 5-5" />
    </>
  ),
  folder: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4.2l2.1 2.4H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </>
  ),
  generic: (
    <>
      <FileOutline />
      <path d="M9.4 14.5h5.2" />
    </>
  ),
};

export interface FileIconProps {
  type: FileIconType;
  /** md: 40px 타일 / lg: 48px 타일 (기존 FileIconTile과 동일 규격) */
  size?: "md" | "lg";
  className?: string;
}

/** 글리프 단독 (배경 없음) */
export function FileGlyph({
  type,
  className = "h-6 w-6",
}: {
  type: FileIconType;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {GLYPHS[type]}
    </svg>
  );
}

/** 둥근 파스텔 타일 + 글리프 */
export default function FileIcon({ type, size = "md", className = "" }: FileIconProps) {
  const meta = ICON_META[type];
  return (
    <span
      className={`flex shrink-0 items-center justify-center ${meta.tile} ${
        size === "lg" ? "h-12 w-12 rounded-2xl" : "h-10 w-10 rounded-xl"
      } ${className}`}
      aria-hidden
    >
      <FileGlyph
        type={type}
        className={`${size === "lg" ? "h-[26px] w-[26px]" : "h-[22px] w-[22px]"} ${meta.color}`}
      />
    </span>
  );
}
