// SPDX-License-Identifier: AGPL-3.0-only
use serde::{Deserialize, Serialize};
use std::{
    collections::hash_map::DefaultHasher,
    env, fs,
    hash::{Hash, Hasher},
    io::{BufRead, BufReader},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone)]
struct ActiveProcess {
    pid: u32,
    child: Arc<Mutex<Child>>,
}

#[derive(Default)]
struct ProcessState {
    current: Mutex<Option<ActiveProcess>>,
}

#[derive(Clone)]
struct UiProcess {
    pid: u32,
    child: Arc<Mutex<Child>>,
    url: String,
}

#[derive(Default)]
struct UiState {
    current: Mutex<Option<UiProcess>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineInfo {
    found: bool,
    path: Option<String>,
    detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PhotoInfo {
    path: String,
    name: String,
    extension: String,
    size_bytes: u64,
    modified_ms: Option<u64>,
    is_raw: bool,
    browser_previewable: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobRequest {
    command: String,
    input: String,
    output: String,
    executable: Option<String>,
    files: Option<Vec<String>>,
    group_hardware: String,
    trail_hardware: String,
    timelapse_hardware: String,
    threshold: f64,
    min_matches: u32,
    max_side: u32,
    nfeatures: u32,
    time_metadata: bool,
    time_window_minutes: f64,
    recursive: bool,
    quiet: bool,
    link_mode: String,
    min_frames: u32,
    jpeg_quality: u8,
    timelapse: bool,
    fps: f64,
    video_max_side: u32,
    codec: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartResult {
    pid: u32,
    command_display: String,
    staged_files: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UiLaunch {
    pid: u32,
    url: String,
}

#[derive(Clone, Serialize)]
struct LogPayload {
    stream: &'static str,
    line: String,
}

#[derive(Clone, Serialize)]
struct JobFinished {
    success: bool,
    code: Option<i32>,
}

// Keep this list aligned with tihulu_star_trail.images.SUPPORTED_EXTENSIONS.
const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "tif", "tiff", "bmp", "webp", "3fr", "arw", "cr2", "cr3", "dcr", "dng",
    "erf", "kdc", "mef", "mos", "mrw", "nef", "nrw", "orf", "pef", "raf", "raw", "rwl", "rw2",
    "srw", "x3f",
];
const RAW_EXTENSIONS: &[&str] = &[
    "3fr", "arw", "cr2", "cr3", "dcr", "dng", "erf", "kdc", "mef", "mos", "mrw", "nef", "nrw",
    "orf", "pef", "raf", "raw", "rwl", "rw2", "srw", "x3f",
];
const BROWSER_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "bmp"];
const HARDWARE_MODES: &[&str] = &["auto", "cpu", "gpu", "hybrid"];

fn candidate_names() -> &'static [&'static str] {
    #[cfg(windows)]
    {
        &["tihulu.exe", "tihulu.cmd", "tihulu.bat", "tihulu"]
    }
    #[cfg(not(windows))]
    {
        &["tihulu"]
    }
}

fn preferred_locations() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    #[cfg(not(windows))]
    {
        if let Some(home) = env::var_os("HOME") {
            let home = PathBuf::from(home);
            // Match the installer: GUI-managed engine first, then current-user launcher.
            paths.push(home.join(".local/share/gui4tihulu-star-trail/cli-venv/bin/tihulu"));
            paths.push(home.join(".local/bin/tihulu"));
        }
    }
    #[cfg(windows)]
    {
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            paths.push(
                PathBuf::from(local_app_data)
                    .join("GUI4tihulu-star-trail")
                    .join("cli")
                    .join(".venv")
                    .join("Scripts")
                    .join("tihulu.exe"),
            );
        }
    }
    paths
}

fn fallback_locations() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    #[cfg(not(windows))]
    {
        paths.push(PathBuf::from("/usr/local/bin/tihulu"));
        paths.push(PathBuf::from("/opt/homebrew/bin/tihulu"));
        paths.push(PathBuf::from("/usr/bin/tihulu"));
    }
    paths
}

