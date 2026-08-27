// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editor = readFileSync(new URL("../src/studio-editor.ts", import.meta.url), "utf8");
const thumbs = readFileSync(new URL("../src/photo-thumbnail-manager.ts", import.meta.url), "utf8");

test("default Photo Editor preview skips the expensive pixel buffer pass", () => {
  const guard = editor.indexOf("const hasPixelEdits =");
  const fastReturn = editor.indexOf("if (!hasPixelEdits) return { canvas, pixelEdited: true };");
  const pixelRead = editor.indexOf("ctx.getImageData(0, 0, outW, outH)");
  assert.ok(guard >= 0, "missing no-op pixel-edit guard");
  assert.ok(fastReturn > guard, "missing no-op canvas fast return");
  assert.ok(pixelRead > fastReturn, "pixel buffer must only be read after the no-op fast return");
});

test("thumbnail queue remains at the established two-request limit", () => {
  assert.match(thumbs, /const MAX_ACTIVE_REQUESTS = 2/);
});
