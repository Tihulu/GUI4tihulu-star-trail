#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-only
set -eu

GUI_REPO="Tihulu/GUI4tihulu-star-trail"
ENGINE_REPO="Tihulu/tihulu-star-trail"
TAURI_IDENTIFIER="io.github.tihulu.gui4startrail"
WAYLAND_APP_ID="gui4tihulu-star-trail"
OS="$(uname -s)"
ARCH="$(uname -m)"

say() { printf '\n\033[1;35m%s\033[0m\n' "$1"; }
fail() { printf '\nError: %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl is required."

case "$OS" in
  Darwin) ;;
  Linux)
    case "$ARCH" in
      x86_64|amd64) ;;
      *) fail "Linux GUI releases currently support x86_64 only. Linux ARM64 will be enabled after tihulu-star-trail has ARM64 CI/release coverage." ;;
    esac
    ;;
  *) fail "This installer supports macOS and Linux. Use scripts/install.ps1 on Windows." ;;
esac

find_tihulu() {
  # Prefer the GUI-managed engine, but retain direct compatibility with the
  # Debian installer used by older releases before relying on a launcher wrapper.
  if [ -x "$HOME/.local/share/gui4tihulu-star-trail/cli-venv/bin/tihulu" ]; then
    printf '%s\n' "$HOME/.local/share/gui4tihulu-star-trail/cli-venv/bin/tihulu"
    return 0
  fi
  if [ -x "$HOME/tihulu-star-trail/.venv/bin/tihulu" ]; then
    printf '%s\n' "$HOME/tihulu-star-trail/.venv/bin/tihulu"
    return 0
  fi
  if [ -x "$HOME/.local/bin/tihulu" ]; then
    printf '%s\n' "$HOME/.local/bin/tihulu"
    return 0
  fi
  if command -v tihulu >/dev/null 2>&1; then
    command -v tihulu
    return 0
  fi
  return 1
}

