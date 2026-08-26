// SPDX-License-Identifier: AGPL-3.0-only
import { invoke } from "@tauri-apps/api/core";

type HardwareMode = "auto" | "cpu" | "gpu" | "hybrid";
type JobMode = "run" | "group" | "trail" | "timelapse";
type HardwareKind = "group" | "trail" | "timelapse";
type HardwarePolicies = {
  groupHardware: HardwareMode;
  trailHardware: HardwareMode;
  timelapseHardware: HardwareMode;
};

let replayingStartClick = false;
let lastLockedPolicies: HardwarePolicies | null = null;
let lastLaunchedMode: JobMode = "run";
let stoppedSilentFallback = false;

function qs<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function activeMode(): JobMode {
  const value = qs<HTMLButtonElement>(".mode-tab.active")?.dataset.mode;
  return value === "group" || value === "trail" || value === "timelapse" ? value : "run";
}

function selectedHardware(id: string): HardwareMode {
  const value = qs<HTMLButtonElement>(`#${id} button.selected`)?.dataset.value;
  return value === "cpu" || value === "gpu" || value === "hybrid" ? value : "auto";
}

function currentPolicies(): HardwarePolicies {
  return {
    groupHardware: selectedHardware("groupHardwarePolicy"),
    trailHardware: selectedHardware("trailHardwarePolicy"),
    timelapseHardware: selectedHardware("timelapseHardwarePolicy"),
  };
}

function policyFor(kind: HardwareKind): HardwareMode {
  const policies = lastLockedPolicies ?? currentPolicies();
  if (kind === "group") return policies.groupHardware;
  if (kind === "trail") return policies.trailHardware;
  return policies.timelapseHardware;
}

function toast(message: string): void {
  let node = qs<HTMLDivElement>("#studioToast");
  if (!node) {
    node = document.createElement("div");
    node.id = "studioToast";
    node.className = "studio-toast";
    document.body.append(node);
  }
  node.textContent = message;
  node.classList.add("show");
  window.setTimeout(() => node?.classList.remove("show"), 5200);
}

function appendConsoleError(message: string): void {
  const body = qs<HTMLElement>("#consoleBody");
  if (!body) return;
  const muted = body.querySelector(".console-muted");
  muted?.remove();
  const row = document.createElement("div");
  row.className = "console-line stderr";
  row.textContent = message;
  body.append(row);
  qs<HTMLElement>("#consoleCard")?.classList.remove("hidden");
}

function modeHardwareSummary(policies: HardwarePolicies): string {
  const mode = activeMode();
  if (mode === "group") return `group=${policies.groupHardware}`;
  if (mode === "trail") return `trail=${policies.trailHardware}`;
  if (mode === "timelapse") return `timelapse=${policies.timelapseHardware}`;
  return `group=${policies.groupHardware}, trail=${policies.trailHardware}, timelapse=${policies.timelapseHardware}`;
}

function installHardwareLaunchBarrier(): boolean {
  const start = qs<HTMLButtonElement>("#startJob");
  if (!start) return false;
  if (start.dataset.hardwareLaunchBarrier === "1") return true;
  start.dataset.hardwareLaunchBarrier = "1";

  start.addEventListener("click", async (event) => {
    if (replayingStartClick) {
      replayingStartClick = false;
      return;
    }

    // Hardware selectors live in a separate feature module and normally push their
    // state asynchronously. Block this launch until the exact visible selection has
    // reached Rust, so a fast GPU -> Start sequence can never race an older Auto state.
    event.preventDefault();
    event.stopImmediatePropagation();

    const policies = currentPolicies();
    try {
      await invoke("set_hardware_policies", { policies });
      lastLockedPolicies = policies;
      lastLaunchedMode = activeMode();
      stoppedSilentFallback = false;
      start.dataset.hardwareLaunchSelection = modeHardwareSummary(policies);
      replayingStartClick = true;
      start.click();
    } catch (error) {
      const message = `Could not lock hardware selection before launch: ${String(error)}`;
      appendConsoleError(message);
      toast("Job was stopped because the selected CPU/GPU policy could not be locked. Nothing was silently changed to Auto.");
    }
  }, { capture: true });
  return true;
}

function classifyCpuBackend(line: string, previousLine: string): HardwareKind | null {
  if (/^Grouping Hardware acceleration:\s*CPU\b/i.test(line)) return "group";
  if (!/Hardware acceleration:\s*CPU\b/i.test(line)) return null;
  if (lastLaunchedMode === "group") return "group";
  if (lastLaunchedMode === "trail") return "trail";
  if (lastLaunchedMode === "timelapse") return "timelapse";
  if (/timelapse/i.test(previousLine)) return "timelapse";
  return "trail";
}

