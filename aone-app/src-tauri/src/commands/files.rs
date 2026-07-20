//! goldset 파일 업로드·재스캔: 네이티브 다이얼로그로 파일을 골라 subject/unit 폴더에 복사하고,
//! goldset을 subject/unit 트리로 재귀 스캔해 files.json 매니페스트(§7)를 재생성한다.
//! 개발 폴백에선 PDF를 웹뷰가 fetch할 수 있도록 public/uploads/{slug}/ 로 미러링한다
//! (새 레이아웃에선 프론트가 원본을 직접 읽으므로 미러링을 스킵한다 — 계약 §5).
//! 모든 절대 경로는 commands::paths 헬퍼로 런타임 해석한다 (계약 §3).

use super::analysis::nfc;
use super::paths::{aone_root, files_json_path, in_new_layout, trash_dir, uploads_dir};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// goldset 루트 직속 파일의 미러 키 (앱과 공유하는 약속).
const ROOT_KEY: &str = "__root__";

#[derive(Serialize, Clone)]
struct FileEntry {
    name: String,
    kind: &'static str,
    size: u64,
}

/// files.json 매니페스트 (§7) — Rust가 쓰고 프론트가 읽는다.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UnitEntry {
    name: String,
    order: u32,
    files: Vec<FileEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SubjectEntry {
    name: String,
    root_files: Vec<FileEntry>,
    units: Vec<UnitEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    subjects: Vec<SubjectEntry>,
    root_files: Vec<FileEntry>,
}

/// PDF 미러링 대상: (uploads 하위 slug 키, 원본 폴더, 스캔 결과).
struct MirrorTarget {
    key: String,
    dir: PathBuf,
    entries: Vec<FileEntry>,
}

/// 확장자 (소문자, 점 제외). 확장자가 없으면 "".
fn ext_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// 업로드 화이트리스트 (부록 A3) — 이 확장자만 goldset으로 복사한다.
const ALLOWED_UPLOAD_EXTS: [&str; 8] = ["pdf", "ppt", "pptx", "txt", "md", "png", "jpg", "jpeg"];
/// 오디오 원본은 별도 사유("audio")로 거부 — 프론트가 전사(.txt) 안내를 띄운다 (시나리오 S3).
const AUDIO_EXTS: [&str; 3] = ["mp3", "m4a", "wav"];

/// 업로드 거부 사유. None = 허용.
fn upload_rejection(name: &str) -> Option<&'static str> {
    let ext = ext_of(name);
    if AUDIO_EXTS.contains(&ext.as_str()) {
        Some("audio")
    } else if ALLOWED_UPLOAD_EXTS.contains(&ext.as_str()) {
        None
    } else {
        Some("unsupported")
    }
}

/// 업로드 거부 항목 — reason: "audio" | "unsupported".
#[derive(Serialize)]
pub struct RejectedFile {
    pub name: String,
    pub reason: &'static str,
}

/// pick_and_upload_files / drop_files 반환 계약 (부록 A3).
/// 프론트는 rejected의 reason별로 토스트를 띄운다.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    pub copied: Vec<String>,
    pub rejected: Vec<RejectedFile>,
}

/// 파일명에 주어진 키워드 중 하나라도 포함되는지 (소문자 비교 전제).
fn has_any(n: &str, keys: &[&str]) -> bool {
    keys.iter().any(|k| n.contains(k))
}

/// 확장자를 모르는 파일(.json·확장자 없음)에 적용하는 기존 파일명 규칙 — 골드셋 호환용 폴백.
fn classify_by_name(n: &str) -> &'static str {
    if n.contains("transcript") {
        "transcript"
    } else if n.contains("theory") {
        "theory"
    } else if n.contains("practice") || n.starts_with("lab_") {
        "practice"
    } else if n.contains("exam") {
        "past_exam"
    } else {
        "other"
    }
}

/// 파일 타입 분류 — 확장자를 먼저 보고, 같은 확장자 안에서 파일명 키워드로 세분한다.
/// 확장자 규칙이 없는 형식(.json 등)은 기존 파일명 규칙으로 폴백한다.
fn classify(name: &str) -> &'static str {
    let n = name.to_lowercase();
    match ext_of(&n).as_str() {
        // 강의자료 — 기본은 이론 슬라이드, 파일명이 실습/기출을 가리키면 그쪽으로.
        "pdf" | "ppt" | "pptx" => {
            if has_any(&n, &["practice", "실습", "lab"]) {
                "practice"
            } else if has_any(&n, &["exam", "기출", "족보"]) {
                "past_exam"
            } else {
                "theory"
            }
        }
        "m4a" | "mp3" | "wav" | "m4v" => "audio",
        "txt" | "md" => {
            if has_any(&n, &["transcript", "전사", "녹음"]) {
                "transcript"
            } else if has_any(&n, &["exam", "기출", "족보"]) {
                "past_exam"
            } else if n.contains("theory") {
                "theory"
            } else if n.contains("practice") || n.starts_with("lab_") {
                "practice"
            } else {
                "note"
            }
        }
        "jpg" | "jpeg" | "png" => {
            if has_any(&n, &["exam", "기출", "족보"]) {
                "past_exam"
            } else {
                "image"
            }
        }
        // .json 등 확장자 규칙이 없는 형식 — 기존 골드셋 파일명 규칙 유지
        "" | "json" => classify_by_name(&n),
        _ => "other",
    }
}

