// SPDX-License-Identifier: AGPL-3.0-only
import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { buildOutputPath, normalizeHardwareMode, type HardwareMode } from "./job-policy";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";

type Mode = "run" | "group" | "trail" | "timelapse";
type Section = "process" | "photos" | "desktop" | "web";
type SortMode = "manual" | "name-asc" | "name-desc" | "date-asc" | "date-desc";
type LinkMode = "symlink" | "copy" | "hardlink" | "none";

type EngineInfo = { found: boolean; path: string | null; detail: string };
type LogPayload = { stream: "stdout" | "stderr"; line: string };
type JobFinished = { success: boolean; code: number | null };
type StartResult = { pid: number; commandDisplay: string; stagedFiles: number };
type UiLaunch = { pid: number; url: string };

type PhotoInfo = {
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
  modifiedMs: number | null;
  isRaw: boolean;
  browserPreviewable: boolean;
};

type PhotoRecord = PhotoInfo & { included: boolean };

type JobRequest = {
  command: Mode;
  input: string;
  output: string;
  executable: string | null;
  files: string[] | null;
  groupHardware: HardwareMode;
  trailHardware: HardwareMode;
  timelapseHardware: HardwareMode;
  threshold: number;
  minMatches: number;
  maxSide: number;
  nfeatures: number;
  timeMetadata: boolean;
  timeWindowMinutes: number;
  recursive: boolean;
  quiet: boolean;
  linkMode: LinkMode;
  minFrames: number;
  jpegQuality: number;
  timelapse: boolean;
  fps: number;
  videoMaxSide: number;
  codec: string;
};

