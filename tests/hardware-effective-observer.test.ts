// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hardware = readFileSync(new URL("../src/hardware-options.ts", import.meta.url), "utf8");

test("effective backend parser resets when the console contents are replaced", () => {
  assert.match(hardware, /mutation\.type === "childList" && mutation\.removedNodes\.length > 0/);
  assert.match(hardware, /processed = 0/);
  assert.match(hardware, /Grouping Hardware acceleration:/);
});