/// folder 파라미터 검증 — goldset 밖 탈출 금지, benchmark(정답지) 금지.
/// `folder`는 goldset 기준 상대 경로 ("" = 루트, "데이터통신/3주차" 등). 비교는 NFC 정규화.
fn validate_folder(folder: &str) -> Result<(), String> {
    if folder.starts_with('/') || folder.split('/').any(|s| nfc(s) == "..") {
        return Err(format!("허용되지 않는 폴더 경로: {folder}"));
    }
    let first = folder.split('/').next().unwrap_or("");
    if nfc(first) == "benchmark" {
        return Err(format!("benchmark 폴더는 사용할 수 없습니다: {folder}"));
    }
    Ok(())
}

/// 원본 경로 목록을 goldset 하위 폴더로 복사 (화이트리스트 적용) — pick/drop 공용.
fn copy_with_whitelist(srcs: Vec<PathBuf>, dest_dir: &Path) -> Result<UploadResult, String> {
    fs::create_dir_all(dest_dir).map_err(|e| format!("폴더 생성 실패: {e}"))?;
    let mut copied = Vec::new();
    let mut rejected = Vec::new();
    for src in srcs {
        let Some(name) = src.file_name().map(|n| n.to_string_lossy().into_owned()) else {
            continue;
        };
        if let Some(reason) = upload_rejection(&name) {
            rejected.push(RejectedFile { name, reason });
            continue;
        }
        fs::copy(&src, dest_dir.join(&name)).map_err(|e| format!("{name} 복사 실패: {e}"))?;
        copied.push(name);
    }
    Ok(UploadResult { copied, rejected })
}

/// 네이티브 파일 선택 다이얼로그 → 선택 파일들을 goldset 하위 임의 폴더로 복사.
/// `folder`는 goldset 기준 상대 경로 — "" (루트) · "데이터통신/3주차" 등 자유.
/// 반환(부록 A3): `{ copied: string[], rejected: [{ name, reason: "audio"|"unsupported" }] }`
/// (취소 시 둘 다 빈 배열).
/// 자료 원본(PDF·PPTX)을 바이트로 읽어 반환한다.
/// 새 레이아웃은 public/uploads 미러링을 하지 않으므로(계약 §5), 웹뷰가 /uploads URL로
/// PDF를 못 연다. 그래서 프론트가 이 커맨드로 원본 바이트를 받아 blob URL로 pdf.js에 넘긴다.
/// `folder`는 자료 루트 기준 상대 경로("데이터통신/1주차"), `name`은 파일명(경로 금지).
#[tauri::command]
pub fn read_doc_bytes(folder: String, name: String) -> Result<Vec<u8>, String> {
    let folder = nfc(folder.trim());
    let name = nfc(name.trim());
    validate_folder(&folder)?;
    if name.contains('/') || name.contains("..") || name.is_empty() {
        return Err(format!("허용되지 않는 파일명: {name}"));
    }
    // 새 레이아웃/개발 폴백 모두 aone_root() 하위에서 원본을 찾는다
    // (개발 폴백에선 aone_root()가 goldset을 가리킨다).
    let mut path = aone_root();
    for seg in folder.split('/').filter(|s| !s.is_empty()) {
        path.push(seg);
    }
    path.push(&name);
    if !path.is_file() {
        return Err(format!("파일을 찾을 수 없습니다: {folder}/{name}"));
    }
    fs::read(&path).map_err(|e| format!("파일 읽기 실패: {e}"))
}