fn executable_from_path() -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    for directory in env::split_paths(&path) {
        for name in candidate_names() {
            let candidate = directory.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn resolve_executable(custom: Option<&str>) -> Result<PathBuf, String> {
    if let Some(value) = custom.map(str::trim).filter(|value| !value.is_empty()) {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!("Custom tihulu executable does not exist: {value}"));
    }
    // Desktop launchers and direct AppImage launches can inherit different PATHs.
    // Prefer the user-managed engine that our installer owns before consulting PATH.
    for path in preferred_locations() {
        if path.is_file() {
            return Ok(path);
        }
    }
    if let Some(path) = executable_from_path() {
        return Ok(path);
    }
    for path in fallback_locations() {
        if path.is_file() {
            return Ok(path);
        }
    }
    Err(
        "tihulu was not found in a current-user install, on PATH, or in a standard system location"
            .into(),
    )
}

fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Win32 CREATE_NO_WINDOW. Keep the flag local instead of depending on
        // windows-sys generated module paths, which can move across crate versions.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

#[tauri::command]
fn detect_engine(custom_executable: Option<String>) -> EngineInfo {
    match resolve_executable(custom_executable.as_deref()) {
        Ok(path) => match Command::new(&path).arg("--help").output() {
            Ok(output) if output.status.success() => {
                let text = String::from_utf8_lossy(&output.stdout);
                EngineInfo {
                    found: true,
                    path: Some(path.to_string_lossy().into_owned()),
                    detail: text
                        .lines()
                        .find(|line| !line.trim().is_empty())
                        .unwrap_or("tihulu command is available")
                        .trim()
                        .to_string(),
                }
            }
            Ok(output) => EngineInfo {
                found: false,
                path: Some(path.to_string_lossy().into_owned()),
                detail: format!("tihulu --help exited with {}", output.status),
            },
            Err(error) => EngineInfo {
                found: false,
                path: Some(path.to_string_lossy().into_owned()),
                detail: format!("Could not execute tihulu: {error}"),
            },
        },
        Err(error) => EngineInfo {
            found: false,
            path: None,
            detail: error,
        },
    }
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with('.'))
        .unwrap_or(false)
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn is_supported_image(path: &Path) -> bool {
    IMAGE_EXTENSIONS.contains(&extension(path).as_str())
}

fn collect_photos(path: &Path, recursive: bool, output: &mut Vec<PhotoInfo>) -> Result<(), String> {
    if path.is_file() {
        if is_supported_image(path) && !is_hidden(path) {
            output.push(photo_info(path)?);
        }
        return Ok(());
    }
    let entries = fs::read_dir(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not read directory entry: {error}"))?;
        let child = entry.path();
        if is_hidden(&child) {
            continue;
        }
        if child.is_dir() {
            if recursive {
                collect_photos(&child, recursive, output)?;
            }
        } else if is_supported_image(&child) {
            output.push(photo_info(&child)?);
        }
    }
    Ok(())
}

fn photo_info(path: &Path) -> Result<PhotoInfo, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not read metadata for {}: {error}", path.display()))?;
    let ext = extension(path);
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);
    Ok(PhotoInfo {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("photo")
            .to_string(),
        extension: ext.clone(),
        size_bytes: metadata.len(),
        modified_ms,
        is_raw: RAW_EXTENSIONS.contains(&ext.as_str()),
        browser_previewable: BROWSER_EXTENSIONS.contains(&ext.as_str()),
    })
}

#[tauri::command]
fn scan_photos(input: String, recursive: bool) -> Result<Vec<PhotoInfo>, String> {
    let path = PathBuf::from(input);
    if !path.exists() {
        return Err("Input path does not exist".into());
    }
    let mut photos = Vec::new();
    collect_photos(&path, recursive, &mut photos)?;
    photos.sort_by(|left, right| {
        left.name
            .to_ascii_lowercase()
            .cmp(&right.name.to_ascii_lowercase())
            .then(left.path.cmp(&right.path))
    });
    Ok(photos)
}

