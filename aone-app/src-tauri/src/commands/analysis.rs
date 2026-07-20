//! 파이프라인 라이브 실행: 앱에서 폴더(subject/unit) 자료 분석을 트리거하고 진행 상태를 폴링한다.

use super::paths::{aone_root, data_dir, in_new_layout, logs_dir, pipeline_dir};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use unicode_normalization::UnicodeNormalization;

/// 한글 폴더명 NFC 정규화 (macOS NFD 함정 방지) — 전 커맨드 공통.
pub(crate) fn nfc(s: &str) -> String {
    s.nfc().collect()
}

/// GUI 앱은 PATH가 최소화되어 있으므로 node bin 디렉토리를 앞에 붙인다 (스폰 공통).
/// PATH 구분자·기본 후보 경로가 플랫폼마다 달라 cfg로 분기한다.
#[cfg(unix)]
pub(crate) fn spawn_path_env() -> String {
    let base_path = std::env::var("PATH").unwrap_or_default();
    let node_bin = node_bin_dir();
    let extra = if node_bin.is_empty() {
        String::new()
    } else {
        format!("{node_bin}:")
    };
    format!("{extra}/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:{base_path}")
}

/// Windows PATH: 구분자 `;`. node bin 디렉토리만 prepend하고 기존 PATH를 그대로 잇는다
/// (유닉스식 /usr/bin 등 시스템 후보는 Windows에 없으므로 붙이지 않는다).
#[cfg(windows)]
pub(crate) fn spawn_path_env() -> String {
    let base_path = std::env::var("PATH").unwrap_or_default();
    let node_bin = node_bin_dir();
    if node_bin.is_empty() {
        base_path
    } else if base_path.is_empty() {
        node_bin
    } else {
        format!("{node_bin};{base_path}")
    }
}

/// 실행 파일명 후보 — Windows는 `.cmd`(npm 래퍼)·`.exe`도 함께 시도한다.
/// 유닉스는 확장자 없는 이름 하나만.
pub(crate) fn exe_name_candidates(name: &str) -> Vec<String> {
    #[cfg(windows)]
    {
        vec![format!("{name}.cmd"), format!("{name}.exe"), name.to_string()]
    }
    #[cfg(not(windows))]
    {
        vec![name.to_string()]
    }
}

/// node bin 디렉토리에서 실행 파일 후보 중 존재하는 절대경로를 찾는다.
fn resolve_in_dir(dir: &str, name: &str) -> Option<String> {
    if dir.is_empty() {
        return None;
    }
    for cand in exe_name_candidates(name) {
        let p = PathBuf::from(dir).join(&cand);
        if p.is_file() {
            return Some(p.to_string_lossy().into_owned());
        }
    }
    None
}

/// node bin 디렉토리를 런타임 해석 — env `AONE_NODE_BIN` → nvm 최신 → npx의 부모 → 빈 문자열.
/// 심사위원 머신에서 하드코딩 nvm 경로가 없어도 동작해야 한다.
/// (nvm 프로브는 유닉스(~/.nvm) 레이아웃 전용 — Windows(nvm-windows)는 PATH 탐색에 의존한다.)
pub(crate) fn node_bin_dir() -> String {
    if let Ok(dir) = std::env::var("AONE_NODE_BIN") {
        if !dir.is_empty() {
            return dir;
        }
    }
    // nvm 설치본 중 npx가 있는 최신 버전 디렉토리 (유닉스 레이아웃)
    #[cfg(unix)]
    if let Some(home) = dirs::home_dir() {
        let versions = home.join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&versions) {
            let mut dirs: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path().join("bin"))
                .filter(|b| b.join("npx").is_file())
                .collect();
            dirs.sort();
            if let Some(latest) = dirs.pop() {
                return latest.to_string_lossy().into_owned();
            }
        }
    }
    // Homebrew·시스템 경로 또는 Windows PATH에 npx가 있으면 굳이 prepend 불필요
    String::new()
}