/// 분석 산출물 스냅샷을 읽는다 (프론트가 새 레이아웃에서 폴더별 .aone/를 읽게).
/// kind: "analysis"(폴더 스냅샷) | "docs"(문서 상세) | "slides"(슬라이드 요약) | "guide"(학습가이드).
/// 새 레이아웃: ~/Aone/<subject>/<unit>/.aone/<kind>.json (guide는 <subject>/.aone/guide.json).
/// 개발 폴백: public/snapshots|slides 의 slug 파일. 없으면 Ok(None).
#[tauri::command]
pub fn read_snapshot(kind: String, subject: String, unit: Option<String>) -> Result<Option<String>, String> {
    use super::paths::{aone_root, in_new_layout, pipeline_dir};
    let subject = nfc(subject.trim());
    let unit_n = unit.as_deref().map(|u| nfc(u.trim()));
    let file = if in_new_layout() {
        let root = aone_root();
        match kind.as_str() {
            "guide" => root.join(&subject).join(".aone").join("guide.json"),
            "analysis" | "docs" | "slides" => {
                let u = unit_n.clone().ok_or("unit이 필요합니다")?;
                root.join(&subject).join(&u).join(".aone").join(format!("{kind}.json"))
            }
            other => return Err(format!("알 수 없는 스냅샷 종류: {other}")),
        }
    } else {
        // 개발 폴백: public/snapshots(slug.json / docs_slug.json / guide_subject.json), public/slides(slug.json)
        let public = pipeline_dir().join("..").join("aone-app").join("public");
        let slug = |s: &str, u: &str| format!("{s}__{u}");
        match kind.as_str() {
            "analysis" => {
                let u = unit_n.clone().ok_or("unit이 필요합니다")?;
                public.join("snapshots").join(format!("{}.json", slug(&subject, &u)))
            }
            "docs" => {
                let u = unit_n.clone().ok_or("unit이 필요합니다")?;
                public.join("snapshots").join(format!("docs_{}.json", slug(&subject, &u)))
            }
            "slides" => {
                let u = unit_n.clone().ok_or("unit이 필요합니다")?;
                public.join("slides").join(format!("{}.json", slug(&subject, &u)))
            }
            "guide" => public.join("snapshots").join(format!("guide_{subject}.json")),
            other => return Err(format!("알 수 없는 스냅샷 종류: {other}")),
        }
    };
    if !file.is_file() {
        return Ok(None);
    }
    fs::read_to_string(&file).map(Some).map_err(|e| format!("스냅샷 읽기 실패: {e}"))
}

#[tauri::command]
pub async fn pick_and_upload_files(folder: String) -> Result<UploadResult, String> {
    validate_folder(&folder)?;

    let title = if folder.is_empty() {
        "자료 선택".to_string()
    } else {
        format!("{folder} 자료 선택")
    };

    let picked = rfd::AsyncFileDialog::new()
        .set_title(title)
        .pick_files()
        .await;

    let Some(handles) = picked else {
        // 사용자 취소
        return Ok(UploadResult {
            copied: Vec::new(),
            rejected: Vec::new(),
        });
    };

    let mut dest_dir = aone_root();
    if !folder.is_empty() {
        dest_dir = dest_dir.join(&folder);
    }

    // 파일 복사는 blocking I/O — 런타임 워커를 막지 않도록 spawn_blocking.
    tauri::async_runtime::spawn_blocking(move || {
        let srcs: Vec<PathBuf> = handles.iter().map(|h| h.path().to_path_buf()).collect();
        copy_with_whitelist(srcs, &dest_dir)
    })
    .await
    .map_err(|e| format!("복사 작업 실패: {e}"))?
}

/// 창에 드롭된 절대경로 파일들을 goldset 하위 폴더로 복사.
/// `folder`는 goldset 기준 상대 경로 — ""(루트) · "데이터통신/3주차" 등.
/// 반환(부록 A3): `{ copied: string[], rejected: [{ name, reason: "audio"|"unsupported" }] }`
#[tauri::command]
pub async fn drop_files(paths: Vec<String>, folder: String) -> Result<UploadResult, String> {
    validate_folder(&folder)?;
    let mut dest_dir = aone_root();
    if !folder.is_empty() {
        dest_dir = dest_dir.join(&folder);
    }

    tauri::async_runtime::spawn_blocking(move || {
        let srcs: Vec<PathBuf> = paths
            .into_iter()
            .map(PathBuf::from)
            .filter(|p| p.is_file()) // 디렉터리 드롭은 무시
            .collect();
        copy_with_whitelist(srcs, &dest_dir)
    })
    .await
    .map_err(|e| format!("복사 작업 실패: {e}"))?
}

/// goldset 하위 파일 1개를 삭제.
/// `folder`는 goldset 기준 상대 경로 — ""(루트) · "데이터통신/3주차" 등. `name`은 파일명(경로 금지).
#[tauri::command]
pub fn delete_file(folder: String, name: String) -> Result<(), String> {
    validate_folder(&folder)?;
    if name.is_empty() || name.contains('/') || name.contains("..") {
        return Err(format!("허용되지 않는 파일 이름: {name}"));
    }

    let mut path = aone_root();
    if !folder.is_empty() {
        path = path.join(&folder);
    }
    path = path.join(&name);

    if !path.is_file() {
        return Err(format!("파일을 찾을 수 없습니다: {name}"));
    }
    fs::remove_file(&path).map_err(|e| format!("{name} 삭제 실패: {e}"))
}

