//! 슬라이드 요약 라이브 생성: 리더에서 doc 태그 하나의 페이지별 요약 생성을
//! 트리거하고 진행 상태를 폴링한다 (analysis.rs 패턴).

use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use super::analysis::{
    claude_bin, cli_engine_of, inject_model_env, inject_root_env, kill_child, log_tail, nfc, npx_bin,
    spawn_path_env,
};
use super::paths::{logs_dir, pipeline_dir};

struct SlideRun {
    child: Option<Child>, // reap 후 None
    subject: String,
    unit: String,
    doc: String,
    exit_code: Option<i32>,
    log_path: PathBuf,
}

#[derive(Default)]
pub struct SlideSummarizeState(Mutex<Option<SlideRun>>);

impl SlideSummarizeState {
    /// analysis_log(kind="slides")용: (로그 경로, 종료 여부, exit code).
    /// 실행 이력이 없으면 기본 로그 경로 + done=true.
    pub(crate) fn snapshot(&self) -> Result<(PathBuf, bool, Option<i32>), String> {
        let mut guard = self.0.lock().map_err(|e| e.to_string())?;
        let Some(run) = guard.as_mut() else {
            return Ok((logs_dir().join("aone-slides-run.log"), true, None));
        };
        if let Some(child) = run.child.as_mut() {
            match child.try_wait() {
                Ok(None) => return Ok((run.log_path.clone(), false, None)),
                Ok(Some(status)) => {
                    run.exit_code = status.code();
                    run.child = None;
                }
                Err(e) => return Err(format!("프로세스 상태 확인 실패: {e}")),
            }
        }
        Ok((run.log_path.clone(), true, run.exit_code))
    }

    /// stop_analysis(kind="slides")용: 실행 중인 자식 프로세스를 kill한다.
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
pub struct SlideSummarizeStatus {
    /// "idle" | "running" | "done" | "failed"
    pub status: String,
    pub subject: Option<String>,
    pub unit: Option<String>,
    pub doc: Option<String>,
    pub exit_code: Option<i32>,
    pub log_tail: String,
}

#[tauri::command]
pub async fn run_slide_summarize(
    subject: String,
    unit: String,
    doc: String,
    engine: Option<String>,
    state: tauri::State<'_, SlideSummarizeState>,
) -> Result<(), String> {
    let subject = nfc(subject.trim());
    let unit = nfc(unit.trim());
    if subject.is_empty() || unit.is_empty() {
        return Err("subject와 unit을 모두 지정해야 합니다.".into());
    }
    // 활성 엔진 → 파이프라인 CLI 엔진 이름 매핑 (analysis.rs와 동일, gemini는 키 동반)
    let (cli_engine, gemini_key) = cli_engine_of(engine.as_deref())?;

    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    // 이미 실행 중이면 거부
    if let Some(run) = guard.as_mut() {
        if let Some(child) = run.child.as_mut() {
            match child.try_wait() {
                Ok(None) => return Err("이미 슬라이드 요약 생성이 실행 중입니다.".into()),
                Ok(Some(status)) => {
                    run.exit_code = status.code();
                    run.child = None;
                }
                Err(e) => return Err(format!("프로세스 상태 확인 실패: {e}")),
            }
        }
    }

    let log_path = logs_dir().join("aone-slides-run.log");
    let log_file = fs::File::create(&log_path).map_err(|e| format!("로그 파일 생성 실패: {e}"))?;
    let err_file = log_file.try_clone().map_err(|e| e.to_string())?;

    // subject/unit/doc에 공백·한글이 있어도 안전하도록 셸을 거치지 않고 인자 배열로 전달한다.
    let mut cmd = Command::new(npx_bin());
    cmd.args([
            "tsx",
            "src/cli.ts",
            "summarize-slides",
            "--subject",
            subject.as_str(),
            "--unit",
            unit.as_str(),
            "--doc",
            doc.as_str(),
            "--engine",
            cli_engine,
        ]);
    // 세 엔진 모두 동시 호출을 지원한다(codex도 4병렬 실측 확인). 응답성과 한도 여유를 위해 2로 통일.
    cmd.args(["--concurrency", "2"]);
    cmd.current_dir(pipeline_dir())
        .env("PATH", spawn_path_env())
        .env("CLAUDE_BIN", claude_bin());
    inject_root_env(&mut cmd);
    inject_model_env(&mut cmd);
    // B안: 비전 지원 엔진이면 원본 PDF를 첨부해 그림·도식까지 요약.
    // 세 엔진 모두 PDF를 직접 본다(codex는 exec -i). pipeline이 AONE_ATTACH_PDF=1을 읽는다.
    if cli_engine == "claude-cli" || cli_engine == "gemini-api" || cli_engine == "codex-cli" {
        cmd.env("AONE_ATTACH_PDF", "1");
    }
    if let Some(key) = gemini_key {
        cmd.env("GEMINI_API_KEY", key);
    }
    let child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(err_file))
        .spawn()
        .map_err(|e| format!("슬라이드 요약 실행 실패: {e}"))?;

    *guard = Some(SlideRun {
        child: Some(child),
        subject,
        unit,
        doc,
        exit_code: None,
        log_path,
    });
    Ok(())
}

#[tauri::command]
pub async fn slide_summarize_status(
    state: tauri::State<'_, SlideSummarizeState>,
) -> Result<SlideSummarizeStatus, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    let Some(run) = guard.as_mut() else {
        return Ok(SlideSummarizeStatus {
            status: "idle".into(),
            subject: None,
            unit: None,
            doc: None,
            exit_code: None,
            log_tail: String::new(),
        });
    };

    if let Some(child) = run.child.as_mut() {
        match child.try_wait() {
            Ok(None) => {
                return Ok(SlideSummarizeStatus {
                    status: "running".into(),
                    subject: Some(run.subject.clone()),
                    unit: Some(run.unit.clone()),
                    doc: Some(run.doc.clone()),
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
    Ok(SlideSummarizeStatus {
        status: if success { "done" } else { "failed" }.into(),
        subject: Some(run.subject.clone()),
        unit: Some(run.unit.clone()),
        doc: Some(run.doc.clone()),
        exit_code: run.exit_code,
        log_tail: log_tail(&run.log_path),
    })
}
