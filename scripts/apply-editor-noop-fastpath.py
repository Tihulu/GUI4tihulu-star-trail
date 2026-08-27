from pathlib import Path

editor_path = Path("src/studio-editor.ts")
editor = editor_path.read_text()
needle = "    finally { image.close(); }\n    try { const frame = ctx.getImageData"
insert = """    finally { image.close(); }
    const hasPixelEdits = edit.exposure !== 0 || edit.brightness !== 0 || edit.contrast !== 0 || edit.highlights !== 0 || edit.shadows !== 0 || edit.saturation !== 0 || edit.warmth !== 0 || edit.sharpness !== 0;
    if (!hasPixelEdits) return { canvas, pixelEdited: true };
    try { const frame = ctx.getImageData"""
if editor.count(needle) != 1:
    raise SystemExit(f"studio-editor.ts: expected one pixel-render insertion point, got {editor.count(needle)}")
editor_path.write_text(editor.replace(needle, insert, 1))

thumbs_path = Path("src/photo-thumbnail-manager.ts")
thumbs = thumbs_path.read_text()
old = """// Native thumbnail generation is serialized by THUMBNAIL_GENERATION_LOCK.
// Keeping a second grid IPC active only creates a waiter ahead of interactive
// Photo Editor requests, so one active grid request is both safer and equally
// fast for actual thumbnail generation.
const MAX_ACTIVE_REQUESTS = 1;"""
new = "const MAX_ACTIVE_REQUESTS = 2;"
if thumbs.count(old) != 1:
    raise SystemExit(f"photo-thumbnail-manager.ts: expected one temporary serialization block, got {thumbs.count(old)}")
thumbs_path.write_text(thumbs.replace(old, new, 1))
