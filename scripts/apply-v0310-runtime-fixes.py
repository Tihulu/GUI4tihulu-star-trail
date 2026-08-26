#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text)


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    text = read(path)
    found = text.count(old)
    if found < count:
        raise SystemExit(f"{path}: expected at least {count} occurrence(s), found {found}: {old[:120]!r}")
    text = text.replace(old, new, count)
    write(path, text)


# Version the hotfix as a new release. Never overwrite v0.3.9 assets.
replace("package.json", '"version": "0.3.9"', '"version": "0.3.10"')
replace("src-tauri/Cargo.toml", 'version = "0.3.9"', 'version = "0.3.10"')
replace("src-tauri/tauri.conf.json", '"version": "0.3.9"', '"version": "0.3.10"')
replace("src/branding.ts", "· v0.3.9", "· v0.3.10")

# Small-thumbnail IPC uses a data URL so WebKit never has to resolve an app-cache
# asset:// URL. The bytes are bounded thumbnails, never the full source image.
replace(
    "src-tauri/Cargo.toml",
    'serde_json = "1"\n',
    'serde_json = "1"\nbase64 = "0.22"\n',
)

lib_path = "src-tauri/src/lib.rs"
lib = read(lib_path)
lib = lib.replace(
    "use serde::{Deserialize, Serialize};\n",
    "use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};\nuse serde::{Deserialize, Serialize};\n",
    1,
)
old_struct = '''struct ThumbnailResult {
    path: String,
    cache_hit: bool,
    source_bytes: u64,
}
'''
new_struct = '''struct ThumbnailResult {
    path: String,
    data_url: String,
    cache_hit: bool,
    source_bytes: u64,
}
'''
if old_struct not in lib:
    raise SystemExit("ThumbnailResult struct anchor missing")
lib = lib.replace(old_struct, new_struct, 1)
# All generate_thumbnail return sites start without an in-memory payload. get_thumbnail
# fills it after cache generation/hit.
lib = re.sub(
    r'(path: target\.to_string_lossy\(\)\.into_owned\(\),\n)(\s+cache_hit:)',
    r'\1            data_url: String::new(),\n\2',
    lib,
)

helper_anchor = "fn generate_thumbnail(\n"
if helper_anchor not in lib:
    raise SystemExit("generate_thumbnail anchor missing")
helpers = r'''fn thumbnail_helper_path(engine: &Path) -> Option<PathBuf> {
    let parent = engine.parent()?;
    #[cfg(windows)]
    let names = ["tihulu-thumbnail.exe", "tihulu-thumbnail.cmd", "tihulu-thumbnail.bat"];
    #[cfg(not(windows))]
    let names = ["tihulu-thumbnail"];
    for name in names {
        let candidate = parent.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn render_thumbnail_with_engine(
    source: &Path,
    target: &Path,
    max_width: u32,
    max_height: u32,
) -> Result<(), String> {
    let engine = resolve_executable(None)?;
    let helper = thumbnail_helper_path(&engine).ok_or_else(|| {
        format!(
            "RAW thumbnail helper is missing beside {}. Update tihulu-star-trail with the GUI installer.",
            engine.display()
        )
    })?;
    let stem = target
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("thumbnail");
    let temporary = target.with_file_name(format!(".{stem}.engine.jpg"));
    let _ = fs::remove_file(&temporary);
    let mut command = Command::new(&helper);
    command
        .arg(source)
        .arg(&temporary)
        .args(["--max-width", &max_width.to_string()])
        .args(["--max-height", &max_height.to_string()])
        .args(["--jpeg-quality", "82"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("Could not launch RAW thumbnail helper: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "RAW thumbnail helper exited with {}{}",
            output.status,
            if detail.is_empty() { String::new() } else { format!(": {detail}") }
        ));
    }
    if !temporary.is_file() {
        return Err("RAW thumbnail helper completed without producing a JPEG".into());
    }
    fs::rename(&temporary, target)
        .or_else(|_| {
            let _ = fs::remove_file(target);
            fs::rename(&temporary, target)
        })
        .map_err(|error| format!("Could not finalize engine thumbnail: {error}"))
}

fn thumbnail_data_url(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("Could not read cached thumbnail bytes: {error}"))?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        BASE64_STANDARD.encode(bytes)
    ))
}

'''
lib = lib.replace(helper_anchor, helpers + helper_anchor, 1)

old_decode = r'''    let image = image::ImageReader::open(source)
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
'''
new_decode = r'''    let native_result: Result<(), String> = if RAW_EXTENSIONS.contains(&extension(source).as_str()) {
        Err("RAW source requires the tihulu/rawpy decoder".into())
    } else {
        (|| {
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
            Ok(())
        })()
    };
    if let Err(native_error) = native_result {
        render_thumbnail_with_engine(source, &target, max_width, max_height).map_err(|engine_error| {
            format!("Native thumbnail decode failed ({native_error}); engine fallback failed: {engine_error}")
        })?;
    }
'''
if old_decode not in lib:
    raise SystemExit("native thumbnail decode block anchor missing")
