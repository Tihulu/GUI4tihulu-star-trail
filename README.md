# GUI4tihulu-star-trail

A modern, cross-platform desktop studio for [`tihulu-star-trail`](https://github.com/Tihulu/tihulu-star-trail), built with **Tauri 2 + TypeScript/Vite** and licensed **AGPL-3.0-only**.

The application keeps the real `tihulu` engine as the source of truth. Version 0.2 adds a native frame-curation workspace while also exposing the complete upstream native Desktop and Web Forge workflows, so advanced functionality is never lost behind the simplified quick-run UI.

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

## Supported platforms

| Platform | GUI package | Engine handling |
| --- | --- | --- |
| Windows 10/11 x86_64 | NSIS `.exe` | Existing `tihulu`, or managed Python 3.12 venv |
| macOS 11+ Intel + Apple Silicon | Universal `.dmg` | Existing `tihulu`, or main macOS installer |
| Linux x86_64 | `.AppImage` | Existing `tihulu`, Debian installer, or venv fallback |

Linux ARM64 GUI builds are validated in CI but are intentionally not published as an end-to-end supported package yet because the upstream `tihulu-star-trail` engine does not currently have Linux ARM64 CI/release coverage.

## Studio sections

### Process

Fast native control surface for the CLI:

- Full run, Group, Trail and Timelapse workflows
- input/output native folder pickers
- live stdout/stderr console and cancellation
- grouping threshold, minimum matches, ORB features and analysis size
- EXIF/file-time grouping window
- recursive scanning
- copy / symlink / hardlink / manifest-only grouped output
- minimum frames, JPEG quality, FPS, video max side and codec

### Photo Workspace

The folder is scanned into a native frame workspace before processing:

- thumbnail grid for browser-readable images
- RAW files appear in the workspace and remain processable; full RAW image preview is available through **Full Desktop**
- per-photo include/exclude checkbox
- click selection, Ctrl/Cmd-click toggle and **Shift-click range selection**
- Select All, Clear Selection and Invert Selection
- include or exclude the selected set as a block
- order by filename A-Z / Z-A
- order by capture/file timestamp ascending / descending
- **manual drag-and-drop ordering**
- selected photos can be dragged as one ordered block
- filename, type, size, path and timestamp inspector
- optional "Use selection" bridge into all quick Process workflows

When Photo Workspace selection is enabled, only included frames are staged in a temporary directory, with sequence-prefixed filenames that preserve the workspace order. The original photos are never modified. The temporary staging directory is removed after the engine exits.

### Full Desktop — exact upstream native features

The **Launch Full Desktop** button runs `tihulu desktop`. This intentionally gives direct access to the complete original native application rather than maintaining a reduced clone. It includes the upstream features such as:

- responsive Process & Export and Manual Review workspaces
- 120x90 photo thumbnails and optional group thumbnails
- filename-only mode and thumbnail RAM cache controls
- multi-photo selection and block drag/reorder
- moving photos between groups
- group create / rename / reorder
- remove frames and 50-step Undo history
- RAW-capable previews
- selected-group trail/timelapse rendering
- completed trail preview and in-app video playback
- Auto / CPU / GPU hardware acceleration
- JPEG / PNG image export
- MP4 / WebM video export
- original-size image/video options
- output dimensions, bitrate and custom output names
- edited-group export

Because this launches the installed upstream implementation, new native features added to `tihulu-star-trail` remain available without waiting for a GUI rewrite.

### Web Forge

The GUI exposes both browser versions:

- **Local Web UI** starts `tihulu ui` on an available localhost port and opens it in the browser. It uses the installed engine and keeps processing local.
- **Hosted Star Trail Forge** opens `https://tihulu.github.io/tihulu-star-trail/` and is also shown in an in-app preview when embedding is supported.

The hosted Forge provides its existing browser feature set, including Select Photos, Analyze, Manual Review, Trail Image, Timelapse Video, group editor, Prev/Next, Rename/Add Group, Move/Remove Photo, Undo, multi-selection, Select All/Clear, filename/date sorting, drag-to-reorder, multi-photo block moves, custom download filename, JPEG/PNG controls, original-size export, WebM/MP4 controls, FPS, video size and bitrate.

## Architecture

```text
Tauri Studio
  ├─ Process ─────────────── validated CLI argv ───────┐
  ├─ Photo Workspace ────── ordered selection staging ┤
  ├─ Full Desktop ───────── `tihulu desktop` ─────────┤
  └─ Web Forge ──────────── `tihulu ui` / hosted web ┤
                                                       ▼
                                          installed tihulu-star-trail
```

No user-provided shell command strings are executed. Paths and supported options are passed as individual process arguments.

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

`.github/workflows/build.yml` validates Windows x86_64, macOS Universal and Linux builds. On a successful push to `main`, the workflow reads the version from `package.json`, creates the corresponding `v*` Git tag and GitHub Release, uploads the supported native packages, and adds checksums.

## License

**GNU Affero General Public License v3.0 only (`AGPL-3.0-only`).** See [`LICENSE`](LICENSE).
