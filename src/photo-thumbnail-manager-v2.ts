// SPDX-License-Identifier: AGPL-3.0-only
import "./performance.css";

const MAX_CACHE_ITEMS = 160;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const GRID_SIZE: [number, number] = [320, 240];
const INSPECTOR_SIZE: [number, number] = [960, 720];
const GROUP_SIZE: [number, number] = [160, 112];
const PREFETCH_MARGIN = "360px 0px";
const PERFORMANCE_MODE_THRESHOLD = 180;
const MAX_ACTIVE_DECODES = (navigator.hardwareConcurrency || 4) >= 12 ? 3 : 2;

type CacheEntry = { url: string; bytes: number };
type QueueTask<T> = { run: () => Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry | null>>();
const failed = new Set<string>();
const visible = new WeakSet<HTMLImageElement>();
const queue: QueueTask<unknown>[] = [];
let activeDecodes = 0;
let cacheBytes = 0;
let workspaceActive = false;
let lastSource = "";
let perfQueued = false;

function qs<T extends Element>(selector: string): T | null { return document.querySelector<T>(selector); }
function key(source: string, width: number, height: number): string { return `${width}x${height}:${source}`; }
function fmt(bytes: number): string { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

function stat(id: string, title: string): HTMLElement | null {
  const root = qs<HTMLElement>(".photo-stats");
  if (!root) return null;
  let node = qs<HTMLElement>(`#${id}`);
  if (!node) {
    node = document.createElement("span");
    node.id = id;
    node.title = title;
    root.append(node);
  }
  return node;
}

function updateCacheStat(): void {
  const node = stat("thumbCacheStat", `Bounded thumbnail cache · ${MAX_ACTIVE_DECODES} parallel decodes`);
  if (node) node.textContent = `thumb cache ${cache.size}/${MAX_CACHE_ITEMS} · ${fmt(cacheBytes)}/${fmt(MAX_CACHE_BYTES)} · ${MAX_ACTIVE_DECODES}× decode`;
}

function updatePerformanceMode(): void {
  perfQueued = false;
  const count = document.querySelectorAll("#photoGrid .photo-tile").length;
  const enabled = count >= PERFORMANCE_MODE_THRESHOLD;
  document.documentElement.classList.toggle("workspace-performance-mode", enabled);
  const node = stat("workspacePerformanceStat", "Large-project mode reduces blur, transitions and offscreen paint work.");
  if (node) {
    node.classList.toggle("hidden", !enabled);
    node.classList.add("performance-stat");
    node.textContent = enabled ? `performance mode · ${count} frames` : "";
  }
}

function queuePerformanceUpdate(): void {
  if (perfQueued) return;
  perfQueued = true;
  requestAnimationFrame(updatePerformanceMode);
}

function touch(k: string): CacheEntry | null {
  const entry = cache.get(k);
  if (!entry) return null;
  cache.delete(k);
  cache.set(k, entry);
  return entry;
}

function evict(): void {
  while (cache.size > MAX_CACHE_ITEMS || cacheBytes > MAX_CACHE_BYTES) {
    const oldest = cache.entries().next().value as [string, CacheEntry] | undefined;
    if (!oldest) break;
    cache.delete(oldest[0]);
    cacheBytes = Math.max(0, cacheBytes - oldest[1].bytes);
    URL.revokeObjectURL(oldest[1].url);
  }
  updateCacheStat();
}

function put(k: string, entry: CacheEntry): CacheEntry {
  const old = cache.get(k);
  if (old) {
    cacheBytes = Math.max(0, cacheBytes - old.bytes);
    URL.revokeObjectURL(old.url);
  }
  cache.delete(k);
  cache.set(k, entry);
  cacheBytes += entry.bytes;
  evict();
  return entry;
}

function clearCache(): void {
  for (const entry of cache.values()) URL.revokeObjectURL(entry.url);
  cache.clear();
  inFlight.clear();
  failed.clear();
  cacheBytes = 0;
  updateCacheStat();
}

function pump(): void {
  if (!workspaceActive) return;
  while (activeDecodes < MAX_ACTIVE_DECODES && queue.length) {
    const task = queue.shift();
    if (!task) break;
    activeDecodes += 1;
    task.run().then(task.resolve, task.reject).finally(() => {
      activeDecodes -= 1;
      pump();
    });
  }
}

function schedule<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ run, resolve, reject } as QueueTask<unknown>);
    pump();
  });
}

