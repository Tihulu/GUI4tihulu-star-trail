// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const REPO = 'Tihulu/GUI4tihulu-star-trail';
const RELEASE_TAG = 'v0.3.3';
const MERGE_SHA = '77c3c8b5abbc09dc5954593aba3e3499636f6620';
const API = 'https://api.github.com';
const token = process.env.GITHUB_TOKEN || '';
const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'GUI4tihulu-star-trail-docs-finalizer',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function api(endpoint) {
  const response = await fetch(`${API}${endpoint}`, { headers });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${endpoint}`);
  return response.json();
}

async function verifyReleaseGate() {
  const runs = await api(`/repos/${REPO}/actions/runs?head_sha=${MERGE_SHA}&per_page=30`);
  const run = runs.workflow_runs.find((item) => item.name === 'Build desktop apps' && item.head_sha === MERGE_SHA && item.conclusion === 'success');
  if (!run) throw new Error('Main Build desktop apps is not successful yet.');
  const jobs = await api(`/repos/${REPO}/actions/runs/${run.id}/jobs?per_page=100`);
  const required = ['Linux x86_64', 'macOS Universal', 'Windows x86_64'];
  for (const name of required) {
    const job = jobs.jobs.find((item) => item.name === name);
    if (!job || job.conclusion !== 'success') throw new Error(`${name} is not successful yet.`);
  }
  const release = await api(`/repos/${REPO}/releases/tags/${RELEASE_TAG}`);
  if (release.draft || !release.published_at) throw new Error(`${RELEASE_TAG} is not published.`);
  const names = release.assets.map((asset) => asset.name.toLowerCase());
  const hasLinux = names.some((name) => name.endsWith('.appimage'));
  const hasMac = names.some((name) => name.endsWith('.dmg'));
  const hasWindows = names.some((name) => name.endsWith('.exe'));
  if (!hasLinux || !hasMac || !hasWindows) throw new Error(`${RELEASE_TAG} is missing one or more native release assets.`);
  console.log(`Gate passed: ${run.html_url} / ${release.html_url}`);
}

const shotDir = path.resolve('docs/screenshots');
await fs.mkdir(shotDir, { recursive: true });
await verifyReleaseGate();

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1050 }, deviceScaleFactor: 1 });
page.on('pageerror', (error) => console.warn('pageerror:', error.message));
await page.goto('http://127.0.0.1:1420', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1800);

await page.addStyleTag({ content: `
  html { scroll-behavior: auto !important; }
  body { min-width: 1180px !important; }
  .docs-sky { width:100%; height:100%; min-height:120px; border-radius:12px; background:
    radial-gradient(circle at 24% 22%, rgba(255,255,255,.95) 0 1px, transparent 2px),
    radial-gradient(circle at 72% 32%, rgba(120,220,255,.95) 0 1px, transparent 2px),
    radial-gradient(circle at 62% 68%, rgba(255,185,235,.9) 0 1px, transparent 2px),
    linear-gradient(145deg,#081021,#13244b 55%,#281441); background-size:47px 47px,61px 61px,73px 73px,auto; }
  .docs-badge { position:fixed; right:24px; bottom:22px; z-index:9999; padding:9px 13px; border-radius:999px; background:#10182b; color:#8eeeff; border:1px solid #315575; font:600 12px/1.2 system-ui; box-shadow:0 8px 30px #0008; }
` });

async function clickIf(selector) {
  const loc = page.locator(selector).first();
  if (await loc.count()) { await loc.click({ force: true }).catch(() => {}); await page.waitForTimeout(220); return true; }
  return false;
}
async function screenshot(name, selector = null, options = {}) {
  const file = path.join(shotDir, name);
  if (selector) {
    const loc = page.locator(selector).first();
    if (await loc.count()) {
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(120);
      await loc.screenshot({ path: file, animations: 'disabled', ...options });
      return;
    }
  }
  await page.screenshot({ path: file, fullPage: Boolean(options.fullPage), animations: 'disabled' });
}
async function setText(selector, text) {
  await page.evaluate(({ selector, text }) => {
    const node = document.querySelector(selector);
    if (!node) return;
    node.textContent = text;
    node.classList.remove('empty', 'missing', 'checking');
  }, { selector, text });
}
async function top() { await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(120); }

// Make the Process screen look like a configured real session without requiring native Tauri APIs.
await setText('#inputPath', '/home/astro/perseids-2026');
await setText('#outputPath', '/home/astro/perseids-2026/output');
await setText('#engineText', 'tihulu engine ready');
await page.evaluate(() => {
  document.querySelector('#enginePill')?.classList.remove('missing', 'checking');
  const badge = document.createElement('div');
  badge.className = 'docs-badge';
  badge.textContent = 'Documentation capture · v0.3.3';
  document.body.append(badge);
});

await clickIf('.section-tab[data-section="process"]');
await clickIf('.mode-tab[data-mode="run"]');
await top();
await screenshot('process.png');

await clickIf('.mode-tab[data-mode="trail"]');
await top();
await screenshot('trail-options.png');

await clickIf('.mode-tab[data-mode="timelapse"]');
await page.evaluate(() => {
  const selects = [...document.querySelectorAll('select')];
  const codec = selects.find((node) => /codec/i.test(node.id + ' ' + node.name + ' ' + (node.closest('label')?.textContent || '')));
  if (codec && [...codec.options].some((opt) => opt.value === 'mp4v')) codec.value = 'mp4v';
});
await top();
await screenshot('timelapse-options.png');

await clickIf('.mode-tab[data-mode="run"]');
await page.evaluate(() => {
  const hardwareSelects = [...document.querySelectorAll('select')].filter((node) => {
    const text = `${node.id} ${node.name} ${node.closest('label, .field, .setting-row, .settings-section')?.textContent || ''}`;
    return /hardware|gpu|grouping|trail|timelapse/i.test(text) && [...node.options].some((opt) => /hybrid|gpu\+cpu/i.test(opt.value + opt.textContent));
  });
  const desired = ['cpu', 'gpu', 'hybrid'];
  hardwareSelects.slice(0, 3).forEach((node, index) => {
    const target = desired[index] || 'auto';
    const option = [...node.options].find((opt) => opt.value.toLowerCase() === target || (target === 'hybrid' && /hybrid|gpu\+cpu/i.test(opt.value + opt.textContent)));
    if (option) node.value = option.value;
  });
});
const hardwareText = page.getByText(/Grouping.*hardware|Grouping hardware/i).first();
if (await hardwareText.count()) {
  const card = hardwareText.locator('xpath=ancestor::*[self::section or self::div][1]');
  await card.scrollIntoViewIfNeeded().catch(() => {});
}
await screenshot('hardware-policies.png');

// Open Photo Workspace and build a realistic documentation-only frame set using the live UI markup.
await clickIf('.section-tab[data-section="photos"]');
await page.waitForTimeout(600);
await setText('#photoSourcePath', '/home/astro/perseids-2026');
await page.evaluate(() => {
  const grid = document.querySelector('#photoGrid');
  if (!grid) return;
  const cards = Array.from({ length: 12 }, (_, index) => {
    const n = String(index + 1).padStart(4, '0');
    const selected = index < 6 ? ' selected' : '';
    return `<article class="photo-tile${selected}" data-path="/home/astro/perseids-2026/IMG_${n}.CR3" draggable="true">
      <div class="photo-thumb"><div class="docs-sky"></div></div>
      <div class="tile-copy"><strong>IMG_${n}.CR3</strong><span>RAW · frame ${index + 1}</span></div>
    </article>`;
  }).join('');
  grid.innerHTML = cards;
});
await page.waitForTimeout(450);

async function createGroup(name, pathsSelector) {
  await page.evaluate((sel) => {
    document.querySelectorAll('#photoGrid .photo-tile').forEach((node) => node.classList.remove('selected'));
    document.querySelectorAll(sel).forEach((node) => node.classList.add('selected'));
  }, pathsSelector);
  const button = page.locator('#studioNewGroup').first();
  if (await button.count()) {
    page.once('dialog', (dialog) => dialog.accept(name));
    await button.click({ force: true });
    await page.waitForTimeout(260);
  }
}
await createGroup('group_001', '#photoGrid .photo-tile:nth-child(-n+6)');
await createGroup('group_002', '#photoGrid .photo-tile:nth-child(n+7)');
await clickIf('#studioShowAll');
await page.waitForTimeout(220);
await screenshot('photo-workspace-groups.png', '#section-photos', { fullPage: false });

const firstGroupOpen = page.locator('#studioGroupList .studio-group-card[data-group-id] .group-open').first();
if (await firstGroupOpen.count()) await firstGroupOpen.click({ force: true });
await page.waitForTimeout(220);
await page.evaluate(() => {
  const first = [...document.querySelectorAll('#photoGrid .photo-tile')].find((node) => !node.classList.contains('studio-group-hidden'));
  first?.classList.add('selected');
});
await screenshot('manual-group-edit.png', '.studio-group-panel');

const editor = page.locator('.studio-editor-panel').first();
if (await editor.count()) {
  await page.evaluate(() => {
    const preview = document.querySelector('#studioEditPreview');
    if (preview) preview.innerHTML = '<div class="docs-sky" style="min-height:310px"></div>';
    const name = document.querySelector('#studioEditName'); if (name) name.textContent = 'IMG_0001.CR3';
    const mode = document.querySelector('#studioEditRenderMode'); if (mode) mode.textContent = 'Non-destructive preview';
  });
  await editor.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  await screenshot('photo-editor.png', '.studio-editor-panel');
} else {
  await screenshot('photo-editor.png');
}

// Open the real Parameter Guide if a current-info control is available.
let guideOpened = false;
for (const selector of ['#parameterInfoButton', '#settingsInfoButton', 'button[aria-label*="parameter" i]', 'button[title*="parameter" i]']) {
  if (await clickIf(selector)) { guideOpened = true; break; }
}
if (!guideOpened) {
  const candidates = page.getByRole('button', { name: /info|guide/i });
  if (await candidates.count()) { await candidates.first().click({ force: true }).catch(() => {}); await page.waitForTimeout(220); }
}
const guide = page.getByText(/Parameter Guide|Parameter info/i).first();
if (await guide.count()) {
  const panel = guide.locator('xpath=ancestor::*[self::section or self::div][1]');
  await panel.scrollIntoViewIfNeeded().catch(() => {});
}
await screenshot('parameter-guide.png');

// If Performance Mode is present in the released UI, capture it after presenting a large-project count.
const perf = page.getByText(/Performance Mode/i).first();
if (await perf.count()) {
  await perf.scrollIntoViewIfNeeded().catch(() => {});
  await screenshot('performance-mode.png');
}

await browser.close();

const readme = `# Tihulu Star Trail Studio

Modern cross-platform desktop GUI for [tihulu-star-trail](https://github.com/Tihulu/tihulu-star-trail), built with Tauri. The Studio keeps the engine workflow local while adding photo review, group curation, non-destructive edits, independent hardware policies, and direct access to the upstream Desktop and Web Forge interfaces.

> **Release:** v0.3.3 · Windows x86_64, Linux x86_64, and macOS Universal. Linux ARM64 is not a released target.

## Install

### Linux / macOS

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/Tihulu/GUI4tihulu-star-trail/main/scripts/install.sh | sh
\`\`\`

### Windows PowerShell

\`\`\`powershell
irm https://raw.githubusercontent.com/Tihulu/GUI4tihulu-star-trail/main/scripts/install.ps1 | iex
\`\`\`

The installer locates the \`tihulu\` engine and installs it when it is missing. The GUI itself does not upload photos to a service: image scanning, grouping, stacking, timelapse rendering, review state, and edits are local to the machine.

## Process

![Process screen](docs/screenshots/process.png)

Choose an input folder and output folder, then select **Build**, **Group**, **Trail**, or **Timelapse**. Each mode exposes only the parameters that belong to that operation, so trail-only and timelapse-only workflows do not need to pass through the full build path.

### Trail options

![Trail options](docs/screenshots/trail-options.png)

Trail rendering has its own minimum-frame, JPEG/output controls, recursive scan option, and independent hardware policy.

### Timelapse options

![Timelapse options](docs/screenshots/timelapse-options.png)

Timelapse rendering has its own FPS, maximum video side, codec selector, recursive scan option, and independent hardware policy. Codec availability still depends on the local OpenCV/FFmpeg environment used by the engine.

## Independent CPU / GPU policies

![Hardware policies](docs/screenshots/hardware-policies.png)

Grouping, trail stacking, and timelapse work can each use **Auto**, **CPU**, **GPU**, or **GPU + CPU (hybrid)** independently. These are policies, not a promise that a GPU path exists on every machine. GPU/hybrid acceleration depends on the installed OpenCV build exposing usable CUDA or OpenCL support. When acceleration is unavailable or an accelerated operation fails, the engine safely falls back to CPU work instead of making the project unusable.

## Photo Workspace and engine-group sync

![Photo Workspace with groups](docs/screenshots/photo-workspace-groups.png)

After grouping, the Studio can map the engine's \`manifest.json\` / \`group_*\` output back onto the source Photo Workspace. This keeps review tied to the original frames rather than forcing you to browse copied output folders.

The workspace supports:

- multi-select frame review and include/exclude selection for processing;
- groups created from detected output folders or from the current selection;
- rename, split, merge, delete, reorder, and Undo/Redo group operations;
- moving selected frames between groups;
- sort by name/date first, then continue with manual drag ordering so an automatic sort becomes the new manual starting point;
- non-destructive per-frame edit state that does not modify source files.

### Manual group editing

![Manual group editing](docs/screenshots/manual-group-edit.png)

Group curation is deliberately separate from engine grouping: the engine gives you a strong starting point, and the workspace lets you correct membership and order before the final trail or timelapse.

## Non-destructive Photo Editor

![Photo Editor](docs/screenshots/photo-editor.png)

The editor provides **Before**, **Undo**, **Redo**, and **Reset** together with exposure, brightness, contrast, highlights, shadows, saturation, warmth, sharpness, rotation, crop aspect, and JPEG quality. Settings can be copied/pasted and applied to the selected frames, current group, or all frames. Original files remain untouched; edited JPEG exports are explicit outputs.

## Parameter Guide

![Parameter Guide](docs/screenshots/parameter-guide.png)

The in-app info/Parameter Guide explains what the processing controls do and when they matter, without requiring a separate manual while tuning a project.

## Large projects and thumbnail performance

The Photo Workspace is designed not to let thousands of previews dominate memory or layout work:

- the thumbnail cache is bounded to **128 items / 40 MB**;
- thumbnail decoding is asynchronous, so preview generation does not need to block the main interface;
- offscreen/hidden workspace content uses rendering containment so the browser engine can avoid unnecessary layout and paint work;
- large projects automatically enter **Performance Mode**, reducing expensive preview work while preserving group and processing controls;
- when the Photo Workspace is not the active section, workspace preview work is paused/deprioritized and resumes when you return.

If the released UI displays the Performance Mode indicator on a sufficiently large project, it is the visible confirmation that these large-project safeguards are active.

## Full upstream interfaces

The Studio does not replace the upstream interfaces. **Full Desktop** launches the native \`tihulu desktop\` experience, while **Web Forge** launches the local browser interface from the installed engine. This makes the Tauri Studio a focused workflow layer without hiding functionality that already exists upstream.

## How the pieces fit together

1. Select source photos and an output folder in **Process**.
2. Run **Group** or **Build** with the grouping hardware policy you want.
3. Review the synchronized engine groups in **Photo Workspace**.
4. Reorder or move frames manually; use multi-select for bulk moves.
5. Apply optional non-destructive photo edits.
6. Render a trail or timelapse with its own hardware policy and output settings.
7. Open **Full Desktop** or **Web Forge** whenever you need the complete upstream workspace.

## Acceleration notes

- **Auto** asks the engine to use available acceleration and otherwise continue on CPU.
- **CPU** forces the portable CPU path.
- **GPU** requests CUDA/OpenCL-backed operations where the installed OpenCV build supports them.
- **GPU + CPU / hybrid** keeps suitable CPU work on the CPU while using available GPU/OpenCL preprocessing/stacking operations.
- A machine having an NVIDIA/AMD/Intel GPU does **not** by itself guarantee that the Python/OpenCV environment exposes CUDA or OpenCL acceleration.

## Development

\`\`\`bash
npm install
npm run dev
\`\`\`

Type-check/build the frontend with:

\`\`\`bash
npm run build
\`\`\`

Build the native Tauri application with:

\`\`\`bash
npm run tauri build
\`\`\`

## License

GNU Affero General Public License v3.0 only (\`AGPL-3.0-only\`).
`;

await fs.writeFile('README.md', readme, 'utf8');
console.log('README and screenshots generated.');
