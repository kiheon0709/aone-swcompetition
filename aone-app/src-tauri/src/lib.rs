mod commands;

use commands::analysis::{
    analysis_log, analysis_status, run_folder_analysis, stop_analysis, AnalysisState,
};
use commands::engines::{codex_status, connect_codex, detect_engines, run_llm};
use commands::files::{
    create_subject_folders, delete_file, drop_files, read_snapshot, read_doc_bytes, rename_folder, trash_folder, pick_and_upload_files, pick_timetable_image, rescan_files, save_text_file,
};
use commands::guide::{compose_guide_status, run_compose_guide, ComposeGuideState};
use commands::keys::{api_key_status, delete_api_key, save_api_key};
use commands::slides::{run_slide_summarize, slide_summarize_status, SlideSummarizeState};
use commands::timetable::recognize_timetable;
use commands::watcher::{start_goldset_watcher, stop_goldset_watcher, GoldsetWatcherState};

/// Windows 창 재질 폴백.
///
/// macOS는 tauri.conf.json의 `windowEffects`(popover/menu/sidebar) + `macOSPrivateApi`로
/// vibrancy가 적용된다. 그 효과명은 macOS 전용이라 Windows에선 Tauri가 무시하며,
/// 프론트(vibrancy.tsx)는 OS 구분 없이 Tauri 창이면 body 배경을 투명으로 만든다.
/// 따라서 Windows에서 아무 재질도 없으면 창이 완전 투명(바탕 뚫림)으로 보인다.
/// 이를 막기 위해 런타임에 Mica(반투명 시스템 재질)를 적용해 투명 body가 얹힐
/// 반투명 배경을 마련한다. Mica 미지원(구 Windows)이면 조용히 실패 → 불투명 폴백.
#[cfg(target_os = "windows")]
fn apply_windows_window_effect(app: &tauri::App) {
    use tauri::window::{Effect, EffectsBuilder};
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_effects(EffectsBuilder::new().effect(Effect::Mica).build());
    }
}

/// 패키징(사이드카) 런타임 감지 — 경로 계약 §3의 "번들 = 리소스 디렉토리" 단계.
///
/// 번들 리소스에 pipeline이 있으면(=심사위원 배포본) env 3개를 주입해
/// 기존 env 기반 배관(paths.rs·node_bin_dir)이 그대로 동작하게 한다:
/// - `AONE_PIPELINE_DIR` → 번들된 pipeline (node_modules 포함)
/// - `AONE_NODE_BIN`     → 번들된 Node bin (node·npx — 시스템 Node 불필요)
/// - `AONE_ROOT`         → `~/Aone` (첫 실행 시 생성, 모든 자료·DB가 여기에)
/// 개발 모드(리소스 없음)나 이미 env가 설정된 경우엔 아무것도 하지 않는다.
fn setup_bundled_runtime(app: &tauri::App) {
    use tauri::Manager;
    let Ok(res) = app.path().resource_dir() else {
        return;
    };
    let pipeline = res.join("resources").join("pipeline");
    if !pipeline.is_dir() {
        return; // 개발 모드
    }
    if std::env::var_os("AONE_PIPELINE_DIR").map_or(true, |v| v.is_empty()) {
        std::env::set_var("AONE_PIPELINE_DIR", &pipeline);
    }
    let node_bin = res.join("resources").join("node").join("bin");
    if node_bin.is_dir() && std::env::var_os("AONE_NODE_BIN").map_or(true, |v| v.is_empty()) {
        std::env::set_var("AONE_NODE_BIN", &node_bin);
    }
    if std::env::var_os("AONE_ROOT").map_or(true, |v| v.is_empty()) {
        if let Some(home) = dirs::home_dir() {
            std::env::set_var("AONE_ROOT", home.join("Aone"));
        }
    }

    // 첫 실행 시딩 — ~/Aone이 비어 있으면 번들된 데모(분석 완료본)를 복사한다.
    // 심사위원이 앱을 열자마자 전 기능(리더·퀴즈·시험대비)을 볼 수 있게.
    // files.json 유무로 "이미 쓰던 사용자"인지 판별 → 있으면 건드리지 않는다.
    //
    // 순서 보장(부분 복사 방지): 마커(.aone/files.json)를 맨 마지막에 복사한다.
    // 마커가 먼저 복사된 상태에서 중단되면 재시딩이 영구 스킵돼 반토막 데모가 고정되므로,
    // 데이터 파일 전부를 먼저 복사한 뒤 마지막에 마커를 기록한다.
    let demo = res.join("resources").join("demo");
    if demo.is_dir() {
        if let Some(root) = std::env::var_os("AONE_ROOT") {
            let root = std::path::PathBuf::from(root);
            let marker_rel = std::path::Path::new(".aone").join("files.json");
            let marker = root.join(&marker_rel);
            if !marker.exists() {
                // 1) 마커를 제외한 모든 데이터 파일 복사
                copy_dir_all(&demo, &root, Some(&marker_rel));
                // 2) 데이터가 다 복사된 뒤에만 마커를 기록 (완료 신호)
                let marker_src = demo.join(&marker_rel);
                if marker_src.is_file() {
                    if let Some(parent) = marker.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    let _ = std::fs::copy(&marker_src, &marker);
                }
            }
        }
    }
}

/// 디렉토리를 재귀 복사한다 (덮어쓰지 않고 없는 것만). 시딩 전용 — 실패는 조용히 무시.
/// `skip_rel`이 주어지면 (dst 기준 상대경로) 그 파일은 복사하지 않는다 — 완료 마커를
/// 맨 마지막에 따로 기록하기 위한 제외 장치.
fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path, skip_rel: Option<&std::path::Path>) {
    copy_dir_rec(src, dst, dst, skip_rel);
}

fn copy_dir_rec(
    src: &std::path::Path,
    dst: &std::path::Path,
    root: &std::path::Path,
    skip_rel: Option<&std::path::Path>,
) {
    let _ = std::fs::create_dir_all(dst);
    let Ok(entries) = std::fs::read_dir(src) else {
        return;
    };
    for entry in entries.flatten() {
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_rec(&from, &to, root, skip_rel);
        } else {
            // 마커(완료 신호)는 여기서 건너뛰고, 데이터 복사가 끝난 뒤 따로 기록한다.
            if let Some(skip) = skip_rel {
                if to.strip_prefix(root).map(|r| r == skip).unwrap_or(false) {
                    continue;
                }
            }
            if !to.exists() {
                let _ = std::fs::copy(&from, &to);
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(target_os = "windows")]
            apply_windows_window_effect(_app);
            setup_bundled_runtime(_app);
            Ok(())
        })
        .manage(AnalysisState::default())
        .manage(SlideSummarizeState::default())
        .manage(ComposeGuideState::default())
        .manage(GoldsetWatcherState::default())
        .invoke_handler(tauri::generate_handler![
            detect_engines,
            connect_codex,
            codex_status,
            run_llm,
            save_api_key,
            api_key_status,
            delete_api_key,
            recognize_timetable,
            run_folder_analysis,
            analysis_status,
            analysis_log,
            stop_analysis,
            run_slide_summarize,
            slide_summarize_status,
            run_compose_guide,
            compose_guide_status,
            create_subject_folders,
            read_snapshot,
            read_doc_bytes,
            rename_folder,
            trash_folder,
            pick_and_upload_files,
            pick_timetable_image,
            drop_files,
            delete_file,
            rescan_files,
            save_text_file,
            start_goldset_watcher,
            stop_goldset_watcher
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
