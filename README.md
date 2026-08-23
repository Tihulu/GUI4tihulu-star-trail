# GUI4tihulu-star-trail

A modern, cross-platform desktop GUI for [`tihulu-star-trail`](https://github.com/Tihulu/tihulu-star-trail).

The GUI intentionally **does not duplicate the image-processing engine**. It discovers and runs the `tihulu` CLI already installed on the computer, so the desktop interface stays small and the processing behavior remains identical to the main project.

## Platforms

- Windows 10/11
- macOS (Apple Silicon and Intel via universal build)
- Linux (WebKitGTK desktop environments)

Built with **Tauri 2 + TypeScript/Vite**.

## What it can do

- Detect the installed `tihulu` executable automatically from `PATH`
- Allow a custom `tihulu` executable path when needed
- Full run: group images and render star trails
- Group-only workflow
- Star-trail rendering from a folder or grouped output
- Timelapse rendering
- Native folder pickers
- Advanced controls matching the CLI (threshold, ORB features, EXIF time window, link mode, JPEG quality, FPS, codec, etc.)
- Stream CLI output into a live console
- Stop a running job
- Open the output directory from the GUI
- Keep all processing local on the user's machine

## Requirement: install tihulu-star-trail first

The GUI expects the main project to already be installed and the `tihulu` command to be available.

Verify it in a terminal:

```bash
tihulu --help
```

If the GUI cannot find it on `PATH`, open **Advanced controls** and set the full path to the `tihulu` executable.

## Development

Prerequisites:

- Node.js 22+
- Rust stable
- Tauri 2 platform prerequisites for your OS
- `tihulu-star-trail` installed for end-to-end runs

Install dependencies and launch:

```bash
npm install
npm run tauri dev
```

Frontend-only development:

```bash
npm run dev
```

## Build

```bash
npm install
npm run tauri build
```

Tauri creates the native installer/bundle for the current operating system.

## Releases

`.github/workflows/build.yml` builds on Windows, Linux, and macOS. Pushing a tag such as:

```bash
git tag v0.1.0
git push origin v0.1.0
```

creates draft release artifacts through `tauri-apps/tauri-action`.

## Architecture

```text
TypeScript/Vite UI
       │
       │ Tauri invoke + events
       ▼
Rust desktop bridge
       │
       │ discovers/spawns executable
       ▼
installed `tihulu` CLI
       │
       ▼
tihulu-star-trail processing engine
```

The Rust bridge constructs only supported CLI arguments; it does not execute user-provided shell strings. Input/output paths are passed as individual process arguments.

## License

This GUI repository is intended to be distributed under the MIT License, matching the companion project's licensing direction. Add or adjust the repository license before the first public release if needed.
