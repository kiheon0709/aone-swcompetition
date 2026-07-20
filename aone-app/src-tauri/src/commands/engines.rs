use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use super::analysis::exe_name_candidates;

/// 앱 전용 격리 홈. Codex: ~/.aone/codex, Claude: ~/.aone/claude
fn aone_dir(sub: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("홈 디렉토리를 찾을 수 없습니다.")?;
    let dir = home.join(".aone").join(sub);
    fs::create_dir_all(&dir).map_err(|e| format!("디렉토리 생성 실패: {e}"))?;
    Ok(dir)
}

/// GUI 앱으로 실행되면 PATH가 최소화되어 CLI를 못 찾을 수 있으므로
/// PATH 탐색 + 일반적인 설치 경로 후보를 함께 확인한다.
fn find_binary(name: &str) -> Option<PathBuf> {
    // 0) claude는 개발 머신에서 PATH 항목이 cmux 래퍼일 수 있어 실제 바이너리를 우선한다.
    //    런타임 해석(env AONE_CLAUDE_BIN → nvm bin/claude)으로 심사위원 머신에서도 동작.
    if name == "claude" {
        let resolved = super::analysis::claude_bin();
        let path = PathBuf::from(&resolved);
        if path.is_file() {
            return Some(path);
        }
    }
    // 실행 파일명 후보 — Windows는 .cmd(npm 래퍼)·.exe도 함께 시도.
    let names: Vec<String> = exe_name_candidates(name);
    // 1) PATH 탐색
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            for n in &names {
                let candidate = dir.join(n);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    // 2) 대표적인 설치 경로 후보 (플랫폼별)
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(windows)]
    {
        // Windows: npm 전역·nvm-windows 심볼릭 링크·사용자 설치 경로
        if let Some(appdata) = std::env::var_os("APPDATA") {
            candidates.push(PathBuf::from(&appdata).join("npm").join(name));
        }
        if let Some(pf) = std::env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(&pf).join("nodejs").join(name));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(&local).join("Programs").join(name).join(name));
        }
    }
    #[cfg(not(windows))]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin").join(name));
        candidates.push(PathBuf::from("/usr/local/bin").join(name));
        if let Some(home) = dirs::home_dir() {
            candidates.push(home.join(".local/bin").join(name));
            candidates.push(home.join(".claude/local").join(name));
            // nvm 글로벌 bin
            if let Ok(entries) = fs::read_dir(home.join(".nvm/versions/node")) {
                for entry in entries.flatten() {
                    candidates.push(entry.path().join("bin").join(name));
                }
            }
        }
    }
    // 각 후보 디렉토리에서 확장자 변형까지 확인
    for base in &candidates {
        if base.is_file() {
            return Some(base.clone());
        }
        if let (Some(dir), Some(fname)) = (base.parent(), base.file_name()) {
            let fname = fname.to_string_lossy();
            for n in exe_name_candidates(&fname) {
                let p = dir.join(&n);
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }
    None
}

/// 격리 환경변수가 적용된 Command 생성.
fn engine_command(engine: &str) -> Result<Command, String> {
    let bin = find_binary(engine).ok_or_else(|| format!("{engine} CLI가 설치되어 있지 않습니다."))?;
    let mut cmd = Command::new(bin);
    match engine {
        "codex" => {
            cmd.env("CODEX_HOME", aone_dir("codex")?);
        }
        "claude" => {
            // Claude는 전역 인증(Keychain)을 그대로 사용한다.
            // (격리 CLAUDE_CONFIG_DIR을 쓰면 앱에서 재로그인이 필요해 연결 확인이 불가능)
        }
        _ => return Err(format!("지원하지 않는 엔진: {engine}")),
    }
    if let Some(home) = dirs::home_dir() {
        cmd.current_dir(home);
    }
    Ok(cmd)
}

pub(crate) struct CmdOutput {
    pub(crate) status: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

/// 타임아웃을 걸고 커맨드 실행. stdout/stderr는 임시 파일로 리다이렉트해
/// 파이프 버퍼 블로킹 없이 폴링한다.
pub(crate) fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<CmdOutput, String> {
    let tmp = std::env::temp_dir();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let out_path = tmp.join(format!("aone-cmd-{stamp}.out"));
    let err_path = tmp.join(format!("aone-cmd-{stamp}.err"));

    let out_file = fs::File::create(&out_path).map_err(|e| e.to_string())?;
    let err_file = fs::File::create(&err_path).map_err(|e| e.to_string())?;

    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::from(out_file))
        .stderr(Stdio::from(err_file))
        .spawn()
        .map_err(|e| format!("실행 실패: {e}"))?;

    let started = Instant::now();
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break Some(status),
            None => {
                if started.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        }
    };

    let stdout = fs::read_to_string(&out_path).unwrap_or_default();
    let stderr = fs::read_to_string(&err_path).unwrap_or_default();
    let _ = fs::remove_file(&out_path);
    let _ = fs::remove_file(&err_path);

    match status {
        Some(s) => Ok(CmdOutput {
            status: s.code(),
            stdout,
            stderr,
        }),
        None => Err(format!("타임아웃({}초) 초과", timeout.as_secs())),
    }
}

