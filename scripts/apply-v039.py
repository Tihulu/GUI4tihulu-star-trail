from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, text: str) -> None:
    (ROOT / path).parent.mkdir(parents=True, exist_ok=True)
    (ROOT / path).write_text(text)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise SystemExit(f"expected block not found in {path}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"expected regex once in {path}, got {count}: {pattern[:100]!r}")
    write(path, next_text)


# ---------------- Frontend: request-scoped hardware + canonical output ----------------
replace_once(
    "src/main.ts",
    'import { convertFileSrc, invoke } from "@tauri-apps/api/core";\n',
    'import { invoke } from "@tauri-apps/api/core";\nimport { buildOutputPath, normalizeHardwareMode, type HardwareMode } from "./job-policy";\n',
)
replace_once(
    "src/main.ts",
    '  files: string[] | null;\n  threshold: number;\n',
    '  files: string[] | null;\n  groupHardware: HardwareMode;\n  trailHardware: HardwareMode;\n  timelapseHardware: HardwareMode;\n  threshold: number;\n',
)
replace_once(
    "src/main.ts",
    '      <section class="workspace-toolbar glass-card"><div class="toolbar-path"><span class="toolbar-label">SOURCE</span><strong id="photoSourcePath">No folder selected</strong></div><div class="toolbar-actions"><label class="mini-check"><input id="workspaceRecursive" type="checkbox" checked> Recursive</label><button class="secondary-button" id="chooseAndScan" type="button">Choose folder</button><button class="ghost-button" id="rescanPhotos" type="button">Rescan</button></div></section>\n      <section class="photo-controls glass-card">',
    '      <section class="workspace-toolbar glass-card"><div class="toolbar-path"><span class="toolbar-label">SOURCE</span><strong id="photoSourcePath">No folder selected</strong></div><div class="toolbar-actions"><label class="mini-check"><input id="workspaceRecursive" type="checkbox" checked> Recursive</label><button class="secondary-button" id="chooseAndScan" type="button">Choose folder</button><button class="ghost-button" id="rescanPhotos" type="button">Rescan</button></div></section>\n      <section class="workspace-toolbar glass-card" id="workspaceOutputToolbar"><div class="toolbar-path"><span class="toolbar-label">OUTPUT</span><strong class="empty" id="workspaceOutputPath">No output folder selected</strong></div><div class="toolbar-actions"><button class="secondary-button" id="workspacePickOutput" type="button">Choose / change output</button><button class="ghost-button" id="workspaceOpenOutput" type="button" disabled>Open</button></div></section>\n      <section class="photo-controls glass-card">',
)
replace_once(
    "src/main.ts",
    'function checked(id: string): boolean { return qs<HTMLInputElement>(`#${id}`).checked; }\nfunction setPath(element: HTMLDivElement, value: string, emptyText: string): void { element.textContent = value || emptyText; element.classList.toggle("empty", !value); element.title = value; }\n',
    'function checked(id: string): boolean { return qs<HTMLInputElement>(`#${id}`).checked; }\nfunction hardwareMode(id: string): HardwareMode { return normalizeHardwareMode(document.querySelector<HTMLButtonElement>(`#${id} button.selected`)?.dataset.value); }\nfunction setPath(element: HTMLDivElement, value: string, emptyText: string): void { element.textContent = value || emptyText; element.classList.toggle("empty", !value); element.title = value; }\nfunction setOutputPath(value: string): void {\n  outputPath = value;\n  setPath(outputPathEl, outputPath, "Choose where generated files should be saved");\n  const workspaceLabel = document.querySelector<HTMLElement>("#workspaceOutputPath");\n  if (workspaceLabel) { workspaceLabel.textContent = outputPath || "No output folder selected"; workspaceLabel.classList.toggle("empty", !outputPath); workspaceLabel.title = outputPath; }\n  const workspaceOpen = document.querySelector<HTMLButtonElement>("#workspaceOpenOutput");\n  if (workspaceOpen) workspaceOpen.disabled = !outputPath;\n  updateStartState();\n}\n',
)
regex_once(
    "src/main.ts",
    r'function safeOutputStem\(value: string, fallback: string\): string \{.*?\}\nfunction outputForJob\(\): string \{.*?\}\nfunction makeJobRequest\(\): JobRequest \{.*?\}\nfunction validateRequest',
    '''function outputForJob(): string {
  const input = document.querySelector<HTMLInputElement>(mode === "trail" ? "#trailOutputName" : "#timelapseOutputName");
  return buildOutputPath(mode, outputPath, input?.value ?? "");
}
function makeJobRequest(): JobRequest {
  return {
    command: mode,
    input: inputPath,
    output: outputForJob(),
    executable: customExecutable.value.trim() || engine.path,
    files: currentFilesForJob(),
    groupHardware: hardwareMode("groupHardwarePolicy"),
    trailHardware: hardwareMode("trailHardwarePolicy"),
    timelapseHardware: hardwareMode("timelapseHardwarePolicy"),
    threshold: numberValue("threshold"),
    minMatches: numberValue("minMatches"),
    maxSide: numberValue("maxSide"),
    nfeatures: numberValue("nfeatures"),
    timeMetadata: checked("timeMetadata"),
    timeWindowMinutes: numberValue("timeWindowHours") * 60,
    recursive: checked("recursive"),
    quiet: checked("quiet"),
    linkMode: selectedLinkMode,
    minFrames: numberValue("minFrames"),
    jpegQuality: numberValue("jpegQuality"),
    timelapse: checked("makeTimelapse"),
    fps: numberValue("fps"),
    videoMaxSide: numberValue("videoMaxSide"),
    codec: qs<HTMLInputElement>("#codec").value,
  };
}
function validateRequest''',
)
replace_once(
    "src/main.ts",
    'async function pickOutputFolder(): Promise<void> { const value = await open({ directory: true, multiple: false, title: "Choose output folder" }); if (typeof value !== "string") return; outputPath = value; setPath(outputPathEl, outputPath, "Choose where generated files should be saved"); updateStartState(); }',
    'async function pickOutputFolder(): Promise<void> { const value = await open({ directory: true, multiple: false, title: "Choose output folder" }); if (typeof value !== "string") return; setOutputPath(value); }',
)
replace_once(
    "src/main.ts",
    '  qs<HTMLButtonElement>("#pickOutput").addEventListener("click", () => void pickOutputFolder()); qs<HTMLButtonElement>("#openOutput").addEventListener("click", () => { if (outputPath) void openPath(outputPath); });\n',
    '  qs<HTMLButtonElement>("#pickOutput").addEventListener("click", () => void pickOutputFolder()); qs<HTMLButtonElement>("#openOutput").addEventListener("click", () => { if (outputPath) void openPath(outputPath); });\n  qs<HTMLButtonElement>("#workspacePickOutput").addEventListener("click", () => void pickOutputFolder()); qs<HTMLButtonElement>("#workspaceOpenOutput").addEventListener("click", () => { if (outputPath) void openPath(outputPath); });\n',
)
replace_once(
    "src/main.ts",
    'const preview = photo.browserPreviewable ? `<img class="inspector-preview" src="${escapeHtml(convertFileSrc(photo.path))}" alt="">`',
    'const preview = photo.browserPreviewable ? `<img class="inspector-preview" data-thumb-path="${escapeHtml(photo.path)}" data-thumb-version="${photo.modifiedMs ?? 0}:${photo.sizeBytes}" alt="">`',
)
replace_once(
    "src/main.ts",
    'const preview = photo.browserPreviewable ? `<img src="${escapeHtml(convertFileSrc(photo.path))}" alt="" loading="lazy">`',
    'const preview = photo.browserPreviewable ? `<img data-thumb-path="${escapeHtml(photo.path)}" data-thumb-version="${photo.modifiedMs ?? 0}:${photo.sizeBytes}" alt="" loading="lazy">`',
)

write(
    "src/job-policy.ts",
    '''// SPDX-License-Identifier: AGPL-3.0-only
export type HardwareMode = "auto" | "cpu" | "gpu" | "hybrid";
export type JobMode = "run" | "group" | "trail" | "timelapse";

export function normalizeHardwareMode(value: string | undefined): HardwareMode {
  return value === "cpu" || value === "gpu" || value === "hybrid" ? value : "auto";
}

export function safeOutputStem(value: string, fallback: string): string {
  const trimmed = value.trim().replace(/\\.(?:jpe?g|mp4)$/i, "");
  const cleaned = trimmed.replace(/[\\\\/:*?"<>|]+/g, "_").replace(/^\\.+$/, "").slice(0, 120);
  return cleaned || fallback;
}

export function buildOutputPath(mode: JobMode, directory: string, customName = ""): string {
  if (!directory || mode === "run" || mode === "group") return directory;
  const stem = safeOutputStem(customName, mode === "trail" ? "star_trail" : "timelapse");
  const extension = mode === "trail" ? ".jpg" : ".mp4";
  const hasWindowsSeparator = directory.includes("\\\\") && !directory.includes("/");
  const separator = directory.endsWith("/") || directory.endsWith("\\\\") ? "" : hasWindowsSeparator ? "\\\\" : "/";
  return `${directory}${separator}${stem}${extension}`;
}
''',
)

# Hardware UI becomes presentation + backend reporting only. Launch state is synchronous in JobRequest.
replace_once("src/hardware-options.ts", 'import { invoke } from "@tauri-apps/api/core";\n', "")
regex_once("src/hardware-options.ts", r'type HardwarePolicies = \{.*?\};\n\n', "")
regex_once("src/hardware-options.ts", r'async function pushPolicies\(\): Promise<void> \{.*?\}\n\n', "")
write("src/hardware-options.ts", read("src/hardware-options.ts").replace('      void pushPolicies();\n', '').replace('  qs<HTMLButtonElement>("#startJob")?.addEventListener("click", () => { resetEffectiveForActiveJob(); void pushPolicies(); }, true);', '  qs<HTMLButtonElement>("#startJob")?.addEventListener("click", resetEffectiveForActiveJob, true);').replace('  void pushPolicies();\n', ''))
replace_once(
    "src/bootstrap.ts",
    '  // LaunchStateSync runs after the visible selectors/output controls exist. It serializes\n  // the visible hardware policy before every launch and keeps Workspace on the same\n  // Process output-path state instead of introducing a second independent value.\n  await loadFeature("LaunchStateSync", () => import("./launch-state-sync"));\n',
    '',
)
(ROOT / "src/launch-state-sync.ts").unlink(missing_ok=True)

# ---------------- Native, bounded thumbnail cache ----------------
replace_once(
    "src-tauri/Cargo.toml",
    'serde_json = "1"\n',
    'serde_json = "1"\nimage = { version = "0.25", default-features = false, features = ["jpeg", "png", "webp", "bmp", "tiff"] }\n',
)
lib = read("src-tauri/src/lib.rs")
lib = lib.replace('    env, fs,\n', '    env, fs,\n    collections::hash_map::DefaultHasher,\n    hash::{Hash, Hasher},\n')
lib = re.sub(r'\n#\[derive\(Clone, Deserialize\)\]\n#\[serde\(rename_all = "camelCase"\)\]\nstruct HardwarePolicies \{.*?\nfn hardware_policies\(\) -> .*?\n\}\n', '\n', lib, flags=re.S)
lib = lib.replace('    files: Option<Vec<String>>,\n', '    files: Option<Vec<String>>,\n    group_hardware: String,\n    trail_hardware: String,\n    timelapse_hardware: String,\n')
lib = re.sub(r'\n#\[tauri::command\]\nfn set_hardware_policies\(policies: HardwarePolicies\) -> Result<\(\), String> \{.*?\n\}\n\nfn is_hidden', '\nfn is_hidden', lib, flags=re.S)
validation_anchor = '    if request.output.trim().is_empty() {\n        return Err("Output path is required".into());\n    }\n\n'
hardware_validation = '''    if request.output.trim().is_empty() {
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

'''
if validation_anchor not in lib:
    raise SystemExit("Rust output validation anchor missing")
lib = lib.replace(validation_anchor, hardware_validation, 1)
lib = re.sub(
    r'fn append_hardware_args\(\n    request: &JobRequest,\n    args: &mut Vec<String>,\n    policies: &HardwarePolicies,\n    supported: bool,\n\) -> Result<\(\), String> \{.*?\n\}\n\nfn safe_name',
    '''fn append_hardware_args(
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

fn safe_name''',
    lib,
    count=1,
    flags=re.S,
)
lib = re.sub(
    r'    let mut args = build_args\(&request, &input\);\n    let policies = hardware_policies\(\).*?    append_hardware_args\(\n        &request,\n        &mut args,\n        &policies,\n        engine_supports_hardware_policies\(&executable\),\n    \)\?;',
    '    let mut args = build_args(&request, &input);\n    append_hardware_args(\n        &request,\n        &mut args,\n        engine_supports_hardware_policies(&executable),\n    )?;',
    lib,
    count=1,
    flags=re.S,
)
thumbnail_code = r'''
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

fn thumbnail_key(source: &Path, max_width: u32, max_height: u32, source_version: &str) -> Result<u64, String> {
    let metadata = fs::metadata(source).map_err(|error| format!("Could not read thumbnail source metadata: {error}"))?;
    let modified = metadata.modified().ok().and_then(|value| value.duration_since(UNIX_EPOCH).ok()).map(|value| value.as_nanos()).unwrap_or(0);
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
    let Ok(entries) = fs::read_dir(cache_dir) else { return; };
    let mut files = entries.filter_map(Result::ok).filter_map(|entry| {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("jpg") { return None; }
        let metadata = entry.metadata().ok()?;
        let modified = metadata.modified().ok().and_then(|value| value.duration_since(UNIX_EPOCH).ok()).map(|value| value.as_nanos()).unwrap_or(0);
        Some((path, metadata.len(), modified))
    }).collect::<Vec<_>>();
    let mut bytes = files.iter().map(|(_, bytes, _)| *bytes).sum::<u64>();
    if files.len() <= THUMBNAIL_CACHE_ITEMS && bytes <= THUMBNAIL_CACHE_BYTES { return; }
    files.sort_by_key(|(_, _, modified)| *modified);
    let mut count = files.len();
    for (path, size, _) in files {
        if count <= THUMBNAIL_CACHE_ITEMS && bytes <= THUMBNAIL_CACHE_BYTES { break; }
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
    if !source.is_file() { return Err("Thumbnail source does not exist".into()); }
    let metadata = fs::metadata(source).map_err(|error| format!("Could not read thumbnail source: {error}"))?;
    fs::create_dir_all(cache_dir).map_err(|error| format!("Could not create thumbnail cache: {error}"))?;
    let key = thumbnail_key(source, max_width, max_height, source_version)?;
    let target = cache_dir.join(format!("{key:016x}.jpg"));
    if target.is_file() {
        return Ok(ThumbnailResult { path: target.to_string_lossy().into_owned(), cache_hit: true, source_bytes: metadata.len() });
    }

    let _guard = THUMBNAIL_GENERATION_LOCK.get_or_init(|| Mutex::new(())).lock().map_err(|_| "Thumbnail generator is unavailable")?;
    if target.is_file() {
        return Ok(ThumbnailResult { path: target.to_string_lossy().into_owned(), cache_hit: true, source_bytes: metadata.len() });
    }
    let image = image::ImageReader::open(source).map_err(|error| format!("Could not open thumbnail source: {error}"))?.with_guessed_format().map_err(|error| format!("Could not detect image format: {error}"))?.decode().map_err(|error| format!("Could not decode thumbnail source: {error}"))?;
    let thumbnail = image.thumbnail(max_width, max_height).to_rgb8();
    let temporary = target.with_extension("jpg.tmp");
    {
        let mut file = fs::File::create(&temporary).map_err(|error| format!("Could not create thumbnail cache file: {error}"))?;
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut file, 82);
        encoder.encode_image(&thumbnail).map_err(|error| format!("Could not encode thumbnail: {error}"))?;
    }
    fs::rename(&temporary, &target).or_else(|_| { let _ = fs::remove_file(&target); fs::rename(&temporary, &target) }).map_err(|error| format!("Could not finalize thumbnail cache file: {error}"))?;
    prune_thumbnail_cache(cache_dir);
    Ok(ThumbnailResult { path: target.to_string_lossy().into_owned(), cache_hit: false, source_bytes: metadata.len() })
}

#[tauri::command(rename_all = "camelCase")]
async fn get_thumbnail(
    source_path: String,
    max_width: u32,
    max_height: u32,
    source_version: Option<String>,
    app: AppHandle,
) -> Result<ThumbnailResult, String> {
    let cache_dir = app.path().app_cache_dir().map_err(|error| format!("Could not resolve app cache directory: {error}"))?.join("thumbnails-v1");
    let source = PathBuf::from(source_path);
    let version = source_version.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || generate_thumbnail(&cache_dir, &source, max_width, max_height, &version)).await.map_err(|error| format!("Thumbnail worker failed: {error}"))?
}

'''
marker = '#[tauri::command]\nfn stop_job'
if marker not in lib:
    raise SystemExit("Rust stop_job marker missing")
lib = lib.replace(marker, thumbnail_code + marker, 1)
lib = lib.replace('            set_hardware_policies,\n', '')
lib = lib.replace('            scan_photos,\n            start_job,\n', '            scan_photos,\n            get_thumbnail,\n            start_job,\n')
# Replace tests module with stronger regressions.
lib = re.sub(r'#\[cfg\(test\)\]\nmod tests \{.*\}\s*$', r'''#[cfg(test)]
mod tests {
    use super::*;

    fn request(command: &str) -> JobRequest {
        JobRequest {
            command: command.into(), input: ".".into(), output: "out".into(), executable: None, files: None,
            group_hardware: "gpu".into(), trail_hardware: "gpu".into(), timelapse_hardware: "gpu".into(),
            threshold: 0.42, min_matches: 18, max_side: 1000, nfeatures: 2500, time_metadata: false,
            time_window_minutes: 360.0, recursive: true, quiet: false, link_mode: "copy".into(), min_frames: 2,
            jpeg_quality: 95, timelapse: true, fps: 24.0, video_max_side: 1920, codec: "mp4v".into(),
        }
    }

    fn assert_pair(args: &[String], flag: &str, value: &str) {
        let index = args.iter().position(|item| item == flag).unwrap_or_else(|| panic!("missing {flag}"));
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
    fn safe_stage_names_keep_extensions() { assert_eq!(safe_name("IMG 0001.CR3"), "IMG_0001.CR3"); }

    #[test]
    fn group_gpu_is_exact() {
        let req = request("group"); let mut args = Vec::new(); append_hardware_args(&req, &mut args, true).unwrap();
        assert_eq!(args, vec!["--group-hardware", "gpu"]);
    }

    #[test]
    fn trail_gpu_is_exact() {
        let req = request("trail"); let mut args = Vec::new(); append_hardware_args(&req, &mut args, true).unwrap();
        assert_eq!(args, vec!["--trail-hardware", "gpu"]);
    }

    #[test]
    fn timelapse_gpu_is_exact() {
        let req = request("timelapse"); let mut args = Vec::new(); append_hardware_args(&req, &mut args, true).unwrap();
        assert_eq!(args, vec!["--timelapse-hardware", "gpu"]);
    }

    #[test]
    fn full_run_uses_all_exact_gpu_flags() {
        let req = request("run"); let mut args = Vec::new(); append_hardware_args(&req, &mut args, true).unwrap();
        assert_pair(&args, "--group-hardware", "gpu"); assert_pair(&args, "--trail-hardware", "gpu"); assert_pair(&args, "--timelapse-hardware", "gpu");
        assert_eq!(args.len(), 6);
    }

    #[test]
    fn explicit_gpu_never_falls_back_when_engine_is_legacy() {
        let req = request("trail"); let mut args = Vec::new(); let error = append_hardware_args(&req, &mut args, false).unwrap_err();
        assert!(error.contains("not downgraded to Auto")); assert!(args.is_empty());
    }

    #[test]
    fn native_thumbnail_cache_hits_and_invalidates_by_version() {
        let root = env::temp_dir().join(format!("gui4tihulu-thumb-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root); fs::create_dir_all(&root).unwrap();
        let source = root.join("source.png"); let cache = root.join("cache");
        image::RgbImage::from_pixel(640, 480, image::Rgb([12, 34, 56])).save(&source).unwrap();
        let first = generate_thumbnail(&cache, &source, 160, 120, "v1").unwrap(); assert!(!first.cache_hit); assert!(Path::new(&first.path).is_file());
        let second = generate_thumbnail(&cache, &source, 160, 120, "v1").unwrap(); assert!(second.cache_hit); assert_eq!(first.path, second.path);
        let invalidated = generate_thumbnail(&cache, &source, 160, 120, "v2").unwrap(); assert!(!invalidated.cache_hit); assert_ne!(first.path, invalidated.path);
        let _ = fs::remove_dir_all(root);
    }
}
''', lib, count=1, flags=re.S)
write("src-tauri/src/lib.rs", lib)

write(
    "src/photo-thumbnail-manager.ts",
    '''// SPDX-License-Identifier: AGPL-3.0-only
import "./performance.css";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

const GRID_SIZE: [number, number] = [320, 240];
const INSPECTOR_SIZE: [number, number] = [960, 720];
const GROUP_SIZE: [number, number] = [180, 120];
const MAX_ACTIVE_REQUESTS = 2;
const MAX_FRONT_CACHE_ITEMS = 512;
const PREFETCH_MARGIN = "220px 0px";
const PERFORMANCE_MODE_THRESHOLD = 320;

type ThumbnailResult = { path: string; cacheHit: boolean; sourceBytes: number };
type QueueTask = { run: () => Promise<void> };

const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();
const queue: QueueTask[] = [];
const visibleImages = new WeakSet<HTMLImageElement>();
let activeRequests = 0;
let workspaceActive = false;
let lastSourcePath = "";
let metrics = { hits: 0, misses: 0, deduped: 0, requests: 0 };

function keyFor(source: string, version: string, width: number, height: number): string { return `${width}x${height}:${version}:${source}`; }
function touch(key: string): string | null { const value = cache.get(key); if (!value) return null; cache.delete(key); cache.set(key, value); return value; }
function put(key: string, value: string): string { cache.delete(key); cache.set(key, value); while (cache.size > MAX_FRONT_CACHE_ITEMS) { const first = cache.keys().next().value as string | undefined; if (!first) break; cache.delete(first); } return value; }

function cacheStat(): HTMLElement | null {
  const stats = document.querySelector<HTMLElement>(".photo-stats"); if (!stats) return null;
  let node = document.querySelector<HTMLElement>("#thumbCacheStat");
  if (!node) { node = document.createElement("span"); node.id = "thumbCacheStat"; node.title = "Native bounded thumbnail cache; no full-resolution image is assigned to workspace thumbnail elements."; stats.append(node); }
  return node;
}
function updateStats(): void { const node = cacheStat(); if (node) node.textContent = `thumb native ${metrics.hits} hit · ${metrics.misses} miss · ${metrics.deduped} dedupe`; }
function updatePerformanceMode(): void { const count = document.querySelectorAll("#photoGrid .photo-tile").length; document.documentElement.classList.toggle("workspace-performance-mode", count >= PERFORMANCE_MODE_THRESHOLD); }

function pump(): void {
  if (!workspaceActive) return;
  while (activeRequests < MAX_ACTIVE_REQUESTS && queue.length) {
    const task = queue.shift(); if (!task) break; activeRequests += 1;
    task.run().catch(() => undefined).finally(() => { activeRequests -= 1; pump(); });
  }
}
function enqueue(run: () => Promise<void>): void { queue.push({ run }); pump(); }

async function thumbnailUrl(source: string, version: string, width: number, height: number): Promise<string> {
  const key = keyFor(source, version, width, height); const cached = touch(key);
  if (cached) { metrics.hits += 1; updateStats(); return cached; }
  const pending = inFlight.get(key); if (pending) { metrics.deduped += 1; updateStats(); return pending; }
  metrics.requests += 1;
  const promise = invoke<ThumbnailResult>("get_thumbnail", { sourcePath: source, maxWidth: width, maxHeight: height, sourceVersion: version })
    .then((result) => { if (result.cacheHit) metrics.hits += 1; else metrics.misses += 1; updateStats(); return put(key, convertFileSrc(result.path)); })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise); return promise;
}

function dimensions(image: HTMLImageElement): [number, number] {
  if (image.classList.contains("inspector-preview")) return INSPECTOR_SIZE;
  if (image.classList.contains("workspace-group-thumb")) return GROUP_SIZE;
  return GRID_SIZE;
}
async function show(image: HTMLImageElement): Promise<void> {
  const source = image.dataset.thumbPath; if (!workspaceActive || !source || !visibleImages.has(image)) return;
  const version = image.dataset.thumbVersion ?? ""; const [width, height] = dimensions(image);
  try {
    const url = await thumbnailUrl(source, version, width, height);
    if (workspaceActive && image.isConnected && visibleImages.has(image) && image.dataset.thumbPath === source) { image.src = url; image.dataset.thumbReady = "1"; }
  } catch (error) {
    image.dataset.thumbError = String(error); image.removeAttribute("src");
  }
}

const visibility = new IntersectionObserver((entries) => {
  if (!workspaceActive) return;
  for (const entry of entries) {
    const image = entry.target as HTMLImageElement;
    if (entry.isIntersecting) { visibleImages.add(image); enqueue(() => show(image)); }
    else { visibleImages.delete(image); image.removeAttribute("src"); }
  }
}, { root: null, rootMargin: PREFETCH_MARGIN, threshold: 0.01 });

function manage(image: HTMLImageElement): void {
  if (!image.dataset.thumbPath) return;
  image.loading = "lazy"; image.decoding = "async";
  if (image.dataset.thumbManaged !== "1") { image.dataset.thumbManaged = "1"; image.removeAttribute("src"); }
  if (workspaceActive) visibility.observe(image);
}
function scan(root: ParentNode): void {
  if (root instanceof HTMLImageElement) manage(root);
  root.querySelectorAll?.<HTMLImageElement>("img[data-thumb-path]").forEach(manage);
}
function sourcePath(): string { const value = document.querySelector<HTMLElement>("#photoSourcePath")?.textContent?.trim() ?? ""; return value === "Scanning…" || value === "No folder selected" ? "" : value; }
function syncSource(): void { const next = sourcePath(); if (next === lastSourcePath) return; lastSourcePath = next; cache.clear(); inFlight.clear(); metrics = { hits: 0, misses: 0, deduped: 0, requests: 0 }; updateStats(); }
function pause(): void { workspaceActive = false; document.querySelectorAll<HTMLImageElement>("#section-photos img[data-thumb-managed='1']").forEach((image) => { visibility.unobserve(image); visibleImages.delete(image); image.removeAttribute("src"); }); }
function resume(): void { workspaceActive = true; const section = document.querySelector<HTMLElement>("#section-photos"); if (section) scan(section); pump(); updatePerformanceMode(); }
function syncActive(): void { const next = Boolean(document.querySelector<HTMLElement>("#section-photos")?.classList.contains("active")); if (next === workspaceActive) return; next ? resume() : pause(); }

function start(): void {
  const section = document.querySelector<HTMLElement>("#section-photos"); const source = document.querySelector<HTMLElement>("#photoSourcePath"); if (!section || !source) return;
  workspaceActive = section.classList.contains("active"); scan(section); syncSource(); updateStats(); updatePerformanceMode();
  const contentObserver = new MutationObserver((mutations) => { for (const mutation of mutations) for (const node of mutation.addedNodes) if (node instanceof HTMLElement) scan(node); requestAnimationFrame(updatePerformanceMode); });
  contentObserver.observe(section, { childList: true, subtree: true });
  const sourceObserver = new MutationObserver(syncSource); sourceObserver.observe(source, { childList: true, characterData: true, subtree: true });
  const activeObserver = new MutationObserver(syncActive); activeObserver.observe(section, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("beforeunload", () => { contentObserver.disconnect(); sourceObserver.disconnect(); activeObserver.disconnect(); visibility.disconnect(); }, { once: true });
}
start();
''',
)

# ---------------- Group selection + correct workspace ordering ----------------
studio = read("src/studio-editor.ts")
studio = studio.replace('  let mergeChecked = new Set<string>();\n', '  let selectedGroupIds = new Set<string>();\n  let groupSelectionAnchor: string | null = null;\n')
studio = studio.replace('  commandBar.insertAdjacentElement("afterend", groupPanel);', '  layout.insertAdjacentElement("afterend", groupPanel);')
studio = studio.replace('  layout.insertAdjacentElement("afterend", editorPanel);', '  groupPanel.insertAdjacentElement("afterend", editorPanel);')
studio = studio.replace('        <button class="ghost-button compact-button" id="studioRenameGroup" type="button">Rename</button>\n        <button class="ghost-button compact-button" id="studioSplitGroup" type="button">Split selected</button>\n        <button class="ghost-button compact-button" id="studioMergeGroups" type="button">Merge checked</button>\n        <button class="ghost-button compact-button danger-text" id="studioDeleteGroup" type="button">Delete</button>', '        <button class="ghost-button compact-button" id="studioSelectAllGroups" type="button">Select all</button>\n        <button class="ghost-button compact-button" id="studioClearGroupSelection" type="button">Clear selection</button>\n        <button class="ghost-button compact-button" id="studioInvertGroupSelection" type="button">Invert selection</button>\n        <button class="ghost-button compact-button" id="studioRenameGroup" type="button">Rename active</button>\n        <button class="ghost-button compact-button" id="studioSplitGroup" type="button">Split selected frames</button>\n        <button class="ghost-button compact-button" id="studioMergeGroups" type="button">Merge selected groups</button>\n        <button class="ghost-button compact-button danger-text" id="studioDeleteGroup" type="button">Delete selected</button>')
studio = studio.replace('activeGroupId = null; mergeChecked.clear(); groupUndo = []; groupRedo = [];', 'activeGroupId = null; selectedGroupIds.clear(); groupSelectionAnchor = null; groupUndo = []; groupRedo = [];')
studio = studio.replace('activeGroupId = snapshot.activeGroupId; mergeChecked.clear(); renderGroups();', 'activeGroupId = snapshot.activeGroupId; selectedGroupIds.clear(); groupSelectionAnchor = null; renderGroups();')
render_groups = r'''  function renderGroups(): void {
    const pathSet = new Set(allPaths());
    for (const path of [...assignments.keys()]) if (!pathSet.has(path)) assignments.delete(path);
    const validGroupIds = new Set(groups.map((group) => group.id));
    selectedGroupIds = new Set([...selectedGroupIds].filter((id) => validGroupIds.has(id)));
    groupList.innerHTML = "";
    const ungroupedCount = allPaths().filter((path) => !assignments.get(path)).length;
    const allCard = document.createElement("button");
    allCard.type = "button"; allCard.className = `studio-group-card all-card${activeGroupId === null ? " active" : ""}`;
    allCard.innerHTML = `<span class="group-card-main"><strong>All frames</strong><small>${allPaths().length} photos · ${ungroupedCount} ungrouped</small></span>`;
    allCard.addEventListener("click", () => { activeGroupId = null; renderGroups(); applyGroupFilter(); });
    groupList.append(allCard);

    const selectGroup = (groupId: string, event: MouseEvent) => {
      const order = groups.map((group) => group.id);
      if (event.shiftKey && groupSelectionAnchor && order.includes(groupSelectionAnchor)) {
        if (!(event.ctrlKey || event.metaKey)) selectedGroupIds.clear();
        const [from, to] = [order.indexOf(groupSelectionAnchor), order.indexOf(groupId)].sort((a, b) => a - b);
        for (let index = from; index <= to; index += 1) selectedGroupIds.add(order[index]);
      } else if (event.ctrlKey || event.metaKey) {
        if (selectedGroupIds.has(groupId)) selectedGroupIds.delete(groupId); else selectedGroupIds.add(groupId);
        groupSelectionAnchor = groupId;
      } else {
        if (selectedGroupIds.has(groupId)) selectedGroupIds.delete(groupId); else selectedGroupIds.add(groupId);
        groupSelectionAnchor = groupId;
      }
      renderGroups();
    };

    for (const group of groups) {
      const count = groupPaths(group.id).length;
      const card = document.createElement("article");
      card.className = `studio-group-card${activeGroupId === group.id ? " active" : ""}${selectedGroupIds.has(group.id) ? " group-selected" : ""}`;
      card.draggable = true; card.dataset.groupId = group.id;
      card.innerHTML = `<button type="button" class="group-select-toggle" aria-pressed="${selectedGroupIds.has(group.id)}" title="Select group"><span></span></button><button type="button" class="group-open"><span class="group-card-main"><strong>${escapeHtml(group.name)}</strong><small>${count} photo${count === 1 ? "" : "s"}</small></span><span class="group-drop-hint">drop photos</span></button>`;
      card.querySelector<HTMLButtonElement>(".group-select-toggle")?.addEventListener("click", (event) => { event.stopPropagation(); selectGroup(group.id, event); });
      card.querySelector<HTMLButtonElement>(".group-open")?.addEventListener("click", (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey) { selectGroup(group.id, event); return; }
        activeGroupId = group.id; renderGroups(); applyGroupFilter();
      });
      card.addEventListener("dragstart", (event) => { draggedGroupId = group.id; event.dataTransfer?.setData("application/x-tihulu-group", group.id); });
      card.addEventListener("dragend", () => { draggedGroupId = null; card.classList.remove("group-drag-over"); });
      card.addEventListener("dragover", (event) => { event.preventDefault(); card.classList.add("group-drag-over"); });
      card.addEventListener("dragleave", () => card.classList.remove("group-drag-over"));
      card.addEventListener("drop", (event) => {
        event.preventDefault(); card.classList.remove("group-drag-over");
        const incomingGroup = event.dataTransfer?.getData("application/x-tihulu-group") || draggedGroupId;
        if (incomingGroup && incomingGroup !== group.id) {
          recordGroupMutation(); const from = groups.findIndex((item) => item.id === incomingGroup); const to = groups.findIndex((item) => item.id === group.id);
          if (from >= 0 && to >= 0) { const [moved] = groups.splice(from, 1); groups.splice(to, 0, moved); renderGroups(); scheduleSave(); }
          return;
        }
        const paths = selectedPaths(); const transferPath = event.dataTransfer?.getData("text/plain"); const movePaths = paths.length ? paths : transferPath ? [transferPath] : [];
        if (movePaths.length) movePathsToGroup(movePaths, group.id);
      });
      groupList.append(card);
    }
    moveTarget.innerHTML = `<option value="">Choose group…</option><option value="__ungrouped__">Ungrouped</option>${groups.map((group) => `<option value="${group.id}">${escapeHtml(group.name)}</option>`).join("")}`;
    const current = activeGroup();
    const selectionText = selectedGroupIds.size ? ` · ${selectedGroupIds.size} selected` : "";
    groupStatus.textContent = current ? `${current.name}: ${groupPaths(current.id).length} photo(s)${selectionText}. Active group controls the frame filter; selection is independent.` : `${groups.length} group(s) · ${ungroupedCount} ungrouped photo(s)${selectionText}`;
    updateGroupHistoryButtons();
  }
'''
studio, count = re.subn(r'  function renderGroups\(\): void \{.*?\n  \}\n\n  function movePathsToGroup', render_groups + '\n  function movePathsToGroup', studio, count=1, flags=re.S)
if count != 1: raise SystemExit(f"studio renderGroups replacement count {count}")
# Replace old delete and merge handlers, and insert selection toolbar handlers.
old_delete = '  groupPanel.querySelector<HTMLButtonElement>("#studioDeleteGroup")!.addEventListener("click", () => { const group = activeGroup(); if (!group) { toast("Choose a group first."); return; } if (!window.confirm(`Delete ${group.name}? Photos become ungrouped; files are not deleted.`)) return; recordGroupMutation(); assignments.forEach((id, path) => { if (id === group.id) assignments.set(path, null); }); groups = groups.filter((item) => item.id !== group.id); activeGroupId = null; renderGroups(); applyGroupFilter(); scheduleSave(); });'
new_delete = '  groupPanel.querySelector<HTMLButtonElement>("#studioDeleteGroup")!.addEventListener("click", () => { const ids = [...selectedGroupIds]; if (!ids.length) { toast("Select one or more groups first."); return; } if (!window.confirm(`Delete ${ids.length} selected group${ids.length === 1 ? "" : "s"}? Frames become Ungrouped; source files are never deleted.`)) return; recordGroupMutation(); assignments.forEach((id, path) => { if (id && selectedGroupIds.has(id)) assignments.set(path, null); }); groups = groups.filter((item) => !selectedGroupIds.has(item.id)); if (activeGroupId && selectedGroupIds.has(activeGroupId)) activeGroupId = null; selectedGroupIds.clear(); groupSelectionAnchor = null; renderGroups(); applyGroupFilter(); scheduleSave(); });'
if old_delete not in studio: raise SystemExit("old delete handler missing")
studio = studio.replace(old_delete, new_delete, 1)
old_merge = '  groupPanel.querySelector<HTMLButtonElement>("#studioMergeGroups")!.addEventListener("click", () => { const ids = [...mergeChecked]; if (ids.length < 2) { toast("Check at least two groups to merge."); return; } const selectedGroups = groups.filter((group) => ids.includes(group.id)); const name = window.prompt("Merged group name", uniqueGroupName(selectedGroups.map((group) => group.name).join(" + "))); if (!name?.trim()) return; recordGroupMutation(); const target = { id: crypto.randomUUID(), name: uniqueGroupName(name.trim()) }; groups.push(target); assignments.forEach((id, path) => { if (id && ids.includes(id)) assignments.set(path, target.id); }); groups = groups.filter((group) => !ids.includes(group.id)); activeGroupId = target.id; mergeChecked.clear(); renderGroups(); applyGroupFilter(); scheduleSave(); });'
new_merge = '  groupPanel.querySelector<HTMLButtonElement>("#studioMergeGroups")!.addEventListener("click", () => { const ids = [...selectedGroupIds]; if (ids.length < 2) { toast("Select at least two groups to merge."); return; } const selectedGroups = groups.filter((group) => ids.includes(group.id)); const name = window.prompt("Merged group name", uniqueGroupName(selectedGroups.map((group) => group.name).join(" + "))); if (!name?.trim()) return; recordGroupMutation(); const target = { id: crypto.randomUUID(), name: uniqueGroupName(name.trim()) }; groups.push(target); assignments.forEach((id, path) => { if (id && selectedGroupIds.has(id)) assignments.set(path, target.id); }); groups = groups.filter((group) => !selectedGroupIds.has(group.id)); activeGroupId = target.id; selectedGroupIds = new Set([target.id]); groupSelectionAnchor = target.id; renderGroups(); applyGroupFilter(); scheduleSave(); });'
if old_merge not in studio: raise SystemExit("old merge handler missing")
studio = studio.replace(old_merge, new_merge, 1)
selection_handlers = '''  groupPanel.querySelector<HTMLButtonElement>("#studioSelectAllGroups")!.addEventListener("click", () => { selectedGroupIds = new Set(groups.map((group) => group.id)); groupSelectionAnchor = groups.at(-1)?.id ?? null; renderGroups(); });
  groupPanel.querySelector<HTMLButtonElement>("#studioClearGroupSelection")!.addEventListener("click", () => { selectedGroupIds.clear(); groupSelectionAnchor = null; renderGroups(); });
  groupPanel.querySelector<HTMLButtonElement>("#studioInvertGroupSelection")!.addEventListener("click", () => { selectedGroupIds = new Set(groups.filter((group) => !selectedGroupIds.has(group.id)).map((group) => group.id)); groupSelectionAnchor = null; renderGroups(); });
'''
anchor = '  groupPanel.querySelector<HTMLButtonElement>("#studioRenameGroup")!'
if anchor not in studio: raise SystemExit("group action anchor missing")
studio = studio.replace(anchor, selection_handlers + anchor, 1)
if 'mergeChecked' in studio: raise SystemExit("mergeChecked remained after migration")
write("src/studio-editor.ts", studio)

# Add distinct active-vs-selected styling.
with (ROOT / "src/studio-editor.css").open("a") as css:
    css.write('\n#studioGroupList .studio-group-card.group-selected{border-color:rgba(72,219,195,.8);box-shadow:0 0 0 1px rgba(72,219,195,.2) inset}#studioGroupList .studio-group-card.active.group-selected{outline:1px solid rgba(126,166,255,.65);outline-offset:2px}.group-select-toggle{position:relative;width:19px;height:19px;flex:0 0 19px;border:1px solid rgba(255,255,255,.22);border-radius:6px;background:transparent;padding:0;cursor:pointer}.group-select-toggle[aria-pressed="true"]{background:#48dbc3;border-color:#48dbc3}.group-select-toggle[aria-pressed="true"] span:after{content:"✓";position:absolute;inset:-1px 0 0;color:#07120f;font-size:13px;font-weight:800;text-align:center}\n')

# Group preview now advertises native thumbnail source, never convertFileSrc(full source).
replace_once("src/workspace-parity.ts", 'import { convertFileSrc } from "@tauri-apps/api/core";\n', '')
regex_once(
    "src/workspace-parity.ts",
    r'function addGroupThumbnails\(\): void \{.*?\n\}\n\nasync function processCurrentGroup',
    '''function addGroupThumbnails(): void {
  const list = qs<HTMLElement>("#studioGroupList"); if (!list) return;
  const state = readState(); const assignments = new Map(state?.assignments ?? []);
  const tileByPath = new Map(tiles().map((tile) => [tile.dataset.path ?? "", tile]));
  const firstPreviewByGroup = new Map<string, { path: string; version: string }>();
  for (const [path, groupId] of assignments) {
    if (!groupId || firstPreviewByGroup.has(groupId)) continue;
    const image = tileByPath.get(path)?.querySelector<HTMLImageElement>("img[data-thumb-path]");
    if (image) firstPreviewByGroup.set(groupId, { path, version: image.dataset.thumbVersion ?? "" });
  }
  for (const card of Array.from(list.querySelectorAll<HTMLElement>(".studio-group-card[data-group-id]"))) {
    const existing = card.querySelector<HTMLImageElement>(".workspace-group-thumb");
    if (!groupThumbsEnabled) { existing?.remove(); continue; }
    const groupId = card.dataset.groupId; const preview = groupId ? firstPreviewByGroup.get(groupId) : undefined;
    if (!preview) { existing?.remove(); continue; }
    if (existing?.dataset.thumbPath === preview.path && existing.dataset.thumbVersion === preview.version) continue;
    existing?.remove(); const thumb = document.createElement("img"); thumb.className = "workspace-group-thumb";
    thumb.dataset.thumbPath = preview.path; thumb.dataset.thumbVersion = preview.version; thumb.alt = ""; thumb.loading = "lazy"; thumb.decoding = "async"; card.prepend(thumb);
  }
}

async function processCurrentGroup''',
)
# Reduce parity observers to child changes; class state updates are already triggered by group-open and grid code paths.
replace_once(
    "src/workspace-parity.ts",
    '  observer.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });\n  observer.observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });',
    '  observer.observe(list, { childList: true, subtree: true });\n  observer.observe(grid, { childList: true, subtree: true });',
)

# Studio preview: use the native cache for interactive preview and debounce slider renders.
replace_once("src/studio-editor.ts", 'import { convertFileSrc } from "@tauri-apps/api/core";\n', 'import { convertFileSrc, invoke } from "@tauri-apps/api/core";\n')
replace_once("src/studio-editor.ts", '  let renderGeneration = 0;\n  let saveTimer: number | null = null;\n', '  let renderGeneration = 0;\n  let previewTimer: number | null = null;\n  let saveTimer: number | null = null;\n')
# Introduce preview thumbnail resolver immediately before renderPreview.
anchor = '  async function renderPreview(path: string): Promise<void> {'
helper = '''  function schedulePreview(path: string): void { if (previewTimer !== null) window.clearTimeout(previewTimer); previewTimer = window.setTimeout(() => { previewTimer = null; void renderPreview(path); }, 45); }
  async function previewSource(path: string, maxSide: number): Promise<string> {
    if (maxSide > 1600) return path;
    const tile = tiles().find((item) => item.dataset.path === path); const version = tile?.querySelector<HTMLImageElement>("img[data-thumb-path]")?.dataset.thumbVersion ?? "";
    const result = await invoke<{ path: string }>("get_thumbnail", { sourcePath: path, maxWidth: maxSide, maxHeight: maxSide, sourceVersion: `editor:${version}` });
    return result.path;
  }
'''
studio = read("src/studio-editor.ts")
if anchor not in studio: raise SystemExit("renderPreview anchor missing")
studio = studio.replace(anchor, helper + anchor, 1)
studio = studio.replace('    const image = await loadLocalImage(path);', '    const image = await loadLocalImage(await previewSource(path, maxSide));', 1)
studio = studio.replace('if (currentPrimaryPath) { edits.set(currentPrimaryPath, currentEditFromControls()); void renderPreview(currentPrimaryPath); }', 'if (currentPrimaryPath) { edits.set(currentPrimaryPath, currentEditFromControls()); schedulePreview(currentPrimaryPath); }')
write("src/studio-editor.ts", studio)

# ---------------- Tests + CI ----------------
write(
    "tests/job-policy.test.ts",
    '''import test from "node:test";
import assert from "node:assert/strict";
import { buildOutputPath, normalizeHardwareMode } from "../src/job-policy.ts";

test("hardware preserves explicit GPU", () => { assert.equal(normalizeHardwareMode("gpu"), "gpu"); assert.equal(normalizeHardwareMode("cpu"), "cpu"); assert.equal(normalizeHardwareMode("bogus"), "auto"); });
test("trail custom filename stays below canonical output", () => { assert.equal(buildOutputPath("trail", "/night/out", "gece-1.jpg"), "/night/out/gece-1.jpg"); });
test("timelapse custom filename stays below canonical output", () => { assert.equal(buildOutputPath("timelapse", "/night/out", "gece-video.mp4"), "/night/out/gece-video.mp4"); });
test("Windows output keeps Windows separator", () => { assert.equal(buildOutputPath("trail", "C:\\\\night\\\\out", "gece-1"), "C:\\\\night\\\\out\\\\gece-1.jpg"); });
test("run and group use canonical directory exactly", () => { assert.equal(buildOutputPath("run", "/night/out", "ignored"), "/night/out"); assert.equal(buildOutputPath("group", "/night/out", "ignored"), "/night/out"); });
''',
)
write(
    "tests/source-regressions.test.mjs",
    '''import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("JobRequest owns exact hardware selections", () => { const main = read("src/main.ts"); const rust = read("src-tauri/src/lib.rs"); assert.match(main, /groupHardware: hardwareMode\\("groupHardwarePolicy"\\)/); assert.match(main, /trailHardware: hardwareMode\\("trailHardwarePolicy"\\)/); assert.match(main, /timelapseHardware: hardwareMode\\("timelapseHardwarePolicy"\\)/); assert.doesNotMatch(rust, /HARDWARE_POLICIES|set_hardware_policies/); assert.match(rust, /request\\.group_hardware/); });
test("launch barrier workaround is gone", () => { assert.doesNotMatch(read("src/bootstrap.ts"), /LaunchStateSync/); });
test("workspace images never receive full source URLs", () => { const main = read("src/main.ts"); const thumbs = read("src/photo-thumbnail-manager.ts"); assert.doesNotMatch(main, /convertFileSrc\\(photo\\.path\\)/); assert.match(main, /data-thumb-path/); assert.match(thumbs, /invoke<ThumbnailResult>\\("get_thumbnail"/); assert.doesNotMatch(thumbs, /createImageBitmap|ImageDecoder|fetch\\(source/); });
test("group previews share native thumbnail manager", () => { const parity = read("src/workspace-parity.ts"); assert.match(parity, /thumb\\.dataset\\.thumbPath = preview\\.path/); assert.doesNotMatch(parity, /convertFileSrc\\(path\\)/); });
test("manual review command is above Frames, groups are below Frames", () => { const studio = read("src/studio-editor.ts"); assert.match(studio, /controls\\.insertAdjacentElement\\("afterend", commandBar\\)/); assert.match(studio, /layout\\.insertAdjacentElement\\("afterend", groupPanel\\)/); assert.match(studio, /groupPanel\\.insertAdjacentElement\\("afterend", editorPanel\\)/); });
test("group mass selection and delete controls exist", () => { const studio = read("src/studio-editor.ts"); for (const id of ["studioSelectAllGroups", "studioClearGroupSelection", "studioInvertGroupSelection", "studioDeleteGroup", "studioMergeGroups"]) assert.match(studio, new RegExp(id)); assert.match(studio, /Frames become Ungrouped; source files are never deleted/); assert.match(studio, /selectedGroupIds/); assert.match(studio, /groupUndo/); });
''',
)
replace_once(
    "package.json",
    '    "check": "tsc --noEmit",\n',
    '    "check": "tsc --noEmit",\n    "test": "node --experimental-strip-types --test tests/*.test.ts tests/*.test.mjs",\n',
)
# Version follows live main (0.3.8), so this implementation is v0.3.9 rather than reusing an existing version.
replace_once("package.json", '"version": "0.3.8"', '"version": "0.3.9"')
replace_once("src-tauri/tauri.conf.json", '"version": "0.3.8"', '"version": "0.3.9"')
replace_once("src-tauri/Cargo.toml", 'version = "0.3.6"', 'version = "0.3.9"')
replace_once("src/branding.ts", 'v0.3.8";', 'v0.3.9";')

workflow = read(".github/workflows/build.yml")
insert = '''jobs:
  quality:
    name: TypeScript + Rust regression tests
    runs-on: ubuntu-22.04
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Install Linux prerequisites
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev xdg-utils patchelf
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Set up Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt
      - name: Install frontend dependencies
        run: npm install
      - name: Generate native icon set
        run: npx tauri icon app-icon.svg
      - name: Type-check frontend
        run: npm run check
      - name: Frontend regression tests
        run: npm test
      - name: Rust formatting
        run: cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
      - name: Rust unit tests
        run: cargo test --manifest-path src-tauri/Cargo.toml
      - name: Rust check
        run: cargo check --manifest-path src-tauri/Cargo.toml

  build:
    needs: quality
'''
if 'jobs:\n  build:\n' not in workflow: raise SystemExit("workflow build anchor missing")
workflow = workflow.replace('jobs:\n  build:\n', insert, 1)
write(".github/workflows/build.yml", workflow)

# Self-delete the temporary patch plumbing before the workflow commits the implementation.
(ROOT / "scripts/apply-v039.py").unlink(missing_ok=True)
(ROOT / ".github/workflows/dev-apply-v039.yml").unlink(missing_ok=True)
print("v0.3.9 implementation patch applied")
