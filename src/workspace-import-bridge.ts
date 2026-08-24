// SPDX-License-Identifier: AGPL-3.0-only

type ResolvedGroup = { name: string; paths: string[] };
type GroupsResolvedDetail = { groups: ResolvedGroup[]; source: string; output: string };

let importing = false;

function qs<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function tiles(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("#photoGrid .photo-tile[data-path]"));
}

function cardCount(): number {
  return document.querySelectorAll("#studioGroupList .studio-group-card[data-group-id]").length;
}

function clearTileSelection(): void {
  for (const tile of tiles()) tile.classList.remove("selected");
}

function selectTilePaths(paths: string[]): number {
  const wanted = new Set(paths);
  let matched = 0;
  for (const tile of tiles()) {
    const path = tile.dataset.path;
    const selected = Boolean(path && wanted.has(path));
    tile.classList.toggle("selected", selected);
    if (selected) matched += 1;
  }
  return matched;
}

async function clearExistingGroups(): Promise<void> {
  const originalConfirm = window.confirm;
  window.confirm = () => true;
  try {
    for (let guard = 0; guard < 512; guard += 1) {
      const card = qs<HTMLElement>("#studioGroupList .studio-group-card[data-group-id]");
      if (!card) break;
      card.querySelector<HTMLButtonElement>(".group-open")?.click();
      await delay(0);
      qs<HTMLButtonElement>("#studioDeleteGroup")?.click();
      await delay(0);
    }
  } finally {
    window.confirm = originalConfirm;
  }
}

async function createEditorGroup(name: string, paths: string[]): Promise<boolean> {
  qs<HTMLButtonElement>("#studioShowAll")?.click();
  await delay(0);
  clearTileSelection();
  const matched = selectTilePaths(paths);
  if (matched === 0) return false;

  const before = cardCount();
  const originalPrompt = window.prompt;
  window.prompt = () => name;
  try {
    qs<HTMLButtonElement>("#studioNewGroup")?.click();
  } finally {
    window.prompt = originalPrompt;
  }
  await delay(0);
  return cardCount() === before + 1;
}

async function selectFirstGroupFrame(): Promise<void> {
  const opener = qs<HTMLButtonElement>("#studioGroupList .studio-group-card[data-group-id] .group-open");
  opener?.click();
  await delay(0);

  // Re-enter the main Photo Workspace selection model after the bridge's temporary
  // class-only selection. This keeps inspector, multi-select and subsequent drag/drop
  // behavior aligned with main.ts.
  qs<HTMLButtonElement>("#clearPhotoSelection")?.click();
  await delay(0);
  const firstVisible = tiles().find((tile) => !tile.classList.contains("studio-group-hidden"));
  firstVisible?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await delay(0);
}

async function importResolvedGroups(detail: GroupsResolvedDetail): Promise<void> {
  if (importing) return;
  importing = true;
  try {
    const sourceLabel = qs<HTMLElement>("#photoSourcePath")?.textContent?.trim() ?? "";
    if (!detail?.source || normalizePath(sourceLabel) !== normalizePath(detail.source)) return;

    const available = new Set(tiles().map((tile) => tile.dataset.path).filter((path): path is string => Boolean(path)));
    if (available.size === 0) return;

    const resolved = (detail.groups ?? [])
      .map((group) => ({ name: group.name, paths: group.paths.filter((path) => available.has(path)) }))
      .filter((group) => group.paths.length > 0);
    if (resolved.length === 0) return;

    await clearExistingGroups();
    clearTileSelection();

    let importedGroups = 0;
    let importedFrames = 0;
    for (const group of resolved) {
      if (await createEditorGroup(group.name, group.paths)) {
        importedGroups += 1;
        importedFrames += group.paths.length;
      }
    }

    clearTileSelection();
    if (importedGroups !== resolved.length || importedFrames === 0) {
      console.error(`[Tihulu Studio] imported ${importedGroups}/${resolved.length} engine groups into live Studio state`);
      return;
    }

    await selectFirstGroupFrame();
    window.dispatchEvent(new CustomEvent("tihulu:workspace-groups-imported", {
      detail: { groups: importedGroups, frames: importedFrames, source: detail.source },
    }));
  } finally {
    clearTileSelection();
    importing = false;
  }
}

// Register before workspace-parity. The bridge only performs the one-time engine
// result import; Studio Editor remains the owner of group state and all later edits.
window.addEventListener("tihulu:engine-groups-resolved", (event) => {
  event.stopImmediatePropagation();
  const detail = (event as CustomEvent<GroupsResolvedDetail>).detail;
  void importResolvedGroups(detail);
});

export {};