/// npx 실행 바이너리 — node bin 디렉토리에 있으면 절대경로, 없으면 "npx"(PATH 탐색).
/// Windows에선 `npx.cmd`를 우선한다.
pub(crate) fn npx_bin() -> String {
    if let Some(p) = resolve_in_dir(&node_bin_dir(), "npx") {
        return p;
    }
    // PATH 탐색 폴백. Windows는 실제 실행 파일이 npx.cmd라 확장자를 붙여야 찾는다.
    #[cfg(windows)]
    {
        "npx.cmd".to_string()
    }
    #[cfg(not(windows))]
    {
        "npx".to_string()
    }
}

/// claude 실행 바이너리 — env `AONE_CLAUDE_BIN` → nvm bin/claude → "claude"(PATH 탐색).
/// 개발 머신의 cmux 래퍼 회피용 하드코딩을 런타임 해석으로 대체.
/// Windows에선 `claude.cmd`/`claude.exe`도 함께 시도한다.
pub(crate) fn claude_bin() -> String {
    if let Ok(bin) = std::env::var("AONE_CLAUDE_BIN") {
        if !bin.is_empty() {
            return bin;
        }
    }
    if let Some(p) = resolve_in_dir(&node_bin_dir(), "claude") {
        return p;
    }
    "claude".to_string()
}

/// 파이프라인 스폰에 데이터 루트 env를 주입한다 (계약 §3).
/// 새 레이아웃(AONE_ROOT env 설정)에서만 `AONE_ROOT`·`AONE_DATA`·`AONE_DB`를 넣는다.
/// 개발 폴백에선 아무것도 주입하지 않아 파이프라인도 현행 폴백 경로를 쓴다.
pub(crate) fn inject_root_env(cmd: &mut Command) {
    if !in_new_layout() {
        return;
    }
    let data = data_dir();
    cmd.env("AONE_ROOT", aone_root());
    cmd.env("AONE_DB", data.join("knowledge.db"));
    cmd.env("AONE_DATA", data);
}

/// 엔진별 기본 모델을 주입한다 (사용자 설정이 없을 때). 일반 사용자는 Opus 요금제가
/// 아니므로 Claude 기본을 접근성 좋은 Sonnet으로 둔다. env가 이미 있으면 존중.
/// (파이프라인 resolveModel이 명시 --model > 이 env > CLI 기본값 순으로 해석)
pub(crate) fn inject_model_env(cmd: &mut Command) {
    if std::env::var("AONE_CLAUDE_MODEL").is_err() {
        cmd.env("AONE_CLAUDE_MODEL", "claude-sonnet-5");
    }
}

/// 개발 폴백 스냅샷 export 대상 = 앱이 fetch하는 public/snapshots (개발 머신 상대경로).
fn dev_snapshot_out_dir() -> PathBuf {
    crate::commands::paths::pipeline_dir()
        .join("..")
        .join("aone-app")
        .join("public")
        .join("snapshots")
}

