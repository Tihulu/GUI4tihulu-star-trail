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

async function waitForGroupCards(timeoutMs: number): Promise<boolean> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (qs("#studioGroupList .studio-group-card[data-group-id]")) return true;
    await delay(80);
  }
  return false;
}

async function forceStudioStateReload(source: string): Promise<boolean> {
  const label = qs<HTMLElement>("#photoSourcePath");
  const grid = qs<HTMLElement>("#photoGrid");
  const firstTile = qs<HTMLElement>("#photoGrid .photo-tile[data-path]");
  if (!label || !grid || !firstTile) return false;

  // studio-editor keeps group data in closure-local variables and reloads persisted
  // state when its observed grid mutates while the source key changes. Drive that
  // public restore path explicitly: first move it off the real key, then back.
  const originalVisibility = label.style.visibility;
  label.style.visibility = "hidden";

  label.textContent = `${source}#engine-import-${Date.now()}`;
  firstTile.classList.toggle("workspace-import-phase-a");
  await delay(140);

  label.textContent = source;
  firstTile.classList.toggle("workspace-import-phase-b");
  await delay(180);
  label.style.visibility = originalVisibility;

  let loaded = await waitForGroupCards(1600);
  if (!loaded) {
    // A real grid rebuild is a safe fallback and makes the editor observe the real
    // source key again without asking the user to browse output/groups manually.
    qs<HTMLButtonElement>("#rescanPhotos")?.click();
    loaded = await waitForGroupCards(3500);
  }
  return loaded;
}

async function selectFirstGroupFrame(): Promise<void> {
  const opener = qs<HTMLButtonElement>("#studioGroupList .studio-group-card[data-group-id] .group-open");
  opener?.click();
  await delay(100);
  const firstVisible = Array.from(document.querySelectorAll<HTMLElement>("#photoGrid .photo-tile[data-path]"))
    .find((tile) => !tile.classList.contains("studio-group-hidden"));
  firstVisible?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

async function importResolvedGroups(detail: GroupsResolvedDetail): Promise<void> {
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
  localStorage.setItem(storageKey(detail.source), JSON.stringify(state));

  const loaded = await forceStudioStateReload(detail.source);
  if (!loaded) {
    console.error("[Tihulu Studio] engine groups were persisted but Studio did not reload them");
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
}

// Register before workspace-parity. That module still owns navigation/drag/drop,
// but this bridge exclusively owns engine -> Studio state import.
window.addEventListener("tihulu:engine-groups-resolved", (event) => {
  event.stopImmediatePropagation();
  const detail = (event as CustomEvent<GroupsResolvedDetail>).detail;
  void importResolvedGroups(detail);
});

export {};
