//! API 키 저장소 (부록 A1): ~/.aone/keys.json (권한 0600, localStorage 금지 계약).
//! 프론트 invoke: save_api_key { provider, key } / api_key_status → { gemini: bool } / delete_api_key { provider }

use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

fn keys_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("홈 디렉토리를 찾을 수 없습니다.")?;
    let dir = home.join(".aone");
    fs::create_dir_all(&dir).map_err(|e| format!("디렉토리 생성 실패: {e}"))?;
    Ok(dir.join("keys.json"))
}

fn load_keys_from(path: &Path) -> Map<String, Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

fn save_keys_to(path: &Path, keys: &Map<String, Value>) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&Value::Object(keys.clone()))
        .map_err(|e| format!("keys.json 직렬화 실패: {e}"))?;
    fs::write(path, json).map_err(|e| format!("keys.json 쓰기 실패: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("keys.json 권한(0600) 설정 실패: {e}"))?;
    }
    Ok(())
}

fn validate_provider(provider: &str) -> Result<(), String> {
    if provider.is_empty()
        || !provider
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    {
        return Err(format!("허용되지 않는 provider: {provider}"));
    }
    Ok(())
}

/// 저장된 API 키 조회 — 다른 커맨드(analysis/slides/timetable/engines)가 사용.
pub(crate) fn api_key(provider: &str) -> Option<String> {
    let path = keys_path().ok()?;
    load_keys_from(&path)
        .get(provider)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

#[tauri::command]
pub fn save_api_key(provider: String, key: String) -> Result<(), String> {
    validate_provider(&provider)?;
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("빈 API 키는 저장할 수 없습니다.".into());
    }
    let path = keys_path()?;
    let mut keys = load_keys_from(&path);
    keys.insert(provider, Value::String(key));
    save_keys_to(&path, &keys)
}

/// 저장된 키 존재 여부 — `{ "gemini": bool }`.
#[tauri::command]
pub fn api_key_status() -> Result<Value, String> {
    Ok(serde_json::json!({ "gemini": api_key("gemini").is_some() }))
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    validate_provider(&provider)?;
    let path = keys_path()?;
    let mut keys = load_keys_from(&path);
    keys.remove(&provider);
    save_keys_to(&path, &keys)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// keys.json 저장·로드 라운드트립 + 0600 권한.
    #[test]
    fn keys_json_roundtrip_and_permissions() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("keys.json");

        let mut keys = Map::new();
        keys.insert("gemini".into(), Value::String("AIza-test-123".into()));
        save_keys_to(&path, &keys).expect("save");

        // 권한 0600
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }

        // 로드 라운드트립
        let loaded = load_keys_from(&path);
        assert_eq!(loaded.get("gemini").and_then(|v| v.as_str()), Some("AIza-test-123"));

        // 삭제 후 저장 → 키 없음
        let mut loaded = loaded;
        loaded.remove("gemini");
        save_keys_to(&path, &loaded).expect("save2");
        assert!(load_keys_from(&path).get("gemini").is_none());
    }

    /// 손상된 keys.json은 빈 맵으로 취급 (크래시 금지).
    #[test]
    fn corrupt_keys_json_treated_as_empty() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("keys.json");
        fs::write(&path, "not-json{{").unwrap();
        assert!(load_keys_from(&path).is_empty());
        // 파일이 아예 없어도 빈 맵
        assert!(load_keys_from(&tmp.path().join("none.json")).is_empty());
    }

    /// provider 이름 검증.
    #[test]
    fn provider_validation() {
        assert!(validate_provider("gemini").is_ok());
        assert!(validate_provider("openai-compat_2").is_ok());
        assert!(validate_provider("").is_err());
        assert!(validate_provider("Gemini").is_err());
        assert!(validate_provider("../etc").is_err());
        assert!(validate_provider("a b").is_err());
    }
}
