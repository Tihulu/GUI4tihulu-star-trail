// SPDX-License-Identifier: AGPL-3.0-only
import "./workflow-polish.css";

type QuickMode = "trail" | "timelapse";
type LinkMode = "copy" | "symlink" | "hardlink" | "none";

function qs<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
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
  const renderSection = Array.from(document.querySelectorAll<HTMLElement>(".settings-section"))
    .find((section) => section.querySelector("#jpegQuality"));
  const timelapseSection = Array.from(document.querySelectorAll<HTMLElement>(".settings-section"))
    .find((section) => section.querySelector("#fps"));

  if (renderSection && !qs("#trailOutputName")) {
    const field = document.createElement("label");
    field.className = "field workflow-output-name";
    field.dataset.show = "trail";
    field.innerHTML = `<span>Trail output name</span><input id="trailOutputName" type="text" maxlength="120" value="star_trail" autocomplete="off"><small>.jpg is added automatically. Grouped inputs use this as the base name.</small>`;
    renderSection.append(field);
  }
  if (timelapseSection && !qs("#timelapseOutputName")) {
    const field = document.createElement("label");
    field.className = "field workflow-output-name";
    field.dataset.show = "timelapse";
    field.innerHTML = `<span>Timelapse output name</span><input id="timelapseOutputName" type="text" maxlength="120" value="timelapse" autocomplete="off"><small>.mp4 is added automatically. Grouped inputs use this as the base name.</small>`;
    timelapseSection.append(field);
  }

  ["trailOutputName", "timelapseOutputName"].forEach((id) => {
    const input = qs<HTMLInputElement>(`#${id}`);
    input?.addEventListener("input", () => input.classList.toggle("workflow-field-error", !validOutputStem(input.value)));
  });

  // main.ts applies data-show only when mode changes. Re-apply the current mode
  // after dynamically inserting these fields so they are correct immediately.
  qs<HTMLButtonElement>(".mode-tab.active")?.click();
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
  trail.textContent = "Trail selected →";
  const timelapse = document.createElement("button");
  timelapse.type = "button";
  timelapse.id = "workspaceTimelapse";
  timelapse.className = "secondary-button fit-primary";
  timelapse.textContent = "Timelapse selected →";

  processButton.remove();
  actions.append(trail, timelapse, processButton);
  footer.append(actions);
  trail.addEventListener("click", () => activateQuickMode("trail"));
  timelapse.addEventListener("click", () => activateQuickMode("timelapse"));
}

function installGroupQuickActions(): void {
  const footer = qs<HTMLElement>(".studio-group-footer");
  const processButton = qs<HTMLButtonElement>("#studioUseGroup");
  if (!footer || !processButton || qs("#studioTrailGroup")) return;

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

  // main.ts defaults to symlink on Unix/macOS and copy on Windows. The old static
  // markup always painted Copy as selected, so the visible state could disagree
  // with the actual value sent to tihulu. Trigger the real button handler once.
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

function install(): boolean {
  if (!qs("#section-photos") || !qs("#advancedCard")) return false;
  installOutputNames();
  installWorkspaceQuickActions();
  installLinkModeHelp();
  installGroupQuickActions();
  return true;
}

function start(): void {
  if (install()) return;
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    installOutputNames();
    installWorkspaceQuickActions();
    installLinkModeHelp();
    installGroupQuickActions();
    if ((qs("#workspaceTrail") && qs("#studioTrailGroup")) || attempts >= 160) window.clearInterval(timer);
  }, 50);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();

export {};
