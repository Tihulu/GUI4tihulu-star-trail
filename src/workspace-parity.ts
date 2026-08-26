// SPDX-License-Identifier: AGPL-3.0-only
import "./workspace-parity.css";

type GroupRecord = { id: string; name: string };
type StudioState = {
  version: 1;
  groups: GroupRecord[];
  assignments: Array<[string, string | null]>;
  edits: Array<[string, unknown]>;
};
type ResolvedGroup = { name: string; paths: string[] };
type GroupsResolvedDetail = { groups: ResolvedGroup[]; source: string; output: string };

let draggedPhotoPaths: string[] = [];
let groupThumbsEnabled = true;
let importInProgress = false;

function qs<T extends Element>(selector: string): T | null { return document.querySelector<T>(selector); }
function nextFrame(): Promise<void> { return new Promise((resolve) => requestAnimationFrame(() => resolve())); }
function delay(ms: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, ms)); }

function tiles(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("#photoGrid .photo-tile[data-path]"));
}
function visibleTiles(): HTMLElement[] {
  return tiles().filter((tile) => !tile.classList.contains("studio-group-hidden"));
}
function selectedTiles(): HTMLElement[] {
  return tiles().filter((tile) => tile.classList.contains("selected"));
}
function currentSourceKey(): string {
  return qs<HTMLElement>("#photoSourcePath")?.textContent?.trim() || "unknown";
}
function storageKey(source = currentSourceKey()): string { return `tihulu-studio-v1:${source}`; }

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
  window.setTimeout(() => node?.classList.remove("show"), 3500);
}

function readState(source = currentSourceKey()): StudioState | null {
  try {
    const raw = localStorage.getItem(storageKey(source));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StudioState>;
    if (parsed.version !== 1) return null;
    return {
      version: 1,
      groups: Array.isArray(parsed.groups) ? parsed.groups as GroupRecord[] : [],
      assignments: Array.isArray(parsed.assignments) ? parsed.assignments as Array<[string, string | null]> : [],
      edits: Array.isArray(parsed.edits) ? parsed.edits as Array<[string, unknown]> : [],
    };
  } catch {
    return null;
  }
}

function writeState(source: string, state: StudioState): void {
  localStorage.setItem(storageKey(source), JSON.stringify(state));
}

async function forceStudioReload(source: string, openGroupId?: string): Promise<void> {
  const label = qs<HTMLElement>("#photoSourcePath");
  const grid = qs<HTMLElement>("#photoGrid");
  if (!label || !grid) return;

  // studio-editor keeps its state in closure-local variables. Force its existing
  // restore path to reload the freshly written state without reloading the app.
  const originalVisibility = label.style.visibility;
  label.style.visibility = "hidden";
  label.textContent = `${source}#workspace-refresh-${Date.now()}`;
  grid.classList.toggle("studio-state-refresh-a");
  await nextFrame();
  await nextFrame();
  label.textContent = source;
  grid.classList.toggle("studio-state-refresh-b");
  await nextFrame();
  await nextFrame();
  label.style.visibility = originalVisibility;

  await waitFor(() => Boolean(qs("#studioGroupList .studio-group-card[data-group-id]")), 2500);
  const opener = openGroupId
    ? groupCard(openGroupId)?.querySelector<HTMLButtonElement>(".group-open")
    : qs<HTMLButtonElement>("#studioGroupList .studio-group-card[data-group-id] .group-open");
  opener?.click();
  await nextFrame();
  await selectFirstVisible();
  addGroupThumbnails();
  updateFrameStatus();
}

async function importResolvedGroups(detail: GroupsResolvedDetail): Promise<void> {
  if (importInProgress) return;
  importInProgress = true;
  try {
    const currentSource = currentSourceKey();
    if (normalizePath(currentSource) !== normalizePath(detail.source)) {
      toast("Workspace source does not match the Process input; group import was stopped to protect the project state.");
      return;
    }

    const sourcePaths = new Set(tiles().map((tile) => tile.dataset.path).filter((path): path is string => Boolean(path)));
    if (sourcePaths.size === 0) {
      toast("Photo Workspace has no source frames to attach the engine groups to.");
      return;
    }

    const existing = readState(detail.source);
    const groups: GroupRecord[] = [];
    const assignments = new Map<string, string | null>();
    for (const path of sourcePaths) assignments.set(path, null);

    for (const resolved of detail.groups) {
      const validPaths = resolved.paths.filter((path) => sourcePaths.has(path));
      if (validPaths.length === 0) continue;
      const group = { id: crypto.randomUUID(), name: uniqueGroupName(resolved.name, groups) };
      groups.push(group);
      for (const path of validPaths) assignments.set(path, group.id);
    }

    if (groups.length === 0) {
      toast("Engine groups were resolved, but no original source frames survived workspace validation.");
      return;
    }

    writeState(detail.source, {
      version: 1,
      groups,
      assignments: [...assignments],
      edits: existing?.edits ?? [],
    });
    await forceStudioReload(detail.source, groups[0]?.id);
    window.dispatchEvent(new CustomEvent("tihulu:workspace-groups-imported", {
      detail: { groups: groups.length, frames: [...assignments.values()].filter(Boolean).length },
    }));
  } finally {
    importInProgress = false;
  }
}

