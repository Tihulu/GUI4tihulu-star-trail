// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hardware = readFileSync(new URL("../src/hardware-options.ts", import.meta.url), "utf8");

test("effective backend labels consume native job-log events directly", () => {
  assert.match(hardware, /import \{ listen \} from "@tauri-apps\/api\/event"/);
  assert.match(hardware, /listen<LogPayload>\("job-log"/);
  assert.match(hardware, /consumeBackendLine\(event\.payload\.line\)/);
  assert.match(hardware, /Grouping Hardware acceleration:/);
  assert.doesNotMatch(hardware, /new MutationObserver/);
});