fn cli_version(engine: &str) -> Option<String> {
    let mut cmd = engine_command(engine).ok()?;
    cmd.arg("--version");
    let out = run_with_timeout(cmd, Duration::from_secs(15)).ok()?;
    if out.status == Some(0) {
        Some(out.stdout.trim().to_string())
    } else {
        None
    }
}

/// `codex login status` exit code로 로그인 여부 판정 (격리 CODEX_HOME 기준).
fn codex_logged_in() -> bool {
    let Ok(mut cmd) = engine_command("codex") else {
        return false;
    };
    cmd.args(["login", "status"]);
    match run_with_timeout(cmd, Duration::from_secs(15)) {
        Ok(out) => out.status == Some(0),
        Err(_) => false,
    }
}

/// ~/.aone/claude 안에 credential 파일이 있는지 확인.
fn claude_isolated_logged_in() -> bool {
    let Ok(dir) = aone_dir("claude") else {
        return false;
    };
    if dir.join(".credentials.json").is_file() {
        return true;
    }
    // 일부 버전은 credentials.json(점 없는 이름)을 사용
    dir.join("credentials.json").is_file()
}

/// 전역 ~/.claude/.credentials.json 존재 여부 (참고용).
fn claude_global_credentials() -> bool {
    dirs::home_dir()
        .map(|h| h.join(".claude").join(".credentials.json").is_file())
        .unwrap_or(false)
}

