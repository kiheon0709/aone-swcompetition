//! 시간표 실인식 (부록 A2): pipeline `recognize-timetable`을 스폰해
//! stdout 마지막 줄의 계약 JSON(`{"lectures":[…],"untimed":[…]}`)을 문자열로 반환한다.

use std::path::Path;
use std::process::Command;
use std::time::Duration;

use super::analysis::{claude_bin, cli_engine_of, inject_root_env, npx_bin, spawn_path_env};
use super::engines::run_with_timeout;
use super::paths::pipeline_dir;

const IMAGE_EXTS: [&str; 3] = ["png", "jpg", "jpeg"];

/// 인식 자체 최대 시간: 엔진 재시도(최대 3회 × 180초 + 대기) 여유를 둔 5분.
const RECOGNIZE_TIMEOUT: Duration = Duration::from_secs(300);

#[tauri::command]
pub async fn recognize_timetable(image_path: String, engine: String) -> Result<String, String> {
    let path = Path::new(&image_path);
    if !path.is_absolute() {
        return Err("이미지 경로는 절대경로여야 합니다.".into());
    }
    if !path.is_file() {
        return Err(format!("이미지 파일을 찾을 수 없습니다: {image_path}"));
    }
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !IMAGE_EXTS.contains(&ext.as_str()) {
        return Err(format!("지원하지 않는 이미지 형식: .{ext} (png/jpg/jpeg만)"));
    }

    let (cli_engine, gemini_key) = cli_engine_of(Some(&engine))?;
    if cli_engine == "codex-cli" {
        return Err("시간표 인식은 claude 또는 gemini 엔진만 지원합니다.".into());
    }

    let mut cmd = Command::new(npx_bin());
    cmd.args([
        "tsx",
        "src/cli.ts",
        "recognize-timetable",
        "--image",
        image_path.as_str(),
        "--engine",
        cli_engine,
    ])
    .current_dir(pipeline_dir())
    .env("PATH", spawn_path_env())
    .env("CLAUDE_BIN", claude_bin());
    inject_root_env(&mut cmd);
    if let Some(key) = gemini_key {
        cmd.env("GEMINI_API_KEY", key);
    }

    let out = run_with_timeout(cmd, RECOGNIZE_TIMEOUT)?;
    if out.status != Some(0) {
        let detail = if out.stderr.trim().is_empty() {
            out.stdout
        } else {
            out.stderr
        };
        let tail: Vec<&str> = detail.lines().rev().take(5).collect();
        let tail: String = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
        return Err(format!(
            "시간표 인식 실패 (exit {:?}): {}",
            out.status,
            tail.trim()
        ));
    }

    // 계약: stdout 마지막 비어있지 않은 줄 = JSON
    let last = out
        .stdout
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .ok_or("시간표 인식 출력이 비어 있습니다.")?
        .trim()
        .to_string();
    serde_json::from_str::<serde_json::Value>(&last).map_err(|e| {
        // 한글 UTF-8 경계 안전하게 앞부분만 자른다
        let head: String = last.chars().take(200).collect();
        format!("시간표 인식 JSON 파싱 실패: {e} — 출력: {head}")
    })?;
    Ok(last)
}
