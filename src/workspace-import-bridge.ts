// SPDX-License-Identifier: AGPL-3.0-only

type ResolvedGroup = { name: string; paths: string[] };
type GroupsResolvedDetail = { groups: ResolvedGroup[]; source: string; output: string };
type GroupRecord = { id: string; name: string };
type StudioState = {
  version: 1;
  groups: GroupRecord[];
  assignments: Array<[string, string | null]>;
  edits: Array<[string, unknown]>;
};
type LiveGroup = { id: string; name: string; paths: string[] };

let importing = false;

function qs<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
}

function storageKey(source: string): string {
  return `tihulu-studio-v1:${source}`;
}

function tiles(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("#photoGrid .photo-tile[data-path]"));
}

function readExistingState(source: string): StudioState | null {
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

function uniqueGroupName(name: string, groups: GroupRecord[]): string {
  const base = name.trim() || `Group ${groups.length + 1}`;
  const names = new Set(groups.map((group) => group.name.toLocaleLowerCase()));
  if (!names.has(base.toLocaleLowerCase())) return base;
  let index = 2;
  while (names.has(`${base} ${index}`.toLocaleLowerCase())) index += 1;
  return `${base} ${index}`;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const started = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (predicate()) { resolve(true); return; }
      if (performance.now() - started >= timeoutMs) { resolve(false); return; }
      window.setTimeout(tick, 40);
    };
    tick();
  });
}

function triggerStudioStructureSync(grid: HTMLElement): void {
  const marker = document.createElement("span");
  marker.hidden = true;
  marker.dataset.studioImportMarker = "1";
  grid.append(marker);
  marker.remove();
}

async function reloadStudioState(source: string, expectedGroups: number): Promise<boolean> {
  const label = qs<HTMLElement>("#photoSourcePath");
  const grid = qs<HTMLElement>("#photoGrid");
  const list = qs<HTMLElement>("#studioGroupList");
  if (!label || !grid || !list) return false;

  // Hide only the transient reload. The group strip is horizontal; rebuilding it
  // group-by-group makes the scrollbar thumb resize dozens/hundreds of times.
  // Two hidden structural syncs let Studio Editor reload closure-local state and
  // reveal only the final group list.
  const oldLabelVisibility = label.style.visibility;
  const oldListVisibility = list.style.visibility;
  const oldPointerEvents = list.style.pointerEvents;
  label.style.visibility = "hidden";
  list.style.visibility = "hidden";
  list.style.pointerEvents = "none";

  try {
    label.textContent = `${source}#atomic-engine-import`;
    triggerStudioStructureSync(grid);
    await nextFrame();
    await nextFrame();

    label.textContent = source;
    triggerStudioStructureSync(grid);
    const restored = await waitFor(
      () => document.querySelectorAll("#studioGroupList .studio-group-card[data-group-id]").length === expectedGroups,
      4000,
    );
    await nextFrame();
    return restored;
  } finally {
    label.textContent = source;
    label.style.visibility = oldLabelVisibility;
    list.style.visibility = oldListVisibility;
    list.style.pointerEvents = oldPointerEvents;
  }
}

async function importResolvedGroups(detail: GroupsResolvedDetail): Promise<void> {
  if (importing) return;
  importing = true;
  try {
    const sourceLabel = qs<HTMLElement>("#photoSourcePath")?.textContent?.trim() ?? "";
    if (!detail?.source || normalizePath(sourceLabel) !== normalizePath(detail.source)) return;

    const sourcePaths = new Set(
      tiles().map((tile) => tile.dataset.path).filter((path): path is string => Boolean(path)),
    );
    if (sourcePaths.size === 0) return;

    const existing = readExistingState(detail.source);
    const groups: GroupRecord[] = [];
    const assignments = new Map<string, string | null>();
    for (const path of sourcePaths) assignments.set(path, null);

    const liveGroups: LiveGroup[] = [];
    for (const resolved of detail.groups ?? []) {
      const validPaths = resolved.paths.filter((path) => sourcePaths.has(path));
      if (validPaths.length === 0) continue;
      const group: GroupRecord = {
        id: crypto.randomUUID(),
        name: uniqueGroupName(resolved.name, groups),
      };
      groups.push(group);
      for (const path of validPaths) assignments.set(path, group.id);
      liveGroups.push({ id: group.id, name: group.name, paths: validPaths });
    }

    if (groups.length === 0) return;

    // One state write replaces hundreds of simulated selection/new-group clicks.
    localStorage.setItem(storageKey(detail.source), JSON.stringify({
      version: 1,
      groups,
      assignments: [...assignments],
      edits: existing?.edits ?? [],
    } satisfies StudioState));

    const restored = await reloadStudioState(detail.source, groups.length);
    if (!restored) {
      console.error("[Tihulu Studio] atomic engine-group import could not reload Studio state");
      return;
    }

    window.dispatchEvent(new CustomEvent("tihulu:workspace-live-groups", {
      detail: { source: detail.source, groups: liveGroups },
    }));

    // Open the first group once, after the complete list exists. This is the only
    // intentional post-import group render and avoids incremental scrollbar churn.
    qs<HTMLButtonElement>("#studioGroupList .studio-group-card[data-group-id] .group-open")?.click();
    await nextFrame();

    window.dispatchEvent(new CustomEvent("tihulu:workspace-groups-imported", {
      detail: {
        groups: groups.length,
        frames: [...assignments.values()].filter(Boolean).length,
        source: detail.source,
      },
    }));
  } finally {
    importing = false;
  }
}

// Register before workspace-parity. This bridge is the single owner of the
// engine-result import so two import implementations can never race each other.
window.addEventListener("tihulu:engine-groups-resolved", (event) => {
  event.stopImmediatePropagation();
  const detail = (event as CustomEvent<GroupsResolvedDetail>).detail;
  void importResolvedGroups(detail);
});

export {};