/// 분석 파이프라인(run → export) 두 단계를 잇는 Command를 플랫폼별로 만든다.
/// 반환된 Command는 아직 spawn 전이며, 호출자가 current_dir/env/stdio를 채워 spawn한다.
///
/// - 유닉스(현행 100% 보존): `/bin/sh -c "npx run $1 $2 && npx export $1 $2"` +
///   subject/unit을 위치 인자($1·$2)로 전달 → 한글·공백 인젝션/이스케이프 무해.
/// - Windows: `/bin/sh`가 없으므로 `cmd /C`로 동일하게 `&&` 체이닝하되,
///   위치 인자를 못 쓰므로 subject/unit을 큰따옴표로 감싸 인라인 삽입한다.
///   cmd 인용을 깨는 문자(`" % < > | & ^` 및 개행)는 사전에 거부해 인젝션을 막는다.
///   (폴더명엔 이런 문자가 오지 않는다.)
#[cfg(unix)]
fn build_analysis_cmd(
    subject: &str,
    unit: &str,
    cli_engine: &str,
    out_dir: Option<&std::path::Path>,
) -> Result<Command, String> {
    let script = match out_dir {
        None => format!(
            "npx tsx src/cli.ts run --subject \"$1\" --unit \"$2\" --engine {cli_engine} --concurrency 2 \
             && npx tsx src/cli.ts export --subject \"$1\" --unit \"$2\""
        ),
        Some(out) => {
            let out = out.to_string_lossy();
            format!(
                "npx tsx src/cli.ts run --subject \"$1\" --unit \"$2\" --engine {cli_engine} --concurrency 2 \
                 && npx tsx src/cli.ts export --subject \"$1\" --unit \"$2\" --out '{out}'"
            )
        }
    };
    let mut cmd = Command::new("/bin/sh");
    cmd.args(["-c", &script, "sh", subject, unit]);
    Ok(cmd)
}

#[cfg(windows)]
fn build_analysis_cmd(
    subject: &str,
    unit: &str,
    cli_engine: &str,
    out_dir: Option<&std::path::Path>,
) -> Result<Command, String> {
    // cmd 큰따옴표 인용을 깨거나 명령을 주입할 수 있는 문자를 거부한다.
    let unsafe_char = |s: &str| s.chars().find(|c| "\"%<>|&^\r\n".contains(*c));
    for (label, v) in [("subject", subject), ("unit", unit)] {
        if let Some(c) = unsafe_char(v) {
            return Err(format!("{label}에 사용할 수 없는 문자가 있습니다: {c:?}"));
        }
    }
    // npx는 Windows에서 npx.cmd 래퍼이므로 cmd /C를 거쳐야 안전하게 실행된다.
    let npx = npx_bin();
    let run = format!(
        "\"{npx}\" tsx src/cli.ts run --subject \"{subject}\" --unit \"{unit}\" --engine {cli_engine} --concurrency 2"
    );
    let export = match out_dir {
        None => format!(
            "\"{npx}\" tsx src/cli.ts export --subject \"{subject}\" --unit \"{unit}\""
        ),
        Some(out) => {
            let out = out.to_string_lossy();
            format!(
                "\"{npx}\" tsx src/cli.ts export --subject \"{subject}\" --unit \"{unit}\" --out \"{out}\""
            )
        }
    };
    let script = format!("{run} && {export}");
    let mut cmd = Command::new("cmd");
    cmd.args(["/C", &script]);
    Ok(cmd)
}

/// 프론트 엔진 id("claude"|"codex"|"gemini") → (파이프라인 CLI 엔진명, gemini 키).
/// gemini는 ~/.aone/keys.json의 키를 함께 반환 — 호출자가 GEMINI_API_KEY로 주입한다.
pub(crate) fn cli_engine_of(engine: Option<&str>) -> Result<(&'static str, Option<String>), String> {
    match engine.unwrap_or("claude") {
        "claude" | "claude-cli" => Ok(("claude-cli", None)),
        "codex" | "codex-cli" => Ok(("codex-cli", None)),
        "gemini" | "gemini-api" => {
            let key = crate::commands::keys::api_key("gemini").ok_or(
                "Gemini API 키가 등록되어 있지 않습니다. 설정에서 API 키를 저장해주세요.",
            )?;
            Ok(("gemini-api", Some(key)))
        }
        other => Err(format!("지원하지 않는 엔진: {other}")),
    }
}

struct AnalysisRun {
    child: Option<Child>, // reap 후 None
    subject: String,
    unit: String,
    exit_code: Option<i32>,
    log_path: PathBuf,
}