/// Gemini API 키 유효성: 모델 목록 GET 1회 (무과금·저비용).
/// HTTP 클라이언트 의존성 없이 시스템 curl 사용. 키는 URL이 아닌 헤더로 전달.
fn gemini_key_valid(key: &str) -> bool {
    // null 장치는 플랫폼마다 다르다: 유닉스 /dev/null, Windows NUL.
    // (curl은 Windows 10+에 curl.exe로 기본 포함된다.)
    #[cfg(windows)]
    let null_device = "NUL";
    #[cfg(not(windows))]
    let null_device = "/dev/null";
    let mut cmd = Command::new("curl");
    cmd.args([
        "-s",
        "-o",
        null_device,
        "-w",
        "%{http_code}",
        "--max-time",
        "10",
        "-H",
        &format!("x-goog-api-key: {key}"),
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
    ]);
    match run_with_timeout(cmd, Duration::from_secs(15)) {
        Ok(out) => out.status == Some(0) && out.stdout.trim() == "200",
        Err(_) => false,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub codex_installed: bool,
    pub codex_version: Option<String>,
    pub codex_logged_in: bool,
    pub claude_installed: bool,
    pub claude_version: Option<String>,
    pub claude_logged_in: bool,
    pub claude_global_credentials: bool,
    /// ~/.aone/keys.json에 gemini 키가 저장돼 있는지
    pub gemini_key_present: bool,
    /// 저장된 키로 모델 목록 GET 1회가 성공했는지 (키 없으면 false)
    pub gemini_valid: bool,
}

#[tauri::command]
pub async fn detect_engines() -> Result<EngineStatus, String> {
    let codex_version = cli_version("codex");
    let claude_version = cli_version("claude");
    let codex_installed = codex_version.is_some() || find_binary("codex").is_some();
    let claude_installed = claude_version.is_some() || find_binary("claude").is_some();
    let gemini_key = crate::commands::keys::api_key("gemini");

    Ok(EngineStatus {
        codex_installed,
        codex_version,
        codex_logged_in: codex_installed && codex_logged_in(),
        claude_installed,
        claude_version,
        claude_logged_in: claude_isolated_logged_in(),
        claude_global_credentials: claude_global_credentials(),
        gemini_key_present: gemini_key.is_some(),
        gemini_valid: gemini_key.as_deref().map(gemini_key_valid).unwrap_or(false),
    })
}

/// `codex login`을 non-blocking으로 spawn. codex가 스스로 브라우저를 연다.
#[tauri::command]
pub async fn connect_codex() -> Result<(), String> {
    let mut cmd = engine_command("codex")?;
    cmd.arg("login")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd.spawn().map_err(|e| format!("codex login 실행 실패: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn codex_status() -> String {
    if find_binary("codex").is_none() {
        return "not_installed".to_string();
    }
    if codex_logged_in() {
        "logged_in".to_string()
    } else {
        "not_logged_in".to_string()
    }
}

const LLM_TIMEOUT: Duration = Duration::from_secs(120);

#[tauri::command]
pub async fn run_llm(engine: String, prompt: String) -> Result<String, String> {
    match engine.as_str() {
        "codex" => run_codex(&prompt),
        "claude" => run_claude(&prompt),
        other => Err(format!("지원하지 않는 엔진: {other}")),
    }
}

fn run_codex(prompt: &str) -> Result<String, String> {
    let last_msg_path = std::env::temp_dir().join("aone-last-msg.txt");
    let _ = fs::remove_file(&last_msg_path);

    let mut cmd = engine_command("codex")?;
    cmd.args(["exec", "--skip-git-repo-check", "-o"])
        .arg(&last_msg_path)
        .arg(prompt);

    let out = run_with_timeout(cmd, LLM_TIMEOUT)?;
    if out.status != Some(0) {
        return Err(format!(
            "codex exec 실패 (exit {:?}): {}",
            out.status,
            out.stderr.trim()
        ));
    }

    // 1순위: --output-last-message 파일
    if let Ok(msg) = fs::read_to_string(&last_msg_path) {
        let msg = msg.trim();
        if !msg.is_empty() {
            return Ok(msg.to_string());
        }
    }
    // 2순위: stdout 폴백
    let stdout = out.stdout.trim();
    if stdout.is_empty() {
        Err("codex 응답이 비어 있습니다.".to_string())
    } else {
        Ok(stdout.to_string())
    }
}

fn run_claude(prompt: &str) -> Result<String, String> {
    let mut cmd = engine_command("claude")?;
    cmd.args(["-p", prompt, "--output-format", "json"]);

    let out = run_with_timeout(cmd, LLM_TIMEOUT)?;
    if out.status != Some(0) {
        return Err(format!(
            "claude 실행 실패 (exit {:?}): {}",
            out.status,
            out.stderr.trim()
        ));
    }

    let parsed: serde_json::Value = serde_json::from_str(out.stdout.trim())
        .map_err(|e| format!("claude 응답 JSON 파싱 실패: {e}"))?;
    parsed
        .get("result")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "claude 응답에 result 필드가 없습니다.".to_string())
}
