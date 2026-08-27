import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { Builder, By, Capabilities, until } from "selenium-webdriver";

const application = resolve(process.env.APPIMAGE_PATH || "");
const inputDir = resolve(process.env.ACCEPTANCE_INPUT_DIR || "");
assert.ok(existsSync(application), `Missing AppImage: ${application}`);
assert.ok(existsSync(inputDir), `Missing input dir: ${inputDir}`);

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPkEpFjYGBgYmBgYGBgAAAC5gBAXKUgWwAAAABJRU5ErkJggg==",
  "base64",
);
for (let i = 0; i < 32; i += 1) {
  const name = i === 0 ? "acceptance-preview.png" : `acceptance-synthetic-${String(i).padStart(3, "0")}.png`;
  writeFileSync(resolve(inputDir, name), png);
}

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const log = (label, value) => console.log(`[editor-probe] ${label}:`, JSON.stringify(value));

let driver;
let tauriDriver;
try {
  tauriDriver = spawn(process.env.TAURI_DRIVER || "tauri-driver", [], { env: process.env, stdio: ["ignore", "inherit", "inherit"] });
  await sleep(1000);
  assert.equal(tauriDriver.exitCode, null, "tauri-driver exited during startup");

  const capabilities = new Capabilities();
  capabilities.set("tauri:options", { application });
  capabilities.setBrowserName("wry");
  driver = await new Builder().withCapabilities(capabilities).usingServer("http://127.0.0.1:4444/").build();
  await driver.manage().setTimeouts({ script: 25000, implicit: 1000 });

  await driver.wait(until.elementLocated(By.css("#photoGrid")), 15000);
  await driver.wait(async () => {
    const state = await driver.executeScript("return document.documentElement.dataset.moduleStudioEditor || null;");
    return state === "ready";
  }, 15000);

  const scan = await driver.executeAsyncScript(function scanWorkspace(sourceRoot) {
    const done = arguments[arguments.length - 1];
    window.dispatchEvent(new CustomEvent("tihulu:workspace-scan-source", { detail: { source: sourceRoot } }));
    const deadline = Date.now() + 12000;
    const poll = () => {
      const tiles = Array.from(document.querySelectorAll("#photoGrid .photo-tile[data-path]"));
      const label = document.querySelector("#photoSourcePath")?.textContent?.trim() || "";
      if (tiles.length === 32 && label === sourceRoot) {
        done({ ok: true, firstPath: tiles[0]?.dataset.path || "", count: tiles.length, label });
        return;
      }
      if (Date.now() >= deadline) {
        done({ ok: false, count: tiles.length, label });
        return;
      }
      setTimeout(poll, 50);
    };
    poll();
  }, inputDir);
  log("scan", scan);
  assert.equal(scan?.ok, true, `scan failed: ${JSON.stringify(scan)}`);

  const direct = await driver.executeAsyncScript(function probeNative(path) {
    const done = arguments[arguments.length - 1];
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    const started = performance.now();
    Promise.resolve(invoke("get_thumbnail", {
      sourcePath: path,
      maxWidth: 1200,
      maxHeight: 1200,
      sourceVersion: "editor-runtime-probe",
    })).then((value) => {
      const ipcMs = Math.round(performance.now() - started);
      const dataUrl = String(value?.dataUrl || "");
      const image = new Image();
      const decodeStarted = performance.now();
      const timer = setTimeout(() => {
        image.onload = null;
        image.onerror = null;
        done({ ok: false, stage: "decode-timeout", ipcMs, prefix: dataUrl.slice(0, 32) });
      }, 8000);
      image.onload = () => {
        clearTimeout(timer);
        done({
          ok: true,
          ipcMs,
          decodeMs: Math.round(performance.now() - decodeStarted),
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
          prefix: dataUrl.slice(0, 32),
        });
      };
      image.onerror = () => {
        clearTimeout(timer);
        done({ ok: false, stage: "decode-error", ipcMs, prefix: dataUrl.slice(0, 32) });
      };
      image.src = dataUrl;
    }).catch((error) => done({ ok: false, stage: "ipc", error: String(error), ipcMs: Math.round(performance.now() - started) }));
  }, scan.firstPath);
  log("direct-1200", direct);

  const before = await driver.executeScript(function editorState() {
    const first = document.querySelector("#photoGrid .photo-tile[data-path]");
    return {
      firstPath: first?.dataset.path || "",
      firstSelected: Boolean(first?.classList.contains("selected")),
      selectedCount: document.querySelectorAll("#photoGrid .photo-tile.selected").length,
      editName: document.querySelector("#studioEditName")?.textContent?.trim() || "",
      renderMode: document.querySelector("#studioEditRenderMode")?.textContent?.trim() || "",
      previewText: document.querySelector("#studioEditPreview")?.textContent?.trim() || "",
      hasCanvas: Boolean(document.querySelector("#studioEditPreview canvas")),
    };
  });
  log("before-click", before);

  const clickResult = await driver.executeScript(function clickFirst() {
    const first = document.querySelector("#photoGrid .photo-tile[data-path]");
    if (!first) return { ok: false };
    first.click();
    return { ok: true, path: first.dataset.path || "" };
  });
  log("click", clickResult);

  for (const delay of [100, 500, 1500, 5000, 12000]) {
    await sleep(delay === 100 ? 100 : delay - ({ 500: 100, 1500: 500, 5000: 1500, 12000: 5000 }[delay] || 0));
    const state = await driver.executeScript(function editorState() {
      const first = document.querySelector("#photoGrid .photo-tile[data-path]");
      const canvas = document.querySelector("#studioEditPreview canvas");
      return {
        firstSelected: Boolean(first?.classList.contains("selected")),
        selectedCount: document.querySelectorAll("#photoGrid .photo-tile.selected").length,
        editName: document.querySelector("#studioEditName")?.textContent?.trim() || "",
        renderMode: document.querySelector("#studioEditRenderMode")?.textContent?.trim() || "",
        previewText: document.querySelector("#studioEditPreview")?.textContent?.trim() || "",
        canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
        moduleState: document.documentElement.dataset.moduleStudioEditor || "",
      };
    });
    log(`after-${delay}ms`, state);
    if (state.canvas) break;
  }
} finally {
  if (driver) {
    try { await driver.quit(); } catch {}
  }
  if (tauriDriver && !tauriDriver.killed) tauriDriver.kill("SIGTERM");
}
