// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Load optional UI layers independently after main.ts has rendered the shell.
 *
 * Vite may otherwise merge multiple module entry scripts into a single chunk.
 * A runtime exception in one early helper can then prevent every helper after it
 * (render options, readiness, branding, workspace tools) from initializing.
 * Keeping each dynamic import behind its own try/catch makes the desktop shell
 * resilient: one unsupported WebView API can degrade one feature without
 * silently disabling the rest of the interface.
 */
const helperModules: Array<[string, () => Promise<unknown>]> = [
  ["thumbnail manager", () => import("./photo-thumbnail-manager")],
  ["render options", () => import("./render-options")],
  ["hardware options", () => import("./hardware-options")],
  ["parameter info", () => import("./parameter-info")],
  ["studio editor", () => import("./studio-editor")],
  ["engine group sync", () => import("./engine-group-sync")],
  ["workspace parity", () => import("./workspace-parity")],
  ["readiness", () => import("./readiness")],
  ["branding", () => import("./branding")],
];

async function loadHelpers(): Promise<void> {
  // Let main.ts finish its synchronous DOM construction first.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  for (const [name, load] of helperModules) {
    try {
      await load();
    } catch (error) {
      console.error(`[Tihulu Studio] ${name} failed to initialize`, error);
    }
  }
}

function start(): void {
  void loadHelpers();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