function fit(width: number, height: number, maxWidth: number, maxHeight: number): [number, number] {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const scale = Math.min(1, maxWidth / w, maxHeight / h);
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
}

function mime(source: string): string {
  const clean = source.toLowerCase().split(/[?#]/, 1)[0];
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".bmp")) return "image/bmp";
  if (clean.endsWith(".tif") || clean.endsWith(".tiff")) return "image/tiff";
  return "image/jpeg";
}

async function drawBlob(drawable: CanvasImageSource, width: number, height: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Offscreen canvas unavailable");
    context.drawImage(drawable, 0, 0, width, height);
    return canvas.convertToBlob({ type: "image/jpeg", quality: 0.78 });
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas unavailable");
  context.drawImage(drawable, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Thumbnail encode failed")), "image/jpeg", 0.78));
}

async function decodeWebCodecs(blob: Blob, source: string, maxWidth: number, maxHeight: number): Promise<CacheEntry | null> {
  const Decoder = (globalThis as any).ImageDecoder as any;
  if (!Decoder) return null;
  const data = await blob.arrayBuffer();
  const type = blob.type || mime(source);
  let probe: any = null;
  let decoder: any = null;
  let frame: any = null;
  try {
    probe = new Decoder({ data: data.slice(0), type, preferAnimation: false });
    await probe.tracks.ready;
    const track = probe.tracks.selectedTrack;
    const sourceWidth = Number(track?.codedWidth ?? track?.displayWidth ?? 0);
    const sourceHeight = Number(track?.codedHeight ?? track?.displayHeight ?? 0);
    if (!sourceWidth || !sourceHeight) return null;
    const [width, height] = fit(sourceWidth, sourceHeight, maxWidth, maxHeight);
    probe.close(); probe = null;
    decoder = new Decoder({ data, type, preferAnimation: false, desiredWidth: width, desiredHeight: height });
    const decoded = await decoder.decode({ frameIndex: 0 });
    frame = decoded.image;
    const output = await drawBlob(decoded.image as CanvasImageSource, width, height);
    return { url: URL.createObjectURL(output), bytes: width * height * 4 };
  } catch {
    return null;
  } finally {
    frame?.close?.(); probe?.close?.(); decoder?.close?.();
  }
}

async function decodeBitmap(blob: Blob, maxWidth: number, maxHeight: number): Promise<CacheEntry> {
  const bitmap = await createImageBitmap(blob);
  try {
    const [width, height] = fit(bitmap.width, bitmap.height, maxWidth, maxHeight);
    const output = await drawBlob(bitmap, width, height);
    return { url: URL.createObjectURL(output), bytes: width * height * 4 };
  } finally {
    bitmap.close();
  }
}

async function decodeImage(source: string, maxWidth: number, maxHeight: number): Promise<CacheEntry> {
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Image decode failed"));
    image.src = source;
  });
  const [width, height] = fit(image.naturalWidth || image.width, image.naturalHeight || image.height, maxWidth, maxHeight);
  const output = await drawBlob(image, width, height);
  image.removeAttribute("src");
  return { url: URL.createObjectURL(output), bytes: width * height * 4 };
}

