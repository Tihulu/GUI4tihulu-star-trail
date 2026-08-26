// SPDX-License-Identifier: AGPL-3.0-only
import "./readiness.css";

type Mode = "run" | "group" | "trail" | "timelapse";

const ACTIONS: Record<Mode, string> = {
  run: "Build star trails",
  group: "Group photos",
  trail: "Render trails",
  timelapse: "Render timelapse",
};
const CAPABILITY_MESSAGES = [
  "too old for separate CPU/GPU/GPU+CPU controls",
  "does not expose the required hardware-policy controls",
];

function qs<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function activeMode(): Mode {
  const value = qs<HTMLButtonElement>(".mode-tab.active")?.dataset.mode;
  return value === "group" || value === "trail" || value === "timelapse" ? value : "run";
}

function setTextIfChanged(node: HTMLElement | null, value: string): void {
  if (node && node.textContent !== value) node.textContent = value;
}

function updateCommandLabels(): void {
  const action = ACTIONS[activeMode()];
  setTextIfChanged(qs<HTMLElement>("#actionTitle"), action);
  setTextIfChanged(qs<HTMLElement>("#startLabel"), action);
}

function readinessReasons(): string[] {
  const reasons: string[] = [];
  const enginePill = qs<HTMLElement>("#enginePill");
  const engineText = qs<HTMLElement>("#engineText")?.textContent?.trim() ?? "";
  const input = qs<HTMLElement>("#inputPath");
  const output = qs<HTMLElement>("#outputPath");
  const useSelection = qs<HTMLInputElement>("#useWorkspaceSelection");
  const bridge = qs<HTMLElement>("#selectionBridge");
  const includedText = qs<HTMLElement>("#includedCount")?.textContent ?? "";

  if (enginePill?.classList.contains("checking") || engineText.includes("Checking")) reasons.push("checking tihulu engine");
  else if (enginePill?.classList.contains("missing") || engineText.includes("missing")) reasons.push("install or select tihulu engine");

  if (!input || input.classList.contains("empty")) reasons.push("choose input folder");
  if (!output || output.classList.contains("empty")) reasons.push("choose output folder");

  if (bridge && !bridge.classList.contains("hidden") && useSelection?.checked && /^0\s+included/i.test(includedText)) {
    reasons.push("include at least one workspace frame");
  }
  return reasons;
}

function updateReadiness(): void {
  updateCommandLabels();
  const button = qs<HTMLButtonElement>("#startJob");
  const status = qs<HTMLElement>("#startReadiness");
  if (!button || !status) return;
  const reasons = readinessReasons();
  const className = button.disabled ? "start-readiness waiting" : "start-readiness ready";
  const text = button.disabled
    ? (reasons.length ? `Waiting · ${reasons.join(" · ")}` : "Waiting · another job may already be running")
    : `Ready · ${ACTIONS[activeMode()]}`;
  if (status.className !== className) status.className = className;
  setTextIfChanged(status, text);
}

function installerCommand(): string {
  const windows = navigator.userAgent.includes("Windows");
  return windows
    ? "irm https://raw.githubusercontent.com/Tihulu/GUI4tihulu-star-trail/main/scripts/install.ps1 | iex"
    : "curl -fsSL https://raw.githubusercontent.com/Tihulu/GUI4tihulu-star-trail/main/scripts/install.sh | sh";
}

function openEngineUpdateDialog(): void {
  let overlay = qs<HTMLDivElement>("#engineUpdateOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "engineUpdateOverlay";
    overlay.className = "engine-update-overlay";
    overlay.innerHTML = `
      <section class="engine-update-dialog" role="dialog" aria-modal="true" aria-labelledby="engineUpdateTitle">
        <div class="engine-update-head"><div><p>ENGINE COMPATIBILITY</p><h2 id="engineUpdateTitle">Update tihulu-star-trail</h2></div><button type="button" class="engine-update-close" aria-label="Close">×</button></div>
        <p>The GUI hardware selectors require a tihulu executable that exposes <code>--group-hardware</code>, <code>--trail-hardware</code> and <code>--timelapse-hardware</code>. Recheck first; update only when the detected executable is actually missing those controls.</p>
        <div class="engine-update-command"><code id="engineUpdateCommand"></code><button id="copyEngineUpdate" type="button">Copy</button></div>
        <p class="engine-update-foot">The installer and app prefer the current-user engine before system copies. Reopen the app, then click <strong>Recheck</strong>. Existing source photos and projects are not modified.</p>
      </section>`;
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || (event.target as HTMLElement).closest(".engine-update-close")) overlay?.remove();
    });
    document.body.append(overlay);
  }
  setTextIfChanged(qs<HTMLElement>("#engineUpdateCommand"), installerCommand());
  qs<HTMLButtonElement>("#copyEngineUpdate")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(installerCommand());
      const button = qs<HTMLButtonElement>("#copyEngineUpdate");
      if (button) {
        button.textContent = "Copied";
        window.setTimeout(() => { if (button.textContent !== "Copy") button.textContent = "Copy"; }, 1200);
      }
    } catch {
      // The command remains selectable even when clipboard permission is unavailable.
    }
  }, { once: true });
}

function install(): boolean {
  const startButton = qs<HTMLButtonElement>("#startJob");
  const primaryActions = qs<HTMLElement>(".primary-actions");
  const engineSection = qs<HTMLInputElement>("#customExecutable")?.closest<HTMLElement>(".settings-section");
  if (!startButton || !primaryActions || !engineSection) return false;

  if (!qs("#startReadiness")) {
    const status = document.createElement("small");
    status.id = "startReadiness";
    status.className = "start-readiness waiting";
    primaryActions.append(status);
  }

  if (!qs("#updateEngineHelp")) {
    const row = document.createElement("div");
    row.id = "updateEngineHelp";
    row.className = "engine-update-row";
    row.innerHTML = `<div><strong>Engine compatibility</strong><small>If a non-Auto hardware mode is rejected, recheck the detected tihulu executable first. Update only if that executable is missing the hardware-policy flags.</small></div><button class="secondary-button fit" id="updateEngineButton" type="button">Update engine</button>`;
    engineSection.append(row);
    qs<HTMLButtonElement>("#updateEngineButton")?.addEventListener("click", openEngineUpdateDialog);
  }

  document.querySelectorAll<HTMLButtonElement>(".mode-tab").forEach((button) => button.addEventListener("click", () => window.setTimeout(updateReadiness, 0)));
  ["#pickInput", "#pickOutput", "#recheckEngine", "#chooseAndScan", "#goToProcess"].forEach((selector) => qs<HTMLElement>(selector)?.addEventListener("click", () => window.setTimeout(updateReadiness, 80)));

  const observer = new MutationObserver(updateReadiness);
  ["#startJob", "#enginePill", "#engineText", "#inputPath", "#outputPath", "#selectionBridge", "#includedCount"].forEach((selector) => {
    const node = qs<HTMLElement>(selector);
    if (node) observer.observe(node, { attributes: true, childList: true, characterData: true, subtree: true });
  });

  const consoleBody = qs<HTMLElement>("#consoleBody");
  if (consoleBody) {
    new MutationObserver(() => {
      const text = consoleBody.textContent ?? "";
      if (CAPABILITY_MESSAGES.some((message) => text.includes(message))) qs<HTMLElement>("#updateEngineHelp")?.classList.add("needs-update");
    }).observe(consoleBody, { childList: true, subtree: true, characterData: true });
  }

  updateReadiness();
  return true;
}

function start(): void {
  if (install()) return;
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 120) window.clearInterval(timer);
  }, 50);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