function effectiveNode(kind: HardwareKind): HTMLElement | null {
  const id = kind === "group" ? "groupHardwarePolicyEffective" : kind === "trail" ? "trailHardwarePolicyEffective" : "timelapseHardwarePolicyEffective";
  return qs<HTMLElement>(`#${id}`);
}

function installSilentFallbackGuard(): boolean {
  const body = qs<HTMLElement>("#consoleBody");
  if (!body) return false;
  if (body.dataset.strictHardwareObserved === "1") return true;
  body.dataset.strictHardwareObserved = "1";
  let processed = 0;

  const consume = (): void => {
    const rows = Array.from(body.querySelectorAll<HTMLElement>(".console-line"));
    if (rows.length < processed) processed = 0;
    for (let index = processed; index < rows.length; index += 1) {
      const line = rows[index].textContent?.trim() ?? "";
      const previousLine = index > 0 ? rows[index - 1].textContent?.trim() ?? "" : "";
      const kind = classifyCpuBackend(line, previousLine);
      if (!kind || stoppedSilentFallback) continue;
      const requested = policyFor(kind);
      if (requested !== "gpu" && requested !== "hybrid") continue;

      stoppedSilentFallback = true;
      qs<HTMLButtonElement>("#stopJob")?.click();
      const effective = effectiveNode(kind);
      if (effective) effective.textContent = "Effective backend: CPU · stopped (explicit GPU requested)";
      toast("The engine reported CPU after an explicit GPU request, so the job was stopped. Update tihulu-star-trail; this usually means an older engine or a missing CUDA/OpenCL backend.");
    }
    processed = rows.length;
  };

  new MutationObserver(consume).observe(body, { childList: true, subtree: true, characterData: true });
  consume();
  return true;
}

function processOutputValue(): string {
  const node = qs<HTMLElement>("#outputPath");
  if (!node || node.classList.contains("empty")) return "";
  return node.textContent?.trim() ?? "";
}

function refreshWorkspaceOutput(): void {
  const value = processOutputValue();
  const label = qs<HTMLElement>("#workspaceOutputPath");
  const openButton = qs<HTMLButtonElement>("#workspaceOpenOutput");
  if (label) {
    label.textContent = value || "No output folder selected";
    label.title = value;
    label.classList.toggle("empty", !value);
  }
  if (openButton) openButton.disabled = !value;
}

function installWorkspaceOutputMirror(): boolean {
  const sourceToolbar = qs<HTMLElement>("#section-photos .workspace-toolbar");
  const processOutput = qs<HTMLElement>("#outputPath");
  const processPicker = qs<HTMLButtonElement>("#pickOutput");
  if (!sourceToolbar || !processOutput || !processPicker) return false;

  if (!qs("#workspaceOutputToolbar")) {
    const toolbar = document.createElement("section");
    toolbar.id = "workspaceOutputToolbar";
    toolbar.className = "workspace-toolbar glass-card";
    toolbar.innerHTML = `
      <div class="toolbar-path">
        <span class="toolbar-label">OUTPUT</span>
        <strong id="workspaceOutputPath">No output folder selected</strong>
      </div>
      <div class="toolbar-actions">
        <button class="secondary-button" id="workspacePickOutput" type="button">Choose / change output</button>
        <button class="ghost-button" id="workspaceOpenOutput" type="button" disabled>Open</button>
      </div>`;
    sourceToolbar.insertAdjacentElement("afterend", toolbar);

    qs<HTMLButtonElement>("#workspacePickOutput")?.addEventListener("click", () => {
      // Reuse the Process picker instead of creating a second output-path state.
      // Whichever screen changes the folder therefore updates the same core value.
      processPicker.click();
    });
    qs<HTMLButtonElement>("#workspaceOpenOutput")?.addEventListener("click", () => {
      qs<HTMLButtonElement>("#openOutput")?.click();
    });
  }

  if (processOutput.dataset.workspaceOutputObserved !== "1") {
    processOutput.dataset.workspaceOutputObserved = "1";
    new MutationObserver(refreshWorkspaceOutput).observe(processOutput, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
  refreshWorkspaceOutput();
  return true;
}

function install(): boolean {
  const hardwareReady = installHardwareLaunchBarrier();
  const fallbackReady = installSilentFallbackGuard();
  const outputReady = installWorkspaceOutputMirror();
  return hardwareReady && fallbackReady && outputReady;
}

function start(): void {
  if (install()) return;
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 160) window.clearInterval(timer);
  }, 50);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();

export {};
