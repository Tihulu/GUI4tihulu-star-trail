# GUI4tihulu-star-trail

A modern, cross-platform desktop GUI for [`tihulu-star-trail`](https://github.com/Tihulu/tihulu-star-trail), built with **Tauri 2 + TypeScript/Vite**.

The GUI does not duplicate the astrophotography engine. It discovers and runs the real `tihulu` CLI, so grouping, star-trail rendering and timelapse behavior remain in the main project.

## One-line install

The installer checks for `tihulu-star-trail` first. **If the engine is missing, it installs it automatically**, then installs the latest GUI release.

### Linux / macOS

```sh
curl -fsSL https://raw.githubusercontent.com/Tihulu/GUI4tihulu-star-trail/main/scripts/install.sh | sh
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/Tihulu/GUI4tihulu-star-trail/main/scripts/install.ps1 | iex
```

On Debian, Ubuntu and Pop!_OS the Unix installer reuses the main project's managed installer. On macOS it reuses the main project's macOS installer. Other supported Linux distributions fall back to an isolated Python virtual environment. Windows installs the engine into an isolated per-user virtual environment when `tihulu` is missing; if Python is also missing, the script installs Python 3.12 with `winget` first.

> The one-line installer downloads the GUI from the latest GitHub Release. Merging a new version into `main` builds all supported desktop packages and publishes that version automatically.

## Supported platforms

| Platform | GUI package | Engine handling |
| --- | --- | --- |
| Windows 10/11 x86_64 | NSIS `.exe` | Existing `tihulu`, or managed Python 3.12 venv |
| macOS 11+ Intel + Apple Silicon | Universal `.dmg` | Existing `tihulu`, or main macOS installer |
| Linux x86_64 | `.AppImage` | Existing `tihulu`, Debian installer, or venv fallback |

Linux ARM64 GUI packages are intentionally not published yet. The GUI itself builds on ARM64, but the upstream `tihulu-star-trail` engine does not currently have Linux ARM64 CI/release coverage, so the project does not claim end-to-end ARM64 support yet.

## Features

- Automatic `tihulu` detection from `PATH` and standard install locations
- Custom executable override when needed
- **Full run**: group photos and render one star trail per detected camera angle
- **Group**: organize matching camera angles without rendering
- **Trail**: render a single folder or existing grouped output
- **Timelapse**: render MP4 video from a folder or grouped output
- Native folder/file pickers
- Live stdout/stderr activity console
- Stop a running job
- Open the output directory directly
- Advanced controls matching the CLI:
  - grouping threshold
  - minimum geometric matches
  - ORB feature count and analysis size
  - EXIF/file-time grouping window
  - recursive scanning
  - copy/symlink/hardlink/manifest-only grouped output
  - minimum frames and JPEG quality
  - timelapse FPS, max side and codec
- Local-only processing: photos are not uploaded by the GUI

## How it works

```text
Tauri desktop window
       │
       │ typed invoke calls + events
       ▼
Rust process bridge
       │
       │ validated argv (no shell command strings)
       ▼
installed `tihulu` CLI
       │
       ▼
tihulu-star-trail processing engine
```

Paths are passed as individual process arguments, so paths containing spaces work on Windows, macOS and Linux. The bridge only constructs supported `tihulu` commands and options.

## Development

Prerequisites:

- Node.js 22+
- Rust stable
- Tauri 2 platform prerequisites for your OS
- `tihulu-star-trail` for end-to-end processing tests

```bash
git clone https://github.com/Tihulu/GUI4tihulu-star-trail.git
cd GUI4tihulu-star-trail
npm install
npm run tauri dev
```

Frontend only:

```bash
npm run dev
```

Build the native package for the current OS:

```bash
npm install
npx tauri icon app-icon.svg
npm run tauri build
```

## Releases

`.github/workflows/build.yml` validates and packages Linux x86_64, macOS Universal and Windows x86_64. On a successful push to `main`, the workflow reads the version from `package.json`, creates the corresponding `v*` Git tag and GitHub Release, uploads the three native packages, and adds `SHA256SUMS.txt`.

For example, `package.json` version `0.1.0` publishes release `v0.1.0`. Bump the package version before the next release.

The one-line installers always resolve the newest published release through the GitHub Releases API.

## License

**GNU Affero General Public License v3.0 only (`AGPL-3.0-only`).**

See [`LICENSE`](LICENSE). Source files also carry SPDX identifiers where appropriate. The desktop UI exposes a source/license link so the corresponding source remains easy to reach.
