import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bootstrap = readFileSync(new URL("../src/bootstrap.ts", import.meta.url), "utf8");
const guard = readFileSync(new URL("../src/workspace-job-scope.ts", import.meta.url), "utf8");

test("active Studio group is authoritative when a job starts", () => {
  assert.match(bootstrap, /WorkspaceJobScope/);
  assert.match(guard, /addEventListener\("click", scopeJobToVisibleGroup, \{ capture: true \}\)/);
  assert.match(guard, /closest\("#startJob"\)/);
  assert.match(guard, /studio-group-hidden/);
  assert.match(guard, /filter\(\(tile\) => !tile\.classList\.contains\("studio-group-hidden"\)\)/);
  assert.match(guard, /detail: \{ paths, includeAll: false, excludeOutside: true \}/);
});

test("active-group staging preserves manual exclusions inside the group", () => {
  assert.match(guard, /includeAll: false/);
  assert.match(guard, /excludeOutside: true/);
  assert.doesNotMatch(guard, /includeAll: true/);
});

test("all-frames view is not narrowed by the guard", () => {
  assert.match(guard, /!tiles\.some\(\(tile\) => tile\.classList\.contains\("studio-group-hidden"\)\)/);
});
