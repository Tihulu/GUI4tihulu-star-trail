// SPDX-License-Identifier: AGPL-3.0-only
use serde::{Deserialize, Serialize};
use std::{
    env,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineInfo {
    found: bool,
    path: Option<String>,
    detail: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobRequest {
    command: String,
    input: String,
    output: String,
    executable: Option<String>,
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
            paths.push(
                home.join(".local/share/gui4tihulu-star-trail/cli-venv/bin/tihulu"),
            );
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
            paths.push(
                local
                    .join("Programs")
                    .join("Python")
                    .join("Python312")
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
        let custom_path = PathBuf::from(value);
        if custom_path.is_file() {
            return Ok(custom_path);
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

    Err("tihulu was not found on PATH or in a standard Tihulu install location".to_string())
}

#[tauri::command]
fn detect_engine(custom_executable: Option<String>) -> EngineInfo {
    match resolve_executable(custom_executable.as_deref()) {
        Ok(path) => {
            let result = Command::new(&path).arg("--help").output();
            match result {
                Ok(output) if output.status.success() => {
                    let text = String::from_utf8_lossy(&output.stdout);
                    let detail = text
                        .lines()
                        .find(|line| !line.trim().is_empty())
                        .unwrap_or("tihulu command is available")
                        .trim()
                        .to_string();
                    EngineInfo {
                        found: true,
                        path: Some(path.to_string_lossy().into_owned()),
                        detail,
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
            }
        }
        Err(error) => EngineInfo {
            found: false,
            path: None,
            detail: error,
        },
    }
}

fn validate_request(request: &JobRequest) -> Result<(), String> {
    if !matches!(request.command.as_str(), "run" | "group" | "trail" | "timelapse") {
        return Err("Unsupported tihulu command".into());
    }
    if request.input.trim().is_empty() || !Path::new(&request.input).exists() {
        return Err("Input path does not exist".into());
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

fn build_args(request: &JobRequest) -> Vec<String> {
    let mut args = vec![
        request.command.clone(),
        request.input.clone(),
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

fn display_arg(value: &str) -> String {
    if value.chars().any(char::is_whitespace) || value.contains('"') {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

#[tauri::command]
fn start_job(
    request: JobRequest,
    app: AppHandle,
    state: State<'_, ProcessState>,
) -> Result<StartResult, String> {
    validate_request(&request)?;
    let executable = resolve_executable(request.executable.as_deref())?;
    let args = build_args(&request);

    let mut slot = state.current.lock().map_err(|_| "Process state is unavailable")?;
    if slot.is_some() {
        return Err("A tihulu job is already running".into());
    }

    let mut command = Command::new(&executable);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }

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

    let stdout_handle = stdout.map(|pipe| {
        let app = app.clone();
        thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let _ = app.emit(
                    "job-log",
                    LogPayload {
                        stream: "stdout",
                        line,
                    },
                );
            }
        })
    });

    let stderr_handle = stderr.map(|pipe| {
        let app = app.clone();
        thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let _ = app.emit(
                    "job-log",
                    LogPayload {
                        stream: "stderr",
                        line,
                    },
                );
            }
        })
    });

    let monitor_app = app.clone();
    thread::spawn(move || {
        let final_status = loop {
            let status = match child.lock() {
                Ok(mut process) => process.try_wait(),
                Err(_) => {
                    let _ = monitor_app.emit(
                        "job-log",
                        LogPayload {
                            stream: "stderr",
                            line: "Process state became unavailable".into(),
                        },
                    );
                    break None;
                }
            };

            match status {
                Ok(Some(status)) => break Some(status),
                Ok(None) => thread::sleep(Duration::from_millis(120)),
                Err(error) => {
                    let _ = monitor_app.emit(
                        "job-log",
                        LogPayload {
                            stream: "stderr",
                            line: format!("Could not read process status: {error}"),
                        },
                    );
                    break None;
                }
            }
        };

        if let Some(handle) = stdout_handle {
            let _ = handle.join();
        }
        if let Some(handle) = stderr_handle {
            let _ = handle.join();
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

    let result = active
        .child
        .lock()
        .map_err(|_| "Running process is unavailable")?
        .kill()
        .map_err(|error| format!("Could not stop tihulu: {error}"));

    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ProcessState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![detect_engine, start_job, stop_job])
        .run(tauri::generate_context!())
        .expect("error while running GUI4tihulu-star-trail");
}
