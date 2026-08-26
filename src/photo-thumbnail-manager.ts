// SPDX-License-Identifier: AGPL-3.0-only
import "./performance.css";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

const GRID_SIZE: [number, number] = [320, 240];
const INSPECTOR_SIZE: [number, number] = [960, 720];
const GROUP_SIZE: [number, number] = [180, 120];
const MAX_ACTIVE_REQUESTS = 2;
const MAX_FRONT_CACHE_ITEMS = 512;
const PREFETCH_MARGIN = "220px 0px";
const PERFORMANCE_MODE_THRESHOLD = 320;

type ThumbnailResult = { path: string; cacheHit: boolean; sourceBytes: number };
type QueueTask = { run: () => Promise<void> };

const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();
const queue: QueueTask[] = [];
const visibleImages = new WeakSet<HTMLImageElement>();
let activeRequests = 0;
let workspaceActive = false;
let lastSourcePath = "";
let metrics = { hits: 0, misses: 0, deduped: 0, requests: 0 };

function keyFor(source: string, version: string, width: number, height: number): string { return `${width}x${height}:${version}:${source}`; }
function touch(key: string): string | null { const value = cache.get(key); if (!value) return null; cache.delete(key); cache.set(key, value); return value; }
function put(key: string, value: string): string { cache.delete(key); cache.set(key, value); while (cache.size > MAX_FRONT_CACHE_ITEMS) { const first = cache.keys().next().value as string | undefined; if (!first) break; cache.delete(first); } return value; }

function cacheStat(): HTMLElement | null {
  const stats = document.querySelector<HTMLElement>(".photo-stats"); if (!stats) return null;
  let node = document.querySelector<HTMLElement>("#thumbCacheStat");
  if (!node) { node = document.createElement("span"); node.id = "thumbCacheStat"; node.title = "Native bounded thumbnail cache; no full-resolution image is assigned to workspace thumbnail elements."; stats.append(node); }
  return node;
}
function updateStats(): void { const node = cacheStat(); if (node) node.textContent = `thumb native ${metrics.hits} hit · ${metrics.misses} miss · ${metrics.deduped} dedupe`; }
function updatePerformanceMode(): void { const count = document.querySelectorAll("#photoGrid .photo-tile").length; document.documentElement.classList.toggle("workspace-performance-mode", count >= PERFORMANCE_MODE_THRESHOLD); }

function pump(): void {
  if (!workspaceActive) return;
  while (activeRequests < MAX_ACTIVE_REQUESTS && queue.length) {
    const task = queue.shift(); if (!task) break; activeRequests += 1;
    task.run().catch(() => undefined).finally(() => { activeRequests -= 1; pump(); });
  }
}
function enqueue(run: () => Promise<void>): void { queue.push({ run }); pump(); }

async function thumbnailUrl(source: string, version: string, width: number, height: number): Promise<string> {
  const key = keyFor(source, version, width, height); const cached = touch(key);
  if (cached) { metrics.hits += 1; updateStats(); return cached; }
  const pending = inFlight.get(key); if (pending) { metrics.deduped += 1; updateStats(); return pending; }
  metrics.requests += 1;
  const promise = invoke<ThumbnailResult>("get_thumbnail", { sourcePath: source, maxWidth: width, maxHeight: height, sourceVersion: version })
    .then((result) => { if (result.cacheHit) metrics.hits += 1; else metrics.misses += 1; updateStats(); return put(key, convertFileSrc(result.path)); })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise); return promise;
}

function dimensions(image: HTMLImageElement): [number, number] {
  if (image.classList.contains("inspector-preview")) return INSPECTOR_SIZE;
  if (image.classList.contains("workspace-group-thumb")) return GROUP_SIZE;
  return GRID_SIZE;
}
async function show(image: HTMLImageElement): Promise<void> {
  const source = image.dataset.thumbPath; if (!workspaceActive || !source || !visibleImages.has(image)) return;
  const version = image.dataset.thumbVersion ?? ""; const [width, height] = dimensions(image);
  try {
    const url = await thumbnailUrl(source, version, width, height);
    if (workspaceActive && image.isConnected && visibleImages.has(image) && image.dataset.thumbPath === source) { image.src = url; image.dataset.thumbReady = "1"; }
  } catch (error) {
    image.dataset.thumbError = String(error); image.removeAttribute("src");
  }
}

const visibility = new IntersectionObserver((entries) => {
  if (!workspaceActive) return;
  for (const entry of entries) {
    const image = entry.target as HTMLImageElement;
    if (entry.isIntersecting) { visibleImages.add(image); enqueue(() => show(image)); }
    else { visibleImages.delete(image); image.removeAttribute("src"); }
  }
}, { root: null, rootMargin: PREFETCH_MARGIN, threshold: 0.01 });

function manage(image: HTMLImageElement): void {
  if (!image.dataset.thumbPath) return;
  image.loading = "lazy"; image.decoding = "async";
  if (image.dataset.thumbManaged !== "1") { image.dataset.thumbManaged = "1"; image.removeAttribute("src"); }
  if (workspaceActive) visibility.observe(image);
}
function scan(root: ParentNode): void {
  if (root instanceof HTMLImageElement) manage(root);
  root.querySelectorAll?.<HTMLImageElement>("img[data-thumb-path]").forEach(manage);
}
function sourcePath(): string { const value = document.querySelector<HTMLElement>("#photoSourcePath")?.textContent?.trim() ?? ""; return value === "Scanning…" || value === "No folder selected" ? "" : value; }
function syncSource(): void { const next = sourcePath(); if (next === lastSourcePath) return; lastSourcePath = next; cache.clear(); inFlight.clear(); metrics = { hits: 0, misses: 0, deduped: 0, requests: 0 }; updateStats(); }
function pause(): void { workspaceActive = false; document.querySelectorAll<HTMLImageElement>("#section-photos img[data-thumb-managed='1']").forEach((image) => { visibility.unobserve(image); visibleImages.delete(image); image.removeAttribute("src"); }); }
function resume(): void { workspaceActive = true; const section = document.querySelector<HTMLElement>("#section-photos"); if (section) scan(section); pump(); updatePerformanceMode(); }
function syncActive(): void { const next = Boolean(document.querySelector<HTMLElement>("#section-photos")?.classList.contains("active")); if (next === workspaceActive) return; next ? resume() : pause(); }

function start(): void {
  const section = document.querySelector<HTMLElement>("#section-photos"); const source = document.querySelector<HTMLElement>("#photoSourcePath"); if (!section || !source) return;
  workspaceActive = section.classList.contains("active"); scan(section); syncSource(); updateStats(); updatePerformanceMode();
  const contentObserver = new MutationObserver((mutations) => { for (const mutation of mutations) for (const node of mutation.addedNodes) if (node instanceof HTMLElement) scan(node); requestAnimationFrame(updatePerformanceMode); });
  contentObserver.observe(section, { childList: true, subtree: true });
  const sourceObserver = new MutationObserver(syncSource); sourceObserver.observe(source, { childList: true, characterData: true, subtree: true });
  const activeObserver = new MutationObserver(syncActive); activeObserver.observe(section, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("beforeunload", () => { contentObserver.disconnect(); sourceObserver.disconnect(); activeObserver.disconnect(); visibility.disconnect(); }, { once: true });
}
start();
