// SPDX-License-Identifier: AGPL-3.0-only
import "./performance.css";

const MAX_CACHE_ITEMS = 128;
const MAX_CACHE_BYTES = 40 * 1024 * 1024;
const GRID_THUMB_WIDTH = 320;
const GRID_THUMB_HEIGHT = 240;
const INSPECTOR_THUMB_WIDTH = 960;
const INSPECTOR_THUMB_HEIGHT = 720;
const PREFETCH_MARGIN = "180px 0px";
const MAX_ACTIVE_DECODES = 1;
const PERFORMANCE_MODE_THRESHOLD = 320;

type CacheEntry = {
  url: string;
  bytes: number;
};

type QueueTask<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry | null>>();
const fallbackKeys = new Set<string>();
const visibleImages = new WeakSet<HTMLImageElement>();
const queue: QueueTask<unknown>[] = [];
let cacheBytes = 0;
let activeDecodes = 0;
let lastSourcePath = "";
let workspaceActive = false;
let performanceUpdateQueued = false;

function cacheKey(source: string, width: number, height: number): string {
  return `${width}x${height}:${source}`;
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ensureCacheStat(): HTMLElement | null {
  const stats = document.querySelector<HTMLElement>(".photo-stats");
  if (!stats) return null;
  let node = document.querySelector<HTMLElement>("#thumbCacheStat");
  if (!node) {
    node = document.createElement("span");
    node.id = "thumbCacheStat";
    node.title = "Bounded thumbnail cache: max 128 items / 40 MB decoded estimate";
    stats.append(node);
  }
  return node;
}

function ensurePerformanceStat(): HTMLElement | null {
  const stats = document.querySelector<HTMLElement>(".photo-stats");
  if (!stats) return null;
  let node = document.querySelector<HTMLElement>("#workspacePerformanceStat");
  if (!node) {
    node = document.createElement("span");
    node.id = "workspacePerformanceStat";
    node.className = "performance-stat hidden";
    node.title = "Large-project mode reduces blur, transitions and offscreen paint work.";
    stats.append(node);
  }
  return node;
}

function updateCacheStat(): void {
  const node = ensureCacheStat();
  if (node) node.textContent = `thumb cache ${cache.size}/${MAX_CACHE_ITEMS} · ${formatMiB(cacheBytes)}/${formatMiB(MAX_CACHE_BYTES)}`;
}

function updatePerformanceMode(): void {
  performanceUpdateQueued = false;
  const tileCount = document.querySelectorAll("#photoGrid .photo-tile").length;
  const enabled = tileCount >= PERFORMANCE_MODE_THRESHOLD;
  document.documentElement.classList.toggle("workspace-performance-mode", enabled);
  const stat = ensurePerformanceStat();
  if (stat) {
    stat.classList.toggle("hidden", !enabled);
    stat.textContent = enabled ? `performance mode · ${tileCount} frames` : "";
  }
}

function queuePerformanceUpdate(): void {
  if (performanceUpdateQueued) return;
  performanceUpdateQueued = true;
  requestAnimationFrame(updatePerformanceMode);
}

function touchCache(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function evictCache(): void {
  while (cache.size > MAX_CACHE_ITEMS || cacheBytes > MAX_CACHE_BYTES) {
    const oldest = cache.entries().next().value as [string, CacheEntry] | undefined;
    if (!oldest) break;
    cache.delete(oldest[0]);
    cacheBytes = Math.max(0, cacheBytes - oldest[1].bytes);
    URL.revokeObjectURL(oldest[1].url);
  }
  updateCacheStat();
}

function putCache(key: string, entry: CacheEntry): CacheEntry {
  const previous = cache.get(key);
  if (previous) {
    cacheBytes = Math.max(0, cacheBytes - previous.bytes);
    URL.revokeObjectURL(previous.url);
    cache.delete(key);
  }
  cache.set(key, entry);
  cacheBytes += entry.bytes;
  evictCache();
  return entry;
}

function clearCache(): void {
  for (const entry of cache.values()) URL.revokeObjectURL(entry.url);
  cache.clear();
  cacheBytes = 0;
  inFlight.clear();
  fallbackKeys.clear();
  updateCacheStat();
}

function pumpQueue(): void {
  if (!workspaceActive) return;
  while (activeDecodes < MAX_ACTIVE_DECODES && queue.length > 0) {
    const task = queue.shift();
    if (!task) break;
    activeDecodes += 1;
    task
      .run()
      .then(task.resolve, task.reject)
      .finally(() => {
        activeDecodes -= 1;
        pumpQueue();
      });
  }
}

function schedule<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ run, resolve, reject } as QueueTask<unknown>);
    pumpQueue();
  });
}