fn validate_request(request: &JobRequest) -> Result<(), String> {
    if !matches!(
        request.command.as_str(),
        "run" | "group" | "trail" | "timelapse"
    ) {
        return Err("Unsupported tihulu command".into());
    }
    if request.input.trim().is_empty() || !Path::new(&request.input).exists() {
        return Err("Input path does not exist".into());
    }
    if let Some(files) = &request.files {
        if files.is_empty() {
            return Err("At least one included photo is required".into());
        }
        for file in files {
            if !Path::new(file).is_file() {
                return Err(format!("Selected photo no longer exists: {file}"));
            }
        }
    }
    if request.output.trim().is_empty() {
        return Err("Output path is required".into());
    }
    for (label, value) in [
        ("grouping", request.group_hardware.as_str()),
        ("trail", request.trail_hardware.as_str()),
        ("timelapse", request.timelapse_hardware.as_str()),
    ] {
        if !HARDWARE_MODES.contains(&value) {
            return Err(format!("Unsupported {label} hardware mode: {value}"));
        }
    }

    let uses_grouping = matches!(request.command.as_str(), "run" | "group");
    let uses_render = matches!(request.command.as_str(), "run" | "trail" | "timelapse");
    let uses_jpeg = matches!(request.command.as_str(), "run" | "trail");
    let uses_video =
        request.command == "timelapse" || (request.command == "run" && request.timelapse);

    if uses_grouping {
        if !(0.0..=1.0).contains(&request.threshold) {
            return Err("Threshold must be between 0 and 1".into());
        }
        if request.min_matches < 4 || request.max_side < 128 || request.nfeatures < 100 {
            return Err("Grouping settings are outside the supported range".into());
        }
        if request.time_window_minutes < 0.0 || !request.time_window_minutes.is_finite() {
            return Err("Time window must be a finite, non-negative number".into());
        }
        if !matches!(
            request.link_mode.as_str(),
            "copy" | "symlink" | "hardlink" | "none"
        ) {
            return Err("Unsupported grouped-output link mode".into());
        }
    }
    if uses_render && request.min_frames < 2 {
        return Err("Minimum frames must be at least 2".into());
    }
    if uses_jpeg && !(1..=100).contains(&request.jpeg_quality) {
        return Err("JPEG quality must be between 1 and 100".into());
    }
    if uses_video {
        if request.fps <= 0.0 || !request.fps.is_finite() {
            return Err("FPS must be a finite number greater than zero".into());
        }
        if request.codec.chars().count() != 4 || !request.codec.is_ascii() {
            return Err("Codec must contain exactly four ASCII characters".into());
        }
    }
    Ok(())
}

fn grouping_args(request: &JobRequest, args: &mut Vec<String>) {
    args.extend([
        "--threshold".into(),
        request.threshold.to_string(),
        "--min-matches".into(),
        request.min_matches.to_string(),
        "--max-side".into(),
        request.max_side.to_string(),
        "--nfeatures".into(),
        request.nfeatures.to_string(),
        if request.time_metadata {
            "--time-metadata".into()
        } else {
            "--no-time-metadata".into()
        },
        "--time-window-minutes".into(),
        request.time_window_minutes.to_string(),
        if request.recursive {
            "--recursive".into()
        } else {
            "--no-recursive".into()
        },
    ]);
    if request.quiet {
        args.push("--quiet".into());
    }
}

fn render_args(request: &JobRequest, args: &mut Vec<String>, include_jpeg: bool) {
    args.extend(["--min-frames".into(), request.min_frames.to_string()]);
    if include_jpeg {
        args.extend(["--jpeg-quality".into(), request.jpeg_quality.to_string()]);
    }
}

fn video_args(request: &JobRequest, args: &mut Vec<String>) {
    args.extend([
        "--fps".into(),
        request.fps.to_string(),
        "--video-max-side".into(),
        request.video_max_side.to_string(),
        "--codec".into(),
        request.codec.clone(),
    ]);
}

