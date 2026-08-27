from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"marker missing in {path}: {old[:100]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"marker is not unique in {path}: {old[:100]!r}")
    file.write_text(text.replace(old, new, 1))


# Main owns the real photo state. Announce every completed grid render so optional
# workspace consumers can synchronize from a settled DOM instead of racing a
# MutationObserver against renderPhotoGrid().
replace_once(
    "src/main.ts",
    'renderInspector(); updatePhotoStats(); return; }\n  grid.innerHTML = "";',
    'renderInspector(); updatePhotoStats(); window.dispatchEvent(new CustomEvent("tihulu:workspace-grid-rendered")); return; }\n  grid.innerHTML = "";',
)
replace_once(
    "src/main.ts",
    '  renderInspector(); updatePhotoStats();\n}\nasync function scanPhotos',
    '  renderInspector(); updatePhotoStats();\n  window.dispatchEvent(new CustomEvent("tihulu:workspace-grid-rendered"));\n}\nasync function scanPhotos',
)

# Studio Editor consumes the explicit render contract. MutationObserver remains as
# a fallback for third-party/manual DOM changes, but normal application rendering
# no longer depends on observer timing.
replace_once(
    "src/studio-editor.ts",
    '  const observer = new MutationObserver((mutations) => {\n',
    '  window.addEventListener("tihulu:workspace-grid-rendered", () => queueStructureSync());\n\n  const observer = new MutationObserver((mutations) => {\n',
)

# The packaged test deliberately inserts one native-decodable frame. Explicitly
# announce that its grid is settled, exactly like main.ts does after a real render.
replace_once(
    "tests/packaged-appimage.mjs",
    '      grid.append(tile);\n\n      const deadline = Date.now() + 12000;',
    '      grid.append(tile);\n      window.dispatchEvent(new CustomEvent("tihulu:workspace-grid-rendered"));\n\n      const deadline = Date.now() + 12000;',
)
replace_once(
    "tests/packaged-appimage.mjs",
    '            error: document.querySelector("#studioEditPreview")?.textContent?.trim() || "Photo Editor canvas timed out",\n',
    '            error: document.querySelector("#studioEditPreview")?.textContent?.trim() || "Photo Editor canvas timed out",\n            editName: document.querySelector("#studioEditName")?.textContent?.trim() || "",\n            renderMode: document.querySelector("#studioEditRenderMode")?.textContent?.trim() || "",\n            moduleState: document.documentElement.dataset.moduleStudioEditor || "",\n',
)
replace_once(
    "tests/packaged-appimage.mjs",
    '      const screenshot = await withTimeout(driver.takeScreenshot(), 5000, "Failure screenshot");',
    '      const screenshot = await withTimeout(driver.takeScreenshot(), 20000, "Failure screenshot");',
)

# Lock the new application-level sync contract in source regression coverage.
regression = Path("tests/source-regressions.test.mjs")
text = regression.read_text()
marker = 'test("Photo Editor consumes native JPEG data URLs instead of asset fetch",'
if marker not in text:
    raise SystemExit("source regression insertion marker missing")
new_test = '''test("workspace grid render explicitly synchronizes Photo Editor", () => { const main = read("src/main.ts"); const studio = read("src/studio-editor.ts"); const acceptance = read("tests/packaged-appimage.mjs"); assert.match(main, /tihulu:workspace-grid-rendered/); assert.match(studio, /addEventListener\\("tihulu:workspace-grid-rendered"/); assert.match(acceptance, /dispatchEvent\\(new CustomEvent\\("tihulu:workspace-grid-rendered"/); });\n'''
if new_test not in text:
    text = text.replace(marker, new_test + marker, 1)
    regression.write_text(text)

print("v0.3.13 deterministic editor sync patch applied")
