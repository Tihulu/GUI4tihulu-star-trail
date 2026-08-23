// SPDX-License-Identifier: AGPL-3.0-only
import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";

type Mode = "run" | "group" | "trail" | "timelapse";

type EngineInfo = {
  found: boolean;
  path: string | null;
  detail: string;
};

type LogPayload = {
  stream: "stdout" | "stderr";
  line: string;
};

type JobFinished = {
  success: boolean;
  code: number | null;
};

type StartResult = {
  pid: number;
  commandDisplay: string;
};

type JobRequest = {
  command: Mode;
  input: string;
  output: string;
  executable: string | null;
  threshold: number;
  minMatches: number;
  maxSide: number;
  nfeatures: number;
  timeMetadata: boolean;
  timeWindowMinutes: number;
  recursive: boolean;
  quiet: boolean;
  linkMode: "symlink" | "copy" | "hardlink" | "none";
  minFrames: number;
  jpegQuality: number;
  timelapse: boolean;
  fps: number;
  videoMaxSide: number;
  codec: string;
};

const modes: Record<Mode, { title: string; description: string; action: string }> = {
  run: {
    title: "Full run",
    description: "Group a night of frames and render one trail for every detected camera angle.",
    action: "Build star trails",
  },
  group: {
    title: "Group only",
    description: "Detect repeated camera angles and organize the frames without rendering trails.",
    action: "Group photos",
  },
  trail: {
    title: "Trail render",
    description: "Lighten-stack a folder, or render every group from an existing grouped output.",
    action: "Render trails",
  },
  timelapse: {
    title: "Timelapse",
    description: "Turn a folder or grouped output into MP4 timelapse video.",
    action: "Render timelapse",
  },
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app root");

app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <button class="brand" id="brandButton" aria-label="Open project on GitHub">
        <span class="brand-mark" aria-hidden="true">
          <span class="orbit orbit-a"></span>
          <span class="orbit orbit-b"></span>
          <span class="star-core"></span>
        </span>
        <span class="brand-copy">
          <strong>Tihulu Star Trail</strong>
          <small>Desktop Studio</small>
        </span>
      </button>
      <div class="topbar-actions">
        <button class="engine-pill checking" id="enginePill" type="button" title="Check tihulu engine">
          <span class="status-dot"></span>
          <span id="engineText">Checking engine…</span>
        </button>
        <button class="icon-button" id="toggleConsole" type="button" aria-label="Toggle activity console" title="Activity console">
          <span class="terminal-icon">›_</span>
        </button>
      </div>
    </header>

    <main class="workspace">
      <section class="intro">
        <div>
          <p class="eyebrow">LOCAL ASTROPHOTOGRAPHY WORKFLOW</p>
          <h1 id="modeTitle">Full run</h1>
          <p class="lede" id="modeDescription">${modes.run.description}</p>
        </div>
        <div class="privacy-chip">
          <span class="lock-dot"></span>
          Processing stays on this computer
        </div>
      </section>

      <nav class="mode-tabs" aria-label="Processing mode">
        <button class="mode-tab active" data-mode="run" type="button"><span>01</span> Full run</button>
        <button class="mode-tab" data-mode="group" type="button"><span>02</span> Group</button>
        <button class="mode-tab" data-mode="trail" type="button"><span>03</span> Trail</button>
        <button class="mode-tab" data-mode="timelapse" type="button"><span>04</span> Timelapse</button>
      </nav>

      <section class="path-grid">
        <article class="path-card">
          <div class="path-card-head">
            <div class="path-icon">↳</div>
            <div>
              <small>INPUT</small>
              <h2>Source frames</h2>
            </div>
          </div>
          <div class="path-value empty" id="inputPath">Choose a folder containing your night-sky photos</div>
          <button class="secondary-button" id="pickInput" type="button">Choose input folder</button>
        </article>

        <article class="path-card">
          <div class="path-card-head">
            <div class="path-icon output">↗</div>
            <div>
              <small>OUTPUT</small>
              <h2 id="outputHeading">Project output</h2>
            </div>
          </div>
          <div class="path-value empty" id="outputPath">Choose where generated files should be saved</div>
          <div class="button-row">
            <button class="secondary-button" id="pickOutput" type="button">Choose output folder</button>
            <button class="ghost-button" id="openOutput" type="button" disabled>Open</button>
          </div>
        </article>
      </section>

      <section class="control-card">
        <div class="control-card-main">
          <div class="control-copy">
            <span class="step-label">READY WHEN YOU ARE</span>
            <strong id="actionTitle">Build star trails</strong>
            <p id="actionHint">Uses the installed <code>tihulu</code> engine with safe defaults. Open advanced controls only when you need to tune grouping or rendering.</p>
          </div>
          <div class="primary-actions">
            <button class="stop-button hidden" id="stopJob" type="button">Stop</button>
            <button class="primary-button" id="startJob" type="button" disabled>
              <span id="startLabel">Build star trails</span>
              <span class="button-arrow">→</span>
            </button>
          </div>
        </div>
        <div class="run-state hidden" id="runState">
          <span class="spinner"></span>
          <div>
            <strong>Processing</strong>
            <span id="runStateText">Starting tihulu…</span>
          </div>
        </div>
      </section>

      <details class="advanced-card" id="advancedCard">
        <summary>
          <span>
            <strong>Advanced controls</strong>
            <small>Grouping, stack quality, timelapse and engine settings</small>
          </span>
          <span class="chevron">⌄</span>
        </summary>
        <div class="advanced-body">
          <div class="settings-section" data-show="run,group">
            <div class="settings-title">
              <span>Grouping</span>
              <small>Camera-angle matching</small>
            </div>
            <div class="settings-grid four">
              <label class="field">
                <span>Threshold</span>
                <input id="threshold" type="number" min="0" max="1" step="0.01" value="0.42" />
                <small>Higher is stricter</small>
              </label>
              <label class="field">
                <span>Min. matches</span>
                <input id="minMatches" type="number" min="4" step="1" value="18" />
                <small>Geometric features</small>
              </label>
              <label class="field">
                <span>Analysis max side</span>
                <input id="maxSide" type="number" min="128" step="1" value="1000" />
                <small>Pixels</small>
              </label>
              <label class="field">
                <span>ORB features</span>
                <input id="nfeatures" type="number" min="100" step="100" value="2500" />
                <small>Per frame</small>
              </label>
            </div>
            <div class="switch-row">
              <label class="switch-field">
                <input id="timeMetadata" type="checkbox" />
                <span class="switch"></span>
                <span><strong>Use capture time</strong><small>Require nearby EXIF/file times when grouping</small></span>
              </label>
              <label class="field compact">
                <span>Time window</span>
                <div class="input-with-unit"><input id="timeWindowHours" type="number" min="0" step="0.25" value="6" /><span>hours</span></div>
              </label>
            </div>
          </div>

          <div class="settings-section" data-show="run,group">
            <div class="settings-title"><span>Grouped output</span><small>How source frames are represented</small></div>
            <div class="segmented" id="linkMode" role="radiogroup" aria-label="Link mode">
              <button type="button" data-value="copy" class="selected">Copy</button>
              <button type="button" data-value="symlink">Symlink</button>
              <button type="button" data-value="hardlink">Hardlink</button>
              <button type="button" data-value="none">Manifest only</button>
            </div>
          </div>

          <div class="settings-section" data-show="run,trail,timelapse">
            <div class="settings-title"><span>Render</span><small>Output quality and minimum sequence length</small></div>
            <div class="settings-grid three">
              <label class="field">
                <span>Minimum frames</span>
                <input id="minFrames" type="number" min="2" step="1" value="2" />
              </label>
              <label class="field" data-show="run,trail">
                <span>JPEG quality</span>
                <input id="jpegQuality" type="number" min="1" max="100" step="1" value="95" />
              </label>
              <label class="switch-field inline-switch" data-show="run,trail,timelapse">
                <input id="recursive" type="checkbox" checked />
                <span class="switch"></span>
                <span><strong>Recursive scan</strong><small>Include subfolders</small></span>
              </label>
            </div>
          </div>

          <div class="settings-section" data-show="run,timelapse">
            <div class="settings-title"><span>Timelapse</span><small>MP4 export settings</small></div>
            <label class="switch-field timelapse-toggle" data-show="run">
              <input id="makeTimelapse" type="checkbox" />
              <span class="switch"></span>
              <span><strong>Also render timelapse</strong><small>Create one video per detected group during Full run</small></span>
            </label>
            <div class="settings-grid three timelapse-fields">
              <label class="field">
                <span>Frames / second</span>
                <input id="fps" type="number" min="0.1" step="0.1" value="24" />
              </label>
              <label class="field">
                <span>Video max side</span>
                <input id="videoMaxSide" type="number" min="0" step="1" value="1920" />
                <small>0 keeps original size</small>
              </label>
              <label class="field">
                <span>Codec</span>
                <input id="codec" type="text" maxlength="4" value="mp4v" />
              </label>
            </div>
          </div>

          <div class="settings-section engine-settings">
            <div class="settings-title"><span>Engine</span><small>Normally detected automatically</small></div>
            <div class="engine-path-row">
              <label class="field grow">
                <span>Custom tihulu executable</span>
                <input id="customExecutable" type="text" placeholder="Auto-detect from PATH or standard install locations" />
              </label>
              <button class="secondary-button fit" id="pickExecutable" type="button">Browse</button>
              <button class="ghost-button fit" id="recheckEngine" type="button">Recheck</button>
            </div>
            <label class="switch-field">
              <input id="quiet" type="checkbox" />
              <span class="switch"></span>
              <span><strong>Quiet engine output</strong><small>Hide tihulu progress messages; final status still appears here</small></span>
            </label>
          </div>
        </div>
      </details>

      <section class="console-card hidden" id="consoleCard" aria-live="polite">
        <div class="console-head">
          <div>
            <span class="console-light red"></span><span class="console-light amber"></span><span class="console-light green"></span>
            <strong>Activity</strong>
          </div>
          <button class="ghost-button fit" id="clearConsole" type="button">Clear</button>
        </div>
        <div class="console-body" id="consoleBody"><span class="console-muted">No job output yet.</span></div>
      </section>
    </main>

    <footer class="footer">
      <span>GUI4tihulu-star-trail · AGPL-3.0-only</span>
      <button id="footerRepo" type="button">Source & license ↗</button>
    </footer>
  </div>
`;

function qs<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

const inputPathEl = qs<HTMLDivElement>("#inputPath");
const outputPathEl = qs<HTMLDivElement>("#outputPath");
const startJobButton = qs<HTMLButtonElement>("#startJob");
const stopJobButton = qs<HTMLButtonElement>("#stopJob");
const openOutputButton = qs<HTMLButtonElement>("#openOutput");
const enginePill = qs<HTMLButtonElement>("#enginePill");
const engineText = qs<HTMLSpanElement>("#engineText");
const consoleCard = qs<HTMLElement>("#consoleCard");
const consoleBody = qs<HTMLDivElement>("#consoleBody");
const customExecutable = qs<HTMLInputElement>("#customExecutable");
const runState = qs<HTMLDivElement>("#runState");
const runStateText = qs<HTMLSpanElement>("#runStateText");

let mode: Mode = "run";
let inputPath = "";
let outputPath = "";
let engineFound = false;
let running = false;
let selectedLinkMode: JobRequest["linkMode"] = navigator.userAgent.includes("Windows") ? "copy" : "symlink";
let logHasContent = false;

function numberValue(id: string): number {
  return Number(qs<HTMLInputElement>(`#${id}`).value);
}

