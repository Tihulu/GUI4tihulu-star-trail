// SPDX-License-Identifier: AGPL-3.0-only

type StudioState = {
  version: 1;
  groups: Array<{ id: string; name: string }>;
  assignments: Array<[string, string | null]>;
  edits: Array<[string, unknown]>;
};
type LiveGroup = { id: string; name: string; paths: string[] };
type LiveGroupsDetail = { source: string; groups: LiveGroup[] };
type GroupMoveDetail = { paths: string[]; groupId: string | null };

let applying = false;
let queued = false;
let liveSource = "";
let liveAssignments = new Map<string, string | null>();

function qs<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
}

function sourceKey(): string {
  return qs<HTMLElement>("#photoSourcePath")?.textContent?.trim() || "unknown";
}

function readState(): StudioState | null {
  try {
    const raw = localStorage.getItem(`tihulu-studio-v1:${sourceKey()}`);
    if (!raw) return null;
    const state = JSON.parse(raw) as Partial<StudioState>;
    if (state.version !== 1 || !Array.isArray(state.assignments)) return null;
    return {
      version: 1,
      groups: Array.isArray(state.groups) ? state.groups : [],
      assignments: state.assignments as Array<[string, string | null]>,
      edits: Array.isArray(state.edits) ? state.edits : [],
    };
  } catch {
    return null;
  }
}

function tiles(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("#photoGrid .photo-tile[data-path]"));
}

function selectedTiles(): HTMLElement[] {
  return tiles().filter((tile) => tile.classList.contains("selected"));
}

function updateFrameStatus(active: HTMLElement | null): void {
  const status = qs<HTMLElement>("#workspaceFrameStatus");
  if (!status) return;
  const all = tiles();
  const visible = all.filter((tile) => !tile.classList.contains("studio-group-hidden"));
  if (!active) {
    status.textContent = `${all.length} total frames`;
    return;
  }
  const name = active.querySelector<HTMLElement>(".group-card-main strong")?.textContent?.trim() || "Group";
  const selectedPath = selectedTiles()[0]?.dataset.path;
  const index = selectedPath ? visible.findIndex((tile) => tile.dataset.path === selectedPath) : -1;
  status.textContent = `${name} · ${visible.length} frame${visible.length === 1 ? "" : "s"}${index >= 0 ? ` · frame ${index + 1}/${visible.length}` : ""}`;
}

function assignmentMap(groupId: string): Map<string, string | null> | null {
  // Prefer Studio's persisted state once its 150 ms save has landed. Until then use
  // the exact live IDs/path lists emitted by the import bridge. This removes the
  // import-vs-grid-render race without making normal later group edits depend on it.
  const state = readState();
  if (state) {
    const persisted = new Map(state.assignments);
    if ([...persisted.values()].includes(groupId)) {
      liveAssignments = new Map(persisted);
      liveSource = sourceKey();
      return persisted;
    }
  }

  if (normalizePath(liveSource) === normalizePath(sourceKey()) && [...liveAssignments.values()].includes(groupId)) {
    return liveAssignments;
  }
  return null;
}

function enforce(): void {
  if (applying) return;
  const all = tiles();
  if (!all.length) return;

  const active = qs<HTMLElement>("#studioGroupList .studio-group-card.active[data-group-id]");
  if (!active?.dataset.groupId) {
    applying = true;
    try {
      for (const tile of all) tile.classList.remove("studio-group-hidden");
      updateFrameStatus(null);
    } finally {
      applying = false;
    }
    return;
  }

  const groupId = active.dataset.groupId;
  const assignments = assignmentMap(groupId);
  if (!assignments) return;

  applying = true;
  try {
    for (const tile of all) {
      const path = tile.dataset.path;
      tile.classList.toggle("studio-group-hidden", !path || assignments.get(path) !== groupId);
    }
    updateFrameStatus(active);
  } finally {
    applying = false;
  }
}

function queueEnforce(delayMs = 0): void {
  if (delayMs > 0) {
    window.setTimeout(() => queueEnforce(), delayMs);
    return;
  }
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    enforce();
  });
}

function install(): boolean {
  const grid = qs<HTMLElement>("#photoGrid");
  const list = qs<HTMLElement>("#studioGroupList");
  if (!grid || !list) return false;
  if (document.documentElement.dataset.workspaceFilterGuard === "ready") return true;
  document.documentElement.dataset.workspaceFilterGuard = "ready";

  const observer = new MutationObserver(() => {
    if (!applying) queueEnforce();
  });
  observer.observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  observer.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest("#section-photos")) return;
    if (target.closest(".group-open, #studioShowAll, #clearPhotoSelection, .photo-tile, #workspacePrevFrame, #workspaceNextFrame, #workspaceRemoveFromGroup, #studioMoveTarget")) {
      queueEnforce();
      queueEnforce(180);
    }
  }, true);

  window.addEventListener("tihulu:workspace-live-groups", (event) => {
    const detail = (event as CustomEvent<LiveGroupsDetail>).detail;
    if (!detail?.source || !Array.isArray(detail.groups)) return;
    liveSource = detail.source;
    liveAssignments = new Map();
    for (const tile of tiles()) {
      const path = tile.dataset.path;
      if (path) liveAssignments.set(path, null);
    }
    for (const group of detail.groups) {
      for (const path of group.paths) liveAssignments.set(path, group.id);
    }
    queueEnforce();
    queueEnforce(80);
    queueEnforce(220);
  });

  window.addEventListener("tihulu:workspace-group-move", (event) => {
    const detail = (event as CustomEvent<GroupMoveDetail>).detail;
    if (!detail || !Array.isArray(detail.paths)) return;
    liveSource = sourceKey();
    for (const path of detail.paths) liveAssignments.set(path, detail.groupId ?? null);
    queueEnforce();
    queueEnforce(80);
    queueEnforce(220);
  });

  window.addEventListener("tihulu:workspace-groups-imported", () => {
    queueEnforce();
    queueEnforce(180);
    queueEnforce(420);
  });

  queueEnforce();
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