/// 한 디렉터리의 파일 목록(숨김 제외, 이름순). 파일명은 NFC 정규화해 싣는다.
fn scan_dir(dir: &Path) -> Vec<FileEntry> {
    let mut entries: Vec<FileEntry> = Vec::new();
    if let Ok(read_dir) = fs::read_dir(dir) {
        for entry in read_dir.flatten() {
            let name = nfc(&entry.file_name().to_string_lossy());
            if name.starts_with('.') || !entry.path().is_file() {
                continue;
            }
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            entries.push(FileEntry {
                kind: classify(&name),
                name,
                size,
            });
        }
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    entries
}

/// unit 이름의 첫 숫자 (§2 unit_order 규칙). 없으면 None.
fn first_number(name: &str) -> Option<u32> {
    let digits: String = name
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse().ok()
    }
}

/// goldset을 subject/unit 트리로 재귀 스캔 (§1) — benchmark·숨김 제외, 이름은 NFC.
/// unit_order(§2): 이름의 첫 숫자, 없으면 1000 + (같은 subject 내 숫자 없는 폴더의 mtime 오름차순 순번).
/// 반환: (§7 매니페스트, PDF 미러링 대상 목록).
fn scan_goldset(root: &Path) -> (Manifest, Vec<MirrorTarget>) {
    let mut mirrors: Vec<MirrorTarget> = Vec::new();

    let root_files = scan_dir(root);
    mirrors.push(MirrorTarget {
        key: ROOT_KEY.to_string(),
        dir: root.to_path_buf(),
        entries: root_files.clone(),
    });

    // 과목 폴더 수집 (benchmark = 정답지, 노출 금지)
    let mut subject_dirs: Vec<(String, PathBuf)> = Vec::new();
    if let Ok(read_dir) = fs::read_dir(root) {
        for entry in read_dir.flatten() {
            let raw = entry.file_name().to_string_lossy().into_owned();
            if !entry.path().is_dir() || raw.starts_with('.') {
                continue;
            }
            let name = nfc(&raw);
            if name == "benchmark" {
                continue;
            }
            subject_dirs.push((name, entry.path()));
        }
    }
    subject_dirs.sort_by(|a, b| a.0.cmp(&b.0));

    let mut subjects: Vec<SubjectEntry> = Vec::new();
    for (subject_name, subject_path) in subject_dirs {
        // 과목 직속 파일 (unit="" 취급 — 보관용)
        let subject_root_files = scan_dir(&subject_path);
        mirrors.push(MirrorTarget {
            key: subject_name.clone(),
            dir: subject_path.clone(),
            entries: subject_root_files.clone(),
        });

        // unit 폴더 수집 + order 부여
        let mut numbered: Vec<(u32, String, PathBuf)> = Vec::new();
        let mut numberless: Vec<(SystemTime, String, PathBuf)> = Vec::new();
        if let Ok(read_dir) = fs::read_dir(&subject_path) {
            for entry in read_dir.flatten() {
                let raw = entry.file_name().to_string_lossy().into_owned();
                if !entry.path().is_dir() || raw.starts_with('.') {
                    continue;
                }
                let name = nfc(&raw);
                match first_number(&name) {
                    Some(n) => numbered.push((n, name, entry.path())),
                    None => {
                        let mtime = entry
                            .metadata()
                            .and_then(|m| m.modified())
                            .unwrap_or(SystemTime::UNIX_EPOCH);
                        numberless.push((mtime, name, entry.path()));
                    }
                }
            }
        }
        numberless.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
        let mut ordered = numbered;
        for (i, (_, name, path)) in numberless.into_iter().enumerate() {
            ordered.push((1000 + i as u32, name, path));
        }
        ordered.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

        let mut units: Vec<UnitEntry> = Vec::new();
        for (order, unit_name, unit_path) in ordered {
            let files = scan_dir(&unit_path);
            // slug = folderKey("{subject}/{unit}")의 '/' → '__'
            mirrors.push(MirrorTarget {
                key: format!("{subject_name}__{unit_name}"),
                dir: unit_path,
                entries: files.clone(),
            });
            units.push(UnitEntry {
                name: unit_name,
                order,
                files,
            });
        }

        subjects.push(SubjectEntry {
            name: subject_name,
            root_files: subject_root_files,
            units,
        });
    }

    (
        Manifest {
            subjects,
            root_files,
        },
        mirrors,
    )
}

