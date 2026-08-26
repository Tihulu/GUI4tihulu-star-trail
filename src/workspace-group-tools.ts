// SPDX-License-Identifier: AGPL-3.0-only
import "./workspace-group-tools.css";

type GroupRecord = { id: string; name: string };
type StudioState = {
  version: 1;
  groups: GroupRecord[];
  assignments: Array<[string, string | null]>;
  edits: Array<[string, unknown]>;
};

type BulkSnapshot = { source: string; raw: string };
let lastBulkSnapshot: BulkSnapshot | null = null;

function qs<T extends Element>(selector: string): T | null { return document.querySelector<T>(selector); }
function nextFrame(): Promise<void> { return new Promise((resolve) => requestAnimationFrame(() => resolve())); }

function sourceKey(): string {
  const value = qs<HTMLElement>("#photoSourcePath")?.textContent?.trim() ?? "";
  return value === "No folder selected" || value === "Scanning…" ? "" : value;
}
function storageKey(source: string): string { return `tihulu-studio-v1:${source}`; }

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
  window.setTimeout(() => node?.classList.remove("show"), 3600);
}

function groupCheckboxes(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>("#studioGroupList .studio-group-card[data-group-id] .group-check input[type='checkbox']"));
}

function selectedGroupIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("#studioGroupList .studio-group-card[data-group-id]"))
    .filter((card) => card.querySelector<HTMLInputElement>(".group-check input")?.checked)
    .map((card) => card.dataset.groupId)
    .filter((id): id is string => Boolean(id));
}

