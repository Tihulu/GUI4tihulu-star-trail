// SPDX-License-Identifier: AGPL-3.0-only

const MAX_CACHE_ITEMS = 128;
const MAX_CACHE_BYTES = 40 * 1024 * 1024;
const GRID_THUMB_WIDTH = 320;
const GRID_THUMB_HEIGHT = 240;
const INSPECTOR_THUMB_WIDTH = 960;
const INSPECTOR_THUMB_HEIGHT = 720;
const PREFETCH_MARGIN = "360px 0px";
const MAX_ACTIVE_DECODES = 1;

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

function updateCacheStat(): void {
  const node = ensureCacheStat();
  if (node) node.textContent = `thumb cache ${cache.size}/${MAX_CACHE_ITEMS} · ${formatMiB(cacheBytes)}/${formatMiB(MAX_CACHE_BYTES)}`;
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

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not decode ${source}`));
    image.src = source;
  });
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

async function downscale(source: string, maxWidth: number, maxHeight: number): Promise<CacheEntry> {
  const image = await loadImage(source);
  const width = Math.max(1, image.naturalWidth || image.width);
  const height = Math.max(1, image.naturalHeight || image.height);
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("2D canvas is unavailable");
  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  image.removeAttribute("src");

  const blob = await canvasBlob(canvas);
  canvas.width = 1;
  canvas.height = 1;
  return {
    url: URL.createObjectURL(blob),
    bytes: targetWidth * targetHeight * 4,
  };
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
  if (!source || !visibleImages.has(image)) return;
  const [width, height] = dimensionsFor(image);
  const entry = await thumbnailFor(source, width, height);
  if (!image.isConnected || !visibleImages.has(image) || image.dataset.thumbSource !== source) return;
  image.src = entry?.url ?? source;
}

const visibilityObserver = new IntersectionObserver(
  (entries) => {
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
  if (image.dataset.thumbManaged === "1") return;
  const source = image.getAttribute("src");
  if (!source || source.startsWith("blob:")) return;
  image.dataset.thumbManaged = "1";
  image.dataset.thumbSource = source;
  image.removeAttribute("src");
  image.loading = "lazy";
  visibilityObserver.observe(image);
}

function scanNode(root: ParentNode): void {
  if (root instanceof HTMLImageElement && (root.closest(".photo-tile") || root.classList.contains("inspector-preview"))) {
    manageImage(root);
  }
  root
    .querySelectorAll?.<HTMLImageElement>(".photo-tile .thumb-wrap img, .inspector-preview")
    .forEach(manageImage);
}

function syncSourcePath(): void {
  const sourcePath = document.querySelector<HTMLElement>("#photoSourcePath")?.textContent?.trim() ?? "";
  if (sourcePath === lastSourcePath) return;
  lastSourcePath = sourcePath;
  clearCache();
}

function start(): void {
  const app = document.querySelector("#app");
  if (!app) return;
  scanNode(app);
  syncSourcePath();
  updateCacheStat();

  const mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) scanNode(node);
      }
    }
    syncSourcePath();
  });
  mutationObserver.observe(app, { childList: true, subtree: true, characterData: true });

  window.addEventListener("beforeunload", clearCache, { once: true });
}

start();
