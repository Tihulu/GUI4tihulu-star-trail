// SPDX-License-Identifier: AGPL-3.0-only
import "./studio-editor.css";
import { invoke } from "@tauri-apps/api/core";

type GroupRecord = { id: string; name: string };
type EditState = {
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  saturation: number;
  warmth: number;
  sharpness: number;
  rotation: number;
  crop: "original" | "1:1" | "4:3" | "16:9";
  jpegQuality: number;
};
type GroupSnapshot = {
  groups: GroupRecord[];
  assignments: Array<[string, string | null]>;
  activeGroupId: string | null;
};
type StudioState = {
  version: 1;
  groups: GroupRecord[];
  assignments: Array<[string, string | null]>;
  edits: Array<[string, EditState]>;
};
type LocalDrawable = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

const DEFAULT_EDIT: EditState = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  warmth: 0,
  sharpness: 0,
  rotation: 0,
  crop: "original",
  jpegQuality: 95,
};

const EDIT_INFO: Record<keyof EditState, { title: string; body: string }> = {
  exposure: { title: "Exposure", body: "Scales overall light approximately in photographic stops. +1 is about twice the light; -1 is about half. Increase carefully to avoid clipping bright stars." },
  brightness: { title: "Brightness", body: "Adds or removes mid-level brightness after exposure. Use for small overall corrections; prefer Exposure for larger changes." },
  contrast: { title: "Contrast", body: "Separates dark and bright tones. Higher values make star trails punchier but can crush faint sky detail." },
  highlights: { title: "Highlights", body: "Targets brighter pixels more strongly. Lower it to recover bright foreground or saturated trail regions; raise it for stronger highlights." },
  shadows: { title: "Shadows", body: "Targets darker pixels more strongly. Raise it to reveal foreground/sky detail; too much can expose noise." },
  saturation: { title: "Saturation", body: "Controls color intensity. Small positive values can strengthen star/sky colors; large values may exaggerate sensor noise and color casts." },
  warmth: { title: "Warmth / temperature", body: "Moves the image toward warmer red/yellow or cooler blue tones. Useful for correcting white balance without changing originals." },
  sharpness: { title: "Sharpness", body: "Applies a light edge-enhancement pass in the preview/export renderer. High values can amplify noise and hot pixels." },
  rotation: { title: "Rotation", body: "Rotates the non-destructive edit. Use ±90° for orientation fixes or fine values for horizon alignment." },
  crop: { title: "Crop aspect", body: "Sets a centered crop aspect for preview/export. Original keeps the full frame; 1:1, 4:3 and 16:9 crop without modifying the source file." },
  jpegQuality: { title: "JPEG export quality", body: "Only affects edited JPEG exports from this studio. 95 is high quality. Lower values reduce file size but add compression artifacts." },
};

const grid = document.querySelector<HTMLDivElement>("#photoGrid");
const photoSection = document.querySelector<HTMLElement>("#section-photos");
const photoControls = document.querySelector<HTMLElement>(".photo-controls");
const photoLayout = document.querySelector<HTMLElement>(".photo-layout");
const sortSelect = document.querySelector<HTMLSelectElement>("#photoSort");

if (!grid || !photoSection || !photoControls || !photoLayout || !sortSelect) {
  console.warn("Studio Editor: Photo Workspace is unavailable.");
} else {
  setupStudioEditor(grid, photoSection, photoControls, photoLayout, sortSelect);
}

