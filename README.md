<p align="center">
  <img src="./app-icon.svg" alt="Tihulu Star Trail Studio emblem" width="180" />
</p>

<h1 align="center">Tihulu Star Trail Studio</h1>

<p align="center">
  Modern cross-platform desktop studio for <a href="https://github.com/Tihulu/tihulu-star-trail">tihulu-star-trail</a>.<br/>
  Built with Tauri 2 + TypeScript/Vite · local-first astrophotography workflow.
</p>

The GUI uses the installed `tihulu` engine as the source of truth instead of duplicating the astrophotography pipeline. Processing stays local and original source photos are not modified.

## v0.3.5 at a glance

### Process, readiness and independent hardware controls

![v0.3.5 Process workspace](./docs/screenshots/v0.3.5-process.png)

Process exposes four quick workflows: **Full run**, **Group**, **Trail** and **Timelapse**. The primary action now explains why it is disabled instead of remaining silently grey: engine checking/missing, missing input/output, no included workspace frames, or another running job are surfaced directly below the button.

Trail and Timelapse keep their own settings. Timelapse exposes FPS, maximum video side and the four-character OpenCV codec field (for example `mp4v`). Grouping, trail rendering and timelapse rendering each have an independent **Auto / CPU / GPU / GPU+CPU** selector.

GPU/hybrid is capability-dependent: the installed OpenCV build must expose a usable CUDA or OpenCL backend. If acceleration is unavailable or fails, the engine safely continues on CPU. Selecting GPU therefore does **not** guarantee that a machine's GPU will actually be used.

## Photo Workspace and engine-group sync

![v0.3.5 Photo Workspace](./docs/screenshots/v0.3.5-workspace.png)

After a successful **Group** or **Full run**, the workspace restores the original Process input and maps `manifest.json` / `group_*` engine output back onto those original source frames. It no longer treats `output/groups` as the working source by accident.

Clicking a group opens its frames immediately and selects the first visible frame. Manual review includes:

- Ctrl/Cmd and Shift multi-select
- drag selected frames as a block inside the current group
- drag one or many selected frames onto another group
- Previous / Next frame navigation
- remove selected frames from a group without deleting files
- frame-thumbnail and group-thumbnail visibility toggles
- create, rename, reorder, split, merge and delete groups
- group Undo / Redo
- filename/date sorting followed by continued manual drag ordering
- manual **Sync engine groups** when an explicit refresh is useful

### Large projects

Thumbnail work is viewport-aware and uses a decoded-size-aware LRU cache capped at **128 thumbnails / 40 MB**. Off-screen references are released, object URLs are revoked when appropriate, source-image decoding is serialized to reduce transient memory spikes, and the workspace can reduce/pause preview work for large projects. The Performance Mode indicator makes those safeguards visible.

## Non-destructive Photo Editor

![v0.3.5 Photo Editor](./docs/screenshots/v0.3.5-editor.png)

Per-frame edit state includes exposure, brightness, contrast, highlights, shadows, saturation, warmth, sharpness, rotation, crop aspect and JPEG export quality. The editor provides **Before**, **Undo**, **Redo**, **Reset**, Copy/Paste settings, and scoped application to selected frames, the current group or all frames. Edited JPEG export is available for the current frame, selection or current group. Originals remain untouched.

## Parameter Guide

![v0.3.5 Parameter Guide](./docs/screenshots/v0.3.5-parameter-guide.png)

Inline `i` help and the Parameter Guide explain grouping strictness, capture-time constraints, image/video output controls, hardware policies, thumbnail behavior and editor parameters without requiring users to know the CLI flags first.

## Processing workspaces

The application has four top-level workspaces:

1. **Process** — Full run / Group / Trail / Timelapse quick workflows, native pickers, readiness reasons, advanced CLI parameters, streaming logs and cancellation.
2. **Photo Workspace** — frame selection, ordering, engine-group sync, group editing, memory-bounded previews and non-destructive image edits.
3. **Full Desktop** — launches the installed upstream `tihulu desktop`, preserving the original native feature set including Manual Review, RAW previews, hardware acceleration and export controls.
4. **Web Forge** — launches the engine-backed local `tihulu ui` and exposes the hosted Star Trail Forge workflow.

## Engine compatibility and one-line install

Linux x86_64 / macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/Tihulu/GUI4tihulu-star-trail/main/scripts/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/Tihulu/GUI4tihulu-star-trail/main/scripts/install.ps1 | iex
```

The installers verify that the detected engine exposes the current `--group-hardware`, `--trail-hardware` and `--timelapse-hardware` policies. If an installed `tihulu-star-trail` is too old, the installer upgrades it to the current engine and verifies those controls again. The GUI also provides an **Update engine** recovery path when an incompatible engine is detected.

## Platforms

Release builds target:

- Windows x86_64 (NSIS)
- macOS Universal (Intel + Apple Silicon)
- Linux x86_64 (AppImage)

Linux ARM64 GUI publishing is intentionally deferred until the upstream engine has formal ARM64 CI/release coverage; it is **not** a released target today.

## Release validation

v0.3.5 was validated with the packaged Linux x86_64 AppImage using a real six-frame Group → Photo Workspace → Photo Editor workflow, including original-source group mapping, 3+3 group counts and frame-to-frame editor preview sync. The cross-platform desktop workflow must also pass on **Windows x86_64, Linux x86_64 and macOS Universal** before merge; the versioned release is produced only after all three main-branch builds succeed.

## License

`AGPL-3.0-only`. See `LICENSE`.