const modes: Record<Mode, { title: string; description: string; action: string }> = {
  run: { title: "Full run", description: "Group a night of frames and render one trail for every detected camera angle.", action: "Build star trails" },
  group: { title: "Group only", description: "Detect repeated camera angles and organize the frames without rendering trails.", action: "Group photos" },
  trail: { title: "Trail render", description: "Lighten-stack a folder, or render every group from an existing grouped output.", action: "Render trails" },
  timelapse: { title: "Timelapse", description: "Turn a folder or grouped output into an MP4 timelapse video.", action: "Render timelapse" },
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app root");

app.innerHTML = `
<div class="app-shell">
  <header class="topbar">
    <button class="brand" id="brandButton" type="button" aria-label="Open project on GitHub">
      <span class="brand-mark" aria-hidden="true"><span class="orbit orbit-a"></span><span class="orbit orbit-b"></span><span class="star-core"></span></span>
      <span class="brand-copy"><strong>Tihulu Star Trail</strong><small>Desktop Studio</small></span>
    </button>
    <nav class="section-tabs" aria-label="Studio section">
      <button class="section-tab active" data-section="process" type="button">Process</button>
      <button class="section-tab" data-section="photos" type="button">Photo Workspace</button>
      <button class="section-tab" data-section="desktop" type="button">Full Desktop</button>
      <button class="section-tab" data-section="web" type="button">Web Forge</button>
    </nav>
    <div class="topbar-actions">
      <button class="engine-pill checking" id="enginePill" type="button" title="Check tihulu engine"><span class="status-dot"></span><span id="engineText">Checking engine…</span></button>
      <button class="icon-button" id="toggleConsole" type="button" aria-label="Toggle activity console" title="Activity console"><span class="terminal-icon">›_</span></button>
    </div>
  </header>

  <main class="workspace">
    <section class="studio-section active" id="section-process">
      <section class="intro">
        <div><p class="eyebrow">LOCAL ASTROPHOTOGRAPHY WORKFLOW</p><h1 id="modeTitle">Full run</h1><p class="lede" id="modeDescription">${modes.run.description}</p></div>
        <div class="privacy-chip"><span class="lock-dot"></span>Processing stays on this computer</div>
      </section>
      <nav class="mode-tabs" aria-label="Processing mode">
        <button class="mode-tab active" data-mode="run" type="button"><span>01</span> Full run</button>
        <button class="mode-tab" data-mode="group" type="button"><span>02</span> Group</button>
        <button class="mode-tab" data-mode="trail" type="button"><span>03</span> Trail</button>
        <button class="mode-tab" data-mode="timelapse" type="button"><span>04</span> Timelapse</button>
      </nav>
      <section class="path-grid">
        <article class="path-card"><div class="path-card-head"><div class="path-icon">↳</div><div><small>INPUT</small><h2>Source frames</h2></div></div><div class="path-value empty" id="inputPath">Choose a folder containing your night-sky photos</div><div class="button-row"><button class="secondary-button" id="pickInput" type="button">Choose input folder</button><button class="ghost-button" id="scanFromProcess" type="button">Scan photos</button></div></article>
        <article class="path-card"><div class="path-card-head"><div class="path-icon output">↗</div><div><small>OUTPUT</small><h2>Project output</h2></div></div><div class="path-value empty" id="outputPath">Choose where generated files should be saved</div><div class="button-row"><button class="secondary-button" id="pickOutput" type="button">Choose output folder</button><button class="ghost-button" id="openOutput" type="button" disabled>Open</button></div></article>
      </section>
      <section class="selection-bridge hidden" id="selectionBridge"><div><span class="selection-dot"></span><strong>Photo Workspace selection active</strong><small id="selectionBridgeText"></small></div><label class="switch-field compact-switch"><input id="useWorkspaceSelection" type="checkbox" checked><span class="switch"></span><span><strong>Use selection</strong><small>Included frames only, in workspace order</small></span></label></section>
      <section class="control-card"><div class="control-card-main"><div class="control-copy"><span class="step-label">READY WHEN YOU ARE</span><strong id="actionTitle">Build star trails</strong><p>Uses the installed <code>tihulu</code> engine. Open Photo Workspace first when you want to choose, exclude, inspect or reorder individual frames.</p></div><div class="primary-actions"><button class="stop-button hidden" id="stopJob" type="button">Stop</button><button class="primary-button" id="startJob" type="button" disabled><span id="startLabel">Build star trails</span><span class="button-arrow">→</span></button></div></div><div class="run-state hidden" id="runState"><span class="spinner"></span><div><strong>Processing</strong><span id="runStateText">Starting tihulu…</span></div></div></section>
      <details class="advanced-card" id="advancedCard"><summary><span><strong>Advanced controls</strong><small>Grouping, stack quality, timelapse and engine settings</small></span><span class="chevron">⌄</span></summary><div class="advanced-body">
        <div class="settings-section" data-show="run,group"><div class="settings-title"><span>Grouping</span><small>Camera-angle matching</small></div><div class="settings-grid four">
          <label class="field"><span>Threshold</span><input id="threshold" type="number" min="0" max="1" step="0.01" value="0.42"><small>Higher is stricter</small></label>
          <label class="field"><span>Min. matches</span><input id="minMatches" type="number" min="4" step="1" value="18"><small>Geometric features</small></label>
          <label class="field"><span>Analysis max side</span><input id="maxSide" type="number" min="128" step="1" value="1000"><small>Pixels</small></label>
          <label class="field"><span>ORB features</span><input id="nfeatures" type="number" min="100" step="100" value="2500"><small>Per frame</small></label>
        </div><div class="switch-row"><label class="switch-field"><input id="timeMetadata" type="checkbox"><span class="switch"></span><span><strong>Use capture time</strong><small>Use EXIF/file times when engine groups frames</small></span></label><label class="field compact"><span>Time window</span><div class="input-with-unit"><input id="timeWindowHours" type="number" min="0" step="0.25" value="6"><span>hours</span></div></label></div></div>
        <div class="settings-section" data-show="run,group"><div class="settings-title"><span>Grouped output</span><small>How source frames are represented</small></div><div class="segmented" id="linkMode"><button type="button" data-value="copy" class="selected">Copy</button><button type="button" data-value="symlink">Symlink</button><button type="button" data-value="hardlink">Hardlink</button><button type="button" data-value="none">Manifest only</button></div></div>
        <div class="settings-section" data-show="run,trail,timelapse"><div class="settings-title"><span>Render</span><small>Output quality and minimum sequence length</small></div><div class="settings-grid three"><label class="field"><span>Minimum frames</span><input id="minFrames" type="number" min="2" step="1" value="2"></label><label class="field" data-show="run,trail"><span>JPEG quality</span><input id="jpegQuality" type="number" min="1" max="100" step="1" value="95"></label><label class="switch-field inline-switch"><input id="recursive" type="checkbox" checked><span class="switch"></span><span><strong>Recursive scan</strong><small>Include subfolders</small></span></label></div></div>
        <div class="settings-section" data-show="run,timelapse"><div class="settings-title"><span>Timelapse</span><small>MP4 export settings</small></div><label class="switch-field timelapse-toggle" data-show="run"><input id="makeTimelapse" type="checkbox"><span class="switch"></span><span><strong>Also render timelapse</strong><small>Create one video per detected group during Full run</small></span></label><div class="settings-grid three"><label class="field"><span>Frames / second</span><input id="fps" type="number" min="0.1" step="0.1" value="24"></label><label class="field"><span>Video max side</span><input id="videoMaxSide" type="number" min="0" value="1920"><small>0 keeps original size</small></label><label class="field"><span>Codec</span><input id="codec" type="text" maxlength="4" value="mp4v"></label></div></div>
        <div class="settings-section"><div class="settings-title"><span>Engine</span><small>Normally detected automatically</small></div><div class="engine-path-row"><label class="field grow"><span>Custom tihulu executable</span><input id="customExecutable" type="text" placeholder="Auto-detect from PATH or standard install locations"></label><button class="secondary-button fit" id="pickExecutable" type="button">Browse</button><button class="ghost-button fit" id="recheckEngine" type="button">Recheck</button></div><label class="switch-field"><input id="quiet" type="checkbox"><span class="switch"></span><span><strong>Quiet engine output</strong><small>Hide tihulu progress messages</small></span></label></div>
      </div></details>
    </section>

    <section class="studio-section" id="section-photos">
      <section class="intro compact-intro"><div><p class="eyebrow">FRAME CURATION</p><h1>Photo Workspace</h1><p class="lede">Preview, include or exclude frames, inspect file metadata and set the exact timelapse order before processing.</p></div><div class="workspace-count" id="workspaceCount">0 photos</div></section>
      <section class="workspace-toolbar glass-card"><div class="toolbar-path"><span class="toolbar-label">SOURCE</span><strong id="photoSourcePath">No folder selected</strong></div><div class="toolbar-actions"><label class="mini-check"><input id="workspaceRecursive" type="checkbox" checked> Recursive</label><button class="secondary-button" id="chooseAndScan" type="button">Choose folder</button><button class="ghost-button" id="rescanPhotos" type="button">Rescan</button></div></section>
      <section class="workspace-toolbar glass-card" id="workspaceOutputToolbar"><div class="toolbar-path"><span class="toolbar-label">OUTPUT</span><strong class="empty" id="workspaceOutputPath">No output folder selected</strong></div><div class="toolbar-actions"><button class="secondary-button" id="workspacePickOutput" type="button">Choose / change output</button><button class="ghost-button" id="workspaceOpenOutput" type="button" disabled>Open</button></div></section>
      <section class="photo-controls glass-card"><div class="control-cluster"><button class="ghost-button compact-button" id="selectAllPhotos" type="button">Select all</button><button class="ghost-button compact-button" id="clearPhotoSelection" type="button">Clear selection</button><button class="ghost-button compact-button" id="invertPhotoSelection" type="button">Invert selection</button></div><div class="control-cluster"><button class="secondary-button compact-button" id="includeSelected" type="button">Include selected</button><button class="ghost-button compact-button danger-text" id="excludeSelected" type="button">Exclude selected</button></div><label class="sort-field"><span>Order</span><select id="photoSort"><option value="manual">Manual / drag</option><option value="name-asc">Name A–Z</option><option value="name-desc">Name Z–A</option><option value="date-asc">Capture/file date ↑</option><option value="date-desc">Capture/file date ↓</option></select></label><div class="photo-stats"><span id="includedCount">0 included</span><span id="selectedCount">0 selected</span></div></section>
      <section class="photo-layout"><div class="photo-grid-panel glass-card"><div class="photo-grid-head"><div><strong>Frames</strong><small>Click to select · Shift-click a range · drag selected frames as a block in Manual order</small></div><label class="mini-check"><input id="allIncluded" type="checkbox" checked> Include all</label></div><div class="photo-grid" id="photoGrid"><div class="empty-state"><strong>No photos loaded</strong><span>Choose an input folder to build the thumbnail workspace.</span></div></div></div><aside class="inspector glass-card" id="photoInspector"><div class="inspector-empty"><span class="inspector-star">✦</span><strong>Select a frame</strong><p>Filename, path, file type, size and capture/file time appear here.</p></div></aside></section>
      <section class="workspace-footer-card glass-card"><div><strong>Workspace selection can drive every quick workflow</strong><p>When enabled in Process, excluded frames are omitted and included frames are staged in this exact order. Original source photos remain untouched.</p></div><button class="primary-button fit-primary" id="goToProcess" type="button"><span>Process selected frames</span><span>→</span></button></section>
    </section>

    <section class="studio-section" id="section-desktop">
      <section class="intro compact-intro"><div><p class="eyebrow">100% ORIGINAL NATIVE FEATURE SET</p><h1>Full Desktop</h1><p class="lede">Launch the upstream native Tihulu desktop workspace when you need every advanced review/export feature exactly as implemented by the engine project.</p></div></section>
      <section class="parity-grid">
        <article class="feature-card glass-card"><span class="feature-icon">▦</span><h2>Manual Review workspace</h2><p>120×90 photo thumbnails, optional group thumbnails, filename-only mode, multi-selection, drag-to-reorder blocks and drag-to-group moves.</p></article>
        <article class="feature-card glass-card"><span class="feature-icon">↶</span><h2>Group editing + Undo</h2><p>Create, rename and reorder groups, remove/move photos, clear selection states and use the upstream 50-step edit history.</p></article>
        <article class="feature-card glass-card"><span class="feature-icon">◫</span><h2>RAW preview + media preview</h2><p>RAW-capable frame previews, completed trail previews, in-app timelapse playback and selected-group rendering.</p></article>
        <article class="feature-card glass-card"><span class="feature-icon">⚡</span><h2>Hardware + thumbnail controls</h2><p>Auto / CPU / GPU acceleration, bounded background thumbnail decoding, RAM-cache toggle and upstream fallback behavior.</p></article>
        <article class="feature-card glass-card"><span class="feature-icon">⇩</span><h2>Full export controls</h2><p>JPEG/PNG, MP4/WebM, image/video dimensions, original-size exports, bitrate, custom output names and edited-group export.</p></article>
        <article class="feature-card glass-card"><span class="feature-icon">◎</span><h2>Exact upstream implementation</h2><p>This launches <code>tihulu desktop</code>, so future features added to the installed engine remain available without waiting for a GUI re-port.</p></article>
      </section>
      <section class="launch-card glass-card"><div><span class="step-label">UPSTREAM NATIVE UI</span><strong>Open original Tihulu Desktop</strong><p>Runs locally using the same installed engine detected above.</p></div><button class="primary-button" id="launchDesktop" type="button"><span>Launch Full Desktop</span><span>↗</span></button></section>
    </section>

    <section class="studio-section" id="section-web">
      <section class="intro compact-intro"><div><p class="eyebrow">BROWSER WORKSPACES</p><h1>Web Forge</h1><p class="lede">Use the engine-backed local browser UI for RAW/local processing or open the hosted browser-only Forge with its full manual editor and web export controls.</p></div></section>
      <section class="web-choice-grid">
        <article class="web-card glass-card"><span class="feature-icon">⌂</span><h2>Local Web UI</h2><p>Starts <code>tihulu ui</code> on localhost. Photos stay local and processing uses the installed Python engine, including RAW-capable native processing.</p><div class="web-actions"><button class="primary-button" id="launchLocalWeb" type="button"><span>Launch Local UI</span><span>↗</span></button><button class="ghost-button" id="stopLocalWeb" type="button">Stop server</button></div><small id="localWebStatus">Not running</small></article>
        <article class="web-card glass-card"><span class="feature-icon">☄</span><h2>Hosted Star Trail Forge</h2><p>Exact GitHub Pages app: select browser-readable photos, analyze groups, manual review, drag/reorder, move/remove frames, Undo, custom filenames, JPEG/PNG and WebM/MP4 controls.</p><button class="secondary-button wide-button" id="launchHostedWeb" type="button">Open Hosted Forge ↗</button><small>Runs fully in the browser; hosted mode does not process RAW.</small></article>
      </section>
      <section class="hosted-preview glass-card"><div class="hosted-preview-head"><div><strong>Hosted Forge preview</strong><small>If the site refuses embedding on your platform, use “Open Hosted Forge”.</small></div><button class="ghost-button compact-button" id="reloadHosted" type="button">Reload</button></div><iframe id="hostedFrame" title="Tihulu hosted Star Trail Forge" src="https://tihulu.github.io/tihulu-star-trail/" loading="lazy"></iframe></section>
    </section>

    <section class="console-card hidden" id="consoleCard" aria-live="polite"><div class="console-head"><div><span class="console-light red"></span><span class="console-light amber"></span><span class="console-light green"></span><strong>Activity</strong></div><button class="ghost-button fit" id="clearConsole" type="button">Clear</button></div><div class="console-body" id="consoleBody"><span class="console-muted">No job output yet.</span></div></section>
  </main>
  <footer class="footer"><span>GUI4tihulu-star-trail · AGPL-3.0-only · v0.2</span><button id="footerRepo" type="button">Source & license ↗</button></footer>
</div>`;

function qs<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

let mode: Mode = "run";
let inputPath = "";
let outputPath = "";
let engine: EngineInfo = { found: false, path: null, detail: "Checking…" };
let running = false;
let selectedLinkMode: LinkMode = navigator.userAgent.includes("Windows") ? "copy" : "symlink";
let logHasContent = false;
let photos: PhotoRecord[] = [];
let workspaceVisiblePaths: Set<string> | null = null;
let selectedPaths = new Set<string>();
let selectionAnchor: number | null = null;
let sortMode: SortMode = "manual";
let draggedPaths: string[] = [];
let scannedInput = "";

const inputPathEl = qs<HTMLDivElement>("#inputPath");
const outputPathEl = qs<HTMLDivElement>("#outputPath");
const enginePill = qs<HTMLButtonElement>("#enginePill");
const engineText = qs<HTMLSpanElement>("#engineText");
const startJobButton = qs<HTMLButtonElement>("#startJob");
const stopJobButton = qs<HTMLButtonElement>("#stopJob");
const openOutputButton = qs<HTMLButtonElement>("#openOutput");
const consoleCard = qs<HTMLElement>("#consoleCard");
const consoleBody = qs<HTMLDivElement>("#consoleBody");
const runState = qs<HTMLDivElement>("#runState");
const runStateText = qs<HTMLSpanElement>("#runStateText");
const customExecutable = qs<HTMLInputElement>("#customExecutable");

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}
function numberValue(id: string): number { return Number(qs<HTMLInputElement>(`#${id}`).value); }
function checked(id: string): boolean { return qs<HTMLInputElement>(`#${id}`).checked; }
function hardwareMode(id: string): HardwareMode { return normalizeHardwareMode(document.querySelector<HTMLButtonElement>(`#${id} button.selected`)?.dataset.value); }
function setPath(element: HTMLDivElement, value: string, emptyText: string): void { element.textContent = value || emptyText; element.classList.toggle("empty", !value); element.title = value; }
function setOutputPath(value: string): void {
  outputPath = value;
  setPath(outputPathEl, outputPath, "Choose where generated files should be saved");
  const workspaceLabel = document.querySelector<HTMLElement>("#workspaceOutputPath");
  if (workspaceLabel) { workspaceLabel.textContent = outputPath || "No output folder selected"; workspaceLabel.classList.toggle("empty", !outputPath); workspaceLabel.title = outputPath; }
  const workspaceOpen = document.querySelector<HTMLButtonElement>("#workspaceOpenOutput");
  if (workspaceOpen) workspaceOpen.disabled = !outputPath;
  updateStartState();
}
function setSection(next: Section): void { document.querySelectorAll<HTMLElement>(".studio-section").forEach((item) => item.classList.toggle("active", item.id === `section-${next}`)); document.querySelectorAll<HTMLButtonElement>(".section-tab").forEach((button) => button.classList.toggle("active", button.dataset.section === next)); }
function includedPhotos(): PhotoRecord[] { return photos.filter((photo) => photo.included); }
function visiblePhotos(): PhotoRecord[] {
  if (workspaceVisiblePaths === null) return photos;
  return photos.filter((photo) => workspaceVisiblePaths?.has(photo.path));
}
function applyVisibleWorkspaceScope(paths: string[], includeAll: boolean, excludeOutside: boolean): void {
  const knownPaths = new Set(photos.map((photo) => photo.path));
  const requested = paths.filter((path) => knownPaths.has(path));
  workspaceVisiblePaths = requested.length === photos.length ? null : new Set(requested);
  const visible = visiblePhotos();
  const visiblePaths = new Set(visible.map((photo) => photo.path));
  if (excludeOutside) photos.forEach((photo) => { if (!visiblePaths.has(photo.path)) photo.included = false; });
  if (includeAll) visible.forEach((photo) => { photo.included = true; });
  renderPhotoGrid();
}

