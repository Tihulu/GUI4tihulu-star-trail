// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Load UI layers independently after main.ts renders the shell.
 *
 * Vite can merge several module entry scripts into one execution chain. A single
 * runtime exception in an early helper would then prevent every helper after it
 * from starting. Each dynamic import is isolated here so unsupported WebView
 * APIs degrade only that feature instead of silently disabling branding,
 * readiness, render options or the Photo Workspace.
 */
const helperModules: Array<[string, () => Promise<unknown>]> = [
  ["branding", () => import("./branding")],
  ["readiness", () => import("./readiness")],
  ["render options", () => import("./render-options")],
  ["hardware options", () => import("./hardware-options")],
  ["parameter info", () => import("./parameter-info")],
  ["studio editor", () => import("./studio-editor")],
  ["engine group sync", () => import("./engine-group-sync")],
  ["workspace parity", () => import("./workspace-parity")],
  ["thumbnail manager", () => import("./photo-thumbnail-manager")],
];

async function loadHelpers(): Promise<void> {
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