#[derive(Default)]
pub struct AnalysisState(Mutex<Option<AnalysisRun>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisStatus {
    /// "idle" | "running" | "done" | "failed"
    pub status: String,
    pub subject: Option<String>,
    pub unit: Option<String>,
    pub exit_code: Option<i32>,
    pub log_tail: String,
}

pub(crate) fn log_tail(path: &PathBuf) -> String {
    let Ok(content) = fs::read_to_string(path) else {
        return String::new();
    };
    let tail: Vec<&str> = content.lines().rev().take(12).collect();
    tail.into_iter().rev().collect::<Vec<_>>().join("\n")
}

/// 에이전트 콘솔용 로그 스트리밍 응답.
/// `lines`는 요청한 `from_line`(0-based) 이후의 신규 줄만 담는다.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogChunk {
    /// from_line부터의 신규 줄
    pub lines: Vec<String>,
    /// 다음 폴링에 넘길 커서 (= 현재까지 읽은 총 줄 수)
    pub next_line: usize,
    /// 프로세스 종료 여부 (idle 상태도 true)
    pub done: bool,
    pub exit_code: Option<i32>,
}

/// 로그 파일을 from_line부터 읽어 신규 줄만 반환.
pub(crate) fn log_lines_from(path: &PathBuf, from_line: usize) -> (Vec<String>, usize) {
    let Ok(content) = fs::read_to_string(path) else {
        return (Vec::new(), from_line);
    };
    let all: Vec<&str> = content.lines().collect();
    let total = all.len();
    if from_line >= total {
        return (Vec::new(), total);
    }
    (
        all[from_line..].iter().map(|s| s.to_string()).collect(),
        total,
    )
}

/// 실행 중인 자식 프로세스를 확인해 (done, exit_code)를 반환하고, 종료됐으면 reap한다.
fn reap(child: &mut Option<Child>, exit_code: &mut Option<i32>) -> Result<bool, String> {
    if let Some(c) = child.as_mut() {
        match c.try_wait() {
            Ok(None) => return Ok(false), // 아직 실행 중
            Ok(Some(status)) => {
                *exit_code = status.code();
                *child = None;
            }
            Err(e) => return Err(format!("프로세스 상태 확인 실패: {e}")),
        }
    }
    Ok(true)
}

/// 분석/슬라이드 요약 실행 로그를 from_line부터 증분 조회한다.
/// kind: "analysis" (aone-ui-run.log) | "slides" (aone-slides-run.log)
#[tauri::command]
pub async fn analysis_log(
    kind: Option<String>,
    from_line: usize,
    analysis: tauri::State<'_, AnalysisState>,
    slides: tauri::State<'_, crate::commands::slides::SlideSummarizeState>,
) -> Result<LogChunk, String> {
    let kind = kind.unwrap_or_else(|| "analysis".into());
    let (log_path, done, exit_code) = match kind.as_str() {
        "analysis" => {
            let mut guard = analysis.0.lock().map_err(|e| e.to_string())?;
            match guard.as_mut() {
                None => (logs_dir().join("aone-ui-run.log"), true, None),
                Some(run) => {
                    let done = reap(&mut run.child, &mut run.exit_code)?;
                    (run.log_path.clone(), done, run.exit_code)
                }
            }
        }
        "slides" => {
            let (path, done, code) = slides.snapshot()?;
            (path, done, code)
        }
        other => return Err(format!("지원하지 않는 kind: {other}")),
    };

    let (lines, next_line) = log_lines_from(&log_path, from_line);
    Ok(LogChunk {
        lines,
        next_line,
        done,
        exit_code,
    })
}

