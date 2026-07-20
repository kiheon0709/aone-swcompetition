//! goldset 디렉토리 감시 — 새 파일 감지 시 `aone:file-added` 이벤트를 프론트로 emit.
//! A-one_v4의 watcher.rs 패턴(notify + debouncer-mini, 300ms) 이식.

use crate::commands::paths::aone_root;
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    path::{Component, Path},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct GoldsetWatcherState {
    current: Mutex<Option<Debouncer<notify::RecommendedWatcher>>>,
}

/// `aone:file-added` 이벤트 payload.
#[derive(Serialize, Clone)]
pub struct FileAddedPayload {
    pub subject: String,
    pub unit: String,
    pub files: Vec<String>,
}

/// goldset 기준 상대 경로에서 (subject, unit, 파일명) 추출 — 전부 NFC 정규화.
/// 첫 세그먼트 = subject, 둘째 세그먼트 = unit (subject 직속 파일이면 unit="").
/// goldset 루트 직속·benchmark 하위·숨김 파일은 None → 무시.
fn subject_unit_and_name(root: &Path, path: &Path) -> Option<(String, String, String)> {
    let rel = path.strip_prefix(root).ok()?;
    let segs: Vec<&str> = rel
        .components()
        .map(|c| match c {
            Component::Normal(s) => s.to_str(),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    // 최소 subject/파일 2단계. 루트 직속 파일은 감시 대상 아님.
    if segs.len() < 2 {
        return None;
    }
    let subject = crate::commands::analysis::nfc(segs[0]);
    if subject == "benchmark" || subject.starts_with('.') {
        return None;
    }
    let unit = if segs.len() >= 3 {
        crate::commands::analysis::nfc(segs[1])
    } else {
        String::new()
    };
    if unit.starts_with('.') {
        return None;
    }
    let name = segs.last()?.to_string();
    if name.starts_with('.') {
        return None;
    }
    Some((subject, unit, name))
}

/// goldset을 재귀 감시(300ms 디바운스). subject/unit 폴더 안에 파일이 생기면
/// 폴더별로 묶어 `aone:file-added` {subject, unit, files}를 emit한다 (benchmark 제외).
/// 존재하지 않는 경로(삭제 이벤트)는 걸러진다.
#[tauri::command]
pub fn start_goldset_watcher(app: AppHandle) -> Result<(), String> {
    let root = aone_root();

    // 디바운서는 lock 밖에서 생성·watch — Mutex 점유는 포인터 swap만.
    let app_handle = app.clone();
    let cb_root = root.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        move |res: DebounceEventResult| {
            let Ok(events) = res else { return };
            let mut by_folder: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();
            for event in events {
                if !event.path.is_file() {
                    continue; // 삭제·디렉토리 이벤트 무시
                }
                if let Some((subject, unit, name)) = subject_unit_and_name(&cb_root, &event.path) {
                    let files = by_folder.entry((subject, unit)).or_default();
                    if !files.contains(&name) {
                        files.push(name);
                    }
                }
            }
            for ((subject, unit), files) in by_folder {
                let _ = app_handle.emit(
                    "aone:file-added",
                    FileAddedPayload {
                        subject,
                        unit,
                        files,
                    },
                );
            }
        },
    )
    .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let state = app.state::<GoldsetWatcherState>();
    let mut guard = state.current.lock().map_err(|e| e.to_string())?;
    *guard = Some(debouncer); // 기존 디바운서는 대입과 동시에 drop (자동 stop)
    Ok(())
}

#[tauri::command]
pub fn stop_goldset_watcher(app: AppHandle) -> Result<(), String> {
    let state = app.state::<GoldsetWatcherState>();
    let mut guard = state.current.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subject_unit_extraction() {
        let root = Path::new("/g");
        // subject/unit/파일
        assert_eq!(
            subject_unit_and_name(root, Path::new("/g/데이터통신/3주차/slide.pdf")),
            Some(("데이터통신".into(), "3주차".into(), "slide.pdf".into()))
        );
        // subject 직속 파일 → unit=""
        assert_eq!(
            subject_unit_and_name(root, Path::new("/g/운영체제/note.md")),
            Some(("운영체제".into(), String::new(), "note.md".into()))
        );
        // 더 깊은 경로는 subject/unit까지만 본다
        assert_eq!(
            subject_unit_and_name(root, Path::new("/g/데이터통신/족보/img/scan.png")),
            Some(("데이터통신".into(), "족보".into(), "scan.png".into()))
        );
        // goldset 루트 직속·benchmark·숨김은 무시
        assert_eq!(subject_unit_and_name(root, Path::new("/g/loose.txt")), None);
        assert_eq!(
            subject_unit_and_name(root, Path::new("/g/benchmark/answers.txt")),
            None
        );
        assert_eq!(
            subject_unit_and_name(root, Path::new("/g/데이터통신/3주차/.DS_Store")),
            None
        );
        // NFD(macOS) 경로도 NFC로 정규화된다
        use unicode_normalization::UnicodeNormalization;
        let nfd_subject: String = "데이터통신".nfd().collect();
        let p = format!("/g/{nfd_subject}/1주차/a.txt");
        let got = subject_unit_and_name(root, Path::new(&p)).unwrap();
        assert_eq!(got.0, "데이터통신");
    }
}