function updateMode(next: Mode): void {
  mode = next;
  qs<HTMLElement>("#modeTitle").textContent = modes[mode].title;
  qs<HTMLElement>("#modeDescription").textContent = modes[mode].description;
  qs<HTMLElement>("#actionTitle").textContent = modes[mode].action;
  qs<HTMLElement>("#startLabel").textContent = modes[mode].action;
  document.querySelectorAll<HTMLButtonElement>(".mode-tab").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  document.querySelectorAll<HTMLElement>("[data-show]").forEach((element) => element.classList.toggle("mode-hidden", !(element.dataset.show ?? "").split(",").includes(mode)));
}

function updateSelectionBridge(): void {
  const bridge = qs<HTMLElement>("#selectionBridge");
  const useSelection = qs<HTMLInputElement>("#useWorkspaceSelection");
  const usable = photos.length > 0 && scannedInput === inputPath;
  bridge.classList.toggle("hidden", !usable);
  if (usable) {
    const included = includedPhotos().length;
    qs<HTMLElement>("#selectionBridgeText").textContent = `${included} of ${photos.length} frames included · current workspace order will be preserved`;
    useSelection.disabled = included === 0;
  }
}
function updateStartState(): void {
  const useSelection = qs<HTMLInputElement>("#useWorkspaceSelection");
  const selectionOkay = !useSelection.checked || photos.length === 0 || scannedInput !== inputPath || includedPhotos().length > 0;
  startJobButton.disabled = running || !engine.found || !inputPath || !outputPath || !selectionOkay;
  openOutputButton.disabled = !outputPath;
  updateSelectionBridge();
}
function setRunning(next: boolean): void { running = next; stopJobButton.classList.toggle("hidden", !next); runState.classList.toggle("hidden", !next); startJobButton.classList.toggle("running", next); updateStartState(); }
function appendLog(message: string, stream: "stdout" | "stderr" | "system" = "system"): void { if (!logHasContent) { consoleBody.innerHTML = ""; logHasContent = true; } const row = document.createElement("div"); row.className = `console-line ${stream}`; row.textContent = message; consoleBody.append(row); consoleBody.scrollTop = consoleBody.scrollHeight; }

