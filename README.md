<p align="center">
  <img src="./app-icon.svg" alt="Tihulu Star Trail Studio emblem" width="180" />
</p>

<h1 align="center">Tihulu Star Trail Studio</h1>

<p align="center">
  Modern cross-platform desktop studio for <a href="https://github.com/Tihulu/tihulu-star-trail">tihulu-star-trail</a>.<br/>
  Built with Tauri 2 + TypeScript/Vite · local-first astrophotography workflow.
</p>

The GUI uses the installed `tihulu` engine as the source of truth instead of duplicating the astrophotography pipeline. Processing stays local.

## v0.3 Studio workspace

The Photo Workspace now combines frame curation, manual grouping and a non-destructive image editor:

- sort by filename or file/capture date, then continue manually with drag-and-drop without losing the sorted starting order
- multi-select with Ctrl/Cmd and Shift, move selected photos as a block, include/exclude frames and preserve the final order for processing
- group cards with drag-and-drop photo moves, group reordering, rename, split, merge, delete, group undo/redo and “use current group in Process”
- automatic group detection from existing `group_*` folders, plus manual group creation from the current selection
- non-destructive photo editor with sliders for exposure, brightness, contrast, highlights, shadows, saturation, warmth, sharpness and rotation
- centered crop presets (original, 1:1, 4:3, 16:9)
- photo-edit Undo, Redo and Reset, Before/After preview, Copy/Paste settings
- apply edit settings to selected photos, the current group, or all frames
- edited JPEG export for the current frame, selection, or current group
- inline `i` parameter descriptions for every editor control, plus the existing full Parameter Guide for processing controls
- studio group/edit state is kept per source folder without modifying original images

## Memory-safe thumbnails

Photo Workspace uses viewport-aware loading and a decoded-size-aware LRU thumbnail cache capped at **128 thumbnails / 40 MB**. Off-screen image references are released, object URLs are revoked on eviction, and source-image decoding is serialized to reduce transient memory spikes.

## Processing workspaces

The application has four top-level workspaces:

1. **Process** — Full run / Group / Trail / Timelapse quick workflows, native pickers, advanced CLI parameters, streaming logs and cancellation.
2. **Photo Workspace** — frame selection, ordering, group editing, memory-bounded previews and non-destructive image edits.
3. **Full Desktop** — launches the exact installed upstream `tihulu desktop`, preserving the complete original native feature set including Manual Review, RAW previews, hardware acceleration and full export controls.
4. **Web Forge** — launches the engine-backed local `tihulu ui` and exposes the hosted Star Trail Forge.

## One-line install

Linux x86_64 / macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/Tihulu/GUI4tihulu-star-trail/main/scripts/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/Tihulu/GUI4tihulu-star-trail/main/scripts/install.ps1 | iex
```

The installers check for `tihulu-star-trail` and install the engine automatically when it is missing.

## Platforms

Release builds target:

- Windows x86_64 (NSIS)
- macOS Universal (Intel + Apple Silicon)
- Linux x86_64 (AppImage)

Linux ARM64 GUI publishing is intentionally deferred until the upstream engine has formal ARM64 CI/release coverage.

## License

`AGPL-3.0-only`. See `LICENSE`.
