//! 런타임 경로 해석 (경로 재설계 계약 §3).
//!
//! 두 가지 모드로 동작한다:
//! - **개발 폴백** (`AONE_ROOT` env 미설정): 기존 하드코딩 절대경로와 동일하게 동작한다.
//!   files.json은 aone-app/public, 로그·trash는 기존 위치를 그대로 쓴다. 현행 dev 세션
//!   (3100 + Tauri)이 재시작해도 안 깨지게 하는 게 핵심.
//! - **새 레이아웃** (`AONE_ROOT` env 설정): `AONE_ROOT/.aone/` 아래로 files.json·logs·trash·
//!   extracted 를 모은다 (계약 §2). 이 모드에서만 파이프라인에 env를 주입한다.
//!
//! 분기 기준은 단 하나: `AONE_ROOT` env 존재 여부 (`in_new_layout()`).

use std::env;
use std::path::PathBuf;

/// 개발 폴백 자료 루트 = 기존 GOLDSET_DIR 값 그대로.
const DEV_GOLDSET_DIR: &str = "/Users/hong-giheon/hkheon/Project/SW경진대회_Aone/goldset";
/// 개발 폴백 files.json = 기존 public/files.json.
const DEV_FILES_JSON_PATH: &str =
    "/Users/hong-giheon/hkheon/Project/SW경진대회_Aone/aone-app/public/files.json";
/// 개발 폴백 PDF 미러 루트 = 기존 public/uploads.
const DEV_UPLOADS_DIR: &str =
    "/Users/hong-giheon/hkheon/Project/SW경진대회_Aone/aone-app/public/uploads";
/// 개발 폴백 파이프라인 루트 = 기존 상대 경로가 가리키던 절대 경로.
const DEV_PIPELINE_DIR: &str = "/Users/hong-giheon/hkheon/Project/SW경진대회_Aone/pipeline";

/// 새 레이아웃 여부 — `AONE_ROOT` env가 설정돼 있으면 true.
/// 개발 폴백/새 레이아웃 분기의 단일 진실.
pub(crate) fn in_new_layout() -> bool {
    env::var_os("AONE_ROOT")
        .map(|v| !v.is_empty())
        .unwrap_or(false)
}

/// 자료 루트 (구 GOLDSET_DIR).
/// env `AONE_ROOT`가 있으면 그것, 없으면 개발 폴백. 없으면 생성한다.
pub(crate) fn aone_root() -> PathBuf {
    let root = match env::var_os("AONE_ROOT").filter(|v| !v.is_empty()) {
        Some(v) => PathBuf::from(v),
        None => PathBuf::from(DEV_GOLDSET_DIR),
    };
    let _ = std::fs::create_dir_all(&root);
    root
}

