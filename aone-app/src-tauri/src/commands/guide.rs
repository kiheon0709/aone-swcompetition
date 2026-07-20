//! 시험대비 학습 가이드 생성: compose-guide(과목/범위 즉석 조립)를 트리거하고
//! 진행 상태를 폴링한다 (slides.rs 패턴).

use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use super::analysis::{
    claude_bin, cli_engine_of, inject_model_env, inject_root_env, kill_child, log_tail, nfc,
    npx_bin, spawn_path_env,
};
use super::paths::{logs_dir, pipeline_dir};

struct GuideRun {
    child: Option<Child>, // reap 후 None
    subject: String,
    exit_code: Option<i32>,
    log_path: PathBuf,
}

#[derive(Default)]
pub struct ComposeGuideState(Mutex<Option<GuideRun>>);

impl ComposeGuideState {
    /// stop_analysis(kind="guide")용: 실행 중인 자식 프로세스를 kill한다.
    pub(crate) fn stop(&self) -> Result<(), String> {
        let mut guard = self.0.lock().map_err(|e| e.to_string())?;
        if let Some(run) = guard.as_mut() {
            kill_child(&mut run.child)?;
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeGuideStatus {
    /// "idle" | "running" | "done" | "failed"
    pub status: String,
    pub subject: Option<String>,
    pub exit_code: Option<i32>,
    pub log_tail: String,
}

#[tauri::command]
pub async fn run_compose_guide(
    subject: String,
    units: Option<Vec<String>>,
    engine: Option<String>,
    state: tauri::State<'_, ComposeGuideState>,
) -> Result<(), String> {
    let subject = nfc(subject.trim());
    if subject.is_empty() {
        return Err("subject를 지정해야 합니다.".into());
    }
    let (cli_engine, gemini_key) = cli_engine_of(engine.as_deref())?;

    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    // 이미 실행 중이면 거부
    if let Some(run) = guard.as_mut() {
        if let Some(child) = run.child.as_mut() {
            match child.try_wait() {
                Ok(None) => return Err("이미 학습 가이드 생성이 실행 중입니다.".into()),
                Ok(Some(status)) => {
                    run.exit_code = status.code();
                    run.child = None;
                }
                Err(e) => return Err(format!("프로세스 상태 확인 실패: {e}")),
            }
        }
    }

    let log_path = logs_dir().join("aone-guide-run.log");
    let log_file = fs::File::create(&log_path).map_err(|e| format!("로그 파일 생성 실패: {e}"))?;
    let err_file = log_file.try_clone().map_err(|e| e.to_string())?;

    // subject·units에 공백·한글이 있어도 안전하도록 셸 없이 인자 배열로 전달.
    let mut cmd = Command::new(npx_bin());
    cmd.args([
        "tsx",
        "src/cli.ts",
        "compose-guide",
        "--subject",
        subject.as_str(),
        "--engine",
        cli_engine,
    ]);
    let units: Vec<String> = units
        .unwrap_or_default()
        .iter()
        .map(|u| nfc(u.trim()))
        .filter(|u| !u.is_empty())
        .collect();
    if !units.is_empty() {
        cmd.args(["--units", units.join(",").as_str()]);
    }
    cmd.current_dir(pipeline_dir())
        .env("PATH", spawn_path_env())
        .env("CLAUDE_BIN", claude_bin());
    inject_root_env(&mut cmd);
    inject_model_env(&mut cmd);
    if let Some(key) = gemini_key {
        cmd.env("GEMINI_API_KEY", key);
    }
    let child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(err_file))
        .spawn()
        .map_err(|e| format!("학습 가이드 생성 실행 실패: {e}"))?;

    *guard = Some(GuideRun {
        child: Some(child),
        subject,
        exit_code: None,
        log_path,
    });
    Ok(())
}

#[tauri::command]
pub async fn compose_guide_status(
    state: tauri::State<'_, ComposeGuideState>,
) -> Result<ComposeGuideStatus, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    let Some(run) = guard.as_mut() else {
        return Ok(ComposeGuideStatus {
            status: "idle".into(),
            subject: None,
            exit_code: None,
            log_tail: String::new(),
        });
    };

    if let Some(child) = run.child.as_mut() {
        match child.try_wait() {
            Ok(None) => {
                return Ok(ComposeGuideStatus {
                    status: "running".into(),
                    subject: Some(run.subject.clone()),
                    exit_code: None,
                    log_tail: log_tail(&run.log_path),
                });
            }
            Ok(Some(status)) => {
                run.exit_code = status.code();
                run.child = None;
            }
            Err(e) => return Err(format!("프로세스 상태 확인 실패: {e}")),
        }
    }

    let success = run.exit_code == Some(0);
    Ok(ComposeGuideStatus {
        status: if success { "done" } else { "failed" }.into(),
        subject: Some(run.subject.clone()),
        exit_code: run.exit_code,
        log_tail: log_tail(&run.log_path),
    })
}
