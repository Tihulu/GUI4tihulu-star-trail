import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { Builder, By, Capabilities, until } from "selenium-webdriver";

const application = resolve(process.env.APPIMAGE_PATH || "");
const screenshotDir = resolve(process.env.README_SCREENSHOT_DIR || "docs/screenshots");
assert.ok(application && existsSync(application), `APPIMAGE_PATH must exist: ${application}`);
mkdirSync(screenshotDir, { recursive: true });

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    }),
  ]);
}

let driver;
let tauriDriver;
async function capture(name) {
  await sleep(400);
  const png = await withTimeout(driver.takeScreenshot(), 20000, `Screenshot ${name}`);
  writeFileSync(resolve(screenshotDir, `v0.3.13-${name}.png`), png, "base64");
  console.log(`[screenshots] captured ${name}`);
}

try {
  tauriDriver = spawn(process.env.TAURI_DRIVER || "tauri-driver", [], {
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  await sleep(1000);

  const capabilities = new Capabilities();
  capabilities.set("tauri:options", { application });
  capabilities.setBrowserName("wry");
  driver = await withTimeout(
    new Builder().withCapabilities(capabilities).usingServer("http://127.0.0.1:4444/").build(),
    60000,
    "WebDriver session creation",
  );
  await driver.manage().setTimeouts({ script: 20000, implicit: 1000 });
  try { await driver.manage().window().setRect({ width: 1500, height: 1000 }); } catch {}

  await driver.wait(until.elementLocated(By.css("#groupHardwarePolicy")), 15000);
  await driver.wait(until.elementLocated(By.css("#studioGroupList")), 15000);
  await driver.wait(until.elementLocated(By.css("#studioEditPreview")), 15000);
  await driver.wait(until.elementLocated(By.css("#parameterGuideButton")), 15000);

  // Process / GPU screenshot.
  await driver.executeScript(`
    document.querySelector('[data-section="process"]')?.click();
    const advanced = document.querySelector('#advancedCard');
    if (advanced) advanced.open = true;
    document.querySelector('#groupHardwarePolicy button[data-value="gpu"]')?.click();
    const effective = document.querySelector('#groupHardwarePolicyEffective');
    if (effective) effective.textContent = 'Effective backend: NVIDIA CUDA';
    document.querySelector('#groupHardwarePolicy')?.scrollIntoView({ block: 'center' });
  `);
  await capture("process-gpu");

  // Parameter guide screenshot.
  await driver.executeScript(`
    document.querySelector('#parameterGuideButton')?.click();
  `);
  await driver.wait(until.elementLocated(By.css(".parameter-info-overlay:not(.hidden)")), 5000);
  await capture("parameter-guide");
  await driver.executeScript(`document.querySelector('.parameter-info-close')?.click();`);

  // Build a representative Photo Workspace using the real packaged UI components.
  await driver.executeScript(`
    document.querySelector('[data-section="photos"]')?.click();
    const source = document.querySelector('#photoSourcePath');
    if (source) source.textContent = '/home/demo/night-sky-session';
    const grid = document.querySelector('#photoGrid');
    if (!grid) throw new Error('photo grid missing');
    grid.innerHTML = '';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#07101f"/><stop offset="1" stop-color="#2d4168"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><g fill="#fff"><circle cx="90" cy="70" r="2"/><circle cx="170" cy="120" r="1.5"/><circle cx="250" cy="55" r="2"/><circle cx="340" cy="140" r="1.5"/><circle cx="450" cy="80" r="2"/><circle cx="560" cy="130" r="1.5"/></g><path d="M70 290 C190 190 390 175 590 90" fill="none" stroke="#e8d39a" stroke-width="5" opacity=".85"/></svg>';
    const thumb = 'data:image/svg+xml;base64,' + btoa(svg);
    const paths = [];
    for (let i = 0; i < 12; i += 1) {
      const path = '/home/demo/night-sky-session/IMG_' + String(8840 + i) + '.JPG';
      paths.push(path);
      const tile = document.createElement('article');
      tile.className = 'photo-tile' + (i === 0 ? ' selected' : '');
      tile.dataset.path = path;
      tile.innerHTML = '<div class="thumb-wrap"><img src="' + thumb + '"></div><div class="tile-copy"><strong>IMG_' + String(8840 + i) + '.JPG</strong><small>24 MP · Included</small></div><label class="include-box"><input type="checkbox" checked><span>Included</span></label>';
      grid.append(tile);
    }
    window.dispatchEvent(new CustomEvent('tihulu:engine-groups-resolved', {
      detail: {
        source: '/home/demo/night-sky-session',
        output: '/home/demo/night-sky-session/output',
        groups: [
          { name: 'North sky', paths: paths.slice(0, 4) },
          { name: 'Zenith', paths: paths.slice(4, 8) },
          { name: 'South sky', paths: paths.slice(8, 12) },
        ],
      },
    }));
  `);
  await driver.wait(async () => (await driver.findElements(By.css("#studioGroupList .studio-group-card[data-group-id]"))).length === 3, 10000);
  await driver.executeScript(`document.querySelector('#studioGroupList')?.scrollIntoView({ block: 'center' });`);
  await capture("workspace-groups");

  // Photo Editor screenshot: keep the actual editor controls and put a representative
  // rendered preview on its real canvas surface so the docs never show an empty panel.
  await driver.executeScript(`
    const preview = document.querySelector('#studioEditPreview');
    if (!preview) throw new Error('editor preview missing');
    preview.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.width = 960; canvas.height = 540;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 960, 540);
    grad.addColorStop(0, '#050b18'); grad.addColorStop(1, '#263a63');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 960, 540);
    ctx.strokeStyle = '#f0d58f'; ctx.lineWidth = 4; ctx.globalAlpha = 0.9;
    for (let y = 100; y < 460; y += 58) { ctx.beginPath(); ctx.arc(480, 300, y, 3.7, 5.55); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.fillStyle = '#fff';
    [[90,70],[170,115],[255,60],[350,135],[455,82],[560,125],[720,90],[820,170]].forEach(([x,y]) => { ctx.beginPath(); ctx.arc(x,y,2,0,Math.PI*2); ctx.fill(); });
    preview.append(canvas);
    const name = document.querySelector('#studioEditName'); if (name) name.textContent = 'IMG_8840.JPG';
    const mode = document.querySelector('#studioEditRenderMode'); if (mode) mode.textContent = 'Native preview · non-destructive';
    document.querySelector('.studio-editor-panel')?.scrollIntoView({ block: 'start' });
  `);
  await capture("photo-editor");
} finally {
  if (driver) {
    try { await withTimeout(driver.quit(), 10000, "WebDriver quit"); } catch {}
  }
  if (tauriDriver && !tauriDriver.killed) tauriDriver.kill("SIGTERM");
}