function fitSize(width: number, height: number, maxWidth: number, maxHeight: number): [number, number] {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const scale = Math.min(maxWidth / safeWidth, maxHeight / safeHeight, 1);
  return [Math.max(1, Math.round(safeWidth * scale)), Math.max(1, Math.round(safeHeight * scale))];
}

function mimeFromSource(source: string): string {
  const clean = source.toLowerCase().split(/[?#]/, 1)[0];
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".gif")) return "image/gif";
  if (clean.endsWith(".bmp")) return "image/bmp";
  if (clean.endsWith(".avif")) return "image/avif";
  if (clean.endsWith(".tif") || clean.endsWith(".tiff")) return "image/tiff";
  return "image/jpeg";
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Thumbnail encoding returned no data"))),
        "image/jpeg",
        0.82,
      );
    } catch (error) {
      reject(error);
    }
  });
}

async function drawToBlob(drawable: CanvasImageSource, width: number, height: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Offscreen 2D canvas is unavailable");
    context.drawImage(drawable, 0, 0, width, height);
    return canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("2D canvas is unavailable");
  context.drawImage(drawable, 0, 0, width, height);
  const blob = await canvasBlob(canvas);
  canvas.width = 1;
  canvas.height = 1;
  return blob;
}

async function decodeWithWebCodecs(blob: Blob, source: string, maxWidth: number, maxHeight: number): Promise<CacheEntry | null> {
  // WebView implementations expose slightly different ImageDecoder typings.
  // Runtime feature detection is more reliable here than binding to one DOM lib version.
  const Decoder = (globalThis as any).ImageDecoder as any;
  if (!Decoder) return null;

  const data = await blob.arrayBuffer();
  const type = blob.type || mimeFromSource(source);
  let probe: any = null;
  let decoder: any = null;
  let frame: any = null;
  try {
    probe = new Decoder({ data: data.slice(0), type, preferAnimation: false });
    await probe.tracks.ready;
    const track = probe.tracks.selectedTrack;
    const sourceWidth = Number(track?.codedWidth ?? track?.displayWidth ?? 0);
    const sourceHeight = Number(track?.codedHeight ?? track?.displayHeight ?? 0);
    if (sourceWidth <= 0 || sourceHeight <= 0) return null;
    const [targetWidth, targetHeight] = fitSize(sourceWidth, sourceHeight, maxWidth, maxHeight);
    probe.close();
    probe = null;

    decoder = new Decoder({
      data,
      type,
      preferAnimation: false,
      desiredWidth: targetWidth,
      desiredHeight: targetHeight,
    });
    const decoded = await decoder.decode({ frameIndex: 0 });
    frame = decoded.image;
    const output = await drawToBlob(decoded.image as CanvasImageSource, targetWidth, targetHeight);
    return { url: URL.createObjectURL(output), bytes: targetWidth * targetHeight * 4 };
  } catch {
    return null;
  } finally {
    frame?.close?.();
    probe?.close?.();
    decoder?.close?.();
  }
}

async function decodeWithImageBitmap(blob: Blob, maxWidth: number, maxHeight: number): Promise<CacheEntry> {
  const bitmap = await createImageBitmap(blob);
  try {
    const [targetWidth, targetHeight] = fitSize(bitmap.width, bitmap.height, maxWidth, maxHeight);
    const output = await drawToBlob(bitmap, targetWidth, targetHeight);
    return { url: URL.createObjectURL(output), bytes: targetWidth * targetHeight * 4 };
  } finally {
    bitmap.close();
  }
}

async function decodeWithImageElement(source: string, maxWidth: number, maxHeight: number): Promise<CacheEntry> {
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Could not decode ${source}`));
    image.src = source;
  });
  try {
    const [targetWidth, targetHeight] = fitSize(image.naturalWidth || image.width, image.naturalHeight || image.height, maxWidth, maxHeight);
    const output = await drawToBlob(image, targetWidth, targetHeight);
    return { url: URL.createObjectURL(output), bytes: targetWidth * targetHeight * 4 };
  } finally {
    image.removeAttribute("src");
  }
}

async function downscale(source: string, maxWidth: number, maxHeight: number): Promise<CacheEntry> {
  try {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Thumbnail source returned ${response.status}`);
    const blob = await response.blob();

    const webCodecs = await decodeWithWebCodecs(blob, source, maxWidth, maxHeight);
    if (webCodecs) return webCodecs;

    if (typeof createImageBitmap === "function") return await decodeWithImageBitmap(blob, maxWidth, maxHeight);
  } catch {
    // File-URL fetch or the newer decode APIs can be unavailable on a platform WebView.
  }
  return decodeWithImageElement(source, maxWidth, maxHeight);
}

