// SPDX-License-Identifier: AGPL-3.0-only

const OLD_ENGINE_MESSAGE = "The installed tihulu engine is too old for separate CPU/GPU/GPU+CPU controls.";
let lastNotice = 0;

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
  window.setTimeout(() => node?.classList.remove("show"), 5200);
}

function handleCapabilityMismatch(): void {
  const now = Date.now();
  if (now - lastNotice < 2500) return;
  lastNotice = now;
  toast("The detected tihulu executable is missing the hardware-policy flags. The job was not downgraded to Auto. Recheck the engine path or update tihulu-star-trail.");
  qs<HTMLButtonElement>("#recheckEngine")?.click();
}

function install(): boolean {
  const consoleBody = qs<HTMLElement>("#consoleBody");
  if (!consoleBody) return false;
  let previous = consoleBody.textContent ?? "";
  new MutationObserver(() => {
    const current = consoleBody.textContent ?? "";
    if (current.includes(OLD_ENGINE_MESSAGE) && !previous.includes(OLD_ENGINE_MESSAGE)) handleCapabilityMismatch();
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