function checked(id: string): boolean {
  return qs<HTMLInputElement>(`#${id}`).checked;
}

function setPath(element: HTMLDivElement, value: string, emptyText: string): void {
  element.textContent = value || emptyText;
  element.classList.toggle("empty", !value);
  element.title = value;
}

function updateStartState(): void {
  startJobButton.disabled = running || !engineFound || !inputPath || !outputPath;
  openOutputButton.disabled = !outputPath;
}

function setRunning(next: boolean): void {
  running = next;
  stopJobButton.classList.toggle("hidden", !next);
  runState.classList.toggle("hidden", !next);
  startJobButton.classList.toggle("running", next);
  qs<HTMLSpanElement>("#startLabel").textContent = next ? "Processing…" : modes[mode].action;
  updateStartState();
}

function showConsole(): void {
  consoleCard.classList.remove("hidden");
  consoleCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function appendLog(line: string, stream: "stdout" | "stderr" | "system" = "system"): void {
  if (!logHasContent) {
    consoleBody.replaceChildren();
    logHasContent = true;
  }
  const row = document.createElement("div");
  row.className = `console-line ${stream}`;
  const prefix = document.createElement("span");
  prefix.className = "console-prefix";
  prefix.textContent = stream === "system" ? "◆" : stream === "stderr" ? "›" : "·";
  const text = document.createElement("span");
  text.textContent = line;
  row.append(prefix, text);
  consoleBody.append(row);
  while (consoleBody.children.length > 1000) consoleBody.firstElementChild?.remove();
  consoleBody.scrollTop = consoleBody.scrollHeight;
}

function modeVisible(list: string | undefined): boolean {
  return !list || list.split(",").includes(mode);
}

function updateMode(): void {
  document.querySelectorAll<HTMLButtonElement>(".mode-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.mode === mode);
  });
  qs<HTMLHeadingElement>("#modeTitle").textContent = modes[mode].title;
  qs<HTMLParagraphElement>("#modeDescription").textContent = modes[mode].description;
  qs<HTMLElement>("#actionTitle").textContent = modes[mode].action;
  qs<HTMLSpanElement>("#startLabel").textContent = running ? "Processing…" : modes[mode].action;
  qs<HTMLHeadingElement>("#outputHeading").textContent = mode === "group" ? "Grouped output" : mode === "timelapse" ? "Video output" : "Project output";
  document.querySelectorAll<HTMLElement>("[data-show]").forEach((element) => {
    element.classList.toggle("mode-hidden", !modeVisible(element.dataset.show));
  });
}