lib = lib.replace(old_decode, new_decode, 1)

old_get_tail = r'''    tauri::async_runtime::spawn_blocking(move || {
        generate_thumbnail(&cache_dir, &source, max_width, max_height, &version)
    })
    .await
    .map_err(|error| format!("Thumbnail worker failed: {error}"))?
}
'''
new_get_tail = r'''    let mut result = tauri::async_runtime::spawn_blocking(move || {
        generate_thumbnail(&cache_dir, &source, max_width, max_height, &version)
    })
    .await
    .map_err(|error| format!("Thumbnail worker failed: {error}"))??;
    result.data_url = thumbnail_data_url(Path::new(&result.path))?;
    Ok(result)
}
'''
if old_get_tail not in lib:
    raise SystemExit("get_thumbnail tail anchor missing")
lib = lib.replace(old_get_tail, new_get_tail, 1)

old_test = '''        assert!(!first.cache_hit);
        assert!(Path::new(&first.path).is_file());
'''
new_test = '''        assert!(!first.cache_hit);
        assert!(Path::new(&first.path).is_file());
        assert!(thumbnail_data_url(Path::new(&first.path))
            .unwrap()
            .starts_with("data:image/jpeg;base64,"));
'''
if old_test not in lib:
    raise SystemExit("thumbnail data URL test anchor missing")
lib = lib.replace(old_test, new_test, 1)
write(lib_path, lib)

# WebView thumbnail manager: consume bounded JPEG data URLs. Hide <img> until the
# native worker succeeds so WebKit never shows a broken-image glyph while queued.
thumb_path = "src/photo-thumbnail-manager.ts"
thumb = read(thumb_path)
thumb = thumb.replace(
    'import { convertFileSrc, invoke } from "@tauri-apps/api/core";',
    'import { invoke } from "@tauri-apps/api/core";',
    1,
)
thumb = thumb.replace(
    'type ThumbnailResult = { path: string; cacheHit: boolean; sourceBytes: number };',
    'type ThumbnailResult = { path: string; dataUrl: string; cacheHit: boolean; sourceBytes: number };',
    1,
)
thumb = thumb.replace(
    'return put(key, convertFileSrc(result.path));',
    'return put(key, result.dataUrl);',
    1,
)
thumb = thumb.replace(
    'if (workspaceActive && image.isConnected && visibleImages.has(image) && image.dataset.thumbPath === source) { image.src = url; image.dataset.thumbReady = "1"; }',
    'if (workspaceActive && image.isConnected && visibleImages.has(image) && image.dataset.thumbPath === source) { image.src = url; image.dataset.thumbReady = "1"; image.style.visibility = "visible"; image.closest(".thumb-wrap")?.classList.remove("thumbnail-error"); }',
    1,
)
thumb = thumb.replace(
    'image.dataset.thumbError = String(error); image.removeAttribute("src");',
    'image.dataset.thumbError = String(error); image.removeAttribute("src"); image.style.visibility = "hidden"; image.closest(".thumb-wrap")?.classList.add("thumbnail-error");',
    1,
)
thumb = thumb.replace(
    'image.loading = "lazy"; image.decoding = "async";',
    'image.loading = "lazy"; image.decoding = "async"; if (image.dataset.thumbReady !== "1") image.style.visibility = "hidden";',
    1,
)
write(thumb_path, thumb)

# v0.3.8 selection-pulse workaround became a render loop in v0.3.9: it toggled
# #photoGrid.class every 60-100 ms and Studio Editor rebuilt all group cards for each
# mutation. The editor already observes real tile selection changes, so do not load it.
replace(
    "src/bootstrap.ts",
    '  await loadFeature("StudioEditorSelectionSync", () => import("./studio-editor-selection-sync"));\n',
    '',
)

# Reserve group-preview space and take the thumbnail out of flex flow. This prevents
# cards from shifting horizontally when async previews arrive.
css_path = "src/workspace-parity.css"
css = read(css_path)
css += '''\n/* v0.3.10: keep group cards geometrically stable while thumbnails resolve. */\n#studioGroupList .studio-group-card[data-group-id] { padding-left: 68px; min-height: 58px; }\n#studioGroupList .studio-group-card[data-group-id] .workspace-group-thumb { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); }\n#photoGrid .thumb-wrap.thumbnail-error::after { content: "preview unavailable"; position: absolute; inset: 0; display: grid; place-items: center; color: #687187; font-size: 9px; letter-spacing: .04em; background: radial-gradient(circle at 50% 35%, rgba(155,140,255,.10), transparent 62%), #060914; }\n'''
write(css_path, css)

