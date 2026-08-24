// SPDX-License-Identifier: AGPL-3.0-only
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
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
type EngineGroup = { name: string; sources: string[] };
type ManifestFile = { source?: string; group_path?: string };
type ManifestGroup = { name?: string; files?: ManifestFile[] };
type EngineManifest = { groups?: ManifestGroup[] };

let lastStartedMode: string | null = null;

queueMicrotask(() => {
  installSyncButton();
  document.querySelector<HTMLButtonElement>("#startJob")?.addEventListener("click", () => {
    lastStartedMode = document.querySelector<HTMLButtonElement>(".mode-tab.active")?.dataset.mode ?? null;
  }, true);

  void listen<JobFinished>("job-finished", (event) => {
    if (!event.payload.success) return;
    const mode = lastStartedMode ?? document.querySelector<HTMLButtonElement>(".mode-tab.active")?.dataset.mode;
    if (mode !== "group" && mode !== "run") return;
    window.setTimeout(() => void syncAfterSuccessfulJob(mode), 220);
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
  button.title = "Read manifest.json/group_* output and map engine groups back to the original source frames";
  button.addEventListener("click", () => void syncEngineGroups(true, true));
  actions.insertBefore(button, actions.querySelector("#studioGroupUndo"));
}

async function syncAfterSuccessfulJob(mode: string): Promise<void> {
  if (mode === "group") {
    document.querySelector<HTMLButtonElement>('.section-tab[data-section="photos"]')?.click();
  }
  const ready = await ensureSourceWorkspaceLoaded();
  if (!ready) {
    toast("Grouping finished, but the original source workspace could not be loaded automatically.");
    return;
  }
  await syncEngineGroups(mode === "group", false);
}

function processInputPath(): string {
  const node = document.querySelector<HTMLElement>("#inputPath");
  if (!node || node.classList.contains("empty")) return "";
  return node.textContent?.trim() ?? "";
}

function workspaceSourcePath(): string {
  const text = document.querySelector<HTMLElement>("#photoSourcePath")?.textContent?.trim() ?? "";
  return text === "No folder selected" || text === "Scanning…" ? "" : text;
}

async function ensureSourceWorkspaceLoaded(): Promise<boolean> {
  const processInput = processInputPath();
  if (!processInput) return false;
  const sourceMatches = normalizePath(workspaceSourcePath()) === normalizePath(processInput);
  const hasTiles = Boolean(document.querySelector("#photoGrid .photo-tile[data-path]"));
  if (hasTiles && sourceMatches) return true;

  // Never sync against output/groups or another arbitrary workspace. Always
  // restore the original Process input first, then map engine groups onto it.
  const scan = document.querySelector<HTMLButtonElement>("#scanFromProcess");
  if (!scan) return false;
  scan.click();
  return waitFor(() => {
    const matches = normalizePath(workspaceSourcePath()) === normalizePath(processInput);
    return matches && Boolean(document.querySelector("#photoGrid .photo-tile[data-path]"));
  }, 15000);
}

async function syncEngineGroups(showMessages: boolean, switchToWorkspace: boolean): Promise<void> {
  if (switchToWorkspace) {
    document.querySelector<HTMLButtonElement>('.section-tab[data-section="photos"]')?.click();
  }

  const output = document.querySelector<HTMLElement>("#outputPath");
  if (!output || output.classList.contains("empty")) {
    if (showMessages) toast("Choose or create a grouped output first.");
    return;
  }
  const outputPath = output.textContent?.trim() ?? "";
  if (!outputPath) return;

  const ready = await ensureSourceWorkspaceLoaded();
  if (!ready) {
    if (showMessages) toast("Load the original source photos in Photo Workspace first.");
    return;
  }

  const sourceTiles = Array.from(document.querySelectorAll<HTMLElement>("#photoGrid .photo-tile[data-path]"));
  const groups = await loadEngineGroupsWithRetry(outputPath);
  if (groups.length === 0) {
    if (showMessages) toast("No engine groups were found in manifest.json or group_* folders.");
    return;
  }

  const sourceByBase = new Map<string, string[]>();
  const sourceByPath = new Map<string, string>();
  for (const tile of sourceTiles) {
    const path = tile.dataset.path;
    if (!path) continue;
    sourceByPath.set(normalizePath(path), path);
    const key = normalizeBase(path);
    if (!sourceByBase.has(key)) sourceByBase.set(key, []);
    sourceByBase.get(key)!.push(path);
  }

  let matched = 0;
  let groupsMatched = 0;
  document.querySelector<HTMLButtonElement>("#studioShowAll")?.click();
  await nextFrame();

  for (const group of groups) {
    const targetPaths: string[] = [];
    const used = new Set<string>();
    for (const source of group.sources) {
      const exact = sourceByPath.get(normalizePath(source));
      if (exact && !used.has(exact)) {
        targetPaths.push(exact);
        used.add(exact);
        continue;
      }
      const pool = sourceByBase.get(normalizeBase(source)) ?? [];
      const candidate = pool.find((path) => !used.has(path));
      if (candidate) {
        targetPaths.push(candidate);
        used.add(candidate);
      }
    }
    if (targetPaths.length === 0) continue;
    matched += targetPaths.length;
    groupsMatched += 1;
    await selectPaths(targetPaths);
    await ensureGroupAndMove(group.name);
  }

  document.querySelector<HTMLButtonElement>("#studioShowAll")?.click();
  await nextFrame();
  document.querySelector<HTMLButtonElement>("#studioGroupList .studio-group-card:not(.all-card) .group-open")?.click();
  await nextFrame();
  selectFirstVisibleFrame();

  window.dispatchEvent(new CustomEvent("tihulu:engine-groups-synced", {
    detail: { groups, groupsMatched, matched, source: processInput, output: outputPath },
  }));
  if (showMessages || matched > 0) {
    toast(`Synced ${groupsMatched}/${groups.length} engine group(s) · ${matched} original source frame(s) matched.`);
  }
}

async function loadEngineGroupsWithRetry(outputPath: string): Promise<EngineGroup[]> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let groups = await groupsFromManifest(outputPath);
    if (groups.length === 0) groups = await groupsFromMaterializedOutput(outputPath);
    if (groups.length > 0) return groups;
    await delay(180 + attempt * 70);
  }
  return [];
}

async function groupsFromManifest(outputPath: string): Promise<EngineGroup[]> {
  const separator = outputPath.includes("\\") ? "\\" : "/";
  const manifestPath = `${outputPath.replace(/[\\/]+$/, "")}${separator}manifest.json`;
  try {
    const response = await fetch(convertFileSrc(manifestPath));
    if (!response.ok) return [];
    const manifest = await response.json() as EngineManifest;
    return (manifest.groups ?? []).map((group, index) => ({
      name: group.name?.trim() || `group_${String(index + 1).padStart(3, "0")}`,
      sources: (group.files ?? []).map((file) => file.source || file.group_path || "").filter(Boolean),
    })).filter((group) => group.sources.length > 0);
  } catch {
    return [];
  }
}

async function groupsFromMaterializedOutput(outputPath: string): Promise<EngineGroup[]> {
  let photos: PhotoInfo[];
  try {
    photos = await invoke<PhotoInfo[]>("scan_photos", { input: outputPath, recursive: true });
  } catch {
    return [];
  }
  const map = new Map<string, string[]>();
  for (const photo of photos) {
    const parts = photo.path.split(/[\\/]/).filter(Boolean);
    const groupName = parts.find((part) => /^group[_ -]?\d*/i.test(part));
    if (!groupName) continue;
    if (!map.has(groupName)) map.set(groupName, []);
    map.get(groupName)!.push(photo.name);
  }
  return [...map.entries()].map(([name, sources]) => ({ name, sources }));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
}

function normalizeBase(value: string): string {
  let base = value.split(/[\\/]/).pop() ?? value;
  base = base.replace(/^\d{6}_/, "").replace(/^\d{4}_/, "");
  return base.toLocaleLowerCase();
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
  const existing = cards().find((card) => card.querySelector("strong")?.textContent?.trim() === name);
  if (!existing) {
    const originalPrompt = window.prompt;
    window.prompt = () => name;
    try { document.querySelector<HTMLButtonElement>("#studioNewGroup")?.click(); }
    finally { window.prompt = originalPrompt; }
    await nextFrame();
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

function selectFirstVisibleFrame(): void {
  const tile = Array.from(document.querySelectorAll<HTMLElement>("#photoGrid .photo-tile[data-path]"))
    .find((item) => !item.classList.contains("studio-group-hidden"));
  tile?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const started = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (predicate()) { resolve(true); return; }
      if (performance.now() - started >= timeoutMs) { resolve(false); return; }
      window.setTimeout(tick, 100);
    };
    tick();
  });
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, ms)); }
function nextFrame(): Promise<void> { return new Promise((resolve) => requestAnimationFrame(() => resolve())); }
function toast(message: string): void {
  let node = document.querySelector<HTMLDivElement>("#studioToast");
  if (!node) { node = document.createElement("div"); node.id = "studioToast"; node.className = "studio-toast"; document.body.append(node); }
  node.textContent = message;
  node.classList.add("show");
  window.setTimeout(() => node?.classList.remove("show"), 3600);
}
