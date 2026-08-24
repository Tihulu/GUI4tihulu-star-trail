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
type ResolvedGroup = { name: string; paths: string[] };
type ManifestFile = { source?: string; group_path?: string };
type ManifestGroup = { name?: string; files?: ManifestFile[] };
type EngineManifest = { groups?: ManifestGroup[] };
type GroupsResolvedDetail = { groups: ResolvedGroup[]; source: string; output: string };

let lastStartedMode: string | null = null;

start();

function start(): void {
  installWhenReady();
  document.querySelector<HTMLButtonElement>("#startJob")?.addEventListener("click", () => {
    lastStartedMode = document.querySelector<HTMLButtonElement>(".mode-tab.active")?.dataset.mode ?? null;
  }, true);

  void listen<JobFinished>("job-finished", (event) => {
    if (!event.payload.success) return;
    const mode = lastStartedMode ?? document.querySelector<HTMLButtonElement>(".mode-tab.active")?.dataset.mode;
    if (mode !== "group" && mode !== "run") return;
    window.setTimeout(() => void syncAfterSuccessfulJob(mode), 180);
  });
}

function installWhenReady(): void {
  if (installSyncButton()) return;
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (installSyncButton() || attempts >= 160) window.clearInterval(timer);
  }, 50);
}

function installSyncButton(): boolean {
  const actions = document.querySelector<HTMLElement>(".studio-command-actions");
  if (!actions) return false;
  if (document.querySelector("#studioSyncEngineGroups")) return true;
  const button = document.createElement("button");
  button.id = "studioSyncEngineGroups";
  button.type = "button";
  button.className = "ghost-button compact-button";
  button.textContent = "Sync engine groups";
  button.title = "Import manifest.json/group_* output into the original source workspace";
  button.addEventListener("click", () => void syncEngineGroups(true, true));
  actions.insertBefore(button, actions.querySelector("#studioGroupUndo"));
  return true;
}

async function syncAfterSuccessfulJob(mode: string): Promise<void> {
  if (mode === "group") {
    document.querySelector<HTMLButtonElement>('.section-tab[data-section="photos"]')?.click();
  }
  await syncEngineGroups(mode === "group", mode === "group");
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

  const scan = document.querySelector<HTMLButtonElement>("#scanFromProcess");
  if (!scan) return false;
  scan.click();
  return waitFor(() => {
    const matches = normalizePath(workspaceSourcePath()) === normalizePath(processInput);
    return matches && Boolean(document.querySelector("#photoGrid .photo-tile[data-path]"));
  }, 20000);
}

async function syncEngineGroups(showMessages: boolean, switchToWorkspace: boolean): Promise<void> {
  if (switchToWorkspace) {
    document.querySelector<HTMLButtonElement>('.section-tab[data-section="photos"]')?.click();
  }

  const outputNode = document.querySelector<HTMLElement>("#outputPath");
  if (!outputNode || outputNode.classList.contains("empty")) {
    if (showMessages) toast("Choose an output folder first.");
    return;
  }
  const outputPath = outputNode.textContent?.trim() ?? "";
  const sourcePath = processInputPath();
  if (!sourcePath || !outputPath) {
    if (showMessages) toast("Choose both the original input and output folders first.");
    return;
  }

  const ready = await ensureSourceWorkspaceLoaded();
  if (!ready) {
    toast("Grouping finished, but the original Process input could not be loaded into Photo Workspace.");
    return;
  }

  const sourceTiles = Array.from(document.querySelectorAll<HTMLElement>("#photoGrid .photo-tile[data-path]"));
  const engineGroups = await loadEngineGroupsWithRetry(outputPath);
  if (engineGroups.length === 0) {
    if (showMessages) toast("No engine groups were found in manifest.json or group_* output folders.");
    return;
  }

  const resolvedGroups = resolveEngineGroups(engineGroups, sourceTiles);
  const matched = resolvedGroups.reduce((sum, group) => sum + group.paths.length, 0);
  if (resolvedGroups.length === 0 || matched === 0) {
    toast("Engine groups were found, but none could be mapped back to the original source frames.");
    return;
  }

  const detail: GroupsResolvedDetail = { groups: resolvedGroups, source: sourcePath, output: outputPath };
  const ack = waitForWorkspaceImport(5000);
  window.dispatchEvent(new CustomEvent<GroupsResolvedDetail>("tihulu:engine-groups-resolved", { detail }));
  const imported = await ack;

  if (showMessages || imported) {
    toast(imported
      ? `Imported ${resolvedGroups.length} group(s) · ${matched} original frame(s) into Photo Workspace.`
      : `Resolved ${resolvedGroups.length} group(s), but the workspace did not acknowledge the import.`);
  }
}

function resolveEngineGroups(engineGroups: EngineGroup[], sourceTiles: HTMLElement[]): ResolvedGroup[] {
  const byExact = new Map<string, string>();
  const byBase = new Map<string, string[]>();
  for (const tile of sourceTiles) {
    const path = tile.dataset.path;
    if (!path) continue;
    byExact.set(normalizePath(path), path);
    const base = normalizeBase(path);
    const pool = byBase.get(base) ?? [];
    pool.push(path);
    byBase.set(base, pool);
  }

  const consumed = new Set<string>();
  const result: ResolvedGroup[] = [];
  for (const engineGroup of engineGroups) {
    const paths: string[] = [];
    for (const source of engineGroup.sources) {
      const exact = byExact.get(normalizePath(source));
      if (exact && !consumed.has(exact)) {
        paths.push(exact);
        consumed.add(exact);
        continue;
      }
      const pool = byBase.get(normalizeBase(source)) ?? [];
      const candidate = pool.find((path) => !consumed.has(path));
      if (candidate) {
        paths.push(candidate);
        consumed.add(candidate);
      }
    }
    if (paths.length > 0) result.push({ name: engineGroup.name, paths });
  }
  return result;
}

async function loadEngineGroupsWithRetry(outputPath: string): Promise<EngineGroup[]> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    let groups = await groupsFromManifest(outputPath);
    if (groups.length === 0) groups = await groupsFromMaterializedOutput(outputPath);
    if (groups.length > 0) return groups;
    await delay(180 + attempt * 80);
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
    const sources = map.get(groupName) ?? [];
    sources.push(photo.path);
    map.set(groupName, sources);
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

function waitForWorkspaceImport(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("tihulu:workspace-groups-imported", onImported as EventListener);
      resolve(value);
    };
    const onImported = () => finish(true);
    window.addEventListener("tihulu:workspace-groups-imported", onImported as EventListener, { once: true });
    window.setTimeout(() => finish(false), timeoutMs);
  });
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
function toast(message: string): void {
  let node = document.querySelector<HTMLDivElement>("#studioToast");
  if (!node) { node = document.createElement("div"); node.id = "studioToast"; node.className = "studio-toast"; document.body.append(node); }
  node.textContent = message;
  node.classList.add("show");
  window.setTimeout(() => node?.classList.remove("show"), 3800);
}
