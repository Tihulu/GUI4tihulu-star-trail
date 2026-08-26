// SPDX-License-Identifier: AGPL-3.0-only
import "./workflow-polish.css";

type QuickMode = "trail" | "timelapse";
type LinkMode = "copy" | "symlink" | "hardlink" | "none";
type Mode = "run" | "group" | QuickMode;

function qs<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function activeMode(): Mode {
  const value = qs<HTMLButtonElement>(".mode-tab.active")?.dataset.mode;
  return value === "group" || value === "trail" || value === "timelapse" ? value : "run";
}

function hasActiveGroup(): boolean {
  return Boolean(qs<HTMLElement>(".studio-group-card.active[data-group-id]"));
}

function activateQuickMode(mode: QuickMode): void {
  const useSelection = qs<HTMLInputElement>("#useWorkspaceSelection");
  if (useSelection && !useSelection.disabled) {
    useSelection.checked = true;
    useSelection.dispatchEvent(new Event("change", { bubbles: true }));
  }
  qs<HTMLButtonElement>(`.mode-tab[data-mode="${mode}"]`)?.click();
  qs<HTMLButtonElement>('.section-tab[data-section="process"]')?.click();
}

function validOutputStem(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== "." && trimmed !== ".." && !/[\\/:*?"<>|]/.test(trimmed);
}

function installOutputNames(): void {
  const trailCard = qs<HTMLElement>("#trailOptionsCard");
  const timelapseCard = qs<HTMLElement>("#timelapseOptionsCard");

  if (trailCard && !qs("#trailOutputName")) {
    const field = document.createElement("label");
    field.className = "field workflow-output-name";
    field.innerHTML = `<span>Trail output name</span><input id="trailOutputName" type="text" maxlength="120" value="star_trail" autocomplete="off"><small>.jpg is added automatically. Grouped inputs use this as the base name.</small>`;
    trailCard.append(field);
  }
  if (timelapseCard && !qs("#timelapseOutputName")) {
    const field = document.createElement("label");
    field.className = "field workflow-output-name";
    field.innerHTML = `<span>Timelapse output name</span><input id="timelapseOutputName" type="text" maxlength="120" value="timelapse" autocomplete="off"><small>.mp4 is added automatically. Grouped inputs use this as the base name.</small>`;
    timelapseCard.append(field);
  }

  ["trailOutputName", "timelapseOutputName"].forEach((id) => {
    const input = qs<HTMLInputElement>(`#${id}`);
    if (!input || input.dataset.outputValidationReady === "1") return;
    input.dataset.outputValidationReady = "1";
    input.addEventListener("input", () => input.classList.toggle("workflow-field-error", !validOutputStem(input.value)));
  });
}

function installWorkspaceQuickActions(): void {
  const footer = qs<HTMLElement>(".workspace-footer-card");
  const processButton = qs<HTMLButtonElement>("#goToProcess");
  if (!footer || !processButton || qs("#workspaceTrail")) return;

  const actions = document.createElement("div");
  actions.className = "workspace-quick-actions";
  const trail = document.createElement("button");
  trail.type = "button";
  trail.id = "workspaceTrail";
  trail.className = "secondary-button fit-primary";
  trail.textContent = "Trail included frames →";
  const timelapse = document.createElement("button");
  timelapse.type = "button";
  timelapse.id = "workspaceTimelapse";
  timelapse.className = "secondary-button fit-primary";
  timelapse.textContent = "Timelapse included frames →";

  processButton.remove();
  actions.append(trail, timelapse, processButton);
  footer.append(actions);
  trail.addEventListener("click", () => activateQuickMode("trail"));
  timelapse.addEventListener("click", () => activateQuickMode("timelapse"));
}

function forceAllFramesExcluded(): void {
  if (!hasActiveGroup()) return;
  const allIncluded = qs<HTMLInputElement>("#allIncluded");
  if (!allIncluded) return;
  allIncluded.checked = true;
  allIncluded.click();
}

function installGroupQuickActions(): void {
  const footer = qs<HTMLElement>(".studio-group-footer");
  const processButton = qs<HTMLButtonElement>("#studioUseGroup");
  if (!footer || !processButton || qs("#studioTrailGroup")) return;

  processButton.addEventListener("click", forceAllFramesExcluded, { capture: true });

  const actions = document.createElement("div");
  actions.className = "studio-group-quick-actions";
  const trail = document.createElement("button");
  trail.type = "button";
  trail.id = "studioTrailGroup";
  trail.className = "secondary-button compact-button";
  trail.textContent = "Trail this group";
  const timelapse = document.createElement("button");
  timelapse.type = "button";
  timelapse.id = "studioTimelapseGroup";
  timelapse.className = "secondary-button compact-button";
  timelapse.textContent = "Timelapse this group";

  processButton.remove();
  actions.append(trail, timelapse, processButton);
  footer.append(actions);

  const useGroup = (mode: QuickMode): void => {
    if (!hasActiveGroup()) {
      processButton.click();
      return;
    }
    qs<HTMLButtonElement>(`.mode-tab[data-mode="${mode}"]`)?.click();
    processButton.click();
  };
  trail.addEventListener("click", () => useGroup("trail"));
  timelapse.addEventListener("click", () => useGroup("timelapse"));
}

function linkModeDescription(mode: LinkMode): string {
  if (mode === "copy") return "Portable and safest: creates independent copies and uses extra disk space.";
  if (mode === "symlink") return navigator.userAgent.includes("Windows")
    ? "References originals without copying. Windows may require Developer Mode or symlink privileges."
    : "References the original files without duplicating image data.";
  if (mode === "hardlink") return "No duplicate image data, but input and output must be on the same filesystem/volume.";
  return "Writes manifests/group metadata only; grouped image files are not materialized.";
}

function installLinkModeHelp(): void {
  const root = qs<HTMLElement>("#linkMode");
  if (!root || qs("#linkModeHelp")) return;

  const initial: LinkMode = navigator.userAgent.includes("Windows") ? "copy" : "symlink";
  root.querySelector<HTMLButtonElement>(`button[data-value="${initial}"]`)?.click();

  const help = document.createElement("div");
  help.id = "linkModeHelp";
  help.className = "link-mode-help";
  root.insertAdjacentElement("afterend", help);

  const refresh = (): void => {
    const selected = root.querySelector<HTMLButtonElement>("button.selected")?.dataset.value as LinkMode | undefined;
    const mode = selected ?? initial;
    help.innerHTML = `<strong>${mode === "none" ? "Manifest only" : mode[0].toUpperCase() + mode.slice(1)}:</strong> ${linkModeDescription(mode)}`;
  };
  root.querySelectorAll<HTMLButtonElement>("button[data-value]").forEach((button) => button.addEventListener("click", refresh));
  refresh();
}

function installModeRequestGuard(): void {
  const start = qs<HTMLButtonElement>("#startJob");
  if (!start || start.dataset.workflowGuardReady === "1") return;
  start.dataset.workflowGuardReady = "1";
  start.addEventListener("click", () => {
    const mode = activeMode();
    if (mode === "run") return;
    const replacements: Array<[string, string]> = mode === "group"
      ? [["minFrames", "2"], ["jpegQuality", "95"], ["fps", "24"], ["codec", "mp4v"]]
      : mode === "trail"
        ? [["threshold", "0.42"], ["minMatches", "18"], ["maxSide", "1000"], ["nfeatures", "2500"], ["timeWindowHours", "6"], ["fps", "24"], ["codec", "mp4v"]]
        : [["threshold", "0.42"], ["minMatches", "18"], ["maxSide", "1000"], ["nfeatures", "2500"], ["timeWindowHours", "6"], ["jpegQuality", "95"]];
    const snapshot: Array<[HTMLInputElement, string]> = [];
    for (const [id, safeValue] of replacements) {
      const input = qs<HTMLInputElement>(`#${id}`);
      if (!input) continue;
      snapshot.push([input, input.value]);
      input.value = safeValue;
    }
    queueMicrotask(() => snapshot.forEach(([input, value]) => { input.value = value; }));
  }, { capture: true });
}

function install(): boolean {
  if (!qs("#section-photos") || !qs("#advancedCard")) return false;
  installOutputNames();
  installWorkspaceQuickActions();
  installLinkModeHelp();
  installGroupQuickActions();
  installModeRequestGuard();
  return Boolean(qs("#trailOutputName") && qs("#timelapseOutputName") && qs("#workspaceTrail") && qs("#studioTrailGroup"));
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
