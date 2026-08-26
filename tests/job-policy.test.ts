import test from "node:test";
import assert from "node:assert/strict";
import { buildOutputPath, normalizeHardwareMode } from "../src/job-policy.ts";

test("hardware preserves explicit GPU", () => { assert.equal(normalizeHardwareMode("gpu"), "gpu"); assert.equal(normalizeHardwareMode("cpu"), "cpu"); assert.equal(normalizeHardwareMode("bogus"), "auto"); });
test("trail custom filename stays below canonical output", () => { assert.equal(buildOutputPath("trail", "/night/out", "gece-1.jpg"), "/night/out/gece-1.jpg"); });
test("timelapse custom filename stays below canonical output", () => { assert.equal(buildOutputPath("timelapse", "/night/out", "gece-video.mp4"), "/night/out/gece-video.mp4"); });
test("Windows output keeps Windows separator", () => { assert.equal(buildOutputPath("trail", "C:\\night\\out", "gece-1"), "C:\\night\\out\\gece-1.jpg"); });
test("run and group use canonical directory exactly", () => { assert.equal(buildOutputPath("run", "/night/out", "ignored"), "/night/out"); assert.equal(buildOutputPath("group", "/night/out", "ignored"), "/night/out"); });