function buildRequest(): JobRequest {
  const threshold = numberValue("threshold");
  const minMatches = numberValue("minMatches");
  const maxSide = numberValue("maxSide");
  const nfeatures = numberValue("nfeatures");
  const timeWindowHours = numberValue("timeWindowHours");
  const minFrames = numberValue("minFrames");
  const jpegQuality = numberValue("jpegQuality");
  const fps = numberValue("fps");
  const videoMaxSide = numberValue("videoMaxSide");
  const codec = qs<HTMLInputElement>("#codec").value.trim();

  if (!(threshold >= 0 && threshold <= 1)) throw new Error("Threshold must be between 0 and 1.");
  if (!Number.isFinite(minMatches) || minMatches < 4) throw new Error("Minimum matches must be at least 4.");
  if (!Number.isFinite(maxSide) || maxSide < 128) throw new Error("Analysis max side must be at least 128 pixels.");
  if (!Number.isFinite(nfeatures) || nfeatures < 100) throw new Error("ORB features must be at least 100.");
  if (!Number.isFinite(timeWindowHours) || timeWindowHours < 0) throw new Error("Time window cannot be negative.");
  if (!Number.isFinite(minFrames) || minFrames < 2) throw new Error("Minimum frames must be at least 2.");
  if (!(jpegQuality >= 1 && jpegQuality <= 100)) throw new Error("JPEG quality must be between 1 and 100.");
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("FPS must be greater than 0.");
  if (!Number.isFinite(videoMaxSide) || videoMaxSide < 0) throw new Error("Video max side cannot be negative.");
  if (codec.length !== 4) throw new Error("Codec must be exactly four characters, for example mp4v.");

  return {
    command: mode,
    input: inputPath,
    output: outputPath,
    executable: customExecutable.value.trim() || null,
    threshold,
    minMatches: Math.trunc(minMatches),
    maxSide: Math.trunc(maxSide),
    nfeatures: Math.trunc(nfeatures),
    timeMetadata: checked("timeMetadata"),
    timeWindowMinutes: timeWindowHours * 60,
    recursive: checked("recursive"),
    quiet: checked("quiet"),
    linkMode: selectedLinkMode,
    minFrames: Math.trunc(minFrames),
    jpegQuality: Math.trunc(jpegQuality),
    timelapse: mode === "run" && checked("makeTimelapse"),
    fps,
    videoMaxSide: Math.trunc(videoMaxSide),
    codec,
  };
}