fn build_args(request: &JobRequest, input: &Path) -> Vec<String> {
    let mut args = vec![
        request.command.clone(),
        input.to_string_lossy().into_owned(),
        request.output.clone(),
    ];
    match request.command.as_str() {
        "run" => {
            grouping_args(request, &mut args);
            args.extend(["--link-mode".into(), request.link_mode.clone()]);
            render_args(request, &mut args, true);
            if request.timelapse {
                args.push("--timelapse".into());
                video_args(request, &mut args);
            }
        }
        "group" => {
            grouping_args(request, &mut args);
            args.extend(["--link-mode".into(), request.link_mode.clone()]);
        }
        "trail" => {
            render_args(request, &mut args, true);
            args.push(if request.recursive {
                "--recursive".into()
            } else {
                "--no-recursive".into()
            });
            if request.quiet {
                args.push("--quiet".into());
            }
        }
        "timelapse" => {
            render_args(request, &mut args, false);
            video_args(request, &mut args);
            args.push(if request.recursive {
                "--recursive".into()
            } else {
                "--no-recursive".into()
            });
            if request.quiet {
                args.push("--quiet".into());
            }
        }
        _ => unreachable!("validated command"),
    }
    args
}

fn engine_supports_hardware_policies(executable: &Path) -> bool {
    let output = Command::new(executable).args(["run", "--help"]).output();
    match output {
        Ok(output) => {
            let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
            text.push_str(&String::from_utf8_lossy(&output.stderr));
            text.contains("--group-hardware")
                && text.contains("--trail-hardware")
                && text.contains("--timelapse-hardware")
        }
        Err(_) => false,
    }
}

fn append_hardware_args(
    request: &JobRequest,
    args: &mut Vec<String>,
    supported: bool,
) -> Result<(), String> {
    let requested = match request.command.as_str() {
        "run" => vec![
            ("--group-hardware", request.group_hardware.as_str()),
            ("--trail-hardware", request.trail_hardware.as_str()),
            ("--timelapse-hardware", request.timelapse_hardware.as_str()),
        ],
        "group" => vec![("--group-hardware", request.group_hardware.as_str())],
        "trail" => vec![("--trail-hardware", request.trail_hardware.as_str())],
        "timelapse" => vec![("--timelapse-hardware", request.timelapse_hardware.as_str())],
        _ => Vec::new(),
    };

    if !supported {
        if requested.iter().any(|(_, value)| *value != "auto") {
            return Err("The detected tihulu executable does not expose the required hardware-policy controls. Recheck the engine path or update tihulu-star-trail; the requested mode was not downgraded to Auto.".into());
        }
        return Ok(());
    }
    for (flag, value) in requested {
        args.push(flag.into());
        args.push(value.into());
    }
    Ok(())
}

fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "photo".into()
    } else {
        cleaned
    }
}

fn make_stage(files: &[String]) -> Result<PathBuf, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let directory = env::temp_dir()
        .join("gui4tihulu-star-trail")
        .join(format!("selection-{stamp}"));
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create temporary selection: {error}"))?;

    for (index, source_value) in files.iter().enumerate() {
        let source = PathBuf::from(source_value);
        let name = source
            .file_name()
            .and_then(|value| value.to_str())
            .map(safe_name)
            .unwrap_or_else(|| "photo".into());
        let target = directory.join(format!("{:06}_{name}", index + 1));
        link_or_copy(&source, &target).map_err(|error| {
            let _ = fs::remove_dir_all(&directory);
            format!("Could not stage {}: {error}", source.display())
        })?;
    }
    Ok(directory)
}

#[cfg(unix)]
fn link_or_copy(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::symlink;
    symlink(source, target).or_else(|_| fs::copy(source, target).map(|_| ()))
}

#[cfg(windows)]
fn link_or_copy(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::hard_link(source, target).or_else(|_| fs::copy(source, target).map(|_| ()))
}

