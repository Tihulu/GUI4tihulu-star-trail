// SPDX-License-Identifier: AGPL-3.0-only

type GroupRecord = { id: string; name: string };
type StudioState = {
  version: 1;
  groups: GroupRecord[];
  assignments: Array<[string, string | null]>;
  edits: Array<[string, unknown]>;
};
type ResolvedGroup = { name: string; paths: string[] };
type GroupsResolvedDetail = { groups: ResolvedGroup[]; source: string; output: string };

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function tilePaths(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("#photoGrid .photo-tile[data-path]"))
    .map((tile) => tile.dataset.path)
    .filter((path): path is string => Boolean(path));
}

function uniqueName(name: string, groups: GroupRecord[]): string {
  const base = name.trim() || `Group ${groups.length + 1}`;
  const names = new Set(groups.map((group) => group.name.toLocaleLowerCase()));
  if (!names.has(base.toLocaleLowerCase())) return base;
  let index = 2;
  while (names.has(`${base} ${index}`.toLocaleLowerCase())) index += 1;
  return `${base} ${index}`;
}

function previousEdits(source: string): Array<[string, unknown]> {
  try {
    const raw = localStorage.getItem(storageKey(source));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<StudioState>;
    return Array.isArray(parsed.edits) ? parsed.edits as Array<[string, unknown]> : [];
  } catch {
    return [];
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (predicate()) return true;
    await delay(80);
  }
  return false;
}

async function pulseStudioObserver(): Promise<boolean> {
  const grid = qs<HTMLElement>("#photoGrid");
  if (!grid) return false;
  const marker = document.createElement("span");
  marker.hidden = true;
  marker.dataset.workspaceImportPulse = String(Date.now());
  grid.append(marker);
  // MutationObserver callbacks run before the timer task. This gives Studio Editor
  // enough time to consume the current source key before the next phase begins.
  await delay(0);
  marker.remove();
  await delay(120);
  return true;
}

async function forceStudioStateReload(source: string, state: StudioState): Promise<boolean> {
  const label = qs<HTMLElement>("#photoSourcePath");
  const firstTile = qs<HTMLElement>("#photoGrid .photo-tile[data-path]");
  if (!label || !firstTile) return false;

  // Studio Editor owns group state in closure-local variables and only reloads
  // persisted state when its source key changes. Drive that exact mechanism without
  // rescanning or replacing any photo tiles: first move to a disposable key, pulse
  // the observed grid, then persist the resolved groups and pulse again on the real key.
  const fakeSource = `${source}#engine-import-${Date.now()}`;
  label.textContent = fakeSource;
  if (!await pulseStudioObserver()) return false;

  // Write only after Studio has consumed the disposable key. This prevents stale
  // empty state from racing the engine import.
  localStorage.setItem(storageKey(source), JSON.stringify(state));

  label.textContent = source;
  if (!await pulseStudioObserver()) return false;

  return waitFor(() => Boolean(qs("#studioGroupList .studio-group-card[data-group-id]")), 3000);
}

async function selectFirstGroupFrame(): Promise<void> {
  const opener = qs<HTMLButtonElement>("#studioGroupList .studio-group-card[data-group-id] .group-open");
  opener?.click();
  await delay(120);
  qs<HTMLButtonElement>("#clearPhotoSelection")?.click();
  await delay(40);
  const firstVisible = Array.from(document.querySelectorAll<HTMLElement>("#photoGrid .photo-tile[data-path]"))
    .find((tile) => !tile.classList.contains("studio-group-hidden"));
  firstVisible?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

async function importResolvedGroups(detail: GroupsResolvedDetail): Promise<void> {
  if (importing) return;
  importing = true;
  try {
    const sourceLabel = qs<HTMLElement>("#photoSourcePath")?.textContent?.trim() ?? "";
    if (!detail?.source || normalizePath(sourceLabel) !== normalizePath(detail.source)) return;

    const paths = tilePaths();
    if (!paths.length) return;
    const available = new Set(paths);
    const assignments = new Map<string, string | null>(paths.map((path) => [path, null]));
    const groups: GroupRecord[] = [];

    for (const resolved of detail.groups ?? []) {
      const valid = resolved.paths.filter((path) => available.has(path));
      if (!valid.length) continue;
      const group: GroupRecord = { id: crypto.randomUUID(), name: uniqueName(resolved.name, groups) };
      groups.push(group);
      for (const path of valid) assignments.set(path, group.id);
    }

    if (!groups.length) return;

    const state: StudioState = {
      version: 1,
      groups,
      assignments: [...assignments],
      edits: previousEdits(detail.source),
    };

    const loaded = await forceStudioStateReload(detail.source, state);
    if (!loaded) {
      console.error("[Tihulu Studio] engine groups were persisted but Studio did not reload them after the observer pulse");
      return;
    }

    await selectFirstGroupFrame();
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

// Register before workspace-parity. That module owns navigation/drag/drop UI,
// while this bridge exclusively owns engine -> Studio state import.
window.addEventListener("tihulu:engine-groups-resolved", (event) => {
  event.stopImmediatePropagation();
  const detail = (event as CustomEvent<GroupsResolvedDetail>).detail;
  void importResolvedGroups(detail);
});

export {};
