/**
 * 파일 시스템 브릿지 — Tauri 런타임에서 goldset 파일 업로드·재스캔·감시 커맨드를 호출한다.
 * 브라우저(dev) 환경에서는 no-op 또는 에러로 분기 (lib/engines.ts 패턴).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauriRuntime } from "./engines";

/**
 * Rust/네이티브 raw 에러를 사용자용 한국어 메시지로 매핑한다.
 * 원문("No such file...", "permission denied" 등)은 console에만 남기고,
 * 사용자에게는 상황별 안내 문구를 반환한다. 매핑 불가 시 일반 안내.
 */
export const userErrorMessage = (
  e: unknown,
  fallback = "요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.",
): string => {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  console.error("[error]", raw);
  const m = raw.toLowerCase();
  if (m.includes("no such file") || m.includes("not found") || m.includes("존재하지"))
    return "파일이나 폴더를 찾을 수 없어요. 이동하거나 삭제되지 않았는지 확인해주세요.";
  if (m.includes("permission") || m.includes("denied") || m.includes("권한"))
    return "접근 권한이 없어요. 폴더 권한을 확인하거나 앱을 다시 실행해주세요.";
  if (m.includes("already exists") || m.includes("이미"))
    return "같은 이름이 이미 있어요. 다른 이름으로 시도해주세요.";
  if (m.includes("network") || m.includes("timeout") || m.includes("connection") || m.includes("fetch"))
    return "네트워크 연결이 불안정해요. 잠시 후 다시 시도해주세요.";
  if (m.includes("cancel") || m.includes("취소")) return "취소했어요.";
  if (m.includes("데스크톱 앱")) return raw; // 이미 사용자 친화 문구
  return fallback;
};

/** Rust `aone:file-added` 이벤트 payload. subject 직속 파일이면 unit="". */
export interface FileAddedPayload {
  subject: string;
  unit: string;
  files: string[];
}

/** 업로드 화이트리스트 거부 항목 (부록 A3) — reason: "audio" | "unsupported" */
export interface RejectedFile {
  name: string;
  reason: string;
}

/** 업로드 결과 (부록 A3) — 복사된 파일명 + 거부 목록 */
export interface UploadResult {
  copied: string[];
  rejected: RejectedFile[];
}

/**
 * 네이티브 파일 선택 다이얼로그를 열어 goldset 하위 폴더로 복사.
 * folder: goldset 기준 상대 경로(folderKey) — ""(루트) · "데이터통신/3주차" 등.
 * 반환: { copied, rejected } (사용자가 취소하면 둘 다 빈 배열).
 */
export const pickAndUploadFiles = async (folder: string): Promise<UploadResult> => {
  if (!isTauriRuntime()) throw new Error("데스크톱 앱에서만 사용할 수 있습니다.");
  return invoke<UploadResult>("pick_and_upload_files", { folder });
};

/** 창에 드롭된 파일 경로들을 지정 폴더로 복사 */
export const dropFiles = async (
  paths: string[],
  folder: string
): Promise<UploadResult> => {
  if (!isTauriRuntime()) throw new Error("데스크톱 앱에서만 사용할 수 있습니다.");
  return invoke<UploadResult>("drop_files", { paths, folder });
};

/** Tauri 창 파일 드래그·드롭 이벤트 구독 (enter/drop/leave) */
export const onWindowFileDrop = async (handlers: {
  onHover?: () => void;
  onDrop: (paths: string[]) => void;
  onCancel?: () => void;
}): Promise<() => void> => {
  if (!isTauriRuntime()) return () => {};
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    if (p.type === "over") handlers.onHover?.();
    else if (p.type === "drop") handlers.onDrop(p.paths);
    else handlers.onCancel?.();
  });
  return unlisten;
};

/**
 * goldset 하위 파일 1개를 삭제 (되돌릴 수 없음).
 * folder: goldset 기준 상대 경로(folderKey) — ""(루트) · "데이터통신/3주차" 등. name: 파일명.
 */
export const deleteFile = async (folder: string, name: string): Promise<void> => {
  if (!isTauriRuntime()) throw new Error("데스크톱 앱에서만 사용할 수 있습니다.");
  await invoke("delete_file", { folder, name });
};

/**
 * goldset 폴더 이름 변경 — folder: folderKey("데이터통신" · "데이터통신/3주차"),
 * newName: 마지막 세그먼트의 새 이름.
 */
export const renameFolder = async (
  folder: string,
  newName: string
): Promise<void> => {
  if (!isTauriRuntime()) throw new Error("데스크톱 앱에서만 사용할 수 있습니다.");
  await invoke("rename_folder", { folder, newName });
};

/** goldset 폴더를 휴지통(goldset/.trash)으로 이동 (복구 가능) */
export const trashFolder = async (folder: string): Promise<void> => {
  if (!isTauriRuntime()) throw new Error("데스크톱 앱에서만 사용할 수 있습니다.");
  await invoke("trash_folder", { folder });
};

