import assert from "node:assert/strict";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { Builder, By, Capabilities, until } from "selenium-webdriver";

const application = resolve(process.env.APPIMAGE_PATH || "");
const inputDir = resolve(process.env.ACCEPTANCE_INPUT_DIR || "");
assert.ok(application && existsSync(application), `APPIMAGE_PATH must exist: ${application}`);
assert.ok(inputDir && existsSync(inputDir), `ACCEPTANCE_INPUT_DIR must exist: ${inputDir}`);

const previewBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPkEpFjYGBgYmBgYGBgAAAC5gBAXKUgWwAAAABJRU5ErkJggg==",
  "base64",
);
const sources = Array.from({ length: 4 }, (_, index) => resolve(inputDir, `scope-probe-${index + 1}.png`));
for (const source of sources) writeFileSync(source, previewBytes);

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const stage = (message) => console.log(`[active-group-acceptance] ${new Date().toISOString()} ${message}`);

let driver;
let tauriDriver;
try {
  stage("starting tauri-driver");
  tauriDriver = spawn(process.env.TAURI_DRIVER || "tauri-driver", [], {
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  await sleep(1000);
  assert.equal(tauriDriver.exitCode, null, "tauri-driver exited during startup grace period");

  const capabilities = new Capabilities();
  capabilities.set("tauri:options", { application });
  capabilities.setBrowserName("wry");
  driver = await new Builder()
    .withCapabilities(capabilities)
    .usingServer("http://127.0.0.1:4444/")
    .build();
  await driver.manage().setTimeouts({ script: 15000, implicit: 1000 });

  await driver.wait(until.elementLocated(By.css("#photoGrid")), 15000);
  await driver.wait(async () => {
    const state = await driver.executeScript(
      "return [document.documentElement.dataset.moduleStudioEditor, document.documentElement.dataset.moduleWorkspaceImportBridge, document.documentElement.dataset.moduleWorkspaceJobScope];",
    );
    return Array.isArray(state) && state.every((value) => value === "ready");
  }, 15000, "Studio group/job-scope modules did not load in packaged app");

  const result = await driver.executeAsyncScript(
    function exerciseActiveGroupStart(sourceRoot, expectedSources) {
      const done = arguments[arguments.length - 1];
      const waitFor = (predicate, timeoutMs, onReady, onTimeout) => {
        const deadline = Date.now() + timeoutMs;
        const poll = () => {
          if (predicate()) { onReady(); return; }
          if (Date.now() >= deadline) { onTimeout(); return; }
          setTimeout(poll, 50);
        };
        poll();
      };
      const tileState = () => Array.from(document.querySelectorAll("#photoGrid .photo-tile[data-path]")).map((tile) => ({
        path: tile.dataset.path,
        hidden: tile.classList.contains("studio-group-hidden"),
        included: Boolean(tile.querySelector(".include-box input")?.checked),
      }));

      window.dispatchEvent(new CustomEvent("tihulu:workspace-scan-source", { detail: { source: sourceRoot } }));
      waitFor(
        () => tileState().length >= expectedSources.length,
        10000,
        () => {
          const paths = tileState().map((item) => item.path).filter((path) => expectedSources.includes(path));
          if (paths.length !== expectedSources.length) {
            done({ ok: false, error: "Packaged scope probe did not scan the expected fixture paths", paths });
            return;
          }
          window.dispatchEvent(new CustomEvent("tihulu:engine-groups-resolved", {
            detail: {
              source: sourceRoot,
              output: `${sourceRoot}/scope-probe-output`,
              groups: [
                { name: "scope_a", paths: paths.slice(0, 2) },
                { name: "scope_b", paths: paths.slice(2, 4) },
              ],
            },
          }));
          waitFor(
            () => document.querySelectorAll("#studioGroupList .studio-group-card[data-group-id]").length === 2,
            5000,
            () => {
              const firstCard = document.querySelector("#studioGroupList .studio-group-card[data-group-id]");
              firstCard?.querySelector(".group-open")?.click();
              waitFor(
                () => {
                  const state = tileState().filter((item) => expectedSources.includes(item.path));
                  return state.filter((item) => !item.hidden).length === 2 && state.filter((item) => item.hidden).every((item) => item.included);
                },
                5000,
                () => {
                  const visibleTile = Array.from(document.querySelectorAll("#photoGrid .photo-tile[data-path]"))
                    .find((tile) => expectedSources.includes(tile.dataset.path) && !tile.classList.contains("studio-group-hidden"));
                  visibleTile?.querySelector(".include-box input")?.click();
                  const start = document.querySelector("#startJob");
                  if (!start) {
                    done({ ok: false, error: "Start button is unavailable" });
                    return;
                  }
                  start.addEventListener("click", (event) => event.stopImmediatePropagation(), { capture: true, once: true });
                  start.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

                  const state = tileState().filter((item) => expectedSources.includes(item.path));
                  const visible = state.filter((item) => !item.hidden);
                  const outside = state.filter((item) => item.hidden);
                  done({
                    ok: visible.length === 2
                      && outside.length === 2
                      && outside.every((item) => item.included === false)
                      && visible.filter((item) => item.included).length === 1,
                    state,
                    visibleIncluded: visible.filter((item) => item.included).length,
                    outsideIncluded: outside.filter((item) => item.included).length,
                  });
                },
                () => done({ ok: false, error: "First group did not become the visible scope", state: tileState() }),
              );
            },
            () => done({ ok: false, error: "Two packaged probe groups were not imported" }),
          );
        },
        () => done({ ok: false, error: "Packaged scope fixture scan timed out", state: tileState() }),
      );
    },
    inputDir,
    sources,
  );

  assert.equal(
    result?.ok,
    true,
    `${result?.error || "Active-group Start did not scope staged inclusion"}: ${JSON.stringify(result)}`,
  );
  assert.equal(result.visibleIncluded, 1, "manual exclusion inside active group was not preserved");
  assert.equal(result.outsideIncluded, 0, "frames outside active group remained included at Start");
  stage("active-group Start scope passed");
} finally {
  if (driver) {
    try { await driver.quit(); } catch {}
  }
  if (tauriDriver && tauriDriver.exitCode === null) {
    tauriDriver.kill("SIGTERM");
    await Promise.race([
      new Promise((resolveExit) => tauriDriver.once("exit", resolveExit)),
      sleep(2500),
    ]);
  }
  for (const source of sources) {
    try { if (existsSync(source)) unlinkSync(source); } catch {}
  }
}
