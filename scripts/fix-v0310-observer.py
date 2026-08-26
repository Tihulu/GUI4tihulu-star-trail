#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
studio_path = root / "src/studio-editor.ts"
studio = studio_path.read_text()
old = '''  const observer = new MutationObserver(() => queueMicrotask(syncFromMainGrid)); observer.observe(photoGrid, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] }); queueMicrotask(syncFromMainGrid);\n'''
new = '''  let structureSyncQueued = false;\n  let selectionSyncQueued = false;\n  function queueStructureSync(): void {\n    if (structureSyncQueued) return;\n    structureSyncQueued = true;\n    queueMicrotask(() => {\n      structureSyncQueued = false;\n      syncFromMainGrid();\n    });\n  }\n  function queueSelectionSync(): void {\n    if (selectionSyncQueued || structureSyncQueued) return;\n    selectionSyncQueued = true;\n    queueMicrotask(() => {\n      selectionSyncQueued = false;\n      renderEditorForSelection();\n    });\n  }\n  const observer = new MutationObserver((mutations) => {\n    const structureChanged = mutations.some((mutation) => mutation.type === "childList");\n    if (structureChanged) queueStructureSync();\n    else if (mutations.some((mutation) => mutation.type === "attributes")) queueSelectionSync();\n  });\n  observer.observe(photoGrid, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });\n  queueStructureSync();\n'''
if old not in studio:
    raise SystemExit("Studio observer anchor not found")
studio_path.write_text(studio.replace(old, new, 1))

tests_path = root / "tests/source-regressions.test.mjs"
tests = tests_path.read_text()
tests += '''test("workspace class mutations do not rebuild group cards", () => { const studio = read("src/studio-editor.ts"); assert.match(studio, /structureChanged/); assert.match(studio, /queueSelectionSync/); assert.match(studio, /renderEditorForSelection\(\)/); assert.doesNotMatch(studio, /MutationObserver\(\(\) => queueMicrotask\(syncFromMainGrid\)/); });\n'''
tests_path.write_text(tests)
