// SPDX-License-Identifier: AGPL-3.0-only
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
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

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HardwarePolicies {
    group_hardware: String,
    trail_hardware: String,
    timelapse_hardware: String,
}

impl Default for HardwarePolicies {
    fn default() -> Self {
        Self {
            group_hardware: "auto".into(),
            trail_hardware: "auto".into(),
            timelapse_hardware: "auto".into(),
        }
    }
}

static HARDWARE_POLICIES: OnceLock<Mutex<HardwarePolicies>> = OnceLock::new();

fn hardware_policies() -> &'static Mutex<HardwarePolicies> {
    HARDWARE_POLICIES.get_or_init(|| Mutex::new(HardwarePolicies::default()))
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

const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "tif", "tiff", "webp", "bmp", "gif", "avif", "cr2", "cr3",
    "nef", "arw", "dng", "orf", "rw2", "raf", "pef", "srw", "x3f",
];
const RAW_EXTENSIONS: &[&str] = &[
    "cr2", "cr3", "nef", "arw", "dng", "orf", "rw2", "raf", "pef", "srw", "x3f",
];
const BROWSER_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "bmp", "gif", "avif"];
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

fn known_locations() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    #[cfg(not(windows))]
    {
        if let Some(home) = env::var_os("HOME") {
            let home = PathBuf::from(home);
            paths.push(home.join(".local/bin/tihulu"));
            paths.push(home.join(".local/share/gui4tihulu-star-trail/cli-venv/bin/tihulu"));
        }
        paths.push(PathBuf::from("/usr/local/bin/tihulu"));
        paths.push(PathBuf::from("/opt/homebrew/bin/tihulu"));
        paths.push(PathBuf::from("/usr/bin/tihulu"));
    }
    #[cfg(windows)]
    {
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local_app_data);
            paths.push(
                local
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
    if let Some(path) = executable_from_path() {
        return Ok(path);
    }
    for path in known_locations() {
        if path.is_file() {
            return Ok(path);
        }
    }
    Err("tihulu was not found on PATH or in a standard Tihulu install location".into())
}

fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
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

#[tauri::command]
fn set_hardware_policies(policies: HardwarePolicies) -> Result<(), String> {
    for (label, value) in [
        ("grouping", policies.group_hardware.as_str()),
        ("trail", policies.trail_hardware.as_str()),
        ("timelapse", policies.timelapse_hardware.as_str()),
    ] {
        if !HARDWARE_MODES.contains(&value) {
            return Err(format!("Unsupported {label} hardware mode: {value}"));
        }
    }
    *hardware_policies()
        .lock()
        .map_err(|_| "Hardware policy state is unavailable")? = policies;
    Ok(())
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
    if !matches!(request.command.as_str(), "run" | "group" | "trail" | "timelapse") {
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
    if !(0.0..=1.0).contains(&request.threshold) {
        return Err("Threshold must be between 0 and 1".into());
    }
    if request.min_matches < 4 || request.max_side < 128 || request.nfeatures < 100 {
        return Err("Grouping settings are outside the supported range".into());
    }
    if request.time_window_minutes < 0.0 || !request.time_window_minutes.is_finite() {
        return Err("Time window must be a finite, non-negative number".into());
    }
    if request.min_frames < 2 || !(1..=100).contains(&request.jpeg_quality) {
        return Err("Render settings are outside the supported range".into());
    }
    if request.fps <= 0.0 || !request.fps.is_finite() {
        return Err("FPS must be a finite number greater than zero".into());
    }
    if request.codec.chars().count() != 4 || !request.codec.is_ascii() {
        return Err("Codec must contain exactly four ASCII characters".into());
    }
    if !matches!(request.link_mode.as_str(), "copy" | "symlink" | "hardlink" | "none") {
        return Err("Unsupported grouped-output link mode".into());
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
            }
            video_args(request, &mut args);
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
    policies: &HardwarePolicies,
    supported: bool,
) -> Result<(), String> {
    let requested = match request.command.as_str() {
        "run" => vec![
            ("--group-hardware", policies.group_hardware.as_str()),
            ("--trail-hardware", policies.trail_hardware.as_str()),
            ("--timelapse-hardware", policies.timelapse_hardware.as_str()),
        ],
        "group" => vec![("--group-hardware", policies.group_hardware.as_str())],
        "trail" => vec![("--trail-hardware", policies.trail_hardware.as_str())],
        "timelapse" => vec![("--timelapse-hardware", policies.timelapse_hardware.as_str())],
        _ => Vec::new(),
    };

    if !supported {
        if requested.iter().any(|(_, value)| *value != "auto") {
            return Err(
                "The installed tihulu engine is too old for separate CPU/GPU/GPU+CPU controls. Update tihulu-star-trail, then recheck the engine.".into(),
            );
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
    let policies = hardware_policies()
        .lock()
        .map_err(|_| "Hardware policy state is unavailable")?
        .clone();
    append_hardware_args(
        &request,
        &mut args,
        &policies,
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
            set_hardware_policies,
            scan_photos,
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

    #[test]
    fn supported_extensions_include_raw_and_common_images() {
        assert!(is_supported_image(Path::new("sky.JPG")));
        assert!(is_supported_image(Path::new("sky.CR3")));
        assert!(!is_supported_image(Path::new("notes.txt")));
    }

    #[test]
    fn safe_stage_names_keep_extensions() {
        assert_eq!(safe_name("IMG 0001.CR3"), "IMG_0001.CR3");
    }

    #[test]
    fn hardware_policy_defaults_are_auto() {
        let policy = HardwarePolicies::default();
        assert_eq!(policy.group_hardware, "auto");
        assert_eq!(policy.trail_hardware, "auto");
        assert_eq!(policy.timelapse_hardware, "auto");
    }
}
