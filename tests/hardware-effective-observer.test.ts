// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hardware = readFileSync(new URL("../src/hardware-options.ts", import.meta.url), "utf8");
const bootstrap = readFileSync(new URL("../src/bootstrap.ts", import.meta.url), "utf8");

test("effective backend labels consume native job-log events directly", () => {
  assert.match(hardware, /import \{ listen \} from "@tauri-apps\/api\/event"/);
  assert.match(hardware, /backendListenerReady = listen<LogPayload>\("job-log"/);
  assert.match(hardware, /consumeBackendLine\(event\.payload\.line\)/);
  assert.match(hardware, /hardwareBackendListening = "registering"/);
  assert.match(hardware, /hardwareBackendListening = "true"/);
  assert.match(hardware, /export const hardwareOptionsReady = start\(\)/);
  assert.match(bootstrap, /await module\.hardwareOptionsReady/);
  assert.match(hardware, /Grouping Hardware acceleration:/);
  assert.doesNotMatch(hardware, /new MutationObserver/);
});