# Linux installer: own one deterministic engine venv, install a real CuPy CUDA runtime
# when NVIDIA is present, verify it, and use a desktop-file basename matching the Tauri
# Wayland app id so COSMIC can associate the minimized window with the application icon.
installer_path = "scripts/install.sh"
installer = read(installer_path)
installer = installer.replace(
    'ENGINE_REPO="Tihulu/tihulu-star-trail"\n',
    'ENGINE_REPO="Tihulu/tihulu-star-trail"\nAPP_ID="io.github.tihulu.gui4startrail"\n',
    1,
)
old_policy = r'''engine_supports_policies() {
  [ -x "$1" ] || return 1
  HELP="$($1 run --help 2>&1 || true)"
  printf '%s' "$HELP" | grep -q -- '--group-hardware' || return 1
  printf '%s' "$HELP" | grep -q -- '--trail-hardware' || return 1
  printf '%s' "$HELP" | grep -q -- '--timelapse-hardware' || return 1
}
'''
new_policy = r'''engine_supports_runtime() {
  [ -x "$1" ] || return 1
  HELP="$($1 run --help 2>&1 || true)"
  printf '%s' "$HELP" | grep -q -- '--group-hardware' || return 1
  printf '%s' "$HELP" | grep -q -- '--trail-hardware' || return 1
  printf '%s' "$HELP" | grep -q -- '--timelapse-hardware' || return 1
  ENGINE_DIR="$(dirname "$1")"
  [ -x "$ENGINE_DIR/tihulu-hardware" ] || return 1
  [ -x "$ENGINE_DIR/tihulu-thumbnail" ] || return 1
}

engine_gpu_ready() {
  ENGINE_DIR="$(dirname "$1")"
  [ -x "$ENGINE_DIR/tihulu-hardware" ] || return 1
  "$ENGINE_DIR/tihulu-hardware" --mode gpu >/dev/null 2>&1
}
'''
if old_policy not in installer:
    raise SystemExit("install.sh engine policy anchor missing")
installer = installer.replace(old_policy, new_policy, 1)

old_pip = r'''  if [ ! -x "$VENV/bin/python" ]; then
    "$PYTHON" -m venv "$VENV" || fail "Could not create a Python virtual environment. Install python3-venv and rerun."
  fi
  "$VENV/bin/python" -m pip install --upgrade pip setuptools wheel
  "$VENV/bin/python" -m pip install --upgrade --force-reinstall "tihulu-star-trail[video] @ https://github.com/$ENGINE_REPO/archive/refs/heads/main.zip"
  ln -sf "$VENV/bin/tihulu" "$HOME/.local/bin/tihulu"
'''
new_pip = r'''  if [ ! -x "$VENV/bin/python" ]; then
    if ! "$PYTHON" -m venv "$VENV"; then
      if [ "$OS" = "Linux" ] && command -v apt-get >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
        sudo apt-get update
        sudo apt-get install -y python3-venv
        "$PYTHON" -m venv "$VENV" || fail "Could not create the GUI-managed Python virtual environment."
      else
        fail "Could not create a Python virtual environment. Install python3-venv and rerun."
      fi
    fi
  fi
  "$VENV/bin/python" -m pip install --upgrade pip setuptools wheel
  "$VENV/bin/python" -m pip install --upgrade --force-reinstall "tihulu-star-trail[video] @ https://github.com/$ENGINE_REPO/archive/refs/heads/main.zip"

  if command -v nvidia-smi >/dev/null 2>&1; then
    CUDA_MAJOR="$(nvidia-smi 2>/dev/null | sed -n 's/.*CUDA Version: \([0-9][0-9]*\).*/\1/p' | head -n 1)"
    "$VENV/bin/python" -m pip uninstall -y cupy cupy-cuda11x cupy-cuda12x cupy-cuda13x >/dev/null 2>&1 || true
    if [ "${CUDA_MAJOR:-0}" -ge 13 ]; then
      say "Installing NVIDIA CUDA 13 runtime for tihulu-star-trail"
      "$VENV/bin/python" -m pip install --upgrade "cupy-cuda13x[ctk]>=14,<15"
    else
      say "Installing NVIDIA CUDA 12 runtime for tihulu-star-trail"
      "$VENV/bin/python" -m pip install --upgrade "cupy-cuda12x[ctk]>=14,<15"
    fi
  fi

  ln -sf "$VENV/bin/tihulu" "$HOME/.local/bin/tihulu"
  ln -sf "$VENV/bin/tihulu-hardware" "$HOME/.local/bin/tihulu-hardware"
  ln -sf "$VENV/bin/tihulu-thumbnail" "$HOME/.local/bin/tihulu-thumbnail"
'''
if old_pip not in installer:
    raise SystemExit("install.sh venv install anchor missing")
