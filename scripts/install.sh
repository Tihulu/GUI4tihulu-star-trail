#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-only
set -eu

GUI_REPO="Tihulu/GUI4tihulu-star-trail"
ENGINE_REPO="Tihulu/tihulu-star-trail"
OS="$(uname -s)"
ARCH="$(uname -m)"

say() { printf '\n\033[1;35m%s\033[0m\n' "$1"; }
fail() { printf '\nError: %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl is required."

find_tihulu() {
  if command -v tihulu >/dev/null 2>&1; then
    command -v tihulu
    return 0
  fi
  if [ -x "$HOME/.local/bin/tihulu" ]; then
    printf '%s\n' "$HOME/.local/bin/tihulu"
    return 0
  fi
  if [ -x "$HOME/.local/share/gui4tihulu-star-trail/cli-venv/bin/tihulu" ]; then
    printf '%s\n' "$HOME/.local/share/gui4tihulu-star-trail/cli-venv/bin/tihulu"
    return 0
  fi
  return 1
}

install_engine_fallback() {
  PYTHON=""
  if command -v python3 >/dev/null 2>&1; then PYTHON="$(command -v python3)"; fi
  if [ -z "$PYTHON" ] && command -v python >/dev/null 2>&1; then PYTHON="$(command -v python)"; fi
  [ -n "$PYTHON" ] || fail "Python 3 is required to install tihulu-star-trail on this Linux distribution."

  ROOT="$HOME/.local/share/gui4tihulu-star-trail"
  VENV="$ROOT/cli-venv"
  mkdir -p "$ROOT" "$HOME/.local/bin"
  "$PYTHON" -m venv "$VENV" || fail "Could not create a Python virtual environment. Install your distribution's python3-venv package and rerun."
  "$VENV/bin/python" -m pip install --upgrade pip
  "$VENV/bin/python" -m pip install "tihulu-star-trail[video] @ https://github.com/$ENGINE_REPO/archive/refs/heads/main.zip"
  ln -sf "$VENV/bin/tihulu" "$HOME/.local/bin/tihulu"
}

if ! ENGINE_PATH="$(find_tihulu 2>/dev/null)"; then
  say "tihulu-star-trail is not installed — installing the engine"
  case "$OS" in
    Darwin)
      curl -fsSL "https://raw.githubusercontent.com/$ENGINE_REPO/main/macos/install.sh" | sh
      ;;
    Linux)
      if [ -f /etc/debian_version ] && command -v apt-get >/dev/null 2>&1; then
        curl -fsSL "https://raw.githubusercontent.com/$ENGINE_REPO/main/scripts/install-debian.sh" | sh
      else
        install_engine_fallback
      fi
      ;;
    *) fail "This installer supports macOS and Linux. Use scripts/install.ps1 on Windows." ;;
  esac
  ENGINE_PATH="$(find_tihulu 2>/dev/null || true)"
  [ -n "$ENGINE_PATH" ] || fail "tihulu-star-trail installation finished but the tihulu launcher was not found."
else
  say "Found tihulu-star-trail: $ENGINE_PATH"
fi

"$ENGINE_PATH" --help >/dev/null 2>&1 || fail "The tihulu launcher exists but could not be executed."

PYTHON=""
if command -v python3 >/dev/null 2>&1; then PYTHON="$(command -v python3)"; fi
if [ -z "$PYTHON" ] && command -v python >/dev/null 2>&1; then PYTHON="$(command -v python)"; fi
[ -n "$PYTHON" ] || fail "Python is required to resolve the latest GitHub release."

say "Downloading the latest Tihulu Star Trail Studio"
ASSET_URL="$(GUI_REPO="$GUI_REPO" GUI_OS="$OS" GUI_ARCH="$ARCH" "$PYTHON" - <<'PY'
import json, os, urllib.request
repo = os.environ["GUI_REPO"]
os_name = os.environ["GUI_OS"]
arch = os.environ["GUI_ARCH"].lower()
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
    if len(candidates) > 1:
        arm = arch in {"arm64", "aarch64"}
        preferred = [
            a for a in candidates
            if any(token in a.get("name", "").lower() for token in (("aarch64", "arm64") if arm else ("x86_64", "amd64", "x64")))
        ]
        if preferred:
            candidates = preferred
if not candidates:
    raise SystemExit("No compatible GUI release asset was found. Publish a tagged release first.")
print(candidates[0]["browser_download_url"])
PY
)" || fail "Could not resolve a compatible GUI release."

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t tihulu-gui)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

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
    APPIMAGE="$HOME/.local/bin/tihulu-star-trail-studio"
    curl -fL "$ASSET_URL" -o "$APPIMAGE"
    chmod +x "$APPIMAGE"
    cat > "$HOME/.local/share/applications/tihulu-star-trail-studio.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Tihulu Star Trail Studio
Comment=Modern GUI for tihulu-star-trail
Exec=$APPIMAGE
Terminal=false
Categories=Graphics;Photography;
StartupNotify=true
EOF
    say "Installed Tihulu Star Trail Studio"
    printf 'Launch from your app menu or run: %s\n' "$APPIMAGE"
    ;;
esac

printf '\nEngine: %s\n' "$ENGINE_PATH"
printf 'License: GNU AGPL v3 (AGPL-3.0-only)\n'
