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

const previewBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPkEpFjYGBgYmBgYGBgAAAC5gBAXKUgWwAAAABJRU5ErkJggg==",
  "base64",
);
const acceptanceSources = Array.from({ length: 32 }, (_, index) =>
  resolve(
    inputDir,
    index === 0
      ? "acceptance-preview.png"
      : `acceptance-synthetic-${String(index).padStart(3, "0")}.png`,
  ),
);
for (const source of acceptanceSources) writeFileSync(source, previewBytes);
const previewSource = acceptanceSources[0];

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const stage = (message) => console.log(`[acceptance] ${new Date().toISOString()} ${message}`);

function withTimeout(promise, timeoutMs, label, onTimeout) {
  let timer;
  const normalized = Promise.resolve(promise);
  return Promise.race([
    normalized.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { onTimeout?.(); } catch {}
        reject(new Error(`${label} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
    }),
  ]);
}

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
  stage("starting tauri-driver");
  tauriDriver = spawn(process.env.TAURI_DRIVER || "tauri-driver", [], {
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  tauriDriver.on("error", (error) => {
    console.error("tauri-driver failed to start", error);
  });

  // Keep the startup sequence that has already proven reliable in v0.3.9.
  // A raw TCP readiness probe can itself hit tauri-driver before its native
  // WebKit backend is ready and create a false Connection refused race.
  await sleep(1000);
  assert.equal(tauriDriver.exitCode, null, "tauri-driver exited during startup grace period");
  stage("tauri-driver startup grace period complete");

  const capabilities = new Capabilities();
  capabilities.set("tauri:options", { application });
  capabilities.setBrowserName("wry");

  stage("creating packaged Wry WebDriver session");
  driver = await withTimeout(
    new Builder()
      .withCapabilities(capabilities)
      .usingServer("http://127.0.0.1:4444/")
      .build(),
    30000,
    "WebDriver session creation",
    () => tauriDriver && !tauriDriver.killed && tauriDriver.kill("SIGTERM"),
  );
  stage("packaged Wry WebDriver session created");
  await driver.manage().setTimeouts({ script: 20000, implicit: 1000 });

  stage("waiting for packaged application modules");
  await driver.wait(until.elementLocated(By.css("#groupHardwarePolicyEffective")), 15000);
  await driver.wait(until.elementLocated(By.css("#trailHardwarePolicyEffective")), 15000);
  await driver.wait(until.elementLocated(By.css("#timelapseHardwarePolicyEffective")), 15000);
  await driver.wait(async () => {
    const state = await driver.executeScript(
      "return [document.documentElement.dataset.moduleStudioEditor, document.documentElement.dataset.moduleWorkspaceImportBridge];",
    );
    return Array.isArray(state) && state.every((value) => value === "ready");
  }, 15000, "Studio Editor or workspace import bridge did not load in packaged app");
  stage("packaged application modules ready");

  const pulseModuleState = await driver.executeScript(
    "return document.documentElement.dataset.moduleStudioEditorSelectionSync || null;",
  );
  assert.equal(pulseModuleState, null, "obsolete selection-pulse module loaded in packaged app");

  stage("checking native thumbnail IPC");
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
        sourceVersion: "packaged-acceptance-v0312",
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
  stage("native thumbnail IPC passed");

  stage("loading real 32-frame Photo Workspace state");
  const workspaceScan = await driver.executeAsyncScript(
    function scanWorkspaceThroughBridge(sourceRoot, expectedCount) {
      const done = arguments[arguments.length - 1];
      window.dispatchEvent(new CustomEvent("tihulu:workspace-scan-source", {
        detail: { source: sourceRoot },
      }));

      const deadline = Date.now() + 12000;
      const poll = () => {
        const tiles = Array.from(document.querySelectorAll("#photoGrid .photo-tile[data-path]"));
        const label = document.querySelector("#photoSourcePath")?.textContent?.trim() || "";
        if (tiles.length === expectedCount && label === sourceRoot) {
          const paths = tiles.map((tile) => tile.dataset.path).filter(Boolean);
          done({ ok: true, paths, count: paths.length, label });
          return;
        }
        if (Date.now() >= deadline) {
          done({ ok: false, error: "Real Photo Workspace scan timed out", count: tiles.length, label });
          return;
        }
        setTimeout(poll, 80);
      };
      poll();
    },
    inputDir,
    acceptanceSources.length,
  );
  assert.equal(
    workspaceScan?.ok,
    true,
    `${workspaceScan?.error || "Real Photo Workspace scan failed"}: ${JSON.stringify(workspaceScan)}`,
  );
  assert.equal(workspaceScan.count, 32, "Packaged workspace did not load the real 32-frame scan state");
  assert.equal(new Set(workspaceScan.paths).size, 32, "Packaged workspace scan returned duplicate frame paths");
  stage("real 32-frame Photo Workspace state loaded");

  stage("checking Photo Editor canvas");
  const editorPreview = await driver.executeAsyncScript(
    function selectRealEditorTile() {
      const done = arguments[arguments.length - 1];
      const firstTile = document.querySelector("#photoGrid .photo-tile[data-path]");
      if (!firstTile) {
        done({ ok: false, error: "Real workspace has no frame for Photo Editor" });
        return;
      }
      firstTile.click();
      const deadline = Date.now() + 12000;
      const poll = () => {
        const canvas = document.querySelector("#studioEditPreview canvas");
        if (canvas && canvas.width > 0 && canvas.height > 0) {
          done({ ok: true, width: canvas.width, height: canvas.height });
          return;
        }
        if (Date.now() >= deadline) {
          done({
            ok: false,
            error: document.querySelector("#studioEditPreview")?.textContent?.trim() || "Photo Editor canvas timed out",
            editName: document.querySelector("#studioEditName")?.textContent?.trim() || "",
            renderMode: document.querySelector("#studioEditRenderMode")?.textContent?.trim() || "",
            moduleState: document.documentElement.dataset.moduleStudioEditor || "",
          });
          return;
        }
        setTimeout(poll, 100);
      };
      poll();
    },
  );
  assert.equal(editorPreview?.ok, true, editorPreview?.error || "Photo Editor preview failed");
  assert.ok(editorPreview.width > 0 && editorPreview.height > 0, "Photo Editor canvas has invalid dimensions");
  stage(`Photo Editor canvas passed (${editorPreview.width}x${editorPreview.height})`);

  stage("checking atomic 32-group workspace import");
  const workspaceImport = await driver.executeAsyncScript(
    function exerciseAtomicImport(paths, sourceRoot) {
      const done = arguments[arguments.length - 1];
      const list = document.querySelector("#studioGroupList");
      if (!list || !Array.isArray(paths) || paths.length !== 32) {
        done({ ok: false, error: "Real workspace paths/group DOM are unavailable", pathCount: paths?.length || 0 });
        return;
      }

      const groupCount = paths.length;
      const visibleIntermediate = [];
      const observer = new MutationObserver(() => {
        const count = list.querySelectorAll(".studio-group-card[data-group-id]").length;
        if (count > 0 && count < groupCount && list.style.visibility !== "hidden") {
          visibleIntermediate.push({ count, visibility: list.style.visibility, scrollWidth: list.scrollWidth });
        }
      });
      observer.observe(list, { childList: true, subtree: true });

      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        window.removeEventListener("tihulu:workspace-groups-imported", onImported);
        done(value);
      };
      const onImported = () => {
        setTimeout(() => {
          finish({
            ok: true,
            finalCount: list.querySelectorAll(".studio-group-card[data-group-id]").length,
            visibleIntermediate,
            visibility: list.style.visibility,
          });
        }, 80);
      };

      window.addEventListener("tihulu:workspace-groups-imported", onImported, { once: true });
      window.dispatchEvent(new CustomEvent("tihulu:engine-groups-resolved", {
        detail: {
          source: sourceRoot,
          output: `${sourceRoot}/acceptance-output`,
          groups: paths.map((path, index) => ({
            name: `group_${String(index + 1).padStart(3, "0")}`,
            paths: [path],
          })),
        },
      }));

      setTimeout(() => finish({
        ok: false,
        error: "Atomic workspace import timed out",
        finalCount: list.querySelectorAll(".studio-group-card[data-group-id]").length,
        visibleIntermediate,
      }), 10000);
    },
    workspaceScan.paths,
    inputDir,
  );
  assert.equal(workspaceImport?.ok, true, workspaceImport?.error || "Atomic workspace import failed");
  assert.equal(workspaceImport.finalCount, 32, "Packaged workspace did not render the final 32 engine groups");
  assert.deepEqual(
    workspaceImport.visibleIntermediate,
    [],
    "Group strip exposed intermediate card counts/scrollbar widths during atomic import",
  );
  stage("atomic 32-group workspace import passed");

  stage("checking visible-group Include all scope");
  const groupIncludeScope = await driver.executeAsyncScript(
    function exerciseVisibleIncludeScope() {
      const done = arguments[arguments.length - 1];
      const groupCards = () => Array.from(document.querySelectorAll("#studioGroupList .studio-group-card[data-group-id]"));
      const open = (card) => card?.querySelector(".group-open")?.click();
      const checkbox = () => document.querySelector("#allIncluded");
      const tileState = () => Array.from(document.querySelectorAll("#photoGrid .photo-tile[data-path]")).map((tile) => ({
        path: tile.dataset.path,
        hidden: tile.classList.contains("studio-group-hidden"),
        included: Boolean(tile.querySelector(".include-box input")?.checked),
      }));
      const waitFor = (predicate, timeoutMs, onReady, onTimeout) => {
        const deadline = Date.now() + timeoutMs;
        const poll = () => {
          if (predicate()) { onReady(); return; }
          if (Date.now() >= deadline) { onTimeout(); return; }
          setTimeout(poll, 40);
        };
        poll();
      };
      if (groupCards().length < 2) {
        done({ ok: false, error: "Need at least two groups for visible include scope acceptance" });
        return;
      }

      open(groupCards()[0]);
      waitFor(
        () => tileState().filter((item) => !item.hidden).length === 1 && Boolean(checkbox()?.checked),
        2500,
        () => {
          const firstVisible = tileState().filter((item) => !item.hidden);
          const firstPath = firstVisible[0].path;
          checkbox()?.click();
          waitFor(
            () => {
              const afterExclude = tileState();
              const first = afterExclude.find((item) => item.path === firstPath);
              const outsideIncluded = afterExclude.some((item) => item.path !== firstPath && item.included);
              return first?.included === false && outsideIncluded && !checkbox()?.checked;
            },
            2500,
            () => {
              open(groupCards()[1]);
              waitFor(
                () => {
                  const state = tileState();
                  const secondVisible = state.filter((item) => !item.hidden);
                  const firstStillExcluded = state.find((item) => item.path === firstPath)?.included === false;
                  return secondVisible.length === 1 && secondVisible[0].included && Boolean(checkbox()?.checked) && firstStillExcluded;
                },
                2500,
                () => {
                  document.querySelector("#studioGroupList .all-card")?.click();
                  waitFor(
                    () => {
                      const all = tileState();
                      return all.length === 32 && all.every((item) => !item.hidden && item.included) && Boolean(checkbox()?.checked);
                    },
                    2500,
                    () => done({ ok: true }),
                    () => {
                      const all = tileState();
                      done({
                        ok: false,
                        error: "All frames did not restore every shown frame to Included",
                        included: all.filter((item) => item.included).length,
                        hidden: all.filter((item) => item.hidden).length,
                        count: all.length,
                      });
                    },
                  );
                },
                () => done({
                  ok: false,
                  error: "Switching groups did not scope inclusion to the clicked group",
                  state: tileState(),
                  checked: Boolean(checkbox()?.checked),
                }),
              );
            },
            () => done({
              ok: false,
              error: "Include all changed frames outside the visible group",
              state: tileState(),
              checked: Boolean(checkbox()?.checked),
            }),
          );
        },
        () => done({
          ok: false,
          error: "First group did not become the active included visible scope",
          state: tileState(),
          checked: Boolean(checkbox()?.checked),
        }),
      );
    },
  );
  assert.equal(
    groupIncludeScope?.ok,
    true,
    `${groupIncludeScope?.error || "Visible group Include all scope failed"}: ${JSON.stringify(groupIncludeScope)}`,
  );
  stage("visible-group Include all scope passed");

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

  stage("checking start_job GPU policy contract");
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
  stage("start_job GPU policy contract passed");

  const readBackendDiagnostics = () => driver.executeScript(function collectBackendDiagnostics() {
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
    return {
      labels: [
        text("#groupHardwarePolicyEffective"),
        text("#trailHardwarePolicyEffective"),
        text("#timelapseHardwarePolicyEffective"),
      ],
      consoleText: text("#consoleBody"),
      consoleLines: Array.from(document.querySelectorAll("#consoleBody .console-line")).map((row) => row.textContent?.trim() || ""),
      hardwareBackendListening: document.documentElement.dataset.hardwareBackendListening || "",
      moduleHardwareOptions: document.documentElement.dataset.moduleHardwareOptions || "",
      bootstrap: document.documentElement.dataset.tihuluBootstrap || "",
      labelCounts: [
        document.querySelectorAll("#groupHardwarePolicyEffective").length,
        document.querySelectorAll("#trailHardwarePolicyEffective").length,
        document.querySelectorAll("#timelapseHardwarePolicyEffective").length,
      ],
    };
  });

  stage("waiting for effective CUDA backend labels");
  const effectiveDeadline = Date.now() + 10000;
  let backendDiagnostics;
  while (Date.now() < effectiveDeadline) {
    backendDiagnostics = await readBackendDiagnostics();
    if (backendDiagnostics.labels.every((value) => /NVIDIA CUDA/i.test(value))) break;
    await sleep(100);
  }
  backendDiagnostics = await readBackendDiagnostics();
  assert.ok(
    backendDiagnostics.labels.every((value) => /NVIDIA CUDA/i.test(value)),
    `Effective backend labels did not reflect engine output: ${JSON.stringify(backendDiagnostics)}`,
  );

  const effective = backendDiagnostics.labels;

  console.log("Packaged thumbnail data URL verified:", String(thumbnailResult.value.dataUrl).slice(0, 32));
  console.log("Packaged Photo Editor canvas verified:", `${editorPreview.width}x${editorPreview.height}`);
  console.log("Atomic workspace import verified: 32 real workspace frames grouped with no visible intermediate churn");
  console.log("Visible group Include all scope verified against real main workspace state");
  console.log("Packaged AppImage acceptance passed:", commandDisplay);
  console.log("Effective backend labels:", effective.join(" | "));
  stage("all packaged AppImage acceptance checks passed");
} catch (error) {
  console.error("[acceptance] failed:", error);
  if (driver) {
    try {
      stage("capturing failure screenshot");
      const screenshot = await withTimeout(driver.takeScreenshot(), 20000, "Failure screenshot");
      writeFileSync(process.env.ACCEPTANCE_SCREENSHOT || "/tmp/gui4tihulu-appimage-acceptance.png", screenshot, "base64");
    } catch (screenshotError) {
      console.error("[acceptance] screenshot capture failed:", screenshotError);
    }
  }
  throw error;
} finally {
  if (driver) {
    try {
      stage("closing WebDriver session");
      await withTimeout(driver.quit(), 5000, "WebDriver quit");
    } catch (quitError) {
      console.error("[acceptance] WebDriver quit failed:", quitError);
    }
  }
  if (tauriDriver && !tauriDriver.killed) {
    stage("stopping tauri-driver");
    tauriDriver.kill("SIGTERM");
    const forceKill = setTimeout(() => {
      if (!tauriDriver.killed) tauriDriver.kill("SIGKILL");
    }, 2000);
    forceKill.unref();
  }
}
