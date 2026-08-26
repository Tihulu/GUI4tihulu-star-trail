import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { Builder, By, Capabilities, until } from "selenium-webdriver";

const application = resolve(process.env.APPIMAGE_PATH || "");
const fakeTihulu = resolve(process.env.FAKE_TIHULU || "");
const inputDir = resolve(process.env.ACCEPTANCE_INPUT_DIR || "");
const outputDir = resolve(process.env.ACCEPTANCE_OUTPUT_DIR || "");
const argsLog = resolve(process.env.TIHULU_ACCEPTANCE_LOG || "");

for (const [label, value] of [
  ["APPIMAGE_PATH", application],
  ["FAKE_TIHULU", fakeTihulu],
  ["ACCEPTANCE_INPUT_DIR", inputDir],
  ["ACCEPTANCE_OUTPUT_DIR", outputDir],
]) {
  assert.ok(value && existsSync(value), `${label} must point to an existing path: ${value}`);
}

// A real local source for packaged thumbnail IPC. This is intentionally tiny; the
// acceptance target is native decode/cache/WebView transport rather than performance.
const previewSource = resolve(inputDir, "acceptance-preview.png");
writeFileSync(
  previewSource,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAwMDAxMDAwMAAAAwBAf8B9QAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function waitForFile(path, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return readFileSync(path, "utf8");
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${path}`);
}

let driver;
let tauriDriver;
try {
  tauriDriver = spawn(process.env.TAURI_DRIVER || "tauri-driver", [], {
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  tauriDriver.on("error", (error) => {
    console.error("tauri-driver failed to start", error);
  });
  await sleep(1000);

  const capabilities = new Capabilities();
  capabilities.set("tauri:options", { application });
  capabilities.setBrowserName("wry");

  driver = await new Builder()
    .withCapabilities(capabilities)
    .usingServer("http://127.0.0.1:4444/")
    .build();
  await driver.manage().setTimeouts({ script: 15000, implicit: 1000 });

  await driver.wait(until.elementLocated(By.css("#groupHardwarePolicyEffective")), 15000);
  await driver.wait(until.elementLocated(By.css("#trailHardwarePolicyEffective")), 15000);
  await driver.wait(until.elementLocated(By.css("#timelapseHardwarePolicyEffective")), 15000);

  const pulseModuleState = await driver.executeScript(
    "return document.documentElement.dataset.moduleStudioEditorSelectionSync || null;",
  );
  assert.equal(pulseModuleState, null, "obsolete selection-pulse module loaded in packaged app");

  const thumbnailResult = await driver.executeAsyncScript(
    function invokeThumbnail(sourcePath) {
      const done = arguments[arguments.length - 1];
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke !== "function") {
        done({ ok: false, error: "Tauri IPC bridge is unavailable in packaged app" });
        return;
      }
      Promise.resolve(invoke("get_thumbnail", {
        sourcePath,
        maxWidth: 96,
        maxHeight: 72,
        sourceVersion: "packaged-acceptance-v0310",
      }))
        .then((value) => done({ ok: true, value }))
        .catch((error) => done({ ok: false, error: String(error) }));
    },
    previewSource,
  );
  assert.equal(thumbnailResult?.ok, true, thumbnailResult?.error || "get_thumbnail failed");
  assert.match(
    String(thumbnailResult.value?.dataUrl || ""),
    /^data:image\/jpeg;base64,/, 
    "packaged thumbnail IPC did not return a bounded JPEG data URL",
  );
  assert.ok(
    existsSync(String(thumbnailResult.value?.path || "")),
    "packaged thumbnail cache file was not created",
  );

  const request = {
    command: "run",
    input: inputDir,
    output: outputDir,
    executable: fakeTihulu,
    files: null,
    groupHardware: "gpu",
    trailHardware: "gpu",
    timelapseHardware: "gpu",
    threshold: 0.42,
    minMatches: 18,
    maxSide: 1000,
    nfeatures: 2500,
    timeMetadata: false,
    timeWindowMinutes: 360,
    recursive: true,
    quiet: false,
    linkMode: "copy",
    minFrames: 2,
    jpegQuality: 95,
    timelapse: true,
    fps: 24,
    videoMaxSide: 1920,
    codec: "mp4v",
  };

  const result = await driver.executeAsyncScript(
    function invokeStartJob(jobRequest) {
      const done = arguments[arguments.length - 1];
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke !== "function") {
        done({ ok: false, error: "Tauri IPC bridge is unavailable in packaged app" });
        return;
      }
      Promise.resolve(invoke("start_job", { request: jobRequest }))
        .then((value) => done({ ok: true, value }))
        .catch((error) => done({ ok: false, error: String(error) }));
    },
    request,
  );

  assert.equal(result?.ok, true, result?.error || "start_job failed");
  const commandDisplay = String(result.value.commandDisplay || "");
  for (const flag of ["--group-hardware", "--trail-hardware", "--timelapse-hardware"]) {
    assert.match(commandDisplay, new RegExp(`${flag}\\s+gpu(?:\\s|$)`), `${flag} gpu missing from packaged command`);
    assert.doesNotMatch(commandDisplay, new RegExp(`${flag}\\s+(?:auto|cpu)(?:\\s|$)`), `${flag} was silently downgraded`);
  }

  const actualArgs = await waitForFile(argsLog);
  for (const flag of ["--group-hardware", "--trail-hardware", "--timelapse-hardware"]) {
    assert.match(actualArgs, new RegExp(`(?:^|\\n)${flag}\\ngpu(?:\\n|$)`), `${flag} gpu missing from engine argv`);
  }

  await driver.wait(async () => {
    const values = await Promise.all([
      "#groupHardwarePolicyEffective",
      "#trailHardwarePolicyEffective",
      "#timelapseHardwarePolicyEffective",
    ].map(async (selector) => driver.findElement(By.css(selector)).getText()));
    return values.every((value) => /NVIDIA CUDA/i.test(value));
  }, 10000, "Effective backend labels did not reflect engine output");

  const effective = await Promise.all([
    "#groupHardwarePolicyEffective",
    "#trailHardwarePolicyEffective",
    "#timelapseHardwarePolicyEffective",
  ].map(async (selector) => driver.findElement(By.css(selector)).getText()));
  console.log("Packaged thumbnail data URL verified:", String(thumbnailResult.value.dataUrl).slice(0, 32));
  console.log("Packaged AppImage acceptance passed:", commandDisplay);
  console.log("Effective backend labels:", effective.join(" | "));
} catch (error) {
  if (driver) {
    try {
      const screenshot = await driver.takeScreenshot();
      writeFileSync(process.env.ACCEPTANCE_SCREENSHOT || "/tmp/gui4tihulu-appimage-acceptance.png", screenshot, "base64");
    } catch {
      // Preserve the original acceptance failure.
    }
  }
  throw error;
} finally {
  if (driver) {
    try { await driver.quit(); } catch {}
  }
  if (tauriDriver && !tauriDriver.killed) tauriDriver.kill("SIGTERM");
}