function uniqueGroupName(name: string, groups: GroupRecord[]): string {
  const base = name.trim() || `Group ${groups.length + 1}`;
  const existing = new Set(groups.map((group) => group.name.toLocaleLowerCase()));
  if (!existing.has(base.toLocaleLowerCase())) return base;
  let index = 2;
  while (existing.has(`${base} ${index}`.toLocaleLowerCase())) index += 1;
  return `${base} ${index}`;
}

async function selectOnly(path: string): Promise<void> {
  qs<HTMLButtonElement>("#clearPhotoSelection")?.click();
  await nextFrame();
  tiles().find((item) => item.dataset.path === path)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await nextFrame();
  updateFrameStatus();
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
  updateFrameStatus();
}

async function selectFirstVisible(): Promise<void> {
  const first = visibleTiles()[0]?.dataset.path;
  if (first) await selectOnly(first);
}

function groupCard(groupId: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>("#studioGroupList .studio-group-card[data-group-id]"))
    .find((card) => card.dataset.groupId === groupId);
}

async function movePathsWithStudioUi(paths: string[], groupId: string): Promise<void> {
  if (!paths.length) return;
  await selectPaths(paths);
  const target = qs<HTMLSelectElement>("#studioMoveTarget");
  if (!target) {
    toast("Group move control is unavailable.");
    return;
  }
  target.value = groupId;
  target.dispatchEvent(new Event("change", { bubbles: true }));
  await nextFrame();
  groupCard(groupId)?.querySelector<HTMLButtonElement>(".group-open")?.click();
  await nextFrame();
  await selectFirstVisible();
  window.setTimeout(addGroupThumbnails, 180);
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

function updateFrameStatus(): void {
  const node = qs<HTMLElement>("#workspaceFrameStatus");
  if (!node) return;
  const active = qs<HTMLElement>("#studioGroupList .studio-group-card.active[data-group-id]");
  const groupName = active?.querySelector<HTMLElement>("strong")?.textContent?.trim();
  const current = visibleTiles();
  const selectedPath = selectedTiles()[0]?.dataset.path;
  const index = selectedPath ? current.findIndex((tile) => tile.dataset.path === selectedPath) : -1;
  node.textContent = groupName
    ? `${groupName} · ${current.length} frame${current.length === 1 ? "" : "s"}${index >= 0 ? ` · frame ${index + 1}/${current.length}` : ""}`
    : `${tiles().length} total frames`;
}

function addGroupThumbnails(): void {
  const list = qs<HTMLElement>("#studioGroupList"); if (!list) return;
  const state = readState(); const assignments = new Map(state?.assignments ?? []);
  const tileByPath = new Map(tiles().map((tile) => [tile.dataset.path ?? "", tile]));
  const firstPreviewByGroup = new Map<string, { path: string; version: string }>();
  for (const [path, groupId] of assignments) {
    if (!groupId || firstPreviewByGroup.has(groupId)) continue;
    const image = tileByPath.get(path)?.querySelector<HTMLImageElement>("img[data-thumb-path]");
    if (image) firstPreviewByGroup.set(groupId, { path, version: image.dataset.thumbVersion ?? "" });
  }
  for (const card of Array.from(list.querySelectorAll<HTMLElement>(".studio-group-card[data-group-id]"))) {
    const existing = card.querySelector<HTMLImageElement>(".workspace-group-thumb");
    if (!groupThumbsEnabled) { existing?.remove(); continue; }
    const groupId = card.dataset.groupId; const preview = groupId ? firstPreviewByGroup.get(groupId) : undefined;
    if (!preview) { existing?.remove(); continue; }
    if (existing?.dataset.thumbPath === preview.path && existing.dataset.thumbVersion === preview.version) continue;
    existing?.remove(); const thumb = document.createElement("img"); thumb.className = "workspace-group-thumb";
    thumb.dataset.thumbPath = preview.path; thumb.dataset.thumbVersion = preview.version; thumb.alt = ""; thumb.loading = "lazy"; thumb.decoding = "async"; card.prepend(thumb);
  }
}

async function processCurrentGroup(mode: "trail" | "timelapse"): Promise<void> {
  const active = qs<HTMLElement>("#studioGroupList .studio-group-card.active[data-group-id]");
  if (!active) { toast("Choose a group first."); return; }
  qs<HTMLButtonElement>("#studioUseGroup")?.click();
  await delay(80);
  qs<HTMLButtonElement>(`.mode-tab[data-mode="${mode}"]`)?.click();
}

function installParityBar(groupPanel: HTMLElement): void {
  if (qs("#workspaceParityBar")) return;
  const head = groupPanel.querySelector<HTMLElement>(".studio-panel-head");
  const bar = document.createElement("div");
  bar.id = "workspaceParityBar";
  bar.className = "workspace-parity-bar";
  bar.innerHTML = `
    <div class="workspace-parity-copy">
      <strong>Current group frames</strong>
      <small id="workspaceFrameStatus">Choose a group to inspect its frames</small>
    </div>
    <div class="workspace-parity-actions">
      <button type="button" class="ghost-button compact-button" id="workspacePrevFrame">← Previous</button>
      <button type="button" class="ghost-button compact-button" id="workspaceNextFrame">Next →</button>
      <button type="button" class="ghost-button compact-button" id="workspaceRemoveFromGroup">Remove from group</button>
      <button type="button" class="secondary-button compact-button" id="workspaceTrailGroup">Trail this group</button>
      <button type="button" class="secondary-button compact-button" id="workspaceTimelapseGroup">Timelapse this group</button>
      <button type="button" class="ghost-button compact-button" id="workspaceToggleThumbs">Hide frame thumbnails</button>
      <button type="button" class="ghost-button compact-button" id="workspaceToggleGroupThumbs">Hide group thumbnails</button>
    </div>`;
  head?.insertAdjacentElement("afterend", bar);

  qs<HTMLButtonElement>("#workspacePrevFrame")?.addEventListener("click", () => stepFrame(-1));
  qs<HTMLButtonElement>("#workspaceNextFrame")?.addEventListener("click", () => stepFrame(1));
  qs<HTMLButtonElement>("#workspaceTrailGroup")?.addEventListener("click", () => void processCurrentGroup("trail"));
  qs<HTMLButtonElement>("#workspaceTimelapseGroup")?.addEventListener("click", () => void processCurrentGroup("timelapse"));
  qs<HTMLButtonElement>("#workspaceRemoveFromGroup")?.addEventListener("click", () => {
    const paths = selectedTiles().map((tile) => tile.dataset.path).filter((path): path is string => Boolean(path));
    if (!paths.length) { toast("Select one or more frames first."); return; }
    const target = qs<HTMLSelectElement>("#studioMoveTarget");
    if (!target) return;
    target.value = "__ungrouped__";
    target.dispatchEvent(new Event("change", { bubbles: true }));
    window.setTimeout(() => { addGroupThumbnails(); updateFrameStatus(); }, 180);
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
  photoGrid.addEventListener("dragend", () => {
    window.setTimeout(() => { draggedPhotoPaths = []; }, 80);
  }, true);

  groupList.addEventListener("dragover", (event) => {
    if (!draggedPhotoPaths.length) return;
    const card = (event.target as HTMLElement).closest<HTMLElement>(".studio-group-card[data-group-id]");
    if (!card) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    card.classList.add("group-drag-over");
  }, true);
  groupList.addEventListener("dragleave", (event) => {
    (event.target as HTMLElement).closest<HTMLElement>(".studio-group-card")?.classList.remove("group-drag-over");
  }, true);
  groupList.addEventListener("drop", (event) => {
    if (!draggedPhotoPaths.length) return;
    const card = (event.target as HTMLElement).closest<HTMLElement>(".studio-group-card[data-group-id]");
    const groupId = card?.dataset.groupId;
    if (!groupId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    card.classList.remove("group-drag-over");
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
      void selectFirstVisible();
      addGroupThumbnails();
      updateFrameStatus();
    }, 0);
  }, true);
}

function install(): boolean {
  const panel = qs<HTMLElement>(".studio-group-panel");
  const list = qs<HTMLElement>("#studioGroupList");
  const grid = qs<HTMLElement>("#photoGrid");
  if (!panel || !list || !grid) return false;
  if (panel.dataset.parityInstalled === "v035") return true;
  panel.dataset.parityInstalled = "v035";

  installParityBar(panel);
  installDragFallback(grid, list);
  installGroupOpenBehavior(list);

  let refreshQueued = false;
  const observer = new MutationObserver(() => {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      addGroupThumbnails();
      updateFrameStatus();
    });
  });
  observer.observe(list, { childList: true, subtree: true });
  observer.observe(grid, { childList: true, subtree: true });

  window.addEventListener("tihulu:engine-groups-resolved", (event) => {
    const detail = (event as CustomEvent<GroupsResolvedDetail>).detail;
    void importResolvedGroups(detail);
  });

  addGroupThumbnails();
  updateFrameStatus();
  return true;
}

function start(): void {
  if (install()) return;
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 180) window.clearInterval(timer);
  }, 50);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const started = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (predicate()) { resolve(true); return; }
      if (performance.now() - started >= timeoutMs) { resolve(false); return; }
      window.setTimeout(tick, 80);
    };
    tick();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
