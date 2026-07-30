pub mod analysis;
pub mod engines;
pub mod files;
pub mod keys;
pub mod paths;
pub mod guide;
pub mod slides;
pub mod timetable;
pub mod watcher;

/// 테스트에서 프로세스 전역 env(`AONE_ROOT` 등)를 만지는 구간을 직렬화한다.
///
/// cargo test는 테스트를 병렬로 돌리는데 env는 프로세스 전역이라,
/// 한 테스트가 `AONE_ROOT`를 세팅한 사이 다른 테스트가 그것을 읽으면 엉뚱한 값을 본다
/// (실제로 R3 테스트를 추가하자 `new_layout_paths_under_dot_aone`가 깨졌다).
#[cfg(test)]
pub(crate) static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