#[tauri::command]
pub async fn run_folder_analysis(
    subject: String,
    unit: String,
    engine: Option<String>,
    state: tauri::State<'_, AnalysisState>,
) -> Result<(), String> {
    let subject = nfc(subject.trim());
    let unit = nfc(unit.trim());
    if subject.is_empty() || unit.is_empty() {
        return Err("subject와 unit을 모두 지정해야 합니다.".into());
    }

    // 활성 엔진 → 파이프라인 CLI 엔진 이름 매핑 (gemini는 저장된 API 키 동반)
    let (cli_engine, gemini_key) = cli_engine_of(engine.as_deref())?;

    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    // 이미 실행 중이면 거부
    if let Some(run) = guard.as_mut() {
        if let Some(child) = run.child.as_mut() {
            match child.try_wait() {
                Ok(None) => return Err("이미 분석이 실행 중입니다.".into()),
                Ok(Some(status)) => {
                    run.exit_code = status.code();
                    run.child = None;
                }
                Err(e) => return Err(format!("프로세스 상태 확인 실패: {e}")),
            }
        }
    }

    let log_path = logs_dir().join("aone-ui-run.log");
    let log_file = fs::File::create(&log_path).map_err(|e| format!("로그 파일 생성 실패: {e}"))?;
    let err_file = log_file.try_clone().map_err(|e| e.to_string())?;

    // 개발 폴백: export를 public/snapshots(--out)로 내보낸다 (프론트 fetch 위치 유지).
    // 새 레이아웃: --out 없이 export → 파이프라인이 폴더 .aone/로 산출물을 쓴다 (계약 §4).
    let out_dir = if in_new_layout() {
        None
    } else {
        Some(dev_snapshot_out_dir())
    };

    let mut cmd = build_analysis_cmd(&subject, &unit, cli_engine, out_dir.as_deref())?;
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
        .map_err(|e| format!("파이프라인 실행 실패: {e}"))?;

    *guard = Some(AnalysisRun {
        child: Some(child),
        subject,
        unit,
        exit_code: None,
        log_path,
    });
    Ok(())
}

/// 실행 중인 작업을 중지한다. kind: "analysis" | "slides".
/// 저장된 Child 핸들에 kill() → reap → 상태를 "failed"(exit_code=None)로 정리한다.
/// 실행 중이 아니면 성공으로 처리 (idempotent).
#[tauri::command]
pub async fn stop_analysis(
    kind: Option<String>,
    analysis: tauri::State<'_, AnalysisState>,
    slides: tauri::State<'_, crate::commands::slides::SlideSummarizeState>,
) -> Result<(), String> {
    match kind.as_deref().unwrap_or("analysis") {
        "analysis" => {
            let mut guard = analysis.0.lock().map_err(|e| e.to_string())?;
            if let Some(run) = guard.as_mut() {
                kill_child(&mut run.child)?;
            }
            Ok(())
        }
        "slides" => slides.stop(),
        other => Err(format!("지원하지 않는 kind: {other}")),
    }
}

/// Child에 kill()을 보내고 좀비가 남지 않게 wait()으로 거둔다.
pub(crate) fn kill_child(child: &mut Option<Child>) -> Result<(), String> {
    let Some(c) = child.as_mut() else {
        return Ok(()); // 이미 종료됨
    };
    // 이미 죽은 프로세스에 대한 kill 실패는 무시한다.
    let _ = c.kill();
    c.wait().map_err(|e| format!("프로세스 종료 대기 실패: {e}"))?;
    *child = None;
    Ok(())
}

#[tauri::command]
pub async fn analysis_status(
    state: tauri::State<'_, AnalysisState>,
) -> Result<AnalysisStatus, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    let Some(run) = guard.as_mut() else {
        return Ok(AnalysisStatus {
            status: "idle".into(),
            subject: None,
            unit: None,
            exit_code: None,
            log_tail: String::new(),
        });
    };

    if let Some(child) = run.child.as_mut() {
        match child.try_wait() {
            Ok(None) => {
                return Ok(AnalysisStatus {
                    status: "running".into(),
                    subject: Some(run.subject.clone()),
                    unit: Some(run.unit.clone()),
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
    Ok(AnalysisStatus {
        status: if success { "done" } else { "failed" }.into(),
        subject: Some(run.subject.clone()),
        unit: Some(run.unit.clone()),
        exit_code: run.exit_code,
        log_tail: log_tail(&run.log_path),
    })
}