function setupStudioEditor(
  photoGrid: HTMLDivElement,
  section: HTMLElement,
  controls: HTMLElement,
  layout: HTMLElement,
  orderSelect: HTMLSelectElement,
): void {
  void section;
  let groups: GroupRecord[] = [];
  let assignments = new Map<string, string | null>();
  let edits = new Map<string, EditState>();
  let activeGroupId: string | null = null;
  let selectedGroupIds = new Set<string>();
  let groupSelectionAnchor: string | null = null;
  let draggedGroupId: string | null = null;
  let currentPrimaryPath: string | null = null;
  let editHistory: EditState[] = [cloneEdit(DEFAULT_EDIT)];
  let editHistoryIndex = 0;
  let editClipboard: EditState | null = null;
  let groupUndo: GroupSnapshot[] = [];
  let groupRedo: GroupSnapshot[] = [];
  let beforeMode = false;
  let renderGeneration = 0;
  let previewTimer: number | null = null;
  let saveTimer: number | null = null;
  let lastSourceKey = "";

  const commandBar = document.createElement("section");
  commandBar.className = "studio-command-bar glass-card";
  commandBar.innerHTML = `
    <div class="studio-command-copy">
      <span class="toolbar-label">MANUAL REVIEW + GROUPS</span>
      <strong>Sort first, then keep dragging manually</strong>
      <small>Any automatic order becomes the new manual starting point. Group moves and edits stay non-destructive.</small>
    </div>
    <div class="studio-command-actions">
      <button class="ghost-button compact-button" id="studioShowAll" type="button">All frames</button>
      <button class="secondary-button compact-button" id="studioGroupsFromFolders" type="button">Groups from folders</button>
      <button class="secondary-button compact-button" id="studioNewGroup" type="button">New group from selected</button>
      <label class="studio-move-field"><span>Move selected</span><select id="studioMoveTarget"><option value="">Choose group…</option></select></label>
      <button class="ghost-button compact-button" id="studioGroupUndo" type="button" title="Undo group operation">↶ Undo</button>
      <button class="ghost-button compact-button" id="studioGroupRedo" type="button" title="Redo group operation">↷ Redo</button>
    </div>`;
  controls.insertAdjacentElement("afterend", commandBar);

  const groupPanel = document.createElement("section");
  groupPanel.className = "studio-group-panel glass-card";
  groupPanel.innerHTML = `
    <div class="studio-panel-head">
      <div><span class="toolbar-label">GROUP WORKSPACE</span><strong>Groups</strong><small>Drop selected photos on a group. Drag group cards to reorder them.</small></div>
      <div class="studio-panel-actions">
        <button class="ghost-button compact-button" id="studioSelectAllGroups" type="button">Select all</button>
        <button class="ghost-button compact-button" id="studioClearGroupSelection" type="button">Clear selection</button>
        <button class="ghost-button compact-button" id="studioInvertGroupSelection" type="button">Invert selection</button>
        <button class="ghost-button compact-button" id="studioRenameGroup" type="button">Rename active</button>
        <button class="ghost-button compact-button" id="studioSplitGroup" type="button">Split selected frames</button>
        <button class="ghost-button compact-button" id="studioMergeGroups" type="button">Merge selected groups</button>
        <button class="ghost-button compact-button danger-text" id="studioDeleteGroup" type="button">Delete selected</button>
      </div>
    </div>
    <div class="studio-group-list" id="studioGroupList"></div>
    <div class="studio-group-footer">
      <span id="studioGroupStatus">No groups yet. Existing group_* folders are detected automatically.</span>
      <button class="primary-button fit-primary" id="studioUseGroup" type="button">Use current group in Process →</button>
    </div>`;
  layout.insertAdjacentElement("afterend", groupPanel);

  const editorPanel = document.createElement("section");
  editorPanel.className = "studio-editor-panel glass-card";
  editorPanel.innerHTML = `
    <div class="studio-panel-head editor-head">
      <div><span class="toolbar-label">NON-DESTRUCTIVE IMAGE EDITOR</span><strong>Photo editor</strong><small>Original files are never modified. Preview/export settings are stored per frame.</small></div>
      <div class="studio-panel-actions">
        <button class="ghost-button compact-button" id="editBefore" type="button">Before</button>
        <button class="ghost-button compact-button" id="editUndo" type="button">↶ Undo</button>
        <button class="ghost-button compact-button" id="editRedo" type="button">↷ Redo</button>
        <button class="ghost-button compact-button" id="editReset" type="button">Reset</button>
        <button class="ghost-button compact-button" id="editCopy" type="button">Copy settings</button>
        <button class="ghost-button compact-button" id="editPaste" type="button">Paste</button>
      </div>
    </div>
    <div class="studio-editor-grid">
      <div class="studio-edit-preview-wrap">
        <div class="studio-edit-preview" id="studioEditPreview"><div class="studio-preview-empty"><span>✦</span><strong>Select a photo</strong><small>The first selected frame becomes the edit preview.</small></div></div>
        <div class="studio-preview-meta"><strong id="studioEditName">No frame selected</strong><span id="studioEditRenderMode">Preview idle</span></div>
      </div>
      <div class="studio-sliders" id="studioSliders">
        ${sliderRow("exposure", "Exposure", -3, 3, 0.05, "0.00 EV")}
        ${sliderRow("brightness", "Brightness", -100, 100, 1, "0")}
        ${sliderRow("contrast", "Contrast", -100, 100, 1, "0")}
        ${sliderRow("highlights", "Highlights", -100, 100, 1, "0")}
        ${sliderRow("shadows", "Shadows", -100, 100, 1, "0")}
        ${sliderRow("saturation", "Saturation", -100, 100, 1, "0")}
        ${sliderRow("warmth", "Warmth", -100, 100, 1, "0")}
        ${sliderRow("sharpness", "Sharpness", 0, 100, 1, "0")}
        ${sliderRow("rotation", "Rotation", -180, 180, 0.5, "0°")}
        <div class="studio-edit-row"><div class="studio-edit-label"><span>Crop aspect</span><button class="studio-info" type="button" data-edit-info="crop">i</button></div><select id="edit-crop"><option value="original">Original</option><option value="1:1">1:1</option><option value="4:3">4:3</option><option value="16:9">16:9</option></select><output id="edit-crop-value">Original</output></div>
        ${sliderRow("jpegQuality", "JPEG export quality", 60, 100, 1, "95")}
      </div>
    </div>
    <div class="studio-info-box" id="studioEditInfo"><strong>Parameter info</strong><span>Click an <b>i</b> button beside any edit parameter.</span></div>
    <div class="studio-editor-actions">
      <div class="studio-apply-group">
        <button class="secondary-button compact-button" id="editApplySelected" type="button">Apply to selected</button>
        <button class="secondary-button compact-button" id="editApplyGroup" type="button">Apply to current group</button>
        <button class="ghost-button compact-button" id="editApplyAll" type="button">Apply to all frames</button>
      </div>
      <div class="studio-export-group">
        <button class="ghost-button compact-button" id="editExportCurrent" type="button">Export current JPEG</button>
        <button class="ghost-button compact-button" id="editExportSelected" type="button">Export selected</button>
        <button class="ghost-button compact-button" id="editExportGroup" type="button">Export current group</button>
      </div>
    </div>
    <div class="studio-editor-note"><strong>Workflow note:</strong> edits are stored in the studio and applied to edited JPEG exports. The original source frames remain untouched.</div>`;
  groupPanel.insertAdjacentElement("afterend", editorPanel);

  const groupList = groupPanel.querySelector<HTMLDivElement>("#studioGroupList")!;
  const moveTarget = commandBar.querySelector<HTMLSelectElement>("#studioMoveTarget")!;
  const groupStatus = groupPanel.querySelector<HTMLSpanElement>("#studioGroupStatus")!;
  const preview = editorPanel.querySelector<HTMLDivElement>("#studioEditPreview")!;
  const editName = editorPanel.querySelector<HTMLElement>("#studioEditName")!;
  const editRenderMode = editorPanel.querySelector<HTMLElement>("#studioEditRenderMode")!;
  const editInfo = editorPanel.querySelector<HTMLElement>("#studioEditInfo")!;

  function sliderRow(key: keyof EditState, label: string, min: number, max: number, step: number, output: string): string {
    return `<div class="studio-edit-row"><div class="studio-edit-label"><span>${label}</span><button class="studio-info" type="button" data-edit-info="${key}">i</button></div><input id="edit-${key}" data-edit-key="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${DEFAULT_EDIT[key]}"><output id="edit-${key}-value">${output}</output></div>`;
  }

  function cloneEdit(value: EditState): EditState { return { ...value }; }
  function sourceKey(): string { return document.querySelector<HTMLElement>("#photoSourcePath")?.textContent?.trim() || "unknown"; }
  function storageKey(): string { return `tihulu-studio-v1:${sourceKey()}`; }

  function scheduleSave(): void {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      const state: StudioState = { version: 1, groups, assignments: [...assignments], edits: [...edits] };
      try { localStorage.setItem(storageKey(), JSON.stringify(state)); } catch { /* best effort */ }
    }, 150);
  }

  function restoreStateIfNeeded(): void {
    const key = sourceKey();
    if (!key || key === "No folder selected" || key === "Scanning…" || key === lastSourceKey) return;
    lastSourceKey = key; groups = []; assignments = new Map(); edits = new Map(); activeGroupId = null; selectedGroupIds.clear(); groupSelectionAnchor = null; groupUndo = []; groupRedo = [];
    try {
      const raw = localStorage.getItem(storageKey()); if (!raw) return;
      const parsed = JSON.parse(raw) as StudioState; if (parsed.version !== 1) return;
      groups = Array.isArray(parsed.groups) ? parsed.groups : [];
      assignments = new Map(Array.isArray(parsed.assignments) ? parsed.assignments : []);
      edits = new Map(Array.isArray(parsed.edits) ? parsed.edits.map(([path, value]) => [path, { ...DEFAULT_EDIT, ...value }]) : []);
    } catch { /* ignore stale data */ }
  }

  function tiles(): HTMLElement[] { return Array.from(photoGrid.querySelectorAll<HTMLElement>(".photo-tile[data-path]")); }
  function allPaths(): string[] { return tiles().map((tile) => tile.dataset.path!).filter(Boolean); }
  function selectedPaths(): string[] { return tiles().filter((tile) => tile.classList.contains("selected")).map((tile) => tile.dataset.path!).filter(Boolean); }
  function displayName(path: string): string { const tile = tiles().find((item) => item.dataset.path === path); return tile?.querySelector<HTMLElement>(".tile-copy strong")?.textContent?.trim() || path.split(/[\\/]/).pop() || "photo"; }

  function uniqueGroupName(base: string): string {
    const names = new Set(groups.map((group) => group.name.toLowerCase())); if (!names.has(base.toLowerCase())) return base;
    let index = 2; while (names.has(`${base} ${index}`.toLowerCase())) index += 1; return `${base} ${index}`;
  }
  function groupForPath(path: string): GroupRecord | null { const id = assignments.get(path) ?? null; return id ? groups.find((group) => group.id === id) ?? null : null; }
  function activeGroup(): GroupRecord | null { return activeGroupId ? groups.find((group) => group.id === activeGroupId) ?? null : null; }
  function groupPaths(groupId: string): string[] { return allPaths().filter((path) => assignments.get(path) === groupId); }
  function snapshotGroups(): GroupSnapshot { return { groups: groups.map((group) => ({ ...group })), assignments: [...assignments], activeGroupId }; }

  function restoreGroupSnapshot(snapshot: GroupSnapshot): void {
    groups = snapshot.groups.map((group) => ({ ...group })); assignments = new Map(snapshot.assignments); activeGroupId = snapshot.activeGroupId; selectedGroupIds.clear(); groupSelectionAnchor = null; renderGroups(); applyGroupFilter(); scheduleSave();
  }
  function recordGroupMutation(): void { groupUndo.push(snapshotGroups()); if (groupUndo.length > 50) groupUndo.shift(); groupRedo = []; }

  function autoGroupsFromPaths(onlyIfEmpty = false): void {
    if (onlyIfEmpty && groups.length > 0) return;
    const paths = allPaths(); if (paths.length === 0) return;
    const parentNames = new Map<string, string[]>();
    for (const path of paths) { const pieces = path.split(/[\\/]/).filter(Boolean); const parent = pieces.length > 1 ? pieces[pieces.length - 2] : "Ungrouped"; if (!parentNames.has(parent)) parentNames.set(parent, []); parentNames.get(parent)!.push(path); }
    const strongGroups = [...parentNames.entries()].filter(([name]) => /^group[_ -]?/i.test(name));
    if (strongGroups.length === 0 && parentNames.size <= 1) return;
    if (!onlyIfEmpty) recordGroupMutation();
    for (const [name, pathsInGroup] of (strongGroups.length ? strongGroups : [...parentNames.entries()])) {
      let group = groups.find((item) => item.name === name); if (!group) { group = { id: crypto.randomUUID(), name: uniqueGroupName(name) }; groups.push(group); }
      pathsInGroup.forEach((path) => assignments.set(path, group!.id));
    }
    renderGroups(); applyGroupFilter(); scheduleSave();
  }

  function renderGroups(): void {
    const pathSet = new Set(allPaths());
    for (const path of [...assignments.keys()]) if (!pathSet.has(path)) assignments.delete(path);
    const validGroupIds = new Set(groups.map((group) => group.id));
    selectedGroupIds = new Set([...selectedGroupIds].filter((id) => validGroupIds.has(id)));
    groupList.innerHTML = "";
    const ungroupedCount = allPaths().filter((path) => !assignments.get(path)).length;
    const allCard = document.createElement("button");
    allCard.type = "button"; allCard.className = `studio-group-card all-card${activeGroupId === null ? " active" : ""}`;
    allCard.innerHTML = `<span class="group-card-main"><strong>All frames</strong><small>${allPaths().length} photos · ${ungroupedCount} ungrouped</small></span>`;
    allCard.addEventListener("click", () => { activeGroupId = null; renderGroups(); applyGroupFilter(); });
    groupList.append(allCard);

    const selectGroup = (groupId: string, event: MouseEvent) => {
      const order = groups.map((group) => group.id);
      if (event.shiftKey && groupSelectionAnchor && order.includes(groupSelectionAnchor)) {
        if (!(event.ctrlKey || event.metaKey)) selectedGroupIds.clear();
        const [from, to] = [order.indexOf(groupSelectionAnchor), order.indexOf(groupId)].sort((a, b) => a - b);
        for (let index = from; index <= to; index += 1) selectedGroupIds.add(order[index]);
      } else if (event.ctrlKey || event.metaKey) {
        if (selectedGroupIds.has(groupId)) selectedGroupIds.delete(groupId); else selectedGroupIds.add(groupId);
        groupSelectionAnchor = groupId;
      } else {
        if (selectedGroupIds.has(groupId)) selectedGroupIds.delete(groupId); else selectedGroupIds.add(groupId);
        groupSelectionAnchor = groupId;
      }
      renderGroups();
    };

    for (const group of groups) {
      const count = groupPaths(group.id).length;
      const card = document.createElement("article");
      card.className = `studio-group-card${activeGroupId === group.id ? " active" : ""}${selectedGroupIds.has(group.id) ? " group-selected" : ""}`;
      card.draggable = true; card.dataset.groupId = group.id;
      card.innerHTML = `<button type="button" class="group-select-toggle" aria-pressed="${selectedGroupIds.has(group.id)}" title="Select group"><span></span></button><button type="button" class="group-open"><span class="group-card-main"><strong>${escapeHtml(group.name)}</strong><small>${count} photo${count === 1 ? "" : "s"}</small></span><span class="group-drop-hint">drop photos</span></button>`;
      card.querySelector<HTMLButtonElement>(".group-select-toggle")?.addEventListener("click", (event) => { event.stopPropagation(); selectGroup(group.id, event); });
      card.querySelector<HTMLButtonElement>(".group-open")?.addEventListener("click", (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey) { selectGroup(group.id, event); return; }
        activeGroupId = group.id; renderGroups(); applyGroupFilter();
      });
      card.addEventListener("dragstart", (event) => { draggedGroupId = group.id; event.dataTransfer?.setData("application/x-tihulu-group", group.id); });
      card.addEventListener("dragend", () => { draggedGroupId = null; card.classList.remove("group-drag-over"); });
      card.addEventListener("dragover", (event) => { event.preventDefault(); card.classList.add("group-drag-over"); });
      card.addEventListener("dragleave", () => card.classList.remove("group-drag-over"));
      card.addEventListener("drop", (event) => {
        event.preventDefault(); card.classList.remove("group-drag-over");
        const incomingGroup = event.dataTransfer?.getData("application/x-tihulu-group") || draggedGroupId;
        if (incomingGroup && incomingGroup !== group.id) {
          recordGroupMutation(); const from = groups.findIndex((item) => item.id === incomingGroup); const to = groups.findIndex((item) => item.id === group.id);
          if (from >= 0 && to >= 0) { const [moved] = groups.splice(from, 1); groups.splice(to, 0, moved); renderGroups(); scheduleSave(); }
          return;
        }
        const paths = selectedPaths(); const transferPath = event.dataTransfer?.getData("text/plain"); const movePaths = paths.length ? paths : transferPath ? [transferPath] : [];
        if (movePaths.length) movePathsToGroup(movePaths, group.id);
      });
      groupList.append(card);
    }
    moveTarget.innerHTML = `<option value="">Choose group…</option><option value="__ungrouped__">Ungrouped</option>${groups.map((group) => `<option value="${group.id}">${escapeHtml(group.name)}</option>`).join("")}`;
    const current = activeGroup();
    const selectionText = selectedGroupIds.size ? ` · ${selectedGroupIds.size} selected` : "";
    groupStatus.textContent = current ? `${current.name}: ${groupPaths(current.id).length} photo(s)${selectionText}. Active group controls the frame filter; selection is independent.` : `${groups.length} group(s) · ${ungroupedCount} ungrouped photo(s)${selectionText}`;
    updateGroupHistoryButtons();
  }

  function movePathsToGroup(paths: string[], groupId: string | null): void { if (paths.length === 0) return; recordGroupMutation(); paths.forEach((path) => assignments.set(path, groupId)); if (groupId) activeGroupId = groupId; renderGroups(); applyGroupFilter(); scheduleSave(); }
  function applyGroupFilter(): void { for (const tile of tiles()) { const path = tile.dataset.path!; const visible = activeGroupId === null || assignments.get(path) === activeGroupId; tile.classList.toggle("studio-group-hidden", !visible); } }
  function updateGroupHistoryButtons(): void { commandBar.querySelector<HTMLButtonElement>("#studioGroupUndo")!.disabled = groupUndo.length === 0; commandBar.querySelector<HTMLButtonElement>("#studioGroupRedo")!.disabled = groupRedo.length === 0; }

  function syncFromMainGrid(): void {
    restoreStateIfNeeded(); const paths = allPaths();
    if (paths.length === 0) { currentPrimaryPath = null; renderGroups(); renderEditorForSelection(); return; }
    autoGroupsFromPaths(true); for (const path of paths) { if (!assignments.has(path)) assignments.set(path, null); if (!edits.has(path)) edits.set(path, cloneEdit(DEFAULT_EDIT)); }
    renderGroups(); applyGroupFilter(); renderEditorForSelection();
  }

  function selectedPrimary(): string | null { const selected = selectedPaths(); if (selected.length) return selected[0]; if (activeGroupId) return groupPaths(activeGroupId)[0] ?? null; return allPaths()[0] ?? null; }
  function renderEditorForSelection(): void {
    const primary = selectedPrimary();
    const primaryChanged = primary !== currentPrimaryPath;
    if (primaryChanged) { currentPrimaryPath = primary; const state = primary ? cloneEdit(edits.get(primary) ?? DEFAULT_EDIT) : cloneEdit(DEFAULT_EDIT); editHistory = [state]; editHistoryIndex = 0; setControlsFromEdit(state); }
    updateEditButtons();
    if (!primary) { preview.innerHTML = `<div class="studio-preview-empty"><span>✦</span><strong>Select a photo</strong><small>The first selected frame becomes the edit preview.</small></div>`; editName.textContent = "No frame selected"; editRenderMode.textContent = "Preview idle"; return; }
    editName.textContent = `${displayName(primary)}${selectedPaths().length > 1 ? ` · ${selectedPaths().length} selected` : ""}`;
    if (primaryChanged || !preview.querySelector("canvas")) void renderPreview(primary);
  }

  function currentEditFromControls(): EditState {
    const numeric = (key: keyof EditState): number => Number(editorPanel.querySelector<HTMLInputElement>(`#edit-${key}`)!.value);
    return { exposure: numeric("exposure"), brightness: numeric("brightness"), contrast: numeric("contrast"), highlights: numeric("highlights"), shadows: numeric("shadows"), saturation: numeric("saturation"), warmth: numeric("warmth"), sharpness: numeric("sharpness"), rotation: numeric("rotation"), crop: editorPanel.querySelector<HTMLSelectElement>("#edit-crop")!.value as EditState["crop"], jpegQuality: numeric("jpegQuality") };
  }
  function setControlsFromEdit(state: EditState): void {
    const keys: Array<Exclude<keyof EditState, "crop">> = ["exposure", "brightness", "contrast", "highlights", "shadows", "saturation", "warmth", "sharpness", "rotation", "jpegQuality"];
    keys.forEach((key) => { const input = editorPanel.querySelector<HTMLInputElement>(`#edit-${key}`)!; input.value = String(state[key]); updateSliderOutput(key, state[key]); }); editorPanel.querySelector<HTMLSelectElement>("#edit-crop")!.value = state.crop; editorPanel.querySelector<HTMLOutputElement>("#edit-crop-value")!.value = state.crop === "original" ? "Original" : state.crop;
  }
  function updateSliderOutput(key: Exclude<keyof EditState, "crop">, value: number): void { const output = editorPanel.querySelector<HTMLOutputElement>(`#edit-${key}-value`)!; if (key === "exposure") output.value = `${value >= 0 ? "+" : ""}${value.toFixed(2)} EV`; else if (key === "rotation") output.value = `${value.toFixed(value % 1 ? 1 : 0)}°`; else output.value = `${value >= 0 && key !== "jpegQuality" ? "+" : ""}${Math.round(value)}`; }

  function commitEdit(state = currentEditFromControls()): void {
    if (!currentPrimaryPath) return; edits.set(currentPrimaryPath, cloneEdit(state)); editHistory = editHistory.slice(0, editHistoryIndex + 1); const previous = editHistory[editHistory.length - 1];
    if (JSON.stringify(previous) !== JSON.stringify(state)) { editHistory.push(cloneEdit(state)); if (editHistory.length > 80) editHistory.shift(); editHistoryIndex = editHistory.length - 1; }
    scheduleSave(); updateEditButtons(); void renderPreview(currentPrimaryPath);
  }
  function applyEditHistory(index: number): void { if (!currentPrimaryPath || index < 0 || index >= editHistory.length) return; editHistoryIndex = index; const state = cloneEdit(editHistory[index]); edits.set(currentPrimaryPath, state); setControlsFromEdit(state); scheduleSave(); updateEditButtons(); void renderPreview(currentPrimaryPath); }
  function updateEditButtons(): void { editorPanel.querySelector<HTMLButtonElement>("#editUndo")!.disabled = editHistoryIndex <= 0; editorPanel.querySelector<HTMLButtonElement>("#editRedo")!.disabled = editHistoryIndex >= editHistory.length - 1; editorPanel.querySelector<HTMLButtonElement>("#editPaste")!.disabled = !editClipboard || !currentPrimaryPath; }
  function applyCurrentEditTo(paths: string[]): void { if (!currentPrimaryPath || paths.length === 0) return; const state = cloneEdit(currentEditFromControls()); paths.forEach((path) => edits.set(path, cloneEdit(state))); scheduleSave(); toast(`Applied edit settings to ${paths.length} frame${paths.length === 1 ? "" : "s"}.`); }

  function schedulePreview(path: string): void { if (previewTimer !== null) window.clearTimeout(previewTimer); previewTimer = window.setTimeout(() => { previewTimer = null; void renderPreview(path); }, 45); }
  async function previewSource(path: string, maxSide: number): Promise<string> {
    const dimension = Math.max(1, Math.min(4096, Math.round(maxSide)));
    const tile = tiles().find((item) => item.dataset.path === path); const version = tile?.querySelector<HTMLImageElement>("img[data-thumb-path]")?.dataset.thumbVersion ?? "";
    const result = await invoke<{ dataUrl: string }>("get_thumbnail", { sourcePath: path, maxWidth: dimension, maxHeight: dimension, sourceVersion: `editor-v2:${version}` });
    if (!result.dataUrl?.startsWith("data:image/")) throw new Error("Native image decoder returned no preview data");
    return result.dataUrl;
  }
  async function renderPreview(path: string): Promise<void> {
    const generation = ++renderGeneration; const edit = beforeMode ? cloneEdit(DEFAULT_EDIT) : cloneEdit(edits.get(path) ?? DEFAULT_EDIT); editRenderMode.textContent = beforeMode ? "Before · native preview" : "Rendering edited preview…";
    try { const rendered = await buildEditedCanvas(path, edit, 1200); if (generation !== renderGeneration) return; preview.innerHTML = ""; preview.append(rendered.canvas); editRenderMode.textContent = rendered.pixelEdited ? "Edited preview · native pixel renderer" : "Edited preview · limited fallback"; }
    catch (error) { if (generation !== renderGeneration) return; preview.innerHTML = `<div class="studio-preview-empty error"><span>!</span><strong>Preview unavailable</strong><small>${escapeHtml(String(error))}</small></div>`; editRenderMode.textContent = "Preview failed"; }
  }

  async function buildEditedCanvas(path: string, edit: EditState, maxSide: number): Promise<{ canvas: HTMLCanvasElement; pixelEdited: boolean }> {
    const image = await loadLocalImage(await previewSource(path, maxSide)); const sourceW = image.width; const sourceH = image.height; if (!sourceW || !sourceH) { image.close(); throw new Error("Image dimensions unavailable"); }
    const cropRect = centeredCrop(sourceW, sourceH, edit.crop); const scale = Math.min(1, maxSide / Math.max(cropRect.w, cropRect.h)); const baseW = Math.max(1, Math.round(cropRect.w * scale)); const baseH = Math.max(1, Math.round(cropRect.h * scale)); const radians = edit.rotation * Math.PI / 180; const absCos = Math.abs(Math.cos(radians)); const absSin = Math.abs(Math.sin(radians)); const outW = Math.max(1, Math.round(baseW * absCos + baseH * absSin)); const outH = Math.max(1, Math.round(baseW * absSin + baseH * absCos));
    const canvas = document.createElement("canvas"); canvas.width = outW; canvas.height = outH; const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) { image.close(); throw new Error("Canvas renderer unavailable"); }
    try { ctx.save(); ctx.translate(outW / 2, outH / 2); ctx.rotate(radians); ctx.drawImage(image.source, cropRect.x, cropRect.y, cropRect.w, cropRect.h, -baseW / 2, -baseH / 2, baseW, baseH); ctx.restore(); }
    finally { image.close(); }
    try { const frame = ctx.getImageData(0, 0, outW, outH); applyPixelEdits(frame.data, outW, outH, edit); ctx.putImageData(frame, 0, 0); return { canvas, pixelEdited: true }; } catch (error) { console.warn("Studio Editor pixel renderer unavailable; using limited CSS fallback", error); canvas.style.filter = cssFallbackFilter(edit); return { canvas, pixelEdited: false }; }
  }
  function centeredCrop(width: number, height: number, crop: EditState["crop"]): { x: number; y: number; w: number; h: number } { if (crop === "original") return { x: 0, y: 0, w: width, h: height }; const [a, b] = crop.split(":").map(Number); const target = a / b; const current = width / height; if (current > target) { const w = height * target; return { x: (width - w) / 2, y: 0, w, h: height }; } const h = width / target; return { x: 0, y: (height - h) / 2, w: width, h }; }

  function applyPixelEdits(data: Uint8ClampedArray, width: number, height: number, edit: EditState): void {
    const exposure = Math.pow(2, edit.exposure); const brightness = edit.brightness * 1.4; const contrastValue = edit.contrast * 1.28; const contrast = (259 * (contrastValue + 255)) / (255 * (259 - contrastValue)); const saturation = 1 + edit.saturation / 100; const warmth = edit.warmth * 0.65; const shadows = edit.shadows / 100; const highlights = edit.highlights / 100;
    for (let i = 0; i < data.length; i += 4) { let r = data[i] * exposure + brightness; let g = data[i + 1] * exposure + brightness; let b = data[i + 2] * exposure + brightness; r = contrast * (r - 128) + 128; g = contrast * (g - 128) + 128; b = contrast * (b - 128) + 128; const luma = clamp01((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255); const shadowWeight = (1 - luma) * (1 - luma); const highlightWeight = luma * luma; const tonal = 255 * (shadows * shadowWeight + highlights * highlightWeight) * 0.45; r += tonal + warmth; g += tonal + warmth * 0.18; b += tonal - warmth; const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b; r = gray + (r - gray) * saturation; g = gray + (g - gray) * saturation; b = gray + (b - gray) * saturation; data[i] = clamp255(r); data[i + 1] = clamp255(g); data[i + 2] = clamp255(b); }
    if (edit.sharpness > 0 && width > 2 && height > 2) sharpen(data, width, height, edit.sharpness / 100);
  }
  function sharpen(data: Uint8ClampedArray, width: number, height: number, strength: number): void { const source = new Uint8ClampedArray(data); const a = Math.min(0.65, strength * 0.45); for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) { const p = (y * width + x) * 4; for (let c = 0; c < 3; c += 1) { const center = source[p + c]; const neighbors = source[p - 4 + c] + source[p + 4 + c] + source[p - width * 4 + c] + source[p + width * 4 + c]; data[p + c] = clamp255(center * (1 + 4 * a) - neighbors * a); } } }
  function cssFallbackFilter(edit: EditState): string { const brightness = Math.max(0.1, Math.pow(2, edit.exposure * 0.35) * (1 + edit.brightness / 180)); const contrast = Math.max(0.1, 1 + edit.contrast / 100); const saturation = Math.max(0, 1 + edit.saturation / 100); const sepia = Math.abs(edit.warmth) / 350; const hue = edit.warmth >= 0 ? -edit.warmth * 0.12 : -edit.warmth * 0.06; return `brightness(${brightness}) contrast(${contrast}) saturate(${saturation}) sepia(${sepia}) hue-rotate(${hue}deg)`; }
  function loadImage(src: string, timeoutMs = 10000): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image(); image.decoding = "async";
      const timer = window.setTimeout(() => { image.onload = null; image.onerror = null; image.removeAttribute("src"); reject(new Error("Image decode timed out")); }, timeoutMs);
      image.onload = () => { window.clearTimeout(timer); image.onload = null; image.onerror = null; resolve(image); };
      image.onerror = () => { window.clearTimeout(timer); image.onload = null; image.onerror = null; reject(new Error("Could not decode native image preview")); };
      image.src = src;
    });
  }
  async function loadLocalImage(dataUrl: string): Promise<LocalDrawable> {
    if (!dataUrl.startsWith("data:image/")) throw new Error("Editor source is not native image data");
    const image = await loadImage(dataUrl);
    return { source: image, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height, close: () => image.removeAttribute("src") };
  }

  async function exportPaths(paths: string[]): Promise<void> {
    if (paths.length === 0) { toast("No photos to export."); return; } const originalStatus = editRenderMode.textContent;
    for (let index = 0; index < paths.length; index += 1) { const path = paths[index]; editRenderMode.textContent = `Exporting ${index + 1}/${paths.length}…`; try { const edit = edits.get(path) ?? DEFAULT_EDIT; const rendered = await buildEditedCanvas(path, edit, 3200); if (!rendered.pixelEdited && (edit.highlights !== 0 || edit.shadows !== 0 || edit.sharpness !== 0)) throw new Error("Pixel renderer is unavailable, so Highlights/Shadows/Sharpness cannot be exported safely."); const blob = await canvasBlob(rendered.canvas, edit.jpegQuality / 100); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `edited_${safeFileName(displayName(path)).replace(/\.[^.]+$/, "")}.jpg`; document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 2000); await new Promise((resolve) => window.setTimeout(resolve, 120)); } catch (error) { toast(`Export failed for ${displayName(path)}: ${String(error)}`); } }
    editRenderMode.textContent = originalStatus || "Export complete";
  }
  function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> { return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("JPEG export unavailable")), "image/jpeg", quality)); }
  function selectedOrPrimary(): string[] { const selected = selectedPaths(); if (selected.length) return selected; return currentPrimaryPath ? [currentPrimaryPath] : []; }
  function safeFileName(value: string): string { return value.replace(/[\\/:*?"<>|]+/g, "_"); }
  function clamp255(value: number): number { return Math.max(0, Math.min(255, Math.round(value))); }
  function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
  function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
  function toast(message: string): void { let node = document.querySelector<HTMLDivElement>("#studioToast"); if (!node) { node = document.createElement("div"); node.id = "studioToast"; node.className = "studio-toast"; document.body.append(node); } node.textContent = message; node.classList.add("show"); window.setTimeout(() => node?.classList.remove("show"), 2400); }

  async function useCurrentGroupForProcess(): Promise<void> {
    const group = activeGroup(); if (!group) { toast("Choose a group first."); return; } const wanted = new Set(groupPaths(group.id)); const allIncluded = document.querySelector<HTMLInputElement>("#allIncluded"); if (allIncluded?.checked) { allIncluded.click(); await nextFrame(); }
    for (const path of wanted) { const tile = tiles().find((item) => item.dataset.path === path); const checkbox = tile?.querySelector<HTMLInputElement>(".include-box input"); if (checkbox && !checkbox.checked) { checkbox.click(); await nextFrame(); } }
    const useSelection = document.querySelector<HTMLInputElement>("#useWorkspaceSelection"); if (useSelection) useSelection.checked = true; document.querySelector<HTMLButtonElement>("#goToProcess")?.click(); toast(`${group.name} is now the processing selection.`);
  }
  function nextFrame(): Promise<void> { return new Promise((resolve) => requestAnimationFrame(() => resolve())); }

  let convertingSortToManual = false;
  orderSelect.addEventListener("change", () => { if (convertingSortToManual || orderSelect.value === "manual") return; const applied = orderSelect.options[orderSelect.selectedIndex]?.textContent || "sorted order"; window.setTimeout(() => { convertingSortToManual = true; orderSelect.value = "manual"; orderSelect.dispatchEvent(new Event("change", { bubbles: true })); convertingSortToManual = false; toast(`${applied} applied. Manual drag is still enabled.`); }, 0); });

  commandBar.querySelector<HTMLButtonElement>("#studioShowAll")!.addEventListener("click", () => { activeGroupId = null; renderGroups(); applyGroupFilter(); });
  commandBar.querySelector<HTMLButtonElement>("#studioGroupsFromFolders")!.addEventListener("click", () => autoGroupsFromPaths(false));
  commandBar.querySelector<HTMLButtonElement>("#studioNewGroup")!.addEventListener("click", () => { const paths = selectedPaths(); if (!paths.length) { toast("Select one or more photos first."); return; } const name = window.prompt("New group name", uniqueGroupName(`Group ${groups.length + 1}`)); if (!name?.trim()) return; recordGroupMutation(); const group = { id: crypto.randomUUID(), name: uniqueGroupName(name.trim()) }; groups.push(group); paths.forEach((path) => assignments.set(path, group.id)); activeGroupId = group.id; renderGroups(); applyGroupFilter(); scheduleSave(); });
  moveTarget.addEventListener("change", () => { const value = moveTarget.value; if (!value) return; const paths = selectedPaths(); if (!paths.length) { toast("Select photos to move first."); moveTarget.value = ""; return; } movePathsToGroup(paths, value === "__ungrouped__" ? null : value); moveTarget.value = ""; });
  groupPanel.querySelector<HTMLButtonElement>("#studioSelectAllGroups")!.addEventListener("click", () => { selectedGroupIds = new Set(groups.map((group) => group.id)); groupSelectionAnchor = groups.at(-1)?.id ?? null; renderGroups(); });
  groupPanel.querySelector<HTMLButtonElement>("#studioClearGroupSelection")!.addEventListener("click", () => { selectedGroupIds.clear(); groupSelectionAnchor = null; renderGroups(); });
  groupPanel.querySelector<HTMLButtonElement>("#studioInvertGroupSelection")!.addEventListener("click", () => { selectedGroupIds = new Set(groups.filter((group) => !selectedGroupIds.has(group.id)).map((group) => group.id)); groupSelectionAnchor = null; renderGroups(); });
  groupPanel.querySelector<HTMLButtonElement>("#studioRenameGroup")!.addEventListener("click", () => { const group = activeGroup(); if (!group) { toast("Choose a group first."); return; } const name = window.prompt("Rename group", group.name); if (!name?.trim() || name.trim() === group.name) return; recordGroupMutation(); group.name = uniqueGroupName(name.trim()); renderGroups(); scheduleSave(); });
  groupPanel.querySelector<HTMLButtonElement>("#studioDeleteGroup")!.addEventListener("click", () => { const ids = [...selectedGroupIds]; if (!ids.length) { toast("Select one or more groups first."); return; } if (!window.confirm(`Delete ${ids.length} selected group${ids.length === 1 ? "" : "s"}? Frames become Ungrouped; source files are never deleted.`)) return; recordGroupMutation(); assignments.forEach((id, path) => { if (id && selectedGroupIds.has(id)) assignments.set(path, null); }); groups = groups.filter((item) => !selectedGroupIds.has(item.id)); if (activeGroupId && selectedGroupIds.has(activeGroupId)) activeGroupId = null; selectedGroupIds.clear(); groupSelectionAnchor = null; renderGroups(); applyGroupFilter(); scheduleSave(); });
  groupPanel.querySelector<HTMLButtonElement>("#studioSplitGroup")!.addEventListener("click", () => { const current = activeGroup(); const paths = selectedPaths().filter((path) => !current || assignments.get(path) === current.id); if (!paths.length) { toast("Select photos from the current group first."); return; } const name = window.prompt("New split group name", uniqueGroupName(`${current?.name ?? "Group"} split`)); if (!name?.trim()) return; recordGroupMutation(); const group = { id: crypto.randomUUID(), name: uniqueGroupName(name.trim()) }; groups.push(group); paths.forEach((path) => assignments.set(path, group.id)); activeGroupId = group.id; renderGroups(); applyGroupFilter(); scheduleSave(); });
  groupPanel.querySelector<HTMLButtonElement>("#studioMergeGroups")!.addEventListener("click", () => { const ids = [...selectedGroupIds]; if (ids.length < 2) { toast("Select at least two groups to merge."); return; } const selectedGroups = groups.filter((group) => ids.includes(group.id)); const name = window.prompt("Merged group name", uniqueGroupName(selectedGroups.map((group) => group.name).join(" + "))); if (!name?.trim()) return; recordGroupMutation(); const target = { id: crypto.randomUUID(), name: uniqueGroupName(name.trim()) }; groups.push(target); assignments.forEach((id, path) => { if (id && selectedGroupIds.has(id)) assignments.set(path, target.id); }); groups = groups.filter((group) => !selectedGroupIds.has(group.id)); activeGroupId = target.id; selectedGroupIds = new Set([target.id]); groupSelectionAnchor = target.id; renderGroups(); applyGroupFilter(); scheduleSave(); });
  commandBar.querySelector<HTMLButtonElement>("#studioGroupUndo")!.addEventListener("click", () => { const previous = groupUndo.pop(); if (!previous) return; groupRedo.push(snapshotGroups()); restoreGroupSnapshot(previous); });
  commandBar.querySelector<HTMLButtonElement>("#studioGroupRedo")!.addEventListener("click", () => { const next = groupRedo.pop(); if (!next) return; groupUndo.push(snapshotGroups()); restoreGroupSnapshot(next); });
  groupPanel.querySelector<HTMLButtonElement>("#studioUseGroup")!.addEventListener("click", () => void useCurrentGroupForProcess());

  editorPanel.querySelectorAll<HTMLInputElement>("input[type=range][data-edit-key]").forEach((input) => { const key = input.dataset.editKey as Exclude<keyof EditState, "crop">; input.addEventListener("input", () => { const value = Number(input.value); updateSliderOutput(key, value); if (currentPrimaryPath) { edits.set(currentPrimaryPath, currentEditFromControls()); schedulePreview(currentPrimaryPath); } }); input.addEventListener("change", () => commitEdit()); });
  editorPanel.querySelector<HTMLSelectElement>("#edit-crop")!.addEventListener("change", (event) => { editorPanel.querySelector<HTMLOutputElement>("#edit-crop-value")!.value = (event.target as HTMLSelectElement).value; commitEdit(); });
  editorPanel.querySelectorAll<HTMLButtonElement>(".studio-info[data-edit-info]").forEach((button) => button.addEventListener("click", () => { const key = button.dataset.editInfo as keyof EditState; const info = EDIT_INFO[key]; editInfo.innerHTML = `<strong>${escapeHtml(info.title)}</strong><span>${escapeHtml(info.body)}</span>`; }));
  editorPanel.querySelector<HTMLButtonElement>("#editBefore")!.addEventListener("click", (event) => { beforeMode = !beforeMode; (event.currentTarget as HTMLButtonElement).classList.toggle("active", beforeMode); (event.currentTarget as HTMLButtonElement).textContent = beforeMode ? "After" : "Before"; if (currentPrimaryPath) void renderPreview(currentPrimaryPath); });
  editorPanel.querySelector<HTMLButtonElement>("#editUndo")!.addEventListener("click", () => applyEditHistory(editHistoryIndex - 1)); editorPanel.querySelector<HTMLButtonElement>("#editRedo")!.addEventListener("click", () => applyEditHistory(editHistoryIndex + 1));
  editorPanel.querySelector<HTMLButtonElement>("#editReset")!.addEventListener("click", () => { setControlsFromEdit(DEFAULT_EDIT); commitEdit(DEFAULT_EDIT); toast("Photo edit reset to defaults."); });
  editorPanel.querySelector<HTMLButtonElement>("#editCopy")!.addEventListener("click", () => { if (!currentPrimaryPath) return; editClipboard = cloneEdit(currentEditFromControls()); updateEditButtons(); toast("Edit settings copied."); });
  editorPanel.querySelector<HTMLButtonElement>("#editPaste")!.addEventListener("click", () => { if (!editClipboard || !currentPrimaryPath) return; setControlsFromEdit(editClipboard); commitEdit(editClipboard); toast("Edit settings pasted."); });
  editorPanel.querySelector<HTMLButtonElement>("#editApplySelected")!.addEventListener("click", () => applyCurrentEditTo(selectedOrPrimary())); editorPanel.querySelector<HTMLButtonElement>("#editApplyGroup")!.addEventListener("click", () => { const group = activeGroup() ?? groupForPath(currentPrimaryPath ?? ""); if (!group) { toast("Choose a group first."); return; } applyCurrentEditTo(groupPaths(group.id)); }); editorPanel.querySelector<HTMLButtonElement>("#editApplyAll")!.addEventListener("click", () => applyCurrentEditTo(allPaths()));
  editorPanel.querySelector<HTMLButtonElement>("#editExportCurrent")!.addEventListener("click", () => void exportPaths(currentPrimaryPath ? [currentPrimaryPath] : [])); editorPanel.querySelector<HTMLButtonElement>("#editExportSelected")!.addEventListener("click", () => void exportPaths(selectedOrPrimary())); editorPanel.querySelector<HTMLButtonElement>("#editExportGroup")!.addEventListener("click", () => { const group = activeGroup() ?? groupForPath(currentPrimaryPath ?? ""); void exportPaths(group ? groupPaths(group.id) : []); });

  document.addEventListener("keydown", (event) => { const target = event.target as HTMLElement | null; if (target?.matches("input, textarea, select")) return; if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) applyEditHistory(editHistoryIndex + 1); else applyEditHistory(editHistoryIndex - 1); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); applyEditHistory(editHistoryIndex + 1); } });

  let structureSyncQueued = false;
  let selectionSyncQueued = false;
  function queueStructureSync(): void {
    if (structureSyncQueued) return;
    structureSyncQueued = true;
    queueMicrotask(() => {
      structureSyncQueued = false;
      syncFromMainGrid();
    });
  }
  function queueSelectionSync(): void {
    if (selectionSyncQueued || structureSyncQueued) return;
    selectionSyncQueued = true;
    queueMicrotask(() => {
      selectionSyncQueued = false;
      renderEditorForSelection();
    });
  }
  const observer = new MutationObserver((mutations) => {
    const structureChanged = mutations.some((mutation) => mutation.type === "childList");
    if (structureChanged) queueStructureSync();
    else if (mutations.some((mutation) => mutation.type === "attributes")) queueSelectionSync();
  });
  observer.observe(photoGrid, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  queueStructureSync();
}