/// 한 폴더의 PDF를 public/uploads/{key}/ 에 미러링한다 — 웹뷰(PdfViewer)가 URL로 열 수 있게.
/// goldset이 원본(source of truth): goldset에 있는 PDF는 복사하고, 없어진 PDF는 미러에서 지운다.
/// 미러링 실패는 치명적이지 않다 (files.json 재생성은 계속돼야 한다) — 무시하고 진행.
fn sync_uploads_mirror(key: &str, src_dir: &Path, entries: &[FileEntry]) {
    let mirror_dir = uploads_dir().join(key);
    let pdfs: Vec<&FileEntry> = entries
        .iter()
        .filter(|e| ext_of(&e.name) == "pdf")
        .collect();

    if pdfs.is_empty() {
        // 남은 PDF가 없으면 미러 폴더째 제거 (삭제 반영)
        let _ = fs::remove_dir_all(&mirror_dir);
        return;
    }

    if fs::create_dir_all(&mirror_dir).is_err() {
        return;
    }

    // 1) goldset에 있는 PDF → 미러에 없거나 크기가 다르면 복사
    for e in &pdfs {
        let dest = mirror_dir.join(&e.name);
        let stale = fs::metadata(&dest).map(|m| m.len() != e.size).unwrap_or(true);
        if stale {
            let _ = fs::copy(src_dir.join(&e.name), &dest);
        }
    }

    // 2) goldset에서 사라진 미러 파일 제거
    if let Ok(read_dir) = fs::read_dir(&mirror_dir) {
        for entry in read_dir.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !pdfs.iter().any(|e| e.name == name) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

/// goldset 전체를 subject/unit 트리로 스캔해 public/files.json(§7 매니페스트)을 재생성하고
/// 새 JSON 문자열을 반환. 스캔한 PDF는 public/uploads/{slug}/ 로 미러링한다
/// (slug = "{subject}__{unit}" · 과목 직속은 "{subject}" · 루트는 "__root__").
#[tauri::command]
pub fn rescan_files() -> Result<String, String> {
    let root = aone_root();
    let (manifest, mirrors) = scan_goldset(&root);

    // 새 레이아웃에선 프론트가 원본 PDF를 직접 읽으므로 public/uploads 미러링을 스킵한다 (계약 §5).
    // 개발 폴백에선 기존대로 미러링한다 (웹뷰가 /uploads/{slug}/ 로 fetch).
    if !in_new_layout() {
        for m in &mirrors {
            sync_uploads_mirror(&m.key, &m.dir, &m.entries);
        }

        // 사라진 폴더의 미러 잔재 제거 (weekN → subject/unit 마이그레이션 잔재 포함)
        let valid_keys: Vec<&str> = mirrors.iter().map(|m| m.key.as_str()).collect();
        if let Ok(read_dir) = fs::read_dir(uploads_dir()) {
            for entry in read_dir.flatten() {
                let name = nfc(&entry.file_name().to_string_lossy());
                if entry.path().is_dir() && !valid_keys.contains(&name.as_str()) {
                    let _ = fs::remove_dir_all(entry.path());
                }
            }
        }
    }

    let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    let out = files_json_path();
    if let Some(parent) = out.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&out, &json).map_err(|e| format!("files.json 쓰기 실패: {e}"))?;
    Ok(json)
}

/// 폴더 이름 변경 — 과목("데이터통신") 또는 유닛("데이터통신/3주차") 폴더.
/// new_name은 마지막 세그먼트의 새 이름 (경로 문자 금지).
#[tauri::command]
pub fn rename_folder(folder: String, new_name: String) -> Result<(), String> {
    validate_folder(&folder)?;
    let new_name = crate::commands::analysis::nfc(new_name.trim());
    if new_name.is_empty() || new_name.contains('/') || new_name.contains("..") {
        return Err(format!("허용되지 않는 폴더 이름: {new_name}"));
    }
    let old_path = aone_root().join(&folder);
    if !old_path.is_dir() {
        return Err(format!("폴더를 찾을 수 없습니다: {folder}"));
    }
    let new_path = old_path
        .parent()
        .ok_or("상위 경로 없음")?
        .join(&new_name);
    if new_path.exists() {
        return Err(format!("같은 이름의 폴더가 이미 있습니다: {new_name}"));
    }
    fs::rename(&old_path, &new_path).map_err(|e| format!("이름 변경 실패: {e}"))
}

/// 폴더 삭제 — goldset/.trash/<타임스탬프>__<이름> 으로 이동 (복구 가능).
/// 숨김 폴더라 스캔에서 제외된다.
#[tauri::command]
pub fn trash_folder(folder: String) -> Result<(), String> {
    validate_folder(&folder)?;
    let path = aone_root().join(&folder);
    if !path.is_dir() {
        return Err(format!("폴더를 찾을 수 없습니다: {folder}"));
    }
    let trash_root = trash_dir();
    fs::create_dir_all(&trash_root).map_err(|e| format!("휴지통 생성 실패: {e}"))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let base = folder.replace('/', "__");
    let dest = trash_root.join(format!("{stamp}__{base}"));
    fs::rename(&path, &dest).map_err(|e| format!("휴지통 이동 실패: {e}"))
}

/// 폴더 일괄 생성 — "과목" 또는 "과목/유닛" 상대경로(최대 2단)를 받아 빈 폴더를 만든다.
/// 시간표 인식 직후 과목 폴더·주차 스캐폴드 생성용. 반환: 실제로 새로 만든 경로 목록.
/// 과목명 비교용 정규화 — NFC + 공백 제거 + 소문자.
/// "데이터통신"과 "데이터 통신"을 같은 과목으로 취급해 중복 폴더를 막는다.
fn subject_norm(name: &str) -> String {
    crate::commands::analysis::nfc(name)
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_lowercase()
}

/// 기존 폴더 중 정규화 기준 동일한 이름이 있으면 그 이름을 돌려준다.
fn existing_subject_like(root: &Path, name: &str) -> Option<String> {
    let target = subject_norm(name);
    let entries = std::fs::read_dir(root).ok()?;
    for e in entries.flatten() {
        if !e.path().is_dir() {
            continue;
        }
        let existing = crate::commands::analysis::nfc(&e.file_name().to_string_lossy());
        if subject_norm(&existing) == target {
            return Some(existing);
        }
    }
    None
}

#[tauri::command]
pub fn create_subject_folders(names: Vec<String>) -> Result<Vec<String>, String> {
    let root = aone_root();
    let mut created = Vec::new();
    for raw in names {
        let key = crate::commands::analysis::nfc(raw.trim());
        let segs: Vec<&str> = key.split('/').filter(|s| !s.trim().is_empty()).collect();
        if segs.is_empty() || segs.len() > 2 {
            continue;
        }
        if segs.iter().any(|s| s.contains("..")) || segs[0].eq_ignore_ascii_case("benchmark") {
            continue;
        }
        // 과목 세그먼트: 공백·표기만 다른 기존 폴더가 있으면 그 폴더를 재사용
        let subject_seg = existing_subject_like(&root, segs[0])
            .unwrap_or_else(|| crate::commands::analysis::nfc(segs[0].trim()));
        let mut dir = root.join(&subject_seg);
        let mut key_segs = vec![subject_seg.clone()];
        for seg in segs.iter().skip(1) {
            dir = dir.join(seg.trim());
            key_segs.push(seg.trim().to_string());
        }
        if dir.exists() {
            continue;
        }
        std::fs::create_dir_all(&dir).map_err(|e| format!("폴더 생성 실패({key}): {e}"))?;
        created.push(key_segs.join("/"));
    }
    Ok(created)
}

/// 시간표 캡처 이미지를 네이티브 다이얼로그로 선택 — 절대 경로 반환 (취소 시 None).
/// 홈 "이미지 선택" 버튼용: 웹 file input은 경로를 주지 않아 실인식에 쓸 수 없다.
#[tauri::command]
pub async fn pick_timetable_image() -> Result<Option<String>, String> {
    let picked = rfd::AsyncFileDialog::new()
        .set_title("시간표 캡처 선택")
        .add_filter("이미지", &["png", "jpg", "jpeg"])
        .pick_file()
        .await;
    Ok(picked.map(|h| h.path().to_string_lossy().into_owned()))
}

/// 텍스트(마크다운 등)를 네이티브 저장 다이얼로그로 내보낸다.
/// 반환: 저장한 파일 경로 (사용자가 취소하면 None).
#[tauri::command]
pub async fn save_text_file(name: String, content: String) -> Result<Option<String>, String> {
    let picked = rfd::AsyncFileDialog::new()
        .set_title("학습노트 내보내기")
        .set_file_name(&name)
        .save_file()
        .await;

    let Some(handle) = picked else {
        return Ok(None); // 사용자 취소
    };

    let path = handle.path().to_path_buf();
    // 파일 쓰기는 blocking I/O — 런타임 워커를 막지 않도록 spawn_blocking.
    tauri::async_runtime::spawn_blocking(move || {
        fs::write(&path, content).map_err(|e| format!("저장 실패: {e}"))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| format!("저장 작업 실패: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 기존 골드셋 파일이 예전과 똑같이 분류되는지 (확장자 규칙 도입 회귀 방지).
    #[test]
    fn goldset_classification_unchanged() {
        assert_eq!(classify("week1_theory_01.txt"), "theory");
        assert_eq!(classify("week2_theory_03.txt"), "theory");
        assert_eq!(classify("week1_practice_01.txt"), "practice");
        assert_eq!(classify("transcript.txt"), "transcript");
        assert_eq!(classify("past_exam_2025_raw.txt"), "past_exam");
        assert_eq!(classify("past_exams.json"), "past_exam");
        assert_eq!(classify("lab_lecture.json"), "practice");
        assert_eq!(classify("lab_study.json"), "practice");
    }

    /// 업로드 파일 — 확장자 우선 규칙.
    #[test]
    fn upload_classification_by_extension() {
        assert_eq!(classify("01_Operating_System_overview.pdf"), "theory");
        assert_eq!(classify("2주차 강의.pptx"), "theory");
        assert_eq!(classify("week3_실습자료.pdf"), "practice");
        assert_eq!(classify("lab-intro.pdf"), "practice");
        assert_eq!(classify("2024_기말_기출.pdf"), "past_exam");
        assert_eq!(classify("recording.m4a"), "audio");
        assert_eq!(classify("메모.md"), "note");
        assert_eq!(classify("칠판사진.jpg"), "image");
        assert_eq!(classify("족보사진.png"), "past_exam");
        assert_eq!(classify("archive.zip"), "other");
    }

    /// 업로드 화이트리스트 (부록 A3) — 허용/오디오/미지원 분류.
    #[test]
    fn upload_whitelist() {
        // 허용 8종 (대문자 확장자 포함)
        for name in [
            "강의.pdf", "발표.ppt", "슬라이드.pptx", "전사.txt", "메모.md",
            "칠판.png", "사진.jpg", "캡처.jpeg", "REPORT.PDF",
        ] {
            assert_eq!(upload_rejection(name), None, "{name}는 허용돼야 함");
        }
        // 오디오 → "audio" (전사 안내 대상)
        for name in ["녹음.mp3", "recording.m4a", "lecture.wav", "REC.M4A"] {
            assert_eq!(upload_rejection(name), Some("audio"), "{name}는 audio 거부");
        }
        // 그 외 → "unsupported"
        for name in ["archive.zip", "video.m4v", "data.json", "확장자없음", "script.sh"] {
            assert_eq!(upload_rejection(name), Some("unsupported"), "{name}는 unsupported 거부");
        }
    }

    /// copy_with_whitelist — 허용 파일만 복사되고 거부 목록이 사유와 함께 반환된다.
    #[test]
    fn copy_with_whitelist_filters() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let src_dir = tmp.path().join("src");
        let dest_dir = tmp.path().join("dest");
        fs::create_dir_all(&src_dir).unwrap();
        for name in ["ok.pdf", "voice.mp3", "bad.zip"] {
            fs::write(src_dir.join(name), "x").unwrap();
        }

        let srcs = vec![
            src_dir.join("ok.pdf"),
            src_dir.join("voice.mp3"),
            src_dir.join("bad.zip"),
        ];
        let result = copy_with_whitelist(srcs, &dest_dir).expect("copy");

        assert_eq!(result.copied, ["ok.pdf"]);
        assert!(dest_dir.join("ok.pdf").is_file());
        assert!(!dest_dir.join("voice.mp3").exists());
        assert!(!dest_dir.join("bad.zip").exists());

        let reasons: Vec<(&str, &str)> = result
            .rejected
            .iter()
            .map(|r| (r.name.as_str(), r.reason))
            .collect();
        assert_eq!(reasons, [("voice.mp3", "audio"), ("bad.zip", "unsupported")]);

        // 반환 JSON 계약: copied / rejected[].name / rejected[].reason
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["copied"][0], "ok.pdf");
        assert_eq!(json["rejected"][0]["reason"], "audio");
        assert_eq!(json["rejected"][1]["name"], "bad.zip");
    }

    /// folder 파라미터 검증 — 탈출·benchmark 금지, 정상 folderKey 허용.
    #[test]
    fn folder_validation() {
        assert!(validate_folder("").is_ok());
        assert!(validate_folder("데이터통신").is_ok());
        assert!(validate_folder("데이터통신/3주차").is_ok());
        assert!(validate_folder("/etc").is_err());
        assert!(validate_folder("../secret").is_err());
        assert!(validate_folder("데이터통신/../..").is_err());
        assert!(validate_folder("benchmark").is_err());
        assert!(validate_folder("benchmark/week1").is_err());
    }

    /// §7 매니페스트 생성 — subject/unit 트리, unit_order, benchmark 제외, NFC 정규화.
    #[test]
    fn manifest_generation() {
        use unicode_normalization::UnicodeNormalization;

        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();

        fs::write(root.join("loose.txt"), "x").unwrap();
        fs::create_dir_all(root.join("benchmark")).unwrap();
        fs::write(root.join("benchmark/answers.txt"), "x").unwrap();

        // macOS 파일시스템 재현: NFD로 만든 과목 폴더 → 매니페스트에는 NFC로 실려야 한다
        let nfd_subject: String = "데이터통신".nfd().collect();
        let subj = root.join(&nfd_subject);
        fs::create_dir_all(subj.join("3주차")).unwrap();
        fs::write(subj.join("3주차/w3_theory.pdf"), "x").unwrap();
        fs::create_dir_all(subj.join("1주차")).unwrap();
        fs::write(subj.join("1주차/transcript.txt"), "x").unwrap();
        fs::create_dir_all(subj.join("족보")).unwrap();
        fs::write(subj.join("족보/2024_기출.pdf"), "x").unwrap();
        fs::write(subj.join("개요.md"), "x").unwrap();

        let (manifest, mirrors) = scan_goldset(root);

        // 루트 직속 파일 · benchmark 제외
        assert_eq!(manifest.root_files.len(), 1);
        assert_eq!(manifest.root_files[0].name, "loose.txt");
        assert_eq!(manifest.subjects.len(), 1);

        let s = &manifest.subjects[0];
        assert_eq!(s.name, "데이터통신"); // NFC
        assert_eq!(s.root_files.len(), 1);
        assert_eq!(s.root_files[0].name, "개요.md");

        // unit_order: 첫 숫자 → 1, 3 / 숫자 없는 "족보" → 1000+
        let names: Vec<&str> = s.units.iter().map(|u| u.name.as_str()).collect();
        assert_eq!(names, ["1주차", "3주차", "족보"]);
        assert_eq!(s.units[0].order, 1);
        assert_eq!(s.units[1].order, 3);
        assert_eq!(s.units[2].order, 1000);
        assert_eq!(s.units[1].files[0].kind, "theory");
        assert_eq!(s.units[2].files[0].kind, "past_exam");

        // 미러 slug: subject__unit (NFC)
        assert!(mirrors.iter().any(|m| m.key == "데이터통신__3주차"));
        assert!(mirrors.iter().all(|m| !m.key.contains("benchmark")));

        // JSON 필드명 계약(§7): subjects / rootFiles / units / files[].kind
        let json = serde_json::to_value(&manifest).unwrap();
        assert!(json.get("subjects").is_some());
        assert!(json.get("rootFiles").is_some());
        let subj_json = &json["subjects"][0];
        assert!(subj_json.get("rootFiles").is_some());
        assert_eq!(subj_json["units"][0]["order"], 1);
        assert_eq!(subj_json["units"][1]["files"][0]["kind"], "theory");
    }

    /// public/files.json 재생성 — 브라우저(dev) 검증용 수동 실행.
    /// `cargo test -- --ignored regen_files_json --nocapture`
    #[test]
    #[ignore]
    fn regen_files_json() {
        let json = rescan_files().expect("rescan 실패");
        println!("{json}");
    }

    /// unit_order 규칙 (§2): 이름의 첫 숫자, 없으면 None.
    #[test]
    fn first_number_extracts_leading_digits() {
        assert_eq!(first_number("3주차"), Some(3));
        assert_eq!(first_number("10주차"), Some(10));
        assert_eq!(first_number("week07"), Some(7)); // 앞 비숫자 스킵, 첫 숫자 뭉치
        assert_eq!(first_number("2-3 보충"), Some(2)); // 첫 숫자 뭉치만
        assert_eq!(first_number("족보"), None);
        assert_eq!(first_number(""), None);
        // ascii digit만 인식 — 전각/한자 숫자는 숫자로 안 봄
        assert_eq!(first_number("삼주차"), None);
    }

    /// subject_norm — NFC + 공백 제거 + 소문자. "데이터통신" == "데이터 통신".
    #[test]
    fn subject_norm_ignores_whitespace_and_case() {
        assert_eq!(subject_norm("데이터 통신"), subject_norm("데이터통신"));
        assert_eq!(subject_norm("Operating System"), subject_norm("operatingsystem"));
        assert_eq!(subject_norm("  운영체제  "), subject_norm("운영체제"));
        // NFD 입력도 동일하게 정규화
        use unicode_normalization::UnicodeNormalization;
        let nfd: String = "데이터통신".nfd().collect();
        assert_eq!(subject_norm(&nfd), subject_norm("데이터통신"));
    }

    /// existing_subject_like — 공백·대소문자만 다른 기존 폴더를 재사용 후보로 반환.
    #[test]
    fn existing_subject_like_matches_normalized() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        fs::create_dir_all(root.join("데이터 통신")).unwrap();
        fs::write(root.join("메모.txt"), "x").unwrap(); // 파일은 무시

        // "데이터통신"(공백 없음)으로 조회 → 기존 "데이터 통신" 폴더명 반환
        assert_eq!(
            existing_subject_like(root, "데이터통신"),
            Some("데이터 통신".to_string())
        );
        // 정규화해도 다른 이름은 None
        assert_eq!(existing_subject_like(root, "운영체제"), None);
    }
}