async function checkEngine(): Promise<void> {
  enginePill.className = "engine-pill checking";
  engineText.textContent = "Checking engine…";
  engineFound = false;
  updateStartState();
  try {
    const info = await invoke<EngineInfo>("detect_engine", {
      customExecutable: customExecutable.value.trim() || null,
    });
    engineFound = info.found;
    enginePill.className = `engine-pill ${info.found ? "ready" : "missing"}`;
    engineText.textContent = info.found ? "Engine ready" : "Engine missing";
    enginePill.title = info.path ? `${info.detail}\n${info.path}` : info.detail;
    if (info.path && !customExecutable.value) customExecutable.placeholder = info.path;
    if (!info.found) {
      appendLog("tihulu was not found. Use the one-line installer from the repository or choose a custom executable in Advanced controls.", "system");
    }
  } catch (error) {
    enginePill.className = "engine-pill missing";
    engineText.textContent = "Engine check failed";
    appendLog(String(error), "system");
  }
  updateStartState();
}

async function chooseFolder(kind: "input" | "output"): Promise<void> {
  const selected = await open({ directory: true, multiple: false, title: kind === "input" ? "Choose source frames" : "Choose output folder" });
  if (typeof selected !== "string") return;
  if (kind === "input") {
    inputPath = selected;
    setPath(inputPathEl, inputPath, "Choose a folder containing your night-sky photos");
  } else {
    outputPath = selected;
    setPath(outputPathEl, outputPath, "Choose where generated files should be saved");
  }
  updateStartState();
}

