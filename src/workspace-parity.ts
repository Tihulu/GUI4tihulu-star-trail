// SPDX-License-Identifier: AGPL-3.0-only
import "./workspace-parity.css";
import { convertFileSrc } from "@tauri-apps/api/core";

type StoredStudioState = {
  version?: number;
  groups?: Array<{ id: string; name: string }>;
  assignments?: Array<[string, string | null]>;
};

let draggedPhotoPaths: string[] = [];
let groupThumbsEnabled = true;

function qs<T extends Element>(selector: string): T | null { return document.querySelector<T>(selector); }
function nextFrame(): Promise<void> { return new Promise((resolve) => requestAnimationFrame(() => resolve())); }

function tiles(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("#photoGrid .photo-tile[data-path]"));
}
function visibleTiles(): HTMLElement[] {
  return tiles().filter((tile) => !tile.classList.contains("studio-group-hidden"));
}
function selectedTiles(): HTMLElement[] {
  return tiles().filter((tile) => tile.classList.contains("selected"));
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
  window.setTimeout(() => node?.classList.remove("show"), 3200);
}

async function selectOnly(path: string): Promise<void> {
  qs<HTMLButtonElement>("#clearPhotoSelection")?.click();
  await nextFrame();
  const tile = tiles().find((item) => item.dataset.path === path);
  tile?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

async function selectPaths(paths: string[]): Promise<void> {
  qs<HTMLButtonElement>("#clearPhotoSelection")?.click();
  await nextFrame();
  for (const path of paths) {
    const tile = tiles().find((item) => item.dataset.path === path);
    if (!tile) continue;
    tile.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    await nextFrame();
  }
}

async function movePathsWithStudioUi(paths: string[], groupId: string): Promise<void> {
  if (!paths.length) return;
  await selectPaths(paths);
  const target = qs<HTMLSelectElement>("#studioMoveTarget");
  if (!target) return;
  target.value = groupId;
  target.dispatchEvent(new Event("change", { bubbles: true }));
  await nextFrame();
  qs<HTMLButtonElement>(`#studioGroupList .studio-group-card[data-group-id="${CSS.escape(groupId)}"] .group-open`)?.click();
  await nextFrame();
  const first = visibleTiles()[0];
  if (first?.dataset.path) await selectOnly(first.dataset.path);
}

function stepFrame(offset: number): void {
  const current = visibleTiles();
  if (!current.length) { toast("Choose a group with frames first."); return; }
  const selectedPath = selectedTiles()[0]?.dataset.path;
  let index = selectedPath ? current.findIndex((tile) => tile.dataset.path === selectedPath) : -1;
  if (index < 0) index = offset > 0 ? -1 : 0;
  const next = Math.max(0, Math.min(current.length - 1, index + offset));
  const path = current[next]?.dataset.path;
  if (path) void selectOnly(path);
}

function currentSourceKey(): string {
  return qs<HTMLElement>("#photoSourcePath")?.textContent?.trim() || "unknown";
}

function storedState(): StoredStudioState | null {
  try {
    const raw = localStorage.getItem(`tihulu-studio-v1:${currentSourceKey()}`);
    return raw ? JSON.parse(raw) as StoredStudioState : null;
  } catch {
    return null;
  }
}

function addGroupThumbnails(): void {
  const list = qs<HTMLElement>("#studioGroupList");
  if (!list) return;
  const state = storedState();
  const assignments = new Map(state?.assignments ?? []);
  for (const card of Array.from(list.querySelectorAll<HTMLElement>(".studio-group-card[data-group-id]"))) {
    const existing = card.querySelector<HTMLImageElement>(".workspace-group-thumb");
    if (!groupThumbsEnabled) {
      existing?.remove();
      continue;
    }
    const groupId = card.dataset.groupId;
    if (!groupId) continue;
    const path = [...assignments].find(([, id]) => id === groupId)?.[0];
    if (!path) {
      existing?.remove();
      continue;
    }
    if (existing?.dataset.sourcePath === path) continue;
    existing?.remove();
    const thumb = document.createElement("img");
    thumb.className = "workspace-group-thumb";
    thumb.dataset.sourcePath = path;
    thumb.src = convertFileSrc(path);
    thumb.alt = "";
    thumb.loading = "lazy";
    card.prepend(thumb);
  }
}

function installParityBar(groupPanel: HTMLElement): void {
  if (qs("#workspaceParityBar")) return;
  const head = groupPanel.querySelector<HTMLElement>(".studio-panel-head");
  const bar = document.createElement("div");
  bar.id = "workspaceParityBar";
  bar.className = "workspace-parity-bar";
  bar.innerHTML = `
    <div class="workspace-parity-copy"><strong>Current group frames</strong><small>Click a group to open its frames. Drag one or many selected frames onto another group to move them.</small></div>
    <div class="workspace-parity-actions">
      <button type="button" class="ghost-button compact-button" id="workspacePrevFrame">← Previous</button>
      <button type="button" class="ghost-button compact-button" id="workspaceNextFrame">Next →</button>
      <button type="button" class="ghost-button compact-button" id="workspaceRemoveFromGroup">Remove selected from group</button>
      <button type="button" class="ghost-button compact-button" id="workspaceToggleThumbs">Hide frame thumbnails</button>
      <button type="button" class="ghost-button compact-button" id="workspaceToggleGroupThumbs">Hide group thumbnails</button>
    </div>`;
  head?.insertAdjacentElement("afterend", bar);

  qs<HTMLButtonElement>("#workspacePrevFrame")?.addEventListener("click", () => stepFrame(-1));
  qs<HTMLButtonElement>("#workspaceNextFrame")?.addEventListener("click", () => stepFrame(1));
  qs<HTMLButtonElement>("#workspaceRemoveFromGroup")?.addEventListener("click", () => {
    const paths = selectedTiles().map((tile) => tile.dataset.path).filter((path): path is string => Boolean(path));
    if (!paths.length) { toast("Select one or more frames first."); return; }
    const target = qs<HTMLSelectElement>("#studioMoveTarget");
    if (!target) return;
    target.value = "__ungrouped__";
    target.dispatchEvent(new Event("change", { bubbles: true }));
  });
  qs<HTMLButtonElement>("#workspaceToggleThumbs")?.addEventListener("click", (event) => {
    const section = qs<HTMLElement>("#section-photos");
    if (!section) return;
    const hidden = section.classList.toggle("workspace-hide-photo-thumbnails");
    (event.currentTarget as HTMLButtonElement).textContent = hidden ? "Show frame thumbnails" : "Hide frame thumbnails";
  });
  qs<HTMLButtonElement>("#workspaceToggleGroupThumbs")?.addEventListener("click", (event) => {
    groupThumbsEnabled = !groupThumbsEnabled;
    (event.currentTarget as HTMLButtonElement).textContent = groupThumbsEnabled ? "Hide group thumbnails" : "Show group thumbnails";
    addGroupThumbnails();
  });
}

function installDragFallback(photoGrid: HTMLElement, groupList: HTMLElement): void {
  photoGrid.addEventListener("dragstart", (event) => {
    const tile = (event.target as HTMLElement).closest<HTMLElement>(".photo-tile[data-path]");
    if (!tile?.dataset.path) return;
    const selected = selectedTiles().map((item) => item.dataset.path).filter((path): path is string => Boolean(path));
    draggedPhotoPaths = selected.includes(tile.dataset.path) ? selected : [tile.dataset.path];
  }, true);
  photoGrid.addEventListener("dragend", () => { window.setTimeout(() => { draggedPhotoPaths = []; }, 0); }, true);

  groupList.addEventListener("dragover", (event) => {
    if (!draggedPhotoPaths.length) return;
    const card = (event.target as HTMLElement).closest<HTMLElement>(".studio-group-card[data-group-id]");
    if (!card) return;
    event.preventDefault();
    card.classList.add("group-drag-over");
  }, true);
  groupList.addEventListener("drop", (event) => {
    if (!draggedPhotoPaths.length) return;
    const card = (event.target as HTMLElement).closest<HTMLElement>(".studio-group-card[data-group-id]");
    const groupId = card?.dataset.groupId;
    if (!groupId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const paths = [...draggedPhotoPaths];
    draggedPhotoPaths = [];
    void movePathsWithStudioUi(paths, groupId);
  }, true);
}

function installGroupOpenBehavior(groupList: HTMLElement): void {
  groupList.addEventListener("click", (event) => {
    const opener = (event.target as HTMLElement).closest<HTMLButtonElement>(".group-open");
    if (!opener) return;
    window.setTimeout(() => {
      const first = visibleTiles()[0];
      if (first?.dataset.path) void selectOnly(first.dataset.path);
      addGroupThumbnails();
    }, 0);
  }, true);
}

function install(): boolean {
  const panel = qs<HTMLElement>(".studio-group-panel");
  const list = qs<HTMLElement>("#studioGroupList");
  const grid = qs<HTMLElement>("#photoGrid");
  if (!panel || !list || !grid) return false;
  if (panel.dataset.parityInstalled === "true") return true;
  panel.dataset.parityInstalled = "true";
  installParityBar(panel);
  installDragFallback(grid, list);
  installGroupOpenBehavior(list);

  let thumbnailRefreshQueued = false;
  const observer = new MutationObserver(() => {
    if (thumbnailRefreshQueued) return;
    thumbnailRefreshQueued = true;
    requestAnimationFrame(() => {
      thumbnailRefreshQueued = false;
      addGroupThumbnails();
    });
  });
  observer.observe(list, { childList: true, subtree: true });
  window.addEventListener("tihulu:engine-groups-synced", () => {
    window.setTimeout(() => {
      addGroupThumbnails();
      const active = qs<HTMLButtonElement>("#studioGroupList .studio-group-card.active .group-open")
        ?? qs<HTMLButtonElement>("#studioGroupList .studio-group-card:not(.all-card) .group-open");
      active?.click();
    }, 0);
  });
  addGroupThumbnails();
  return true;
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
