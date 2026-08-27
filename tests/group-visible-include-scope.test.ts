// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const editor = readFileSync(new URL("../src/studio-editor.ts", import.meta.url), "utf8");
const polish = readFileSync(new URL("../src/workflow-polish.ts", import.meta.url), "utf8");

test("Include all is scoped to the visible Studio group", () => {
  assert.match(main, /let workspaceVisiblePaths: Set<string> \| null = null/);
  assert.match(main, /visiblePhotos\(\)\.forEach\(\(photo\) => \{ photo\.included = included; \}\)/);
  assert.match(main, /allIncluded\.indeterminate = visibleIncluded\.length > 0 && visibleIncluded\.length < visible\.length/);
  assert.match(main, /tihulu:workspace-visible-scope/);
});

test("opening a group or All frames includes the visible scope by default", () => {
  assert.match(editor, /function activateGroupView\(groupId: string \| null\)/);
  assert.match(editor, /publishWorkspaceScope\(true\)/);
  assert.match(editor, /allCard\.addEventListener\("click", \(\) => activateGroupView\(null\)\)/);
  assert.match(editor, /#studioShowAll[\s\S]*activateGroupView\(null\)/);
  assert.doesNotMatch(polish, /forceAllFramesExcluded/);
});

test("Use current group excludes outside frames without re-including manual exclusions inside it", () => {
  assert.match(editor, /publishWorkspaceScope\(false, true\)/);
  assert.doesNotMatch(editor, /for \(const path of wanted\)/);
});