async function downscale(source: string, maxWidth: number, maxHeight: number): Promise<CacheEntry> {
  try {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Thumbnail source returned ${response.status}`);
    const blob = await response.blob();
    const decoded = await decodeWebCodecs(blob, source, maxWidth, maxHeight);
    if (decoded) return decoded;
    if (typeof createImageBitmap === "function") return decodeBitmap(blob, maxWidth, maxHeight);
  } catch {
    // Some platform WebViews cannot fetch local asset URLs. Fall back to an image element.
  }
  return decodeImage(source, maxWidth, maxHeight);
}

async function thumbnail(source: string, width: number, height: number): Promise<CacheEntry | null> {
  const k = key(source, width, height);
  const cached = touch(k);
  if (cached) return cached;
  if (failed.has(k)) return null;
  const pending = inFlight.get(k);
  if (pending) return pending;
  const promise = schedule(() => downscale(source, width, height))
    .then((entry) => put(k, entry))
    .catch(() => { failed.add(k); return null; })
    .finally(() => inFlight.delete(k));
  inFlight.set(k, promise);
  return promise;
}

function dimensions(image: HTMLImageElement): [number, number] {
  if (image.classList.contains("workspace-group-thumb")) return GROUP_SIZE;
  if (image.classList.contains("inspector-preview")) return INSPECTOR_SIZE;
  return GRID_SIZE;
}

function eligible(image: HTMLImageElement): boolean {
  return Boolean(image.closest(".photo-tile") || image.classList.contains("inspector-preview") || image.classList.contains("workspace-group-thumb"));
}

async function show(image: HTMLImageElement): Promise<void> {
  const source = image.dataset.thumbV2Source;
  if (!workspaceActive || !source || !visible.has(image)) return;
  const [width, height] = dimensions(image);
  const entry = await thumbnail(source, width, height);
  if (!workspaceActive || !image.isConnected || !visible.has(image) || image.dataset.thumbV2Source !== source) return;
  image.src = entry?.url ?? source;
}

const observer = new IntersectionObserver((entries) => {
  if (!workspaceActive) return;
  for (const entry of entries) {
    const image = entry.target as HTMLImageElement;
    if (entry.isIntersecting) {
      visible.add(image);
      void show(image);
    } else {
      visible.delete(image);
      image.removeAttribute("src");
    }
  }
}, { root: null, rootMargin: PREFETCH_MARGIN, threshold: 0.01 });

function manage(image: HTMLImageElement): void {
  if (!eligible(image)) return;
  if (image.dataset.thumbV2Managed === "1") {
    if (workspaceActive) observer.observe(image);
    return;
  }
  const source = image.getAttribute("src");
  if (!source || source.startsWith("blob:")) return;
  image.dataset.thumbV2Managed = "1";
  image.dataset.thumbV2Source = source;
  image.removeAttribute("src");
  image.loading = "lazy";
  image.decoding = "async";
  image.setAttribute("fetchpriority", "low");
  if (workspaceActive) observer.observe(image);
}

function scan(root: ParentNode): void {
  if (root instanceof HTMLImageElement) manage(root);
  root.querySelectorAll?.<HTMLImageElement>(".photo-tile .thumb-wrap img, .inspector-preview, .workspace-group-thumb").forEach(manage);
}

function syncSource(): void {
  const source = qs<HTMLElement>("#photoSourcePath")?.textContent?.trim() ?? "";
  if (source === lastSource) return;
  lastSource = source;
  clearCache();
}

function pause(): void {
  workspaceActive = false;
  document.querySelectorAll<HTMLImageElement>("#section-photos img[data-thumb-v2-managed='1']").forEach((image) => {
    observer.unobserve(image);
    visible.delete(image);
    image.removeAttribute("src");
  });
}

function resume(): void {
  workspaceActive = true;
  const section = qs<HTMLElement>("#section-photos");
  if (section) scan(section);
  pump();
  queuePerformanceUpdate();
}

function syncActive(): void {
  const next = Boolean(qs<HTMLElement>("#section-photos")?.classList.contains("active"));
  if (next === workspaceActive) return;
  next ? resume() : pause();
}

function start(): void {
  const section = qs<HTMLElement>("#section-photos");
  const source = qs<HTMLElement>("#photoSourcePath");
  if (!section || !source) return;
  workspaceActive = section.classList.contains("active");
  scan(section);
  syncSource();
  updateCacheStat();
  queuePerformanceUpdate();

  const sectionObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) if (node instanceof HTMLElement) scan(node);
    queuePerformanceUpdate();
  });
  sectionObserver.observe(section, { childList: true, subtree: true });
  const sourceObserver = new MutationObserver(syncSource);
  sourceObserver.observe(source, { childList: true, characterData: true, subtree: true });
  const activeObserver = new MutationObserver(syncActive);
  activeObserver.observe(section, { attributes: true, attributeFilter: ["class"] });

  window.addEventListener("beforeunload", () => {
    sectionObserver.disconnect(); sourceObserver.disconnect(); activeObserver.disconnect(); observer.disconnect(); clearCache();
  }, { once: true });
}

start();
