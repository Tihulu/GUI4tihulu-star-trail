#!/usr/bin/env python3
from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, got {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


def replace_regex_once(path: str, pattern: str, replacement: str) -> None:
    p = Path(path)
    text = p.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one regex match, got {count}: {pattern[:120]!r}")
    p.write_text(updated)


# main.ts: first-class visible scope for Include all.
replace_once(
    "src/main.ts",
    "let photos: PhotoRecord[] = [];\nlet selectedPaths = new Set<string>();",
    "let photos: PhotoRecord[] = [];\nlet workspaceVisiblePaths: Set<string> | null = null;\nlet selectedPaths = new Set<string>();",
)

replace_once(
    "src/main.ts",
    "function includedPhotos(): PhotoRecord[] { return photos.filter((photo) => photo.included); }",
    '''function includedPhotos(): PhotoRecord[] { return photos.filter((photo) => photo.included); }
function visiblePhotos(): PhotoRecord[] {
  if (workspaceVisiblePaths === null) return photos;
  return photos.filter((photo) => workspaceVisiblePaths?.has(photo.path));
}
function applyVisibleWorkspaceScope(paths: string[], includeAll: boolean, excludeOutside: boolean): void {
  const knownPaths = new Set(photos.map((photo) => photo.path));
  const requested = paths.filter((path) => knownPaths.has(path));
  workspaceVisiblePaths = requested.length === photos.length ? null : new Set(requested);
  const visible = visiblePhotos();
  const visiblePaths = new Set(visible.map((photo) => photo.path));
  if (excludeOutside) photos.forEach((photo) => { if (!visiblePaths.has(photo.path)) photo.included = false; });
  if (includeAll) visible.forEach((photo) => { photo.included = true; });
  renderPhotoGrid();
}''',
)

replace_once(
    "src/main.ts",
    'function updatePhotoStats(): void { qs<HTMLElement>("#workspaceCount").textContent = `${photos.length} photo${photos.length === 1 ? "" : "s"}`; qs<HTMLElement>("#includedCount").textContent = `${includedPhotos().length} included`; qs<HTMLElement>("#selectedCount").textContent = `${selectedPaths.size} selected`; qs<HTMLInputElement>("#allIncluded").checked = photos.length > 0 && includedPhotos().length === photos.length; qs<HTMLElement>("#photoSourcePath").textContent = scannedInput || "No folder selected"; updateStartState(); }',
    '''function updatePhotoStats(): void {
  const visible = visiblePhotos();
  const visibleIncluded = visible.filter((photo) => photo.included);
  const scoped = workspaceVisiblePaths !== null;
  const allIncluded = qs<HTMLInputElement>("#allIncluded");
  qs<HTMLElement>("#workspaceCount").textContent = `${photos.length} photo${photos.length === 1 ? "" : "s"}`;
  qs<HTMLElement>("#includedCount").textContent = scoped ? `${visibleIncluded.length}/${visible.length} shown included` : `${includedPhotos().length} included`;
  qs<HTMLElement>("#selectedCount").textContent = `${selectedPaths.size} selected`;
  allIncluded.checked = visible.length > 0 && visibleIncluded.length === visible.length;
  allIncluded.indeterminate = visibleIncluded.length > 0 && visibleIncluded.length < visible.length;
  allIncluded.title = scoped ? "Include or exclude every frame shown in the active group" : "Include or exclude every frame currently shown";
  qs<HTMLElement>("#photoSourcePath").textContent = scannedInput || "No folder selected";
  updateStartState();
}''',
)

replace_once(
    "src/main.ts",
    'async function scanPhotos(source = inputPath): Promise<void> { if (!source) { appendLog("Choose an input folder before scanning.", "stderr"); return; } qs<HTMLElement>("#photoSourcePath").textContent = "Scanning…"; try { const result = await invoke<PhotoInfo[]>("scan_photos", { input: source, recursive: qs<HTMLInputElement>("#workspaceRecursive").checked }); photos = result.map((photo) => ({ ...photo, included: true })); selectedPaths.clear(); selectionAnchor = null; sortMode = "manual"; qs<HTMLSelectElement>("#photoSort").value = "manual"; scannedInput = source; renderPhotoGrid(); appendLog(`Photo Workspace loaded ${photos.length} supported image(s).`); } catch (error) { photos = []; scannedInput = ""; renderPhotoGrid(); appendLog(String(error), "stderr"); } }',
    'async function scanPhotos(source = inputPath): Promise<void> { if (!source) { appendLog("Choose an input folder before scanning.", "stderr"); return; } qs<HTMLElement>("#photoSourcePath").textContent = "Scanning…"; try { const result = await invoke<PhotoInfo[]>("scan_photos", { input: source, recursive: qs<HTMLInputElement>("#workspaceRecursive").checked }); photos = result.map((photo) => ({ ...photo, included: true })); workspaceVisiblePaths = null; selectedPaths.clear(); selectionAnchor = null; sortMode = "manual"; qs<HTMLSelectElement>("#photoSort").value = "manual"; scannedInput = source; renderPhotoGrid(); appendLog(`Photo Workspace loaded ${photos.length} supported image(s).`); } catch (error) { photos = []; workspaceVisiblePaths = null; scannedInput = ""; renderPhotoGrid(); appendLog(String(error), "stderr"); } }',
)

replace_once(
    "src/main.ts",
    'qs<HTMLInputElement>("#allIncluded").addEventListener("change", (event) => { const included = (event.target as HTMLInputElement).checked; photos.forEach((photo) => { photo.included = included; }); renderPhotoGrid(); });',
    '''qs<HTMLInputElement>("#allIncluded").addEventListener("change", (event) => {
    const included = (event.target as HTMLInputElement).checked;
    visiblePhotos().forEach((photo) => { photo.included = included; });
    renderPhotoGrid();
  });
  window.addEventListener("tihulu:workspace-visible-scope", (event) => {
    const detail = (event as CustomEvent<{ paths?: string[]; includeAll?: boolean; excludeOutside?: boolean }>).detail;
    applyVisibleWorkspaceScope(Array.isArray(detail?.paths) ? detail.paths : [], detail?.includeAll === true, detail?.excludeOutside === true);
  });''',
)

# studio-editor.ts: group opening publishes the visible scope and defaults it Included.
replace_once(
    "src/studio-editor.ts",
    'function activeGroup(): GroupRecord | null { return activeGroupId ? groups.find((group) => group.id === activeGroupId) ?? null : null; }\n  function groupPaths(groupId: string): string[] { return allPaths().filter((path) => assignments.get(path) === groupId); }',
    '''function activeGroup(): GroupRecord | null { return activeGroupId ? groups.find((group) => group.id === activeGroupId) ?? null : null; }
  function groupPaths(groupId: string): string[] { return allPaths().filter((path) => assignments.get(path) === groupId); }
  function publishWorkspaceScope(includeAll = false, excludeOutside = false): void {
    const paths = activeGroupId ? groupPaths(activeGroupId) : allPaths();
    window.dispatchEvent(new CustomEvent("tihulu:workspace-visible-scope", { detail: { paths, includeAll, excludeOutside } }));
  }
  function activateGroupView(groupId: string | null): void {
    activeGroupId = groupId;
    renderGroups();
    applyGroupFilter();
    publishWorkspaceScope(true);
  }''',
)

replace_once(
    "src/studio-editor.ts",
    'allCard.addEventListener("click", () => { activeGroupId = null; renderGroups(); applyGroupFilter(); });',
    'allCard.addEventListener("click", () => activateGroupView(null));',
)

replace_once(
    "src/studio-editor.ts",
    '''      card.querySelector<HTMLButtonElement>(".group-open")?.addEventListener("click", (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey) { selectGroup(group.id, event); return; }
        activeGroupId = group.id; renderGroups(); applyGroupFilter();
      });''',
    '''      card.querySelector<HTMLButtonElement>(".group-open")?.addEventListener("click", (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey) { selectGroup(group.id, event); return; }
        activateGroupView(group.id);
      });''',
)

replace_once(
    "src/studio-editor.ts",
    'commandBar.querySelector<HTMLButtonElement>("#studioShowAll")!.addEventListener("click", () => { activeGroupId = null; renderGroups(); applyGroupFilter(); });',
    'commandBar.querySelector<HTMLButtonElement>("#studioShowAll")!.addEventListener("click", () => activateGroupView(null));',
)

replace_regex_once(
    "src/studio-editor.ts",
    r'''  async function useCurrentGroupForProcess\(\): Promise<void> \{\n    const group = activeGroup\(\); if \(!group\) \{ toast\("Choose a group first\."\); return; \} const wanted = new Set\(groupPaths\(group\.id\)\); const allIncluded = document\.querySelector<HTMLInputElement>\("#allIncluded"\); if \(allIncluded\?\.checked\) \{ allIncluded\.click\(\); await nextFrame\(\); \}\n    for \(const path of wanted\) \{ const tile = tiles\(\)\.find\(\(item\) => item\.dataset\.path === path\); const checkbox = tile\?\.querySelector<HTMLInputElement>\("\.include-box input"\); if \(checkbox && !checkbox\.checked\) \{ checkbox\.click\(\); await nextFrame\(\); \} \}\n    const useSelection = document\.querySelector<HTMLInputElement>\("#useWorkspaceSelection"\); if \(useSelection\) useSelection\.checked = true; document\.querySelector<HTMLButtonElement>\("#goToProcess"\)\?\.click\(\); toast\(`\$\{group\.name\} is now the processing selection\.`\);\n  \}''',
    '''  async function useCurrentGroupForProcess(): Promise<void> {
    const group = activeGroup();
    if (!group) { toast("Choose a group first."); return; }
    publishWorkspaceScope(false, true);
    await nextFrame();
    const useSelection = document.querySelector<HTMLInputElement>("#useWorkspaceSelection");
    if (useSelection) useSelection.checked = true;
    document.querySelector<HTMLButtonElement>("#goToProcess")?.click();
    toast(`${group.name} is now the processing selection.`);
  }''',
)

# workflow-polish.ts: delete obsolete global-exclusion capture guard.
replace_once(
    "src/workflow-polish.ts",
    '''function hasActiveGroup(): boolean {
  return Boolean(qs<HTMLElement>(".studio-group-card.active[data-group-id]"));
}

''',
    '',
)
replace_once(
    "src/workflow-polish.ts",
    '''function forceAllFramesExcluded(): void {
  if (!hasActiveGroup()) return;
  const allIncluded = qs<HTMLInputElement>("#allIncluded");
  if (!allIncluded) return;
  allIncluded.checked = true;
  allIncluded.click();
}

function installExactGroupSelectionGuard(): void {
  const processButton = qs<HTMLButtonElement>("#studioUseGroup");
  if (!processButton || processButton.dataset.exactGroupGuardReady === "1") return;
  processButton.dataset.exactGroupGuardReady = "1";
  processButton.addEventListener("click", forceAllFramesExcluded, { capture: true });
}

''',
    '',
)
replace_once("src/workflow-polish.ts", "  installExactGroupSelectionGuard();\n", "")

# Fast regression contract.
Path("tests/group-visible-include-scope.test.ts").write_text('''// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const editor = readFileSync(new URL("../src/studio-editor.ts", import.meta.url), "utf8");
const polish = readFileSync(new URL("../src/workflow-polish.ts", import.meta.url), "utf8");

test("Include all is scoped to the visible Studio group", () => {
  assert.match(main, /let workspaceVisiblePaths: Set<string> \\| null = null/);
  assert.match(main, /visiblePhotos\(\)\.forEach\(\(photo\) => \{ photo\.included = included; \}\)/);
  assert.match(main, /allIncluded\.indeterminate = visibleIncluded\.length > 0 && visibleIncluded\.length < visible\.length/);
  assert.match(main, /tihulu:workspace-visible-scope/);
});

test("opening a group or All frames includes the visible scope by default", () => {
  assert.match(editor, /function activateGroupView\(groupId: string \\| null\)/);
  assert.match(editor, /publishWorkspaceScope\(true\)/);
  assert.match(editor, /allCard\.addEventListener\("click", \(\) => activateGroupView\(null\)\)/);
  assert.match(editor, /#studioShowAll[\\s\\S]*activateGroupView\(null\)/);
  assert.doesNotMatch(polish, /forceAllFramesExcluded/);
});

test("Use current group excludes outside frames without re-including manual exclusions inside it", () => {
  assert.match(editor, /publishWorkspaceScope\(false, true\)/);
  assert.doesNotMatch(editor, /for \(const path of wanted\)/);
});
''')

# Real packaged UI gate.
p = Path("tests/packaged-appimage.mjs")
text = p.read_text()
marker = '  stage("atomic 32-group workspace import passed");\n\n  const request = {'
insertion = '''  stage("atomic 32-group workspace import passed");

  stage("checking visible-group Include all scope");
  const groupIncludeScope = await driver.executeAsyncScript(
    function exerciseVisibleIncludeScope() {
      const done = arguments[arguments.length - 1];
      const groupCards = () => Array.from(document.querySelectorAll("#studioGroupList .studio-group-card[data-group-id]"));
      const open = (card) => card?.querySelector(".group-open")?.click();
      const checkbox = () => document.querySelector("#allIncluded");
      const tileState = () => Array.from(document.querySelectorAll("#photoGrid .photo-tile[data-path]")).map((tile) => ({
        path: tile.dataset.path,
        hidden: tile.classList.contains("studio-group-hidden"),
        included: Boolean(tile.querySelector(".include-box input")?.checked),
      }));
      if (groupCards().length < 2) {
        done({ ok: false, error: "Need at least two groups for visible include scope acceptance" });
        return;
      }

      open(groupCards()[0]);
      setTimeout(() => {
        const firstVisible = tileState().filter((item) => !item.hidden);
        if (firstVisible.length !== 1 || !checkbox()?.checked) {
          done({ ok: false, error: "First group did not become the active included visible scope", firstVisible });
          return;
        }
        const firstPath = firstVisible[0].path;
        checkbox()?.click();
        setTimeout(() => {
          const afterExclude = tileState();
          const first = afterExclude.find((item) => item.path === firstPath);
          const outsideIncluded = afterExclude.some((item) => item.path !== firstPath && item.included);
          if (first?.included || !outsideIncluded || checkbox()?.checked) {
            done({ ok: false, error: "Include all changed frames outside the visible group", first, outsideIncluded });
            return;
          }

          open(groupCards()[1]);
          setTimeout(() => {
            const secondVisible = tileState().filter((item) => !item.hidden);
            const firstStillExcluded = tileState().find((item) => item.path === firstPath)?.included === false;
            if (secondVisible.length !== 1 || !secondVisible[0].included || !checkbox()?.checked || !firstStillExcluded) {
              done({ ok: false, error: "Switching groups did not scope inclusion to the clicked group", secondVisible, firstStillExcluded });
              return;
            }

            document.querySelector("#studioGroupList .all-card")?.click();
            setTimeout(() => {
              const all = tileState();
              done({
                ok: all.length === 32 && all.every((item) => !item.hidden && item.included) && Boolean(checkbox()?.checked),
                error: "All frames did not restore every shown frame to Included",
                included: all.filter((item) => item.included).length,
                hidden: all.filter((item) => item.hidden).length,
              });
            }, 140);
          }, 140);
        }, 140);
      }, 140);
    },
  );
  assert.equal(groupIncludeScope?.ok, true, groupIncludeScope?.error || "Visible group Include all scope failed");
  stage("visible-group Include all scope passed");

  const request = {'''
count = text.count(marker)
if count != 1:
    raise SystemExit(f"tests/packaged-appimage.mjs: expected acceptance marker once, got {count}")
p.write_text(text.replace(marker, insertion, 1))
