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

const previewSource = resolve(inputDir, "acceptance-preview.png");
writeFileSync(
  previewSource,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPkEpFjYGBgYmBgYGBgAAAC5gBAXKUgWwAAAABJRU5ErkJggg==",
    "base64",
  ),
);

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

  stage("checking Photo Editor canvas");
  const editorPreview = await driver.executeAsyncScript(
    function installEditorTile(sourcePath, sourceRoot) {
      const done = arguments[arguments.length - 1];
      const grid = document.querySelector("#photoGrid");
      const sourceLabel = document.querySelector("#photoSourcePath");
      if (!grid || !sourceLabel) {
        done({ ok: false, error: "Photo Workspace DOM is unavailable" });
        return;
      }

      sourceLabel.textContent = sourceRoot;
      grid.innerHTML = "";
      const tile = document.createElement("article");
      tile.className = "photo-tile selected";
      tile.dataset.path = sourcePath;

      const thumbWrap = document.createElement("div");
      thumbWrap.className = "thumb-wrap";
      const image = document.createElement("img");
      image.dataset.thumbPath = sourcePath;
      image.dataset.thumbVersion = "packaged-editor-v0312";
      thumbWrap.append(image);

      const copy = document.createElement("div");
      copy.className = "tile-copy";
      const strong = document.createElement("strong");
      strong.textContent = "acceptance-preview.png";
      copy.append(strong);
      tile.append(thumbWrap, copy);
      grid.append(tile);

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
          });
          return;
        }
        setTimeout(poll, 100);
      };
      poll();
    },
    previewSource,
    inputDir,
  );
  assert.equal(editorPreview?.ok, true, editorPreview?.error || "Photo Editor preview failed");
  assert.ok(editorPreview.width > 0 && editorPreview.height > 0, "Photo Editor canvas has invalid dimensions");
  stage(`Photo Editor canvas passed (${editorPreview.width}x${editorPreview.height})`);

  stage("checking atomic 32-group workspace import");
  const workspaceImport = await driver.executeAsyncScript(
    function exerciseAtomicImport(realPath, sourceRoot) {
      const done = arguments[arguments.length - 1];
      const grid = document.querySelector("#photoGrid");
      const sourceLabel = document.querySelector("#photoSourcePath");
      const list = document.querySelector("#studioGroupList");
      if (!grid || !sourceLabel || !list) {
        done({ ok: false, error: "Workspace group DOM is unavailable" });
        return;
      }

      sourceLabel.textContent = sourceRoot;
      grid.innerHTML = "";
      const paths = [];
      const groupCount = 32;
      for (let index = 0; index < groupCount; index += 1) {
        const path = index === 0 ? realPath : `${sourceRoot}/acceptance-synthetic-${String(index).padStart(3, "0")}.jpg`;
        paths.push(path);
        const tile = document.createElement("article");
        tile.className = "photo-tile";
        tile.dataset.path = path;
        const copy = document.createElement("div");
        copy.className = "tile-copy";
        const strong = document.createElement("strong");
        strong.textContent = `frame-${index}`;
        copy.append(strong);
        if (index === 0) {
          const image = document.createElement("img");
          image.dataset.thumbPath = realPath;
          image.dataset.thumbVersion = "packaged-group-v0312";
          tile.append(image);
        }
        tile.append(copy);
        grid.append(tile);
      }

      setTimeout(() => {
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
      }, 350);
    },
    previewSource,
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
      if (groupCards().length < 2) {
        done({ ok: false, error: "Need at least two groups for visible include scope acceptance" });
        return;
      }

      open(groupCards()[0]);
      setTimeout(() => {
        const firstVisible = tileState().filter((item) => !item.hidden);
        if (firstVisible.length !== 1 || !checkbox()?.checked) {
          done({ ok: false, error: "First group did not become the active included visible scope", firstVisible });
          return;
        }
        const firstPath = firstVisible[0].path;
        checkbox()?.click();
        setTimeout(() => {
          const afterExclude = tileState();
          const first = afterExclude.find((item) => item.path === firstPath);
          const outsideIncluded = afterExclude.some((item) => item.path !== firstPath && item.included);
          if (first?.included || !outsideIncluded || checkbox()?.checked) {
            done({ ok: false, error: "Include all changed frames outside the visible group", first, outsideIncluded });
            return;
          }

          open(groupCards()[1]);
          setTimeout(() => {
            const secondVisible = tileState().filter((item) => !item.hidden);
            const firstStillExcluded = tileState().find((item) => item.path === firstPath)?.included === false;
            if (secondVisible.length !== 1 || !secondVisible[0].included || !checkbox()?.checked || !firstStillExcluded) {
              done({ ok: false, error: "Switching groups did not scope inclusion to the clicked group", secondVisible, firstStillExcluded });
              return;
            }

            document.querySelector("#studioGroupList .all-card")?.click();
            setTimeout(() => {
              const all = tileState();
              done({
                ok: all.length === 32 && all.every((item) => !item.hidden && item.included) && Boolean(checkbox()?.checked),
                error: "All frames did not restore every shown frame to Included",
                included: all.filter((item) => item.included).length,
                hidden: all.filter((item) => item.hidden).length,
              });
            }, 140);
          }, 140);
        }, 140);
      }, 140);
    },
  );
  assert.equal(groupIncludeScope?.ok, true, groupIncludeScope?.error || "Visible group Include all scope failed");
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

  stage("waiting for effective CUDA backend labels");
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
  console.log("Packaged Photo Editor canvas verified:", `${editorPreview.width}x${editorPreview.height}`);
  console.log("Atomic workspace import verified: 32 groups with no visible intermediate churn");
  console.log("Packaged AppImage acceptance passed:", commandDisplay);
  console.log("Effective backend labels:", effective.join(" | "));
  stage("all packaged AppImage acceptance checks passed");
} catch (error) {
  console.error("[acceptance] failed:", error);
  if (driver) {
    try {
      stage("capturing failure screenshot");
      const screenshot = await withTimeout(driver.takeScreenshot(), 5000, "Failure screenshot");
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