async function detectEngine(): Promise<void> {
  enginePill.className = "engine-pill checking"; engineText.textContent = "Checking engine…";
  try { engine = await invoke<EngineInfo>("detect_engine", { customExecutable: customExecutable.value.trim() || null }); } catch (error) { engine = { found: false, path: null, detail: String(error) }; }
  enginePill.className = `engine-pill ${engine.found ? "ready" : "missing"}`; engineText.textContent = engine.found ? "Engine ready" : "Engine missing"; enginePill.title = engine.path ? `${engine.detail}\n${engine.path}` : engine.detail; updateStartState();
}
function currentFilesForJob(): string[] | null { const useSelection = qs<HTMLInputElement>("#useWorkspaceSelection").checked; if (!useSelection || scannedInput !== inputPath || photos.length === 0) return null; return includedPhotos().map((photo) => photo.path); }
function outputForJob(): string {
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
function validateRequest(request: JobRequest): string | null { if (!engine.found) return "Install or select a tihulu engine first."; if (!request.input) return "Choose an input path."; if (!request.output) return "Choose an output path."; if (request.files?.length === 0) return "Include at least one frame in Photo Workspace."; if (request.threshold < 0 || request.threshold > 1) return "Threshold must be between 0 and 1."; if (request.minMatches < 4) return "Minimum matches must be at least 4."; if (request.codec.length !== 4) return "Codec must have four characters."; return null; }
async function startJob(): Promise<void> { const request = makeJobRequest(); const error = validateRequest(request); if (error) { appendLog(error, "stderr"); return; } setRunning(true); runStateText.textContent = request.files ? `Staging ${request.files.length} selected frame(s)…` : "Starting tihulu…"; consoleCard.classList.remove("hidden"); try { const result = await invoke<StartResult>("start_job", { request }); appendLog(`$ ${result.commandDisplay}`); if (result.stagedFiles > 0) appendLog(`Photo Workspace: ${result.stagedFiles} included frame(s) staged in workspace order.`); runStateText.textContent = `PID ${result.pid} · ${modes[mode].action}`; } catch (error) { appendLog(String(error), "stderr"); setRunning(false); } }

function formatBytes(bytes: number): string { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
function formatDate(ms: number | null): string { return ms ? new Date(ms).toLocaleString() : "Unknown"; }
function sortPhotos(next: SortMode): void { sortMode = next; if (next !== "manual") { const factor = next.endsWith("desc") ? -1 : 1; if (next.startsWith("name")) photos.sort((a, b) => factor * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })); else photos.sort((a, b) => factor * ((a.modifiedMs ?? 0) - (b.modifiedMs ?? 0)) || a.name.localeCompare(b.name)); } renderPhotoGrid(); }
function selectedRecords(): PhotoRecord[] { return photos.filter((photo) => selectedPaths.has(photo.path)); }
function setIncludedForSelection(included: boolean): void { if (selectedPaths.size === 0) return; photos.forEach((photo) => { if (selectedPaths.has(photo.path)) photo.included = included; }); renderPhotoGrid(); }
function selectPhoto(index: number, event: MouseEvent): void { const path = photos[index]?.path; if (!path) return; if (event.shiftKey && selectionAnchor !== null) { if (!(event.ctrlKey || event.metaKey)) selectedPaths.clear(); const [from, to] = [selectionAnchor, index].sort((a, b) => a - b); for (let cursor = from; cursor <= to; cursor += 1) selectedPaths.add(photos[cursor].path); } else if (event.ctrlKey || event.metaKey) { if (selectedPaths.has(path)) selectedPaths.delete(path); else selectedPaths.add(path); selectionAnchor = index; } else { selectedPaths.clear(); selectedPaths.add(path); selectionAnchor = index; } renderPhotoGrid(); }
function updatePhotoStats(): void {
  const visible = visiblePhotos();
  const visibleIncluded = visible.filter((photo) => photo.included);
  const scoped = workspaceVisiblePaths !== null;
  const allIncluded = qs<HTMLInputElement>("#allIncluded");
  qs<HTMLElement>("#workspaceCount").textContent = `${photos.length} photo${photos.length === 1 ? "" : "s"}`;
  qs<HTMLElement>("#includedCount").textContent = scoped ? `${visibleIncluded.length}/${visible.length} shown included` : `${includedPhotos().length} included`;
  qs<HTMLElement>("#selectedCount").textContent = `${selectedPaths.size} selected`;
  allIncluded.checked = visible.length > 0 && visibleIncluded.length === visible.length;
  allIncluded.indeterminate = visibleIncluded.length > 0 && visibleIncluded.length < visible.length;
  allIncluded.title = scoped ? "Include or exclude every frame shown in the active group" : "Include or exclude every frame currently shown";
  qs<HTMLElement>("#photoSourcePath").textContent = scannedInput || "No folder selected";
  updateStartState();
}
function renderInspector(): void { const inspector = qs<HTMLElement>("#photoInspector"); const selected = selectedRecords(); if (selected.length === 0) { inspector.innerHTML = `<div class="inspector-empty"><span class="inspector-star">✦</span><strong>Select a frame</strong><p>Filename, path, file type, size and capture/file time appear here.</p></div>`; return; } const photo = selected[0]; const preview = photo.browserPreviewable ? `<img class="inspector-preview" data-thumb-path="${escapeHtml(photo.path)}" data-thumb-version="${photo.modifiedMs ?? 0}:${photo.sizeBytes}" alt="">` : `<div class="inspector-raw"><span>${escapeHtml(photo.extension.toUpperCase())}</span><small>RAW preview is available in Full Desktop</small></div>`; inspector.innerHTML = `${preview}<div class="inspector-content"><p class="eyebrow">FRAME DETAILS</p><h2>${escapeHtml(photo.name)}</h2><dl class="metadata-list"><div><dt>Status</dt><dd>${photo.included ? "Included" : "Excluded"}</dd></div><div><dt>Format</dt><dd>${escapeHtml(photo.extension.toUpperCase() || "Unknown")}${photo.isRaw ? " · RAW" : ""}</dd></div><div><dt>Size</dt><dd>${formatBytes(photo.sizeBytes)}</dd></div><div><dt>Capture / file date</dt><dd>${escapeHtml(formatDate(photo.modifiedMs))}</dd></div><div><dt>Path</dt><dd class="path-meta">${escapeHtml(photo.path)}</dd></div></dl>${selected.length > 1 ? `<p class="multi-note">${selected.length} frames selected. Include/exclude and drag actions apply to the selection.</p>` : ""}</div>`; }
function renderPhotoGrid(): void {
  const grid = qs<HTMLDivElement>("#photoGrid");
  if (photos.length === 0) { grid.innerHTML = `<div class="empty-state"><strong>No photos loaded</strong><span>Choose an input folder to build the thumbnail workspace.</span></div>`; renderInspector(); updatePhotoStats(); return; }
  grid.innerHTML = "";
  photos.forEach((photo, index) => {
    const tile = document.createElement("article");
    tile.className = `photo-tile${selectedPaths.has(photo.path) ? " selected" : ""}${photo.included ? "" : " excluded"}${workspaceVisiblePaths !== null && !workspaceVisiblePaths.has(photo.path) ? " studio-group-hidden" : ""}`; tile.draggable = sortMode === "manual"; tile.dataset.path = photo.path;
    const preview = photo.browserPreviewable ? `<img data-thumb-path="${escapeHtml(photo.path)}" data-thumb-version="${photo.modifiedMs ?? 0}:${photo.sizeBytes}" alt="" loading="lazy">` : `<div class="raw-placeholder"><span>${escapeHtml(photo.extension.toUpperCase())}</span><small>RAW</small></div>`;
    tile.innerHTML = `<label class="include-box" title="Include this frame"><input type="checkbox" ${photo.included ? "checked" : ""}><span></span></label><div class="thumb-wrap">${preview}<span class="order-badge">${index + 1}</span></div><div class="tile-copy"><strong title="${escapeHtml(photo.name)}">${escapeHtml(photo.name)}</strong><small>${formatBytes(photo.sizeBytes)} · ${escapeHtml(formatDate(photo.modifiedMs))}</small></div>`;
    tile.addEventListener("click", (event) => { if ((event.target as HTMLElement).closest(".include-box")) return; selectPhoto(index, event); });
    tile.querySelector<HTMLInputElement>(".include-box input")?.addEventListener("change", (event) => { photo.included = (event.target as HTMLInputElement).checked; renderPhotoGrid(); });
    tile.addEventListener("dragstart", (event) => { if (sortMode !== "manual") { event.preventDefault(); return; } if (!selectedPaths.has(photo.path)) { selectedPaths.clear(); selectedPaths.add(photo.path); selectionAnchor = index; } draggedPaths = photos.filter((item) => selectedPaths.has(item.path)).map((item) => item.path); event.dataTransfer?.setData("text/plain", photo.path); if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"; requestAnimationFrame(() => tile.classList.add("dragging")); });
    tile.addEventListener("dragend", () => { draggedPaths = []; tile.classList.remove("dragging"); });
    tile.addEventListener("dragover", (event) => { if (sortMode === "manual") { event.preventDefault(); tile.classList.add("drop-target"); } }); tile.addEventListener("dragleave", () => tile.classList.remove("drop-target"));
    tile.addEventListener("drop", (event) => { event.preventDefault(); tile.classList.remove("drop-target"); if (sortMode !== "manual" || draggedPaths.length === 0 || draggedPaths.includes(photo.path)) return; const block = photos.filter((item) => draggedPaths.includes(item.path)); const remaining = photos.filter((item) => !draggedPaths.includes(item.path)); const targetIndex = remaining.findIndex((item) => item.path === photo.path); remaining.splice(Math.max(0, targetIndex), 0, ...block); photos = remaining; renderPhotoGrid(); });
    grid.append(tile);
  });
  renderInspector(); updatePhotoStats();
}
async function scanPhotos(source = inputPath): Promise<void> { if (!source) { appendLog("Choose an input folder before scanning.", "stderr"); return; } qs<HTMLElement>("#photoSourcePath").textContent = "Scanning…"; try { const result = await invoke<PhotoInfo[]>("scan_photos", { input: source, recursive: qs<HTMLInputElement>("#workspaceRecursive").checked }); photos = result.map((photo) => ({ ...photo, included: true })); workspaceVisiblePaths = null; selectedPaths.clear(); selectionAnchor = null; sortMode = "manual"; qs<HTMLSelectElement>("#photoSort").value = "manual"; scannedInput = source; renderPhotoGrid(); appendLog(`Photo Workspace loaded ${photos.length} supported image(s).`); } catch (error) { photos = []; workspaceVisiblePaths = null; scannedInput = ""; renderPhotoGrid(); appendLog(String(error), "stderr"); } }
async function pickInputFolder(andScan = false): Promise<void> { const value = await open({ directory: true, multiple: false, title: "Choose photo folder" }); if (typeof value !== "string") return; inputPath = value; setPath(inputPathEl, inputPath, "Choose a folder containing your night-sky photos"); qs<HTMLElement>("#photoSourcePath").textContent = inputPath; updateStartState(); if (andScan) { setSection("photos"); await scanPhotos(value); } }
async function pickOutputFolder(): Promise<void> { const value = await open({ directory: true, multiple: false, title: "Choose output folder" }); if (typeof value !== "string") return; setOutputPath(value); }

function wireEvents(): void {
  document.querySelectorAll<HTMLButtonElement>(".section-tab").forEach((button) => button.addEventListener("click", () => setSection(button.dataset.section as Section)));
  document.querySelectorAll<HTMLButtonElement>(".mode-tab").forEach((button) => button.addEventListener("click", () => updateMode(button.dataset.mode as Mode)));
  qs<HTMLButtonElement>("#pickInput").addEventListener("click", () => void pickInputFolder(false));
  qs<HTMLButtonElement>("#scanFromProcess").addEventListener("click", async () => { if (!inputPath) await pickInputFolder(true); else { setSection("photos"); await scanPhotos(); } });
  qs<HTMLButtonElement>("#pickOutput").addEventListener("click", () => void pickOutputFolder()); qs<HTMLButtonElement>("#openOutput").addEventListener("click", () => { if (outputPath) void openPath(outputPath); });
  qs<HTMLButtonElement>("#workspacePickOutput").addEventListener("click", () => void pickOutputFolder()); qs<HTMLButtonElement>("#workspaceOpenOutput").addEventListener("click", () => { if (outputPath) void openPath(outputPath); });
  qs<HTMLButtonElement>("#chooseAndScan").addEventListener("click", () => void pickInputFolder(true)); qs<HTMLButtonElement>("#rescanPhotos").addEventListener("click", () => void scanPhotos(scannedInput || inputPath));
  qs<HTMLSelectElement>("#photoSort").addEventListener("change", (event) => sortPhotos((event.target as HTMLSelectElement).value as SortMode));
  qs<HTMLButtonElement>("#selectAllPhotos").addEventListener("click", () => { selectedPaths = new Set(photos.map((photo) => photo.path)); selectionAnchor = photos.length ? 0 : null; renderPhotoGrid(); });
  qs<HTMLButtonElement>("#clearPhotoSelection").addEventListener("click", () => { selectedPaths.clear(); selectionAnchor = null; renderPhotoGrid(); });
  qs<HTMLButtonElement>("#invertPhotoSelection").addEventListener("click", () => { selectedPaths = new Set(photos.filter((photo) => !selectedPaths.has(photo.path)).map((photo) => photo.path)); renderPhotoGrid(); });
  qs<HTMLButtonElement>("#includeSelected").addEventListener("click", () => setIncludedForSelection(true)); qs<HTMLButtonElement>("#excludeSelected").addEventListener("click", () => setIncludedForSelection(false));
  qs<HTMLInputElement>("#allIncluded").addEventListener("change", (event) => {
    const included = (event.target as HTMLInputElement).checked;
    visiblePhotos().forEach((photo) => { photo.included = included; });
    renderPhotoGrid();
  });
  window.addEventListener("tihulu:workspace-visible-scope", (event) => {
    const detail = (event as CustomEvent<{ paths?: string[]; includeAll?: boolean; excludeOutside?: boolean }>).detail;
    applyVisibleWorkspaceScope(Array.isArray(detail?.paths) ? detail.paths : [], detail?.includeAll === true, detail?.excludeOutside === true);
  });
  qs<HTMLInputElement>("#workspaceRecursive").addEventListener("change", () => { qs<HTMLInputElement>("#recursive").checked = qs<HTMLInputElement>("#workspaceRecursive").checked; }); qs<HTMLInputElement>("#recursive").addEventListener("change", () => { qs<HTMLInputElement>("#workspaceRecursive").checked = qs<HTMLInputElement>("#recursive").checked; });
  qs<HTMLInputElement>("#useWorkspaceSelection").addEventListener("change", updateStartState); qs<HTMLButtonElement>("#goToProcess").addEventListener("click", () => setSection("process"));
  qs<HTMLButtonElement>("#startJob").addEventListener("click", () => void startJob()); qs<HTMLButtonElement>("#stopJob").addEventListener("click", async () => { try { await invoke("stop_job"); appendLog("Stop requested."); } catch (error) { appendLog(String(error), "stderr"); } });
  qs<HTMLButtonElement>("#toggleConsole").addEventListener("click", () => consoleCard.classList.toggle("hidden")); qs<HTMLButtonElement>("#clearConsole").addEventListener("click", () => { consoleBody.innerHTML = '<span class="console-muted">No job output yet.</span>'; logHasContent = false; });
  qs<HTMLButtonElement>("#brandButton").addEventListener("click", () => void openUrl("https://github.com/Tihulu/GUI4tihulu-star-trail")); qs<HTMLButtonElement>("#footerRepo").addEventListener("click", () => void openUrl("https://github.com/Tihulu/GUI4tihulu-star-trail"));
  qs<HTMLButtonElement>("#enginePill").addEventListener("click", () => void detectEngine()); qs<HTMLButtonElement>("#recheckEngine").addEventListener("click", () => void detectEngine());
  qs<HTMLButtonElement>("#pickExecutable").addEventListener("click", async () => { const value = await open({ multiple: false, directory: false, title: "Choose tihulu executable" }); if (typeof value === "string") { customExecutable.value = value; await detectEngine(); } });
  qs<HTMLElement>("#linkMode").querySelectorAll<HTMLButtonElement>("button").forEach((button) => button.addEventListener("click", () => { selectedLinkMode = button.dataset.value as LinkMode; qs<HTMLElement>("#linkMode").querySelectorAll("button").forEach((item) => item.classList.toggle("selected", item === button)); }));
  qs<HTMLButtonElement>("#launchDesktop").addEventListener("click", async () => { try { const pid = await invoke<number>("launch_original_desktop", { customExecutable: customExecutable.value.trim() || engine.path }); appendLog(`Original Tihulu Desktop launched (PID ${pid}).`); } catch (error) { appendLog(String(error), "stderr"); } });
  qs<HTMLButtonElement>("#launchLocalWeb").addEventListener("click", async () => { try { const result = await invoke<UiLaunch>("launch_local_ui", { customExecutable: customExecutable.value.trim() || engine.path }); qs<HTMLElement>("#localWebStatus").textContent = `Running · PID ${result.pid} · ${result.url}`; appendLog(`Local Tihulu UI: ${result.url}`); await openUrl(result.url); } catch (error) { appendLog(String(error), "stderr"); } });
  qs<HTMLButtonElement>("#stopLocalWeb").addEventListener("click", async () => { try { await invoke("stop_local_ui"); qs<HTMLElement>("#localWebStatus").textContent = "Not running"; appendLog("Local Tihulu UI stopped."); } catch (error) { appendLog(String(error), "stderr"); } });
  qs<HTMLButtonElement>("#launchHostedWeb").addEventListener("click", () => void openUrl("https://tihulu.github.io/tihulu-star-trail/")); qs<HTMLButtonElement>("#reloadHosted").addEventListener("click", () => { const frame = qs<HTMLIFrameElement>("#hostedFrame"); frame.src = frame.src; });
}
async function setupListeners(): Promise<void> { await listen<LogPayload>("job-log", (event) => appendLog(event.payload.line, event.payload.stream)); await listen<JobFinished>("job-finished", (event) => { setRunning(false); const label = event.payload.success ? "Job completed successfully." : `Job failed${event.payload.code === null ? "" : ` (exit ${event.payload.code})`}.`; appendLog(label, event.payload.success ? "system" : "stderr"); runStateText.textContent = label; }); }

wireEvents(); updateMode("run"); renderPhotoGrid(); setPath(inputPathEl, "", "Choose a folder containing your night-sky photos"); setPath(outputPathEl, "", "Choose where generated files should be saved"); void setupListeners(); void detectEngine();
