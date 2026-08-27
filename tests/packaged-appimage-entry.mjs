const nativeSetTimeout = globalThis.setTimeout;

globalThis.setTimeout = (handler, delay, ...args) => {
  const effectiveDelay = delay === 30000 ? 60000 : delay;
  return nativeSetTimeout(handler, effectiveDelay, ...args);
};

await import("./packaged-appimage.mjs");