/**
 * 텍스트(마크다운 등)를 네이티브 저장 다이얼로그로 내보낸다.
 * 반환: 저장한 파일 경로 (취소하면 null).
 * 브라우저에서는 throw — 호출부가 Blob 다운로드로 폴백한다.
 */
export const saveTextFile = async (
  name: string,
  content: string
): Promise<string | null> => {
  if (!isTauriRuntime()) throw new Error("데스크톱 앱에서만 사용할 수 있습니다.");
  return invoke<string | null>("save_text_file", { name, content });
};

/**
 * 시간표 인식 결과의 과목명들로 goldset에 과목 폴더 생성.
 * 이미 있는 폴더는 건너뛴다. 반환: 실제로 새로 생성된 폴더 이름들.
 */
export const createSubjectFolders = async (
  names: string[]
): Promise<string[]> => {
  if (!isTauriRuntime()) throw new Error("데스크톱 앱에서만 사용할 수 있습니다.");
  return invoke<string[]>("create_subject_folders", { names });
};

/**
 * goldset을 subject/unit 트리로 재스캔해 public/files.json(§7)을 재생성.
 * 반환: 새 files.json 내용(JSON 문자열) — parseManifest 후 바로 상태 갱신에 사용 가능.
 */
export const rescanFiles = async (): Promise<string> => {
  if (!isTauriRuntime()) throw new Error("데스크톱 앱에서만 사용할 수 있습니다.");
  return invoke<string>("rescan_files");
};

/** goldset 감시 시작 (재귀, 300ms 디바운스). 브라우저에서는 no-op. */
export const startGoldsetWatcher = async (): Promise<void> => {
  if (!isTauriRuntime()) return;
  await invoke("start_goldset_watcher");
};

/** goldset 감시 중지. 브라우저에서는 no-op. */
export const stopGoldsetWatcher = async (): Promise<void> => {
  if (!isTauriRuntime()) return;
  await invoke("stop_goldset_watcher");
};

/**
 * `aone:file-added` 이벤트 구독. 반환된 함수를 호출하면 구독 해제.
 * 브라우저에서는 no-op unlisten을 반환.
 */
export const onFileAdded = async (
  cb: (payload: FileAddedPayload) => void
): Promise<UnlistenFn> => {
  if (!isTauriRuntime()) return () => {};
  return listen<FileAddedPayload>("aone:file-added", (event) => cb(event.payload));
};

/**
 * 자료 원본(PDF·PPTX)의 로드용 URL을 만든다.
 * - Tauri(새 레이아웃): public/uploads 미러가 없으므로 read_doc_bytes로 원본 바이트를
 *   받아 blob URL을 만든다. 호출자는 사용 후 URL.revokeObjectURL로 해제해야 한다.
 * - 브라우저/Vercel/개발 폴백: 기존 webUrl(/uploads·/docs)을 그대로 쓴다(미러가 있다).
 * 반환: { url, revoke } — revoke는 blob일 때만 실제 해제, 아니면 no-op.
 */
export const loadDocUrl = async (
  folder: string,
  name: string,
  webUrl: string,
): Promise<{ url: string; revoke: () => void }> => {
  if (isTauriRuntime()) {
    const bytes = await invoke<number[]>("read_doc_bytes", { folder, name });
    const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    return { url, revoke: () => URL.revokeObjectURL(url) };
  }
  return { url: webUrl, revoke: () => {} };
};

/**
 * 분석 산출물 스냅샷 로드 — 새 레이아웃(~/Aone/.../.aone/*.json)은 Tauri 커맨드로,
 * 브라우저(Vercel)·개발 폴백은 public 경로 fetch로. 없으면 null.
 * kind: "analysis" | "docs" | "slides" | "guide" | "docSummaries"
 */
export const loadSnapshot = async (
  kind: "analysis" | "docs" | "slides" | "guide" | "docSummaries",
  subject: string,
  unit?: string,
  cacheBust?: string | number,
): Promise<unknown | null> => {
  if (isTauriRuntime()) {
    const raw = await invoke<string | null>("read_snapshot", { kind, subject, unit: unit ?? null });
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      // 손상된 스냅샷 JSON — 크래시 대신 null 반환 (브라우저 분기와 일관)
      console.error("[loadSnapshot] JSON 파싱 실패:", e);
      return null;
    }
  }
  // 브라우저/Vercel: public 경로 (slug 파일)
  const slug = unit ? `${subject}__${unit}` : subject;
  const r = cacheBust != null ? `?r=${cacheBust}` : "";
  const url =
    kind === "slides"
      ? `/slides/${encodeURIComponent(slug)}.json${r}`
      : kind === "docSummaries"
        ? `/slides/${encodeURIComponent(`docsum_${slug}`)}.json${r}`
      : kind === "docs"
        ? `/snapshots/${encodeURIComponent(`docs_${slug}`)}.json${r}`
        : kind === "guide"
          ? `/snapshots/${encodeURIComponent(`guide_${subject}`)}.json${r}`
          : `/snapshots/${encodeURIComponent(slug)}.json${r}`;
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
};