fn display_arg(value: &str) -> String {
    if value.chars().any(char::is_whitespace) || value.contains('"') {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

fn emit_reader<R: std::io::Read + Send + 'static>(
    pipe: R,
    stream: &'static str,
    app: AppHandle,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            let _ = app.emit("job-log", LogPayload { stream, line });
        }
    })
}

#[tauri::command]
fn start_job(
    request: JobRequest,
    app: AppHandle,
    state: State<'_, ProcessState>,
) -> Result<StartResult, String> {
    validate_request(&request)?;
    let executable = resolve_executable(request.executable.as_deref())?;
    let (input, staging_dir, staged_files) = match request.files.as_ref() {
        Some(files) => {
            let stage = make_stage(files)?;
            (stage.clone(), Some(stage), files.len())
        }
        None => (PathBuf::from(&request.input), None, 0),
    };
    let mut args = build_args(&request, &input);
    append_hardware_args(
        &request,
        &mut args,
        engine_supports_hardware_policies(&executable),
    )?;

    let mut slot = state
        .current
        .lock()
        .map_err(|_| "Process state is unavailable")?;
    if slot.is_some() {
        if let Some(directory) = staging_dir {
            let _ = fs::remove_dir_all(directory);
        }
        return Err("A tihulu job is already running".into());
    }

    let mut command = Command::new(&executable);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start tihulu: {error}"))?;
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    *slot = Some(ActiveProcess {
        pid,
        child: Arc::clone(&child),
    });
    drop(slot);

    let stdout_handle = stdout.map(|pipe| emit_reader(pipe, "stdout", app.clone()));
    let stderr_handle = stderr.map(|pipe| emit_reader(pipe, "stderr", app.clone()));
    let monitor_app = app.clone();
    thread::spawn(move || {
        let final_status = loop {
            let status = match child.lock() {
                Ok(mut process) => process.try_wait(),
                Err(_) => break None,
            };
            match status {
                Ok(Some(status)) => break Some(status),
                Ok(None) => thread::sleep(Duration::from_millis(120)),
                Err(_) => break None,
            }
        };
        if let Some(handle) = stdout_handle {
            let _ = handle.join();
        }
        if let Some(handle) = stderr_handle {
            let _ = handle.join();
        }
        if let Some(directory) = staging_dir {
            let _ = fs::remove_dir_all(directory);
        }
        if let Ok(mut current) = monitor_app.state::<ProcessState>().current.lock() {
            if current.as_ref().map(|active| active.pid) == Some(pid) {
                *current = None;
            }
        }
        let payload = match final_status {
            Some(status) => JobFinished {
                success: status.success(),
                code: status.code(),
            },
            None => JobFinished {
                success: false,
                code: None,
            },
        };
        let _ = monitor_app.emit("job-finished", payload);
    });

    let command_display = std::iter::once(executable.to_string_lossy().into_owned())
        .chain(args.iter().cloned())
        .map(|value| display_arg(&value))
        .collect::<Vec<_>>()
        .join(" ");
    Ok(StartResult {
        pid,
        command_display,
        staged_files,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbnailResult {
    path: String,
    cache_hit: bool,
    source_bytes: u64,
}

const THUMBNAIL_CACHE_ITEMS: usize = 512;
const THUMBNAIL_CACHE_BYTES: u64 = 256 * 1024 * 1024;
static THUMBNAIL_GENERATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn thumbnail_key(
    source: &Path,
    max_width: u32,
    max_height: u32,
    source_version: &str,
) -> Result<u64, String> {
    let metadata = fs::metadata(source)
        .map_err(|error| format!("Could not read thumbnail source metadata: {error}"))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let mut hasher = DefaultHasher::new();
    source.to_string_lossy().hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    modified.hash(&mut hasher);
    max_width.hash(&mut hasher);
    max_height.hash(&mut hasher);
    source_version.hash(&mut hasher);
    Ok(hasher.finish())
}

fn prune_thumbnail_cache(cache_dir: &Path) {
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return;
    };
    let mut files = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("jpg") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let modified = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_nanos())
                .unwrap_or(0);
            Some((path, metadata.len(), modified))
        })
        .collect::<Vec<_>>();
    let mut bytes = files.iter().map(|(_, bytes, _)| *bytes).sum::<u64>();
    if files.len() <= THUMBNAIL_CACHE_ITEMS && bytes <= THUMBNAIL_CACHE_BYTES {
        return;
    }
    files.sort_by_key(|(_, _, modified)| *modified);
    let mut count = files.len();
    for (path, size, _) in files {
        if count <= THUMBNAIL_CACHE_ITEMS && bytes <= THUMBNAIL_CACHE_BYTES {
            break;
        }
        if fs::remove_file(path).is_ok() {
            count = count.saturating_sub(1);
            bytes = bytes.saturating_sub(size);
        }
    }
}

