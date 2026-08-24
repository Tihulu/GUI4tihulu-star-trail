// SPDX-License-Identifier: AGPL-3.0-only
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type PhotoInfo = {
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
  modifiedMs: number | null;
  isRaw: boolean;
  browserPreviewable: boolean;
};
type JobFinished = { success: boolean; code: number | null };
type EngineGroup = { name: string; basenames: string[] };

queueMicrotask(() => {
  installSyncButton();
  void listen<JobFinished>("job-finished", (event) => {
    if (!event.payload.success) return;
    const mode = document.querySelector<HTMLButtonElement>(".mode-tab.active")?.dataset.mode;
    if (mode === "group" || mode === "run") window.setTimeout(() => void syncEngineGroups(false), 350);
  });
});

function installSyncButton(): void {
  const actions = document.querySelector<HTMLElement>(".studio-command-actions");
  if (!actions || document.querySelector("#studioSyncEngineGroups")) return;
  const button = document.createElement("button");
  button.id = "studioSyncEngineGroups";
  button.type = "button";
  button.className = "ghost-button compact-button";
  button.textContent = "Sync engine groups";
  button.title = "Read group_* folders from the current output and map them back to the Photo Workspace";
  button.addEventListener("click", () => void syncEngineGroups(true));
  actions.insertBefore(button, actions.querySelector("#studioGroupUndo"));
}

async function syncEngineGroups(showMessages: boolean): Promise<void> {
  const output = document.querySelector<HTMLElement>("#outputPath");
  if (!output || output.classList.contains("empty")) {
    if (showMessages) toast("Choose or create a grouped output first.");
    return;
  }
  const outputPath = output.textContent?.trim() ?? "";
  if (!outputPath) return;
  const sourceTiles = Array.from(document.querySelectorAll<HTMLElement>("#photoGrid .photo-tile[data-path]"));
  if (sourceTiles.length === 0) {
    if (showMessages) toast("Load the source photos in Photo Workspace first.");
    return;
  }

  let photos: PhotoInfo[];
  try {
    photos = await invoke<PhotoInfo[]>("scan_photos", { input: outputPath, recursive: true });
  } catch (error) {
    if (showMessages) toast(`Could not read grouped output: ${String(error)}`);
    return;
  }

  const groups = engineGroupsFromOutput(photos);
  if (groups.length === 0) {
    if (showMessages) toast("No materialized group_* photo folders were found in the output.");
    return;
  }

  const sourceByBase = new Map<string, string[]>();
  for (const tile of sourceTiles) {
    const path = tile.dataset.path;
    if (!path) continue;
    const key = normalizeBase(path);
    if (!sourceByBase.has(key)) sourceByBase.set(key, []);
    sourceByBase.get(key)!.push(path);
  }

  let matched = 0;
  document.querySelector<HTMLButtonElement>("#studioShowAll")?.click();
  await nextFrame();

  for (const group of groups) {
    const targetPaths: string[] = [];
    const pools = new Map<string, string[]>([...sourceByBase].map(([key, values]) => [key, [...values]]));
    for (const base of group.basenames) {
      const pool = pools.get(normalizeBase(base));
      const path = pool?.shift();
      if (path) targetPaths.push(path);
    }
    if (targetPaths.length === 0) continue;
    matched += targetPaths.length;
    await selectPaths(targetPaths);
    await ensureGroupAndMove(group.name);
  }

  document.querySelector<HTMLButtonElement>("#studioShowAll")?.click();
  if (showMessages || matched > 0) toast(`Synced ${groups.length} engine group(s) · ${matched} source frame(s) matched.`);
}

function engineGroupsFromOutput(photos: PhotoInfo[]): EngineGroup[] {
  const map = new Map<string, string[]>();
  for (const photo of photos) {
    const parts = photo.path.split(/[\\/]/).filter(Boolean);
    const groupName = parts.find((part) => /^group[_ -]?/i.test(part));
    if (!groupName) continue;
    if (!map.has(groupName)) map.set(groupName, []);
    map.get(groupName)!.push(photo.name);
  }
  return [...map.entries()].map(([name, basenames]) => ({ name, basenames }));
}

function normalizeBase(value: string): string {
  const base = value.split(/[\\/]/).pop() ?? value;
  return base.replace(/^\d{6}_/, "").toLocaleLowerCase();
}

async function selectPaths(paths: string[]): Promise<void> {
  document.querySelector<HTMLButtonElement>("#clearPhotoSelection")?.click();
  await nextFrame();
  for (const path of paths) {
    const tile = Array.from(document.querySelectorAll<HTMLElement>("#photoGrid .photo-tile[data-path]")).find((item) => item.dataset.path === path);
    if (!tile) continue;
    tile.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    await nextFrame();
  }
}

async function ensureGroupAndMove(name: string): Promise<void> {
  const cards = () => Array.from(document.querySelectorAll<HTMLElement>("#studioGroupList .studio-group-card[data-group-id]"));
  let existing = cards().find((card) => card.querySelector("strong")?.textContent?.trim() === name);
  if (!existing) {
    const originalPrompt = window.prompt;
    window.prompt = () => name;
    try { document.querySelector<HTMLButtonElement>("#studioNewGroup")?.click(); }
    finally { window.prompt = originalPrompt; }
    await nextFrame();
    existing = cards().find((card) => card.querySelector("strong")?.textContent?.trim() === name);
    return;
  }
  const groupId = existing.dataset.groupId;
  const moveTarget = document.querySelector<HTMLSelectElement>("#studioMoveTarget");
  if (groupId && moveTarget) {
    moveTarget.value = groupId;
    moveTarget.dispatchEvent(new Event("change", { bubbles: true }));
    await nextFrame();
  }
}

function nextFrame(): Promise<void> { return new Promise((resolve) => requestAnimationFrame(() => resolve())); }
function toast(message: string): void {
  let node = document.querySelector<HTMLDivElement>("#studioToast");
  if (!node) { node = document.createElement("div"); node.id = "studioToast"; node.className = "studio-toast"; document.body.append(node); }
  node.textContent = message;
  node.classList.add("show");
  window.setTimeout(() => node?.classList.remove("show"), 2600);
}
