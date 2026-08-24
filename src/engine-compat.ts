// SPDX-License-Identifier: AGPL-3.0-only
import { invoke } from "@tauri-apps/api/core";

const OLD_ENGINE_MESSAGE = "The installed tihulu engine is too old for separate CPU/GPU/GPU+CPU controls.";
let retrying = false;
let lastRetry = 0;

function qs<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function toast(message: string): void {
  let node = qs<HTMLDivElement>("#studioToast");
  if (!node) {
    node = document.createElement("div");
    node.id = "studioToast";
    node.className = "studio-toast";
    document.body.append(node);
  }
  node.textContent = message;
  node.classList.add("show");
  window.setTimeout(() => node?.classList.remove("show"), 4200);
}

function resetHardwareUi(): void {
  ["groupHardwarePolicy", "trailHardwarePolicy", "timelapseHardwarePolicy"].forEach((id) => {
    const root = qs<HTMLElement>(`#${id}`);
    if (!root) return;
    root.querySelectorAll<HTMLButtonElement>("button[data-value]").forEach((button) => {
      button.classList.toggle("selected", button.dataset.value === "auto");
    });
  });
}

async function fallbackAndRetry(): Promise<void> {
  const now = Date.now();
  if (retrying || now - lastRetry < 3000) return;
  retrying = true;
  lastRetry = now;
  try {
    resetHardwareUi();
    await invoke("set_hardware_policies", {
      policies: {
        groupHardware: "auto",
        trailHardware: "auto",
        timelapseHardware: "auto",
      },
    });
    toast("This tihulu version does not support separate hardware policies. Retrying this job in compatible Auto mode.");
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    const start = qs<HTMLButtonElement>("#startJob");
    if (start && !start.disabled) start.click();
  } catch (error) {
    console.warn("Could not switch the old engine to Auto compatibility mode", error);
  } finally {
    window.setTimeout(() => { retrying = false; }, 500);
  }
}

function install(): boolean {
  const consoleBody = qs<HTMLElement>("#consoleBody");
  if (!consoleBody) return false;
  let previous = consoleBody.textContent ?? "";
  new MutationObserver(() => {
    const current = consoleBody.textContent ?? "";
    if (current.includes(OLD_ENGINE_MESSAGE) && !previous.includes(OLD_ENGINE_MESSAGE)) {
      void fallbackAndRetry();
    }
    previous = current;
  }).observe(consoleBody, { childList: true, subtree: true, characterData: true });
  return true;
}

function start(): void {
  if (install()) return;
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 120) window.clearInterval(timer);
  }, 50);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