fn generate_thumbnail(
    cache_dir: &Path,
    source: &Path,
    max_width: u32,
    max_height: u32,
    source_version: &str,
) -> Result<ThumbnailResult, String> {
    if max_width == 0 || max_height == 0 || max_width > 4096 || max_height > 4096 {
        return Err("Thumbnail dimensions must be between 1 and 4096 pixels".into());
    }
    if !source.is_file() {
        return Err("Thumbnail source does not exist".into());
    }
    let metadata = fs::metadata(source)
        .map_err(|error| format!("Could not read thumbnail source: {error}"))?;
    fs::create_dir_all(cache_dir)
        .map_err(|error| format!("Could not create thumbnail cache: {error}"))?;
    let key = thumbnail_key(source, max_width, max_height, source_version)?;
    let target = cache_dir.join(format!("{key:016x}.jpg"));
    if target.is_file() {
        return Ok(ThumbnailResult {
            path: target.to_string_lossy().into_owned(),
            cache_hit: true,
            source_bytes: metadata.len(),
        });
    }

    let _guard = THUMBNAIL_GENERATION_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Thumbnail generator is unavailable")?;
    if target.is_file() {
        return Ok(ThumbnailResult {
            path: target.to_string_lossy().into_owned(),
            cache_hit: true,
            source_bytes: metadata.len(),
        });
    }
    let image = image::ImageReader::open(source)
        .map_err(|error| format!("Could not open thumbnail source: {error}"))?
        .with_guessed_format()
        .map_err(|error| format!("Could not detect image format: {error}"))?
        .decode()
        .map_err(|error| format!("Could not decode thumbnail source: {error}"))?;
    let thumbnail = image.thumbnail(max_width, max_height).to_rgb8();
    let temporary = target.with_extension("jpg.tmp");
    {
        let mut file = fs::File::create(&temporary)
            .map_err(|error| format!("Could not create thumbnail cache file: {error}"))?;
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut file, 82);
        encoder
            .encode_image(&thumbnail)
            .map_err(|error| format!("Could not encode thumbnail: {error}"))?;
    }
    fs::rename(&temporary, &target)
        .or_else(|_| {
            let _ = fs::remove_file(&target);
            fs::rename(&temporary, &target)
        })
        .map_err(|error| format!("Could not finalize thumbnail cache file: {error}"))?;
    prune_thumbnail_cache(cache_dir);
    Ok(ThumbnailResult {
        path: target.to_string_lossy().into_owned(),
        cache_hit: false,
        source_bytes: metadata.len(),
    })
}

#[tauri::command(rename_all = "camelCase")]
async fn get_thumbnail(
    source_path: String,
    max_width: u32,
    max_height: u32,
    source_version: Option<String>,
    app: AppHandle,
) -> Result<ThumbnailResult, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Could not resolve app cache directory: {error}"))?
        .join("thumbnails-v1");
    let source = PathBuf::from(source_path);
    let version = source_version.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        generate_thumbnail(&cache_dir, &source, max_width, max_height, &version)
    })
    .await
    .map_err(|error| format!("Thumbnail worker failed: {error}"))?
}