function setChecked(input: HTMLInputElement, checked: boolean): void {
  if (input.checked === checked) return;
  input.checked = checked;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function updateSelectionUi(): void {
  const checkboxes = groupCheckboxes();
  const selected = checkboxes.filter((input) => input.checked).length;
  const status = qs<HTMLElement>("#workspaceGroupSelectionStatus");
  if (status) status.textContent = `${selected} selected / ${checkboxes.length} groups`;
  const deleteButton = qs<HTMLButtonElement>("#workspaceDeleteSelectedGroups");
  if (deleteButton) deleteButton.disabled = selected === 0;
  const undoButton = qs<HTMLButtonElement>("#workspaceUndoBulkGroupDelete");
  if (undoButton) undoButton.disabled = !lastBulkSnapshot || lastBulkSnapshot.source !== sourceKey();

  document.querySelectorAll<HTMLElement>("#studioGroupList .group-check").forEach((label) => {
    label.title = "Select group for bulk actions or merge";
  });
}

async function forceStudioReload(source: string): Promise<void> {
  const label = qs<HTMLElement>("#photoSourcePath");
  const grid = qs<HTMLElement>("#photoGrid");
  if (!label || !grid) return;
  const visibility = label.style.visibility;
  label.style.visibility = "hidden";
  label.textContent = `${source}#bulk-group-refresh-${Date.now()}`;
  grid.classList.toggle("bulk-group-refresh-a");
  await nextFrame(); await nextFrame();
  label.textContent = source;
  grid.classList.toggle("bulk-group-refresh-b");
  await nextFrame(); await nextFrame();
  label.style.visibility = visibility;
  updateSelectionUi();
}

async function deleteSelectedGroups(): Promise<void> {
  const ids = new Set(selectedGroupIds());
  if (!ids.size) { toast("Select one or more groups first."); return; }
  const source = sourceKey();
  if (!source) { toast("Load a Photo Workspace first."); return; }
  const raw = localStorage.getItem(storageKey(source));
  if (!raw) { toast("No saved group state is available."); return; }

  let state: StudioState;
  try { state = JSON.parse(raw) as StudioState; }
  catch { toast("Group state could not be read safely."); return; }
  if (state.version !== 1 || !Array.isArray(state.groups) || !Array.isArray(state.assignments)) {
    toast("Group state format is not supported.");
    return;
  }

  const names = state.groups.filter((group) => ids.has(group.id)).map((group) => group.name);
  if (!names.length) { toast("The selected groups are no longer present."); return; }
  const label = names.length <= 4 ? names.join(", ") : `${names.slice(0, 3).join(", ")} + ${names.length - 3} more`;
  if (!window.confirm(`Delete ${names.length} selected group${names.length === 1 ? "" : "s"}?\n\n${label}\n\nPhotos become ungrouped; source files are not deleted.`)) return;

  lastBulkSnapshot = { source, raw };
  state.groups = state.groups.filter((group) => !ids.has(group.id));
  state.assignments = state.assignments.map(([path, groupId]) => [path, groupId && ids.has(groupId) ? null : groupId]);
  localStorage.setItem(storageKey(source), JSON.stringify(state));
  await forceStudioReload(source);
  toast(`Deleted ${names.length} group${names.length === 1 ? "" : "s"}. Photos were kept and became ungrouped.`);
}

async function undoBulkDelete(): Promise<void> {
  const snapshot = lastBulkSnapshot;
  if (!snapshot || snapshot.source !== sourceKey()) { toast("No bulk group delete to undo here."); return; }
  localStorage.setItem(storageKey(snapshot.source), snapshot.raw);
  lastBulkSnapshot = null;
  await forceStudioReload(snapshot.source);
  toast("Bulk group delete undone.");
}

function installLayout(): boolean {
  const commandBar = qs<HTMLElement>(".studio-command-bar");
  const photoLayout = qs<HTMLElement>("#section-photos .photo-layout");
  if (!commandBar || !photoLayout) return false;
  if (commandBar.nextElementSibling !== photoLayout) photoLayout.insertAdjacentElement("beforebegin", commandBar);
  return true;
}

function installBulkToolbar(): boolean {
  const panel = qs<HTMLElement>(".studio-group-panel");
  const list = qs<HTMLElement>("#studioGroupList");
  if (!panel || !list) return false;
  if (!qs("#workspaceGroupBulkToolbar")) {
    const toolbar = document.createElement("div");
    toolbar.id = "workspaceGroupBulkToolbar";
    toolbar.className = "workspace-group-bulk-toolbar";
    toolbar.innerHTML = `
      <div class="workspace-group-bulk-copy">
        <strong>Group selection</strong>
        <small id="workspaceGroupSelectionStatus">0 selected</small>
      </div>
      <div class="workspace-group-bulk-actions">
        <button type="button" class="ghost-button compact-button" id="workspaceSelectAllGroups">Select all</button>
        <button type="button" class="ghost-button compact-button" id="workspaceClearGroupSelection">Clear</button>
        <button type="button" class="ghost-button compact-button" id="workspaceInvertGroupSelection">Invert</button>
        <button type="button" class="ghost-button compact-button" id="workspaceUndoBulkGroupDelete" disabled>Undo delete</button>
        <button type="button" class="ghost-button compact-button danger-text" id="workspaceDeleteSelectedGroups" disabled>Delete selected</button>
      </div>`;
    const parity = panel.querySelector("#workspaceParityBar");
    if (parity) parity.insertAdjacentElement("afterend", toolbar);
    else panel.querySelector(".studio-panel-head")?.insertAdjacentElement("afterend", toolbar);

    qs<HTMLButtonElement>("#workspaceSelectAllGroups")?.addEventListener("click", () => {
      groupCheckboxes().forEach((input) => setChecked(input, true)); updateSelectionUi();
    });
    qs<HTMLButtonElement>("#workspaceClearGroupSelection")?.addEventListener("click", () => {
      groupCheckboxes().forEach((input) => setChecked(input, false)); updateSelectionUi();
    });
    qs<HTMLButtonElement>("#workspaceInvertGroupSelection")?.addEventListener("click", () => {
      groupCheckboxes().forEach((input) => setChecked(input, !input.checked)); updateSelectionUi();
    });
    qs<HTMLButtonElement>("#workspaceDeleteSelectedGroups")?.addEventListener("click", () => void deleteSelectedGroups());
    qs<HTMLButtonElement>("#workspaceUndoBulkGroupDelete")?.addEventListener("click", () => void undoBulkDelete());
  }

  if (list.dataset.bulkGroupObserved !== "1") {
    list.dataset.bulkGroupObserved = "1";
    list.addEventListener("change", updateSelectionUi);
    new MutationObserver(updateSelectionUi).observe(list, { childList: true, subtree: true });
  }
  updateSelectionUi();
  return true;
}

function install(): boolean { return installLayout() && installBulkToolbar(); }
function start(): void {
  if (install()) return;
  let attempts = 0;
  const timer = window.setInterval(() => { attempts += 1; if (install() || attempts >= 180) window.clearInterval(timer); }, 50);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();

export {};