async function startJob(): Promise<void> {
  if (running) return;
  try {
    const request = buildRequest();
    showConsole();
    appendLog(`Starting ${modes[mode].title.toLowerCase()}…`, "system");
    setRunning(true);
    const result = await invoke<StartResult>("start_job", { request });
    runStateText.textContent = `PID ${result.pid}`;
    appendLog(result.commandDisplay, "system");
  } catch (error) {
    setRunning(false);
    appendLog(`Could not start: ${String(error)}`, "system");
    showConsole();
  }
}

async function stopJob(): Promise<void> {
  if (!running) return;
  stopJobButton.disabled = true;
  try {
    await invoke("stop_job");
    appendLog("Stop requested…", "system");
  } catch (error) {
    appendLog(`Could not stop process: ${String(error)}`, "system");
  } finally {
    stopJobButton.disabled = false;
  }
}

function savePreferences(): void {
  const data = {
    customExecutable: customExecutable.value,
    linkMode: selectedLinkMode,
    threshold: qs<HTMLInputElement>("#threshold").value,
    minMatches: qs<HTMLInputElement>("#minMatches").value,
    maxSide: qs<HTMLInputElement>("#maxSide").value,
    nfeatures: qs<HTMLInputElement>("#nfeatures").value,
    timeMetadata: checked("timeMetadata"),
    timeWindowHours: qs<HTMLInputElement>("#timeWindowHours").value,
    minFrames: qs<HTMLInputElement>("#minFrames").value,
    jpegQuality: qs<HTMLInputElement>("#jpegQuality").value,
    recursive: checked("recursive"),
    makeTimelapse: checked("makeTimelapse"),
    fps: qs<HTMLInputElement>("#fps").value,
    videoMaxSide: qs<HTMLInputElement>("#videoMaxSide").value,
    codec: qs<HTMLInputElement>("#codec").value,
  };
  localStorage.setItem("tihulu-gui-preferences-v1", JSON.stringify(data));
}