/// 앱 전역 데이터 디렉토리 (.aone 계열).
/// 새 레이아웃: env `AONE_DATA` 또는 `aone_root()/.aone` (없으면 생성).
/// 개발 폴백: 이 함수는 새 레이아웃 전용 getter(logs/trash/extracted 등)에서만 쓴다.
pub(crate) fn data_dir() -> PathBuf {
    let dir = match env::var_os("AONE_DATA").filter(|v| !v.is_empty()) {
        Some(v) => PathBuf::from(v),
        None => aone_root().join(".aone"),
    };
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// files.json 매니페스트 경로.
/// 개발 폴백: 기존 public/files.json (프론트가 fetch하던 위치 유지).
/// 새 레이아웃: `data_dir()/files.json`.
pub(crate) fn files_json_path() -> PathBuf {
    if in_new_layout() {
        data_dir().join("files.json")
    } else {
        PathBuf::from(DEV_FILES_JSON_PATH)
    }
}

/// 로그 디렉토리 (aone-ui-run.log · aone-slides-run.log).
/// 개발 폴백: pipeline/ (기존 위치 — 로그가 기존 자리에 남는다).
/// 새 레이아웃: `data_dir()/logs` (없으면 생성).
pub(crate) fn logs_dir() -> PathBuf {
    if in_new_layout() {
        let dir = data_dir().join("logs");
        let _ = std::fs::create_dir_all(&dir);
        dir
    } else {
        PathBuf::from(DEV_PIPELINE_DIR)
    }
}

/// 휴지통 디렉토리 (삭제 폴더 복구용).
/// 개발 폴백: `aone_root()/.trash` (기존 trash_folder 동작 유지).
/// 새 레이아웃: `data_dir()/.trash`.
pub(crate) fn trash_dir() -> PathBuf {
    if in_new_layout() {
        data_dir().join(".trash")
    } else {
        aone_root().join(".trash")
    }
}

/// 파이프라인 프로젝트 루트 (사이드카 번들 전 단계 — 계약 §3).
/// env `AONE_PIPELINE_DIR` 우선, 없으면 기존 상대 경로가 가리키던 절대 경로.
pub(crate) fn pipeline_dir() -> PathBuf {
    match env::var_os("AONE_PIPELINE_DIR").filter(|v| !v.is_empty()) {
        Some(v) => PathBuf::from(v),
        None => PathBuf::from(DEV_PIPELINE_DIR),
    }
}

/// PDF 미러 루트 (개발 폴백 전용).
/// 새 레이아웃에선 미러링을 하지 않으므로 이 함수는 개발 폴백에서만 호출된다.
pub(crate) fn uploads_dir() -> PathBuf {
    PathBuf::from(DEV_UPLOADS_DIR)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// env는 프로세스 전역이라 env를 만지는 테스트들을 직렬화한다 (병렬 실행 레이스 방지).
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// 새 레이아웃(AONE_ROOT 지정) — files.json이 .aone/ 아래에 나오는지.
    #[test]
    fn new_layout_paths_under_dot_aone() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path().to_path_buf();
        // 안전: 테스트 프로세스 안에서만 set/remove.
        env::set_var("AONE_ROOT", &root);
        env::remove_var("AONE_DATA");

        assert!(in_new_layout());
        assert_eq!(aone_root(), root);

        let data = data_dir();
        assert_eq!(data, root.join(".aone"));
        assert!(data.is_dir(), "data_dir는 생성돼야 함");

        assert_eq!(files_json_path(), root.join(".aone").join("files.json"));
        assert_eq!(logs_dir(), root.join(".aone").join("logs"));
        assert!(logs_dir().is_dir(), "logs_dir는 생성돼야 함");
        assert_eq!(trash_dir(), root.join(".aone").join(".trash"));

        // AONE_DATA 오버라이드
        let alt = tmp.path().join("alt-data");
        env::set_var("AONE_DATA", &alt);
        assert_eq!(data_dir(), alt);
        assert_eq!(files_json_path(), alt.join("files.json"));

        env::remove_var("AONE_ROOT");
        env::remove_var("AONE_DATA");
    }

    /// 개발 폴백(AONE_ROOT 미설정) — 기존 하드코딩 경로와 동일한지.
    #[test]
    fn dev_fallback_paths_unchanged() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        env::remove_var("AONE_ROOT");
        env::remove_var("AONE_DATA");

        assert!(!in_new_layout());
        assert_eq!(aone_root(), PathBuf::from(DEV_GOLDSET_DIR));
        assert_eq!(files_json_path(), PathBuf::from(DEV_FILES_JSON_PATH));
        assert_eq!(logs_dir(), PathBuf::from(DEV_PIPELINE_DIR));
        assert_eq!(trash_dir(), PathBuf::from(DEV_GOLDSET_DIR).join(".trash"));
        assert_eq!(uploads_dir(), PathBuf::from(DEV_UPLOADS_DIR));
    }

    /// AONE_PIPELINE_DIR 우선, 없으면 현행 상대 경로.
    #[test]
    fn pipeline_dir_env_override() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        env::remove_var("AONE_PIPELINE_DIR");
        assert_eq!(pipeline_dir(), PathBuf::from(DEV_PIPELINE_DIR));

        let tmp = tempfile::tempdir().expect("tempdir");
        env::set_var("AONE_PIPELINE_DIR", tmp.path());
        assert_eq!(pipeline_dir(), tmp.path());
        env::remove_var("AONE_PIPELINE_DIR");
    }
}
