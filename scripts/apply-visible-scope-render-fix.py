from pathlib import Path

main_path = Path("src/main.ts")
main = main_path.read_text()
old = '    tile.className = `photo-tile${selectedPaths.has(photo.path) ? " selected" : ""}${photo.included ? "" : " excluded"}`; tile.draggable = sortMode === "manual"; tile.dataset.path = photo.path;'
new = '    tile.className = `photo-tile${selectedPaths.has(photo.path) ? " selected" : ""}${photo.included ? "" : " excluded"}${workspaceVisiblePaths !== null && !workspaceVisiblePaths.has(photo.path) ? " studio-group-hidden" : ""}`; tile.draggable = sortMode === "manual"; tile.dataset.path = photo.path;'
if main.count(old) != 1:
    raise SystemExit(f"src/main.ts: expected exactly one render tile class match, got {main.count(old)}")
main_path.write_text(main.replace(old, new, 1))

test_path = Path("tests/group-visible-include-scope.test.ts")
test = test_path.read_text()
needle = '  assert.match(main, /tihulu:workspace-visible-scope/);\n'
insert = '  assert.match(main, /workspaceVisiblePaths !== null && !workspaceVisiblePaths\\.has\\(photo\\.path\\).*studio-group-hidden/);\n'
if insert not in test:
    if test.count(needle) != 1:
        raise SystemExit(f"tests/group-visible-include-scope.test.ts: expected one insertion point, got {test.count(needle)}")
    test_path.write_text(test.replace(needle, needle + insert, 1))