engine_supports_runtime() {
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

wrap_managed_engine_launcher() {
  VENV="$HOME/.local/share/gui4tihulu-star-trail/cli-venv"
  NAME="$1"
  LAUNCHER="$VENV/bin/$NAME"
  REAL="$VENV/bin/.${NAME}-gui4tihulu-real"
  [ -f "$LAUNCHER" ] || return 0

  # A pip reinstall replaces our wrapper with a fresh console script. In that
  # case refresh the saved real launcher. If the marker is still present this
  # launcher is already safe and must not be wrapped a second time.
  if grep -q 'GUI4TIHULU_APPIMAGE_SAFE_WRAPPER' "$LAUNCHER" 2>/dev/null; then
    return 0
  fi
  rm -f "$REAL"
  mv "$LAUNCHER" "$REAL"
  cat > "$LAUNCHER" <<EOF
#!/usr/bin/env sh
# GUI4TIHULU_APPIMAGE_SAFE_WRAPPER
# linuxdeploy/AppImage injects Python and shared-library paths for the bundled
# GUI. Those paths must never leak into the host Python venv used by tihulu.
if [ -n "\${APPDIR:-}" ] || [ -n "\${APPIMAGE:-}" ]; then
  unset PYTHONHOME PYTHONPATH LD_LIBRARY_PATH QT_PLUGIN_PATH PERLLIB GST_PLUGIN_SYSTEM_PATH
  unset GTK_DATA_PREFIX GTK_EXE_PREFIX GTK_PATH GTK_IM_MODULE_FILE GDK_PIXBUF_MODULE_FILE
  unset GIO_EXTRA_MODULES GSETTINGS_SCHEMA_DIR GTK_THEME GDK_BACKEND XDG_DATA_DIRS

  clean_path=""
  old_ifs="\$IFS"
  IFS=:
  for entry in \${PATH:-}; do
    case "\$entry" in
      "\${APPDIR:-}"|"\${APPDIR:-}"/*) ;;
      *)
        if [ -z "\$clean_path" ]; then clean_path="\$entry"; else clean_path="\$clean_path:\$entry"; fi
        ;;
    esac
  done
  IFS="\$old_ifs"
  export PATH="$VENV/bin:$HOME/.local/bin:\$clean_path"
fi
exec "$REAL" "\$@"
EOF
  chmod +x "$LAUNCHER"
}

install_appimage_safe_engine_wrappers() {
  [ "$OS" = "Linux" ] || return 0
  [ -d "$HOME/.local/share/gui4tihulu-star-trail/cli-venv/bin" ] || return 0
  wrap_managed_engine_launcher tihulu
  wrap_managed_engine_launcher tihulu-hardware
  wrap_managed_engine_launcher tihulu-thumbnail
  ln -sf "$HOME/.local/share/gui4tihulu-star-trail/cli-venv/bin/tihulu" "$HOME/.local/bin/tihulu"
  ln -sf "$HOME/.local/share/gui4tihulu-star-trail/cli-venv/bin/tihulu-hardware" "$HOME/.local/bin/tihulu-hardware"
  ln -sf "$HOME/.local/share/gui4tihulu-star-trail/cli-venv/bin/tihulu-thumbnail" "$HOME/.local/bin/tihulu-thumbnail"
}

install_engine_fallback() {
  PYTHON=""
  if command -v python3 >/dev/null 2>&1; then PYTHON="$(command -v python3)"; fi
  if [ -z "$PYTHON" ] && command -v python >/dev/null 2>&1; then PYTHON="$(command -v python)"; fi
  [ -n "$PYTHON" ] || fail "Python 3 is required to install tihulu-star-trail."

  ROOT="$HOME/.local/share/gui4tihulu-star-trail"
  VENV="$ROOT/cli-venv"
  mkdir -p "$ROOT" "$HOME/.local/bin"
  if [ ! -x "$VENV/bin/python" ]; then
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

  install_appimage_safe_engine_wrappers
}

install_current_engine() {
  case "$OS" in
    Darwin)
      curl -fsSL "https://raw.githubusercontent.com/$ENGINE_REPO/main/macos/install.sh" | sh
      ;;
    Linux)
      # Keep the GUI engine deterministic. System python3-opencv / PyPI OpenCV wheels
      # are commonly CPU-only for CUDA; this venv can carry the CuPy CUDA runtime.
      install_engine_fallback
      ;;
  esac
}

ENGINE_PATH="$(find_tihulu 2>/dev/null || true)"
if [ -z "$ENGINE_PATH" ]; then
  say "tihulu-star-trail is not installed — installing the current engine"
  install_current_engine
elif engine_supports_runtime "$ENGINE_PATH" && { ! command -v nvidia-smi >/dev/null 2>&1 || engine_gpu_ready "$ENGINE_PATH"; }; then
  say "Found compatible tihulu-star-trail: $ENGINE_PATH"
else
  say "Installed tihulu engine is missing the required runtime or GPU backend — updating it"
  install_current_engine
fi

# Even when the engine was already current, repair the managed launchers so an
# existing v0.3.10/v0.3.11 AppImage cannot poison host Python with AppImage's
# PYTHONHOME/PYTHONPATH/LD_LIBRARY_PATH values.
install_appimage_safe_engine_wrappers

ENGINE_PATH="$(find_tihulu 2>/dev/null || true)"
[ -n "$ENGINE_PATH" ] || fail "tihulu-star-trail installation finished but the tihulu launcher was not found."
"$ENGINE_PATH" --help >/dev/null 2>&1 || fail "The tihulu launcher exists but could not be executed."
engine_supports_runtime "$ENGINE_PATH" || fail "The engine was installed but is missing the required hardware probe or RAW thumbnail runtime."
GPU_VERIFIED=0
if command -v nvidia-smi >/dev/null 2>&1; then
  engine_gpu_ready "$ENGINE_PATH" || fail "NVIDIA is present, but the tihulu CUDA runtime probe failed. GPU mode was not accepted as ready."
  GPU_VERIFIED=1
fi

PYTHON=""
if command -v python3 >/dev/null 2>&1; then PYTHON="$(command -v python3)"; fi
if [ -z "$PYTHON" ] && command -v python >/dev/null 2>&1; then PYTHON="$(command -v python)"; fi
[ -n "$PYTHON" ] || fail "Python is required to resolve the latest GitHub release."

say "Downloading the latest Tihulu Star Trail Studio"
ASSET_URL="$(GUI_REPO="$GUI_REPO" GUI_OS="$OS" "$PYTHON" - <<'PY'
import json, os, urllib.request
repo = os.environ["GUI_REPO"]
os_name = os.environ["GUI_OS"]
request = urllib.request.Request(
    f"https://api.github.com/repos/{repo}/releases/latest",
    headers={"Accept": "application/vnd.github+json", "User-Agent": "GUI4tihulu-star-trail-installer"},
)
try:
    with urllib.request.urlopen(request) as response:
        release = json.load(response)
except Exception as exc:
    raise SystemExit(f"Could not read latest GitHub release: {exc}")
assets = release.get("assets", [])
if os_name == "Darwin":
    candidates = [a for a in assets if a.get("name", "").lower().endswith(".dmg")]
else:
    candidates = [a for a in assets if a.get("name", "").lower().endswith(".appimage")]
    preferred = [a for a in candidates if any(token in a.get("name", "").lower() for token in ("x86_64", "amd64", "x64"))]
    if preferred:
        candidates = preferred
if not candidates:
    raise SystemExit("No compatible GUI release asset was found. Publish a release first.")
print(candidates[0]["browser_download_url"])
PY
)" || fail "Could not resolve a compatible GUI release."

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t tihulu-gui)"
APPIMAGE_NEW=""
trap 'rm -rf "$TMP_DIR"; [ -z "$APPIMAGE_NEW" ] || rm -f "$APPIMAGE_NEW"' EXIT INT TERM

case "$OS" in
  Darwin)
    DMG="$TMP_DIR/tihulu-star-trail-studio.dmg"
    curl -fL "$ASSET_URL" -o "$DMG"
    MOUNT="$TMP_DIR/mount"
    mkdir -p "$MOUNT" "$HOME/Applications"
    hdiutil attach -nobrowse -quiet -mountpoint "$MOUNT" "$DMG"
    APP="$(find "$MOUNT" -maxdepth 1 -name '*.app' -print -quit)"
    if [ -z "$APP" ]; then
      hdiutil detach -quiet "$MOUNT" || true
      fail "The downloaded DMG does not contain an application bundle."
    fi
    DEST="$HOME/Applications/$(basename "$APP")"
    rm -rf "$DEST"
    cp -R "$APP" "$HOME/Applications/"
    hdiutil detach -quiet "$MOUNT"
    say "Installed: $DEST"
    printf 'Open it with: open %s\n' "$(printf '%s' "$DEST" | sed 's/ /\\ /g')"
    ;;
  Linux)
    mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications"
    ICON_DIR="$HOME/.local/share/icons/hicolor/scalable/apps"
    mkdir -p "$ICON_DIR"
    ICON_PATH="$ICON_DIR/$WAYLAND_APP_ID.svg"
    curl -fsSL "https://raw.githubusercontent.com/$GUI_REPO/main/app-icon.svg" -o "$ICON_PATH"

    APPIMAGE="$HOME/.local/bin/tihulu-star-trail-studio"
    LAUNCHER="$HOME/.local/bin/tihulu-star-trail-studio-launcher"
    # Never stream into the currently running AppImage. Linux can report
    # ETXTBSY ("Text file busy") when an executing file is opened for write.
    # Download beside it, then atomically replace the directory entry instead.
    APPIMAGE_NEW="$HOME/.local/bin/.tihulu-star-trail-studio.new.$$"
    rm -f "$APPIMAGE_NEW"
    curl -fL "$ASSET_URL" -o "$APPIMAGE_NEW"
    chmod +x "$APPIMAGE_NEW"
    mv -f "$APPIMAGE_NEW" "$APPIMAGE"
    APPIMAGE_NEW=""

    # Desktop/AppImage launches do not necessarily inherit the same PATH as an
    # interactive shell. Put Tihulu's current-user launchers first so the GUI
    # cannot accidentally resolve an older /usr/bin/tihulu before the engine
    # that this installer just verified.
    cat > "$LAUNCHER" <<EOF
#!/usr/bin/env sh
export PATH="$HOME/.local/share/gui4tihulu-star-trail/cli-venv/bin:$HOME/tihulu-star-trail/.venv/bin:$HOME/.local/bin:\$PATH"
exec "$APPIMAGE" "\$@"
EOF
    chmod +x "$LAUNCHER"

    # COSMIC/Wayland groups a running window by the AppImage's actual GTK/Wry
    # app-id, which is the packaged binary name. Match Tauri's generated
    # AppImage desktop entry instead of the reverse-DNS bundle identifier.
    rm -f "$HOME/.local/share/applications/tihulu-star-trail-studio.desktop"
    rm -f "$HOME/.local/share/applications/$TAURI_IDENTIFIER.desktop"
    DESKTOP_FILE="$HOME/.local/share/applications/$WAYLAND_APP_ID.desktop"
    cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Tihulu Star Trail Studio
Comment=Modern GUI for tihulu-star-trail
Exec=$LAUNCHER
Icon=$WAYLAND_APP_ID
StartupWMClass=$WAYLAND_APP_ID
X-GNOME-WMClass=$WAYLAND_APP_ID
Terminal=false
Categories=Graphics;Photography;
StartupNotify=true
EOF
    command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
    say "Installed Tihulu Star Trail Studio"
    printf 'Launch from your app menu or run: %s\n' "$LAUNCHER"
    ;;
esac

printf '\nEngine: %s\n' "$ENGINE_PATH"
printf 'Engine hardware controls installed: Auto / CPU / GPU / GPU+CPU\n'
if [ "$GPU_VERIFIED" -eq 1 ]; then
  printf 'NVIDIA GPU runtime: verified\n'
fi
printf 'License: GNU AGPL v3 (AGPL-3.0-only)\n'
