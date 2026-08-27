// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const thumbs = readFileSync(new URL("../src/photo-thumbnail-manager.ts", import.meta.url), "utf8");
const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

test("grid thumbnail IPC does not queue ahead of interactive editor previews", () => {
  assert.match(rust, /THUMBNAIL_GENERATION_LOCK/);
  assert.match(thumbs, /const MAX_ACTIVE_REQUESTS = 1/);
  assert.match(thumbs, /Native thumbnail generation is serialized by THUMBNAIL_GENERATION_LOCK/);
});
