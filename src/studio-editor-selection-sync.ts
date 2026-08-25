// SPDX-License-Identifier: AGPL-3.0-only

let pulseToken = 0;

function qs<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function hasFrames(): boolean {
  return Boolean(qs("#photoGrid .photo-tile[data-path]"));
}

function editorNeedsSync(): boolean {
  if (!hasFrames()) return false;
  const name = qs<HTMLElement>("#studioEditName")?.textContent?.trim() ?? "";
  const preview = qs<HTMLElement>("#studioEditPreview");
  return !name || name === "No frame selected" || Boolean(preview?.querySelector(".studio-preview-empty"));
}

function pulseEditorObserver(): void {
  const grid = qs<HTMLElement>("#photoGrid");
  if (!grid || !hasFrames()) return;
  pulseToken += 1;
  // Studio Editor intentionally observes only class mutations on #photoGrid and its
  // descendants. Toggling this inert class drives its real closure-local
  // syncFromMainGrid() -> renderEditorForSelection() path without duplicating editor
  // state outside the module.
  grid.classList.toggle("studio-selection-sync-pulse", pulseToken % 2 === 1);
}

function schedulePulse(delayMs = 0): void {
  window.setTimeout(() => {
    pulseEditorObserver();
    // A second task is intentional: main.ts, group filtering and selection helpers can
    // all update tile classes in the first task. Studio Editor should consume the final
    // settled selection rather than an intermediate state.
    window.setTimeout(pulseEditorObserver, 60);
  }, delayMs);
}

function install(): boolean {
  const grid = qs<HTMLElement>("#photoGrid");
  const editor = qs<HTMLElement>("#studioEditPreview");
  if (!grid || !editor) return false;
  if (document.documentElement.dataset.studioEditorSelectionSync === "ready") return true;
  document.documentElement.dataset.studioEditorSelectionSync = "ready";

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest("#section-photos")) return;
    if (target.closest(".photo-tile[data-path], .group-open, #studioShowAll, #clearPhotoSelection, #selectAllPhotos, #invertPhotoSelection, #workspacePrevFrame, #workspaceNextFrame, #workspaceRemoveFromGroup, #studioMoveTarget")) {
      schedulePulse();
    }
  }, true);

  window.addEventListener("tihulu:workspace-groups-imported", () => schedulePulse(80));
  window.addEventListener("tihulu:workspace-group-move", () => schedulePulse(80));

  // Also repair the initial folder-scan case. This is deliberately bounded and becomes
  // idle as soon as Studio Editor renders a real frame preview/name.
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (editorNeedsSync()) pulseEditorObserver();
    const name = qs<HTMLElement>("#studioEditName")?.textContent?.trim();
    if ((hasFrames() && name && name !== "No frame selected") || attempts >= 120) {
      window.clearInterval(timer);
    }
  }, 100);

  schedulePulse();
  return true;
}

function start(): void {
  if (install()) return;
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 200) window.clearInterval(timer);
  }, 50);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();

export {};