installer = installer.replace(old_pip, new_pip, 1)

old_current = r'''    Linux)
      if [ -f /etc/debian_version ] && command -v apt-get >/dev/null 2>&1; then
        curl -fsSL "https://raw.githubusercontent.com/$ENGINE_REPO/main/scripts/install-debian.sh" | sh
      else
        install_engine_fallback
      fi
      ;;
'''
new_current = r'''    Linux)
      # Keep the GUI engine deterministic. System python3-opencv / PyPI OpenCV wheels
      # are commonly CPU-only for CUDA; this venv can carry the CuPy CUDA runtime.
      install_engine_fallback
      ;;
'''
if old_current not in installer:
    raise SystemExit("install.sh Linux engine anchor missing")
installer = installer.replace(old_current, new_current, 1)
installer = installer.replace(
    'elif engine_supports_policies "$ENGINE_PATH"; then\n    say "Found compatible tihulu-star-trail: $ENGINE_PATH"\n',
    'elif engine_supports_runtime "$ENGINE_PATH" && { ! command -v nvidia-smi >/dev/null 2>&1 || engine_gpu_ready "$ENGINE_PATH"; }; then\n    say "Found compatible tihulu-star-trail: $ENGINE_PATH"\n',
    1,
)
installer = installer.replace(
    'engine_supports_policies "$ENGINE_PATH" || fail "The engine was installed but is still missing the required group/trail/timelapse hardware controls."\n',
    'engine_supports_runtime "$ENGINE_PATH" || fail "The engine was installed but is missing the required hardware probe or RAW thumbnail runtime."\nif command -v nvidia-smi >/dev/null 2>&1; then\n  engine_gpu_ready "$ENGINE_PATH" || fail "NVIDIA is present, but the tihulu CUDA runtime probe failed. GPU mode was not accepted as ready."\nfi\n',
    1,
)
installer = installer.replace(
    '    ICON_PATH="$ICON_DIR/tihulu-star-trail-studio.svg"\n',
    '    ICON_PATH="$ICON_DIR/$APP_ID.svg"\n',
    1,
)
old_desktop = r'''    cat > "$HOME/.local/share/applications/tihulu-star-trail-studio.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Tihulu Star Trail Studio
Comment=Modern GUI for tihulu-star-trail
Exec=$LAUNCHER
Icon=$ICON_PATH
Terminal=false
Categories=Graphics;Photography;
StartupNotify=true
EOF
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
'''
new_desktop = r'''    rm -f "$HOME/.local/share/applications/tihulu-star-trail-studio.desktop"
    DESKTOP_FILE="$HOME/.local/share/applications/$APP_ID.desktop"
    cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Tihulu Star Trail Studio
Comment=Modern GUI for tihulu-star-trail
Exec=$LAUNCHER
Icon=$ICON_PATH
StartupWMClass=$APP_ID
X-GNOME-WMClass=$APP_ID
Terminal=false
Categories=Graphics;Photography;
StartupNotify=true
EOF
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
'''
if old_desktop not in installer:
    raise SystemExit("install.sh desktop entry anchor missing")
installer = installer.replace(old_desktop, new_desktop, 1)
write(installer_path, installer)

# Regression assertions for the failures reported from the real v0.3.9 package.
tests_path = "tests/source-regressions.test.mjs"
tests = read(tests_path)
tests += r'''
test("thumbnail IPC is RAW-aware and avoids asset URL regressions", () => { const rust = read("src-tauri/src/lib.rs"); const thumbs = read("src/photo-thumbnail-manager.ts"); assert.match(rust, /render_thumbnail_with_engine/); assert.match(rust, /tihulu-thumbnail/); assert.match(rust, /data:image\/jpeg;base64/); assert.match(thumbs, /result\.dataUrl/); assert.doesNotMatch(thumbs, /convertFileSrc/); });
test("workspace no longer loads the selection pulse render loop", () => { const bootstrap = read("src/bootstrap.ts"); assert.doesNotMatch(bootstrap, /StudioEditorSelectionSync/); const css = read("src/workspace-parity.css"); assert.match(css, /position: absolute/); assert.match(css, /padding-left: 68px/); });
test("Linux desktop identity matches Tauri Wayland app id and verifies CUDA", () => { const install = read("scripts/install.sh"); assert.match(install, /APP_ID="io\.github\.tihulu\.gui4startrail"/); assert.match(install, /applications\/\$APP_ID\.desktop/); assert.match(install, /StartupWMClass=\$APP_ID/); assert.match(install, /cupy-cuda13x\[ctk\]/); assert.match(install, /engine_gpu_ready/); });
'''
write(tests_path, tests)

print("v0.3.10 runtime hotfix applied")