async function thumbnailFor(source: string, width: number, height: number): Promise<CacheEntry | null> {
  const key = cacheKey(source, width, height);
  const cached = touchCache(key);
  if (cached) {
    updateCacheStat();
    return cached;
  }
  if (fallbackKeys.has(key)) return null;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = schedule(() => downscale(source, width, height))
    .then((entry) => putCache(key, entry))
    .catch(() => {
      fallbackKeys.add(key);
      return null;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

function dimensionsFor(image: HTMLImageElement): [number, number] {
  return image.classList.contains("inspector-preview")
    ? [INSPECTOR_THUMB_WIDTH, INSPECTOR_THUMB_HEIGHT]
    : [GRID_THUMB_WIDTH, GRID_THUMB_HEIGHT];
}

async function showManagedImage(image: HTMLImageElement): Promise<void> {
  const source = image.dataset.thumbSource;
  if (!workspaceActive || !source || !visibleImages.has(image)) return;
  const [width, height] = dimensionsFor(image);
  const entry = await thumbnailFor(source, width, height);
  if (!workspaceActive || !image.isConnected || !visibleImages.has(image) || image.dataset.thumbSource !== source) return;
  image.src = entry?.url ?? source;
}

const visibilityObserver = new IntersectionObserver(
  (entries) => {
    if (!workspaceActive) return;
    for (const entry of entries) {
      const image = entry.target as HTMLImageElement;
      if (entry.isIntersecting) {
        visibleImages.add(image);
        void showManagedImage(image);
      } else {
        visibleImages.delete(image);
        image.removeAttribute("src");
      }
    }
  },
  { root: null, rootMargin: PREFETCH_MARGIN, threshold: 0.01 },
);

function manageImage(image: HTMLImageElement): void {
  if (image.dataset.thumbManaged === "1") {
    if (workspaceActive) visibilityObserver.observe(image);
    return;
  }
  const source = image.getAttribute("src");
  if (!source || source.startsWith("blob:")) return;
  image.dataset.thumbManaged = "1";
  image.dataset.thumbSource = source;
  image.removeAttribute("src");
  image.loading = "lazy";
  image.decoding = "async";
  if (workspaceActive) visibilityObserver.observe(image);
}

function scanNode(root: ParentNode): void {
  if (root instanceof HTMLImageElement && (root.closest(".photo-tile") || root.classList.contains("inspector-preview"))) manageImage(root);
  root.querySelectorAll?.<HTMLImageElement>(".photo-tile .thumb-wrap img, .inspector-preview").forEach(manageImage);
}

function syncSourcePath(): void {
  const sourcePath = document.querySelector<HTMLElement>("#photoSourcePath")?.textContent?.trim() ?? "";
  if (sourcePath === lastSourcePath) return;
  lastSourcePath = sourcePath;
  clearCache();
}

function pauseWorkspace(): void {
  workspaceActive = false;
  for (const image of document.querySelectorAll<HTMLImageElement>("#section-photos img[data-thumb-managed='1']")) {
    visibilityObserver.unobserve(image);
    visibleImages.delete(image);
    image.removeAttribute("src");
  }
}

function resumeWorkspace(): void {
  workspaceActive = true;
  const section = document.querySelector<HTMLElement>("#section-photos");
  if (section) scanNode(section);
  pumpQueue();
  queuePerformanceUpdate();
}

function syncWorkspaceActive(): void {
  const section = document.querySelector<HTMLElement>("#section-photos");
  const next = Boolean(section?.classList.contains("active"));
  if (next === workspaceActive) return;
  if (next) resumeWorkspace();
  else pauseWorkspace();
}

function start(): void {
  const grid = document.querySelector<HTMLElement>("#photoGrid");
  const inspector = document.querySelector<HTMLElement>("#photoInspector");
  const sourcePath = document.querySelector<HTMLElement>("#photoSourcePath");
  const section = document.querySelector<HTMLElement>("#section-photos");
  if (!grid || !inspector || !sourcePath || !section) return;

  workspaceActive = section.classList.contains("active");
  scanNode(grid);
  scanNode(inspector);
  syncSourcePath();
  updateCacheStat();
  queuePerformanceUpdate();

  const gridObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) if (node instanceof HTMLElement) scanNode(node);
    }
    queuePerformanceUpdate();
  });
  gridObserver.observe(grid, { childList: true });

  const inspectorObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) if (node instanceof HTMLElement) scanNode(node);
    }
  });
  inspectorObserver.observe(inspector, { childList: true });

  const sourceObserver = new MutationObserver(syncSourcePath);
  sourceObserver.observe(sourcePath, { childList: true, characterData: true, subtree: true });

  const sectionObserver = new MutationObserver(syncWorkspaceActive);
  sectionObserver.observe(section, { attributes: true, attributeFilter: ["class"] });

  window.addEventListener("beforeunload", () => {
    gridObserver.disconnect();
    inspectorObserver.disconnect();
    sourceObserver.disconnect();
    sectionObserver.disconnect();
    visibilityObserver.disconnect();
    clearCache();
  }, { once: true });
}

start();