function loadPreferences(): void {
  try {
    const raw = localStorage.getItem("tihulu-gui-preferences-v1");
    if (!raw) return;
    const data = JSON.parse(raw) as Record<string, unknown>;
    const values = ["customExecutable", "threshold", "minMatches", "maxSide", "nfeatures", "timeWindowHours", "minFrames", "jpegQuality", "fps", "videoMaxSide", "codec"];
    for (const id of values) {
      if (typeof data[id] === "string") qs<HTMLInputElement>(`#${id}`).value = data[id] as string;
    }
    for (const id of ["timeMetadata", "recursive", "makeTimelapse"]) {
      if (typeof data[id] === "boolean") qs<HTMLInputElement>(`#${id}`).checked = data[id] as boolean;
    }
    if (["copy", "symlink", "hardlink", "none"].includes(String(data.linkMode))) {
      selectedLinkMode = data.linkMode as JobRequest["linkMode"];
    }
  } catch {
    localStorage.removeItem("tihulu-gui-preferences-v1");
  }
  document.querySelectorAll<HTMLButtonElement>("#linkMode button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.value === selectedLinkMode);
  });
}

document.querySelectorAll<HTMLButtonElement>(".mode-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (running) return;
    mode = tab.dataset.mode as Mode;
    updateMode();
  });
});

qs<HTMLButtonElement>("#pickInput").addEventListener("click", () => void chooseFolder("input"));
qs<HTMLButtonElement>("#pickOutput").addEventListener("click", () => void chooseFolder("output"));
startJobButton.addEventListener("click", () => void startJob());
stopJobButton.addEventListener("click", () => void stopJob());
enginePill.addEventListener("click", () => void checkEngine());
qs<HTMLButtonElement>("#recheckEngine").addEventListener("click", () => void checkEngine());
qs<HTMLButtonElement>("#toggleConsole").addEventListener("click", () => consoleCard.classList.toggle("hidden"));
qs<HTMLButtonElement>("#clearConsole").addEventListener("click", () => {
  logHasContent = false;
  consoleBody.innerHTML = '<span class="console-muted">No job output yet.</span>';
});
openOutputButton.addEventListener("click", () => {
  if (outputPath) void openPath(outputPath);
});
qs<HTMLButtonElement>("#pickExecutable").addEventListener("click", async () => {
  const selected = await open({ directory: false, multiple: false, title: "Choose tihulu executable" });
  if (typeof selected !== "string") return;
  customExecutable.value = selected;
  savePreferences();
  void checkEngine();
});
customExecutable.addEventListener("change", () => {
  savePreferences();
  void checkEngine();
});

document.querySelectorAll<HTMLButtonElement>("#linkMode button").forEach((button) => {
  button.addEventListener("click", () => {
    selectedLinkMode = button.dataset.value as JobRequest["linkMode"];
    document.querySelectorAll<HTMLButtonElement>("#linkMode button").forEach((item) => item.classList.toggle("selected", item === button));
    savePreferences();
  });
});

document.querySelectorAll<HTMLInputElement>(".advanced-body input").forEach((input) => input.addEventListener("change", savePreferences));

const openRepository = () => void openUrl("https://github.com/Tihulu/GUI4tihulu-star-trail");
qs<HTMLButtonElement>("#brandButton").addEventListener("click", openRepository);
qs<HTMLButtonElement>("#footerRepo").addEventListener("click", openRepository);

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !startJobButton.disabled) {
    event.preventDefault();
    void startJob();
  }
});

void listen<LogPayload>("job-log", ({ payload }) => {
  appendLog(payload.line, payload.stream);
  if (payload.line.trim()) runStateText.textContent = payload.line.length > 80 ? `${payload.line.slice(0, 77)}…` : payload.line;
});

void listen<JobFinished>("job-finished", ({ payload }) => {
  setRunning(false);
  runStateText.textContent = "";
  appendLog(payload.success ? "Finished successfully." : `Process ended with ${payload.code === null ? "no exit code" : `exit code ${payload.code}`}.`, "system");
});

loadPreferences();
updateMode();
updateStartState();
void checkEngine();