#[tauri::command]
fn stop_job(state: State<'_, ProcessState>) -> Result<(), String> {
    let active = state
        .current
        .lock()
        .map_err(|_| "Process state is unavailable")?
        .clone()
        .ok_or_else(|| "No tihulu job is running".to_string())?;
    active
        .child
        .lock()
        .map_err(|_| "Running process is unavailable")?
        .kill()
        .map_err(|error| format!("Could not stop tihulu: {error}"))
}

#[tauri::command]
fn launch_original_desktop(custom_executable: Option<String>) -> Result<u32, String> {
    let executable = resolve_executable(custom_executable.as_deref())?;
    let mut command = Command::new(executable);
    command
        .arg("desktop")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_console(&mut command);
    command
        .spawn()
        .map(|child| child.id())
        .map_err(|error| format!("Could not launch original Tihulu desktop: {error}"))
}

fn free_port() -> Result<u16, String> {
    for port in 8765..=8795 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    Err("Could not find a free localhost port for Tihulu UI".into())
}

#[tauri::command]
fn launch_local_ui(
    custom_executable: Option<String>,
    state: State<'_, UiState>,
) -> Result<UiLaunch, String> {
    {
        let mut slot = state
            .current
            .lock()
            .map_err(|_| "UI server state is unavailable")?;
        if let Some(active) = slot.as_ref() {
            let still_running = active
                .child
                .lock()
                .map_err(|_| "UI server process is unavailable")?
                .try_wait()
                .map_err(|error| format!("Could not read local UI status: {error}"))?
                .is_none();
            if still_running {
                return Ok(UiLaunch {
                    pid: active.pid,
                    url: active.url.clone(),
                });
            }
        }
        *slot = None;
    }

    let port = free_port()?;
    let executable = resolve_executable(custom_executable.as_deref())?;
    let mut command = Command::new(executable);
    command
        .args(["ui", "--host", "127.0.0.1", "--port", &port.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let child = command
        .spawn()
        .map_err(|error| format!("Could not launch local Tihulu UI: {error}"))?;
    let pid = child.id();
    let child = Arc::new(Mutex::new(child));
    let url = format!("http://127.0.0.1:{port}");
    *state
        .current
        .lock()
        .map_err(|_| "UI server state is unavailable")? = Some(UiProcess {
        pid,
        child: Arc::clone(&child),
        url: url.clone(),
    });

    for _ in 0..30 {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    Ok(UiLaunch { pid, url })
}

#[tauri::command]
fn stop_local_ui(state: State<'_, UiState>) -> Result<(), String> {
    let active = state
        .current
        .lock()
        .map_err(|_| "UI server state is unavailable")?
        .take();
    if let Some(active) = active {
        active
            .child
            .lock()
            .map_err(|_| "UI server process is unavailable")?
            .kill()
            .map_err(|error| format!("Could not stop local Tihulu UI: {error}"))?;
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ProcessState::default())
        .manage(UiState::default())
        .invoke_handler(tauri::generate_handler![
            detect_engine,
            scan_photos,
            get_thumbnail,
            start_job,
            stop_job,
            launch_original_desktop,
            launch_local_ui,
            stop_local_ui
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tihulu Star Trail Studio");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(command: &str) -> JobRequest {
        JobRequest {
            command: command.into(),
            input: ".".into(),
            output: "out".into(),
            executable: None,
            files: None,
            group_hardware: "gpu".into(),
            trail_hardware: "gpu".into(),
            timelapse_hardware: "gpu".into(),
            threshold: 0.42,
            min_matches: 18,
            max_side: 1000,
            nfeatures: 2500,
            time_metadata: false,
            time_window_minutes: 360.0,
            recursive: true,
            quiet: false,
            link_mode: "copy".into(),
            min_frames: 2,
            jpeg_quality: 95,
            timelapse: true,
            fps: 24.0,
            video_max_side: 1920,
            codec: "mp4v".into(),
        }
    }

    fn assert_pair(args: &[String], flag: &str, value: &str) {
        let index = args
            .iter()
            .position(|item| item == flag)
            .unwrap_or_else(|| panic!("missing {flag}"));
        assert_eq!(args.get(index + 1).map(String::as_str), Some(value));
    }

    #[test]
    fn supported_extensions_match_engine_formats() {
        assert!(is_supported_image(Path::new("sky.JPG")));
        assert!(is_supported_image(Path::new("sky.CR3")));
        assert!(is_supported_image(Path::new("sky.3FR")));
        assert!(!is_supported_image(Path::new("animation.gif")));
    }

    #[test]
    fn safe_stage_names_keep_extensions() {
        assert_eq!(safe_name("IMG 0001.CR3"), "IMG_0001.CR3");
    }

    #[test]
    fn group_gpu_is_exact() {
        let req = request("group");
        let mut args = Vec::new();
        append_hardware_args(&req, &mut args, true).unwrap();
        assert_eq!(args, vec!["--group-hardware", "gpu"]);
    }

    #[test]
    fn trail_gpu_is_exact() {
        let req = request("trail");
        let mut args = Vec::new();
        append_hardware_args(&req, &mut args, true).unwrap();
        assert_eq!(args, vec!["--trail-hardware", "gpu"]);
    }

    #[test]
    fn timelapse_gpu_is_exact() {
        let req = request("timelapse");
        let mut args = Vec::new();
        append_hardware_args(&req, &mut args, true).unwrap();
        assert_eq!(args, vec!["--timelapse-hardware", "gpu"]);
    }

    #[test]
    fn full_run_uses_all_exact_gpu_flags() {
        let req = request("run");
        let mut args = Vec::new();
        append_hardware_args(&req, &mut args, true).unwrap();
        assert_pair(&args, "--group-hardware", "gpu");
        assert_pair(&args, "--trail-hardware", "gpu");
        assert_pair(&args, "--timelapse-hardware", "gpu");
        assert_eq!(args.len(), 6);
    }

    #[test]
    fn explicit_gpu_never_falls_back_when_engine_is_legacy() {
        let req = request("trail");
        let mut args = Vec::new();
        let error = append_hardware_args(&req, &mut args, false).unwrap_err();
        assert!(error.contains("not downgraded to Auto"));
        assert!(args.is_empty());
    }

    #[test]
    fn native_thumbnail_cache_hits_and_invalidates_by_version() {
        let root = env::temp_dir().join(format!("gui4tihulu-thumb-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.png");
        let cache = root.join("cache");
        image::RgbImage::from_pixel(640, 480, image::Rgb([12, 34, 56]))
            .save(&source)
            .unwrap();
        let first = generate_thumbnail(&cache, &source, 160, 120, "v1").unwrap();
        assert!(!first.cache_hit);
        assert!(Path::new(&first.path).is_file());
        let second = generate_thumbnail(&cache, &source, 160, 120, "v1").unwrap();
        assert!(second.cache_hit);
        assert_eq!(first.path, second.path);
        let invalidated = generate_thumbnail(&cache, &source, 160, 120, "v2").unwrap();
        assert!(!invalidated.cache_hit);
        assert_ne!(first.path, invalidated.path);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn hundreds_of_duplicate_thumbnail_requests_are_cache_hits() {
        let root = env::temp_dir().join(format!(
            "gui4tihulu-thumb-repeat-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.png");
        let cache = root.join("cache");
        image::RgbImage::from_pixel(1280, 720, image::Rgb([21, 42, 63]))
            .save(&source)
            .unwrap();
        let first = generate_thumbnail(&cache, &source, 200, 120, "stable").unwrap();
        assert!(!first.cache_hit);
        for _ in 0..400 {
            let repeated = generate_thumbnail(&cache, &source, 200, 120, "stable").unwrap();
            assert!(repeated.cache_hit);
            assert_eq!(first.path, repeated.path);
        }
        assert_eq!(
            fs::read_dir(&cache).unwrap().filter_map(Result::ok).count(),
            1
        );
        let _ = fs::remove_dir_all(root);
    }
}
