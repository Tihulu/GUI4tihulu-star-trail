import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { deflateSync } from "node:zlib";
import { Builder, By, Capabilities, until } from "selenium-webdriver";

const application = resolve(process.env.APPIMAGE_PATH || "");
const screenshotDir = resolve(process.env.README_SCREENSHOT_DIR || "docs/screenshots");
const fixtureDir = resolve(process.env.RUNNER_TEMP || "/tmp", "tihulu-readme-fixtures");
assert.ok(application && existsSync(application), `APPIMAGE_PATH must exist: ${application}`);
mkdirSync(screenshotDir, { recursive: true });
mkdirSync(fixtureDir, { recursive: true });

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

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([size, typeBuffer, data, checksum]);
}

function makeNightSkyPng(width = 640, height = 360) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const stars = [
    [71, 54], [109, 93], [144, 43], [188, 121], [238, 67], [291, 104],
    [347, 48], [392, 88], [448, 58], [507, 121], [565, 74], [604, 146],
    [87, 167], [170, 185], [264, 154], [365, 171], [474, 162], [553, 205],
  ];
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const index = row + 1 + x * 3;
      const t = y / Math.max(1, height - 1);
      let r = Math.round(5 + 10 * t);
      let g = Math.round(10 + 20 * t);
      let b = Math.round(27 + 38 * t);
      for (const [sx, sy] of stars) {
        const distance = Math.hypot(x - sx, y - sy);
        if (distance < 2.2) { r = 246; g = 244; b = 226; }
      }
      const dx = x - 330;
      const dy = y - 286;
      const radius = Math.hypot(dx, dy);
      let angle = Math.atan2(dy, dx);
      if (angle < 0) angle += Math.PI * 2;
      const trailBand = [95, 125, 155, 185, 215, 245, 275].some((target) => Math.abs(radius - target) < 1.5);
      if (trailBand && angle > 3.55 && angle < 5.62 && y < 320) { r = 235; g = 210; b = 151; }
      if (y > 300 + 12 * Math.sin(x / 62) + 7 * Math.sin(x / 29)) { r = 2; g = 6; b = 12; }
      raw[index] = r; raw[index + 1] = g; raw[index + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const fixturePng = makeNightSkyPng();
const fixtureDataUrl = `data:image/png;base64,${fixturePng.toString("base64")}`;
const fixturePaths = Array.from({ length: 12 }, (_, index) => {
  const path = resolve(fixtureDir, `README_${String(8840 + index)}.png`);
  writeFileSync(path, fixturePng);
  return path;
});

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

  // Packaged Process UI. Select GPU, but do not fake an Effective backend result;
  // the screenshot should show exactly what the app knows before a real job runs.
  await driver.executeScript(`
    document.querySelector('[data-section="process"]')?.click();
    const advanced = document.querySelector('#advancedCard');
    if (advanced) advanced.open = true;
    document.querySelector('#groupHardwarePolicy button[data-value="gpu"]')?.click();
    document.querySelector('#groupHardwarePolicy')?.scrollIntoView({ block: 'center' });
  `);
  await capture("process-gpu");

  await driver.executeScript(`document.querySelector('#parameterGuideButton')?.click();`);
  await driver.wait(until.elementLocated(By.css(".parameter-info-overlay:not(.hidden)")), 5000);
  await capture("parameter-guide");
  await driver.executeScript(`document.querySelector('.parameter-info-close')?.click();`);

  // Representative workspace frames are real PNG files on disk. Their visible card
  // thumbnails use the same deterministic fixture while the editor later reloads the
  // selected file through Tauri's native get_thumbnail command.
  await driver.executeScript(function installWorkspace(paths, dataUrl) {
    document.querySelector('[data-section="photos"]')?.click();
    const source = document.querySelector('#photoSourcePath');
    if (source) source.textContent = paths[0].replace(/[/\\][^/\\]+$/, '');
    const grid = document.querySelector('#photoGrid');
    if (!grid) throw new Error('photo grid missing');
    grid.innerHTML = '';
    paths.forEach((path, index) => {
      const tile = document.createElement('article');
      tile.className = 'photo-tile' + (index === 0 ? ' selected' : '');
      tile.dataset.path = path;
      const thumb = document.createElement('div');
      thumb.className = 'thumb-wrap';
      const image = document.createElement('img');
      image.src = dataUrl;
      image.dataset.thumbPath = path;
      image.dataset.thumbVersion = `readme-v0313:${index}`;
      thumb.append(image);
      const copy = document.createElement('div');
      copy.className = 'tile-copy';
      const strong = document.createElement('strong');
      strong.textContent = `README_${8840 + index}.png`;
      const small = document.createElement('small');
      small.textContent = 'Demo frame · Included';
      copy.append(strong, small);
      const include = document.createElement('label');
      include.className = 'include-box';
      include.innerHTML = '<input type="checkbox" checked><span></span>';
      tile.append(include, thumb, copy);
      grid.append(tile);
    });
    window.dispatchEvent(new CustomEvent('tihulu:workspace-grid-rendered'));
    window.dispatchEvent(new CustomEvent('tihulu:engine-groups-resolved', {
      detail: {
        source: paths[0].replace(/[/\\][^/\\]+$/, ''),
        output: paths[0].replace(/[/\\][^/\\]+$/, '') + '/output',
        groups: [
          { name: 'North sky', paths: paths.slice(0, 4) },
          { name: 'Zenith', paths: paths.slice(4, 8) },
          { name: 'South sky', paths: paths.slice(8, 12) },
        ],
      },
    }));
  }, fixturePaths, fixtureDataUrl);

  await driver.wait(async () => (await driver.findElements(By.css("#studioGroupList .studio-group-card[data-group-id]"))).length === 3, 10000);
  await driver.executeScript(`document.querySelector('#studioGroupList')?.scrollIntoView({ block: 'center' });`);
  await capture("workspace-groups");

  // Re-select a real fixture frame and use the same explicit grid-render contract as
  // main.ts. The screenshot is allowed only after the actual native editor pipeline
  // has produced a canvas; no documentation-only canvas is drawn here.
  await driver.executeScript(function selectNativeFixture(path) {
    const tiles = Array.from(document.querySelectorAll('#photoGrid .photo-tile[data-path]'));
    tiles.forEach((tile) => tile.classList.toggle('selected', tile.dataset.path === path));
    window.dispatchEvent(new CustomEvent('tihulu:workspace-grid-rendered'));
  }, fixturePaths[0]);
  await driver.wait(async () => {
    const state = await driver.executeScript(`
      const canvas = document.querySelector('#studioEditPreview canvas');
      return {
        width: canvas?.width || 0,
        height: canvas?.height || 0,
        mode: document.querySelector('#studioEditRenderMode')?.textContent || '',
        name: document.querySelector('#studioEditName')?.textContent || ''
      };
    `);
    return state.width >= 300 && state.height >= 150 && /Edited preview/i.test(state.mode) && /README_8840/i.test(state.name);
  }, 15000, "Native Photo Editor preview did not render for README capture");
  await driver.executeScript(`document.querySelector('.studio-editor-panel')?.scrollIntoView({ block: 'start' });`);
  await capture("photo-editor");
} finally {
  if (driver) {
    try { await withTimeout(driver.quit(), 10000, "WebDriver quit"); } catch {}
  }
  if (tauriDriver && !tauriDriver.killed) tauriDriver.kill("SIGTERM");
}
