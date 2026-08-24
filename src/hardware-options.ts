// SPDX-License-Identifier: AGPL-3.0-only
import "./hardware-options.css";
import { invoke } from "@tauri-apps/api/core";

type HardwareMode = "auto" | "cpu" | "gpu" | "hybrid";
type HardwarePolicies = {
  groupHardware: HardwareMode;
  trailHardware: HardwareMode;
  timelapseHardware: HardwareMode;
};

const INFO: Record<"group" | "trail" | "timelapse", { title: string; body: string }> = {
  group: {
    title: "Grouping compute",
    body: "Auto chooses the best available backend. CPU keeps grouping on the processor. GPU prefers CUDA/OpenCL and GPU-capable feature work where the installed OpenCV build supports it. GPU + CPU uses acceleration for transferable preprocessing while keeping matching and geometry on CPU. GPU availability depends on the installed OpenCV build and safely falls back to CPU.",
  },
  trail: {
    title: "Trail compute",
    body: "Controls hardware used by star-trail resize and lighten/max stacking. Auto prefers available acceleration, CPU forces processor-only operation, GPU prefers CUDA/OpenCL, and GPU + CPU keeps accelerated pixel operations on the GPU while CPU handles I/O and remaining work. Unsupported acceleration falls back to CPU.",
  },
  timelapse: {
    title: "Timelapse compute",
    body: "Controls hardware used while preparing timelapse frames. GPU-capable resize work can run through CUDA/OpenCL; video encoding and I/O still use the CPU/codec backend. GPU + CPU makes that mixed pipeline explicit. Auto is recommended unless you are testing or troubleshooting a backend.",
  },
};

function qs<T extends Element>(selector: string): T | null { return document.querySelector<T>(selector); }

function selector(id: string, kind: keyof typeof INFO): string {
  return `
    <div class="hardware-policy-field">
      <div class="hardware-policy-title"><span>Compute</span><button type="button" class="hardware-info" data-hardware-info="${kind}" aria-label="About ${INFO[kind].title}">i</button></div>
      <div class="hardware-policy-segmented" id="${id}" role="group" aria-label="${INFO[kind].title}">
        <button type="button" data-value="auto" class="selected">Auto</button>
        <button type="button" data-value="cpu">CPU</button>
        <button type="button" data-value="gpu">GPU</button>
        <button type="button" data-value="hybrid">GPU + CPU</button>
      </div>
      <small>Auto recommended · GPU requires an available CUDA/OpenCL backend</small>
    </div>`;
}

function selected(id: string): HardwareMode {
  const value = qs<HTMLButtonElement>(`#${id} button.selected`)?.dataset.value;
  return value === "cpu" || value === "gpu" || value === "hybrid" ? value : "auto";
}

async function pushPolicies(): Promise<void> {
  const policies: HardwarePolicies = {
    groupHardware: selected("groupHardwarePolicy"),
    trailHardware: selected("trailHardwarePolicy"),
    timelapseHardware: selected("timelapseHardwarePolicy"),
  };
  try { await invoke("set_hardware_policies", { policies }); }
  catch (error) { console.warn("Could not set hardware policies", error); }
}

function wireSegment(id: string): void {
  const root = qs<HTMLElement>(`#${id}`);
  if (!root) return;
  root.querySelectorAll<HTMLButtonElement>("button[data-value]").forEach((button) => {
    button.addEventListener("click", () => {
      root.querySelectorAll("button").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      void pushPolicies();
    });
  });
}

function showInfo(kind: keyof typeof INFO): void {
  let node = qs<HTMLDivElement>("#hardwareInfoToast");
  if (!node) {
    node = document.createElement("div");
    node.id = "hardwareInfoToast";
    node.className = "hardware-info-toast";
    document.body.append(node);
  }
  node.innerHTML = `<strong>${INFO[kind].title}</strong><p>${INFO[kind].body}</p><button type="button" aria-label="Close">×</button>`;
  node.querySelector("button")?.addEventListener("click", () => node?.classList.remove("show"), { once: true });
  node.classList.add("show");
}

function install(): boolean {
  const grouping = qs<HTMLElement>('.settings-section[data-show="run,group"]');
  const trailCard = qs<HTMLElement>("#trailOptionsCard");
  const timelapseCard = qs<HTMLElement>("#timelapseOptionsCard");
  if (!grouping || !trailCard || !timelapseCard) return false;
  if (qs("#groupHardwarePolicy")) return true;

  const groupWrap = document.createElement("div");
  groupWrap.className = "hardware-policy-wrap";
  groupWrap.innerHTML = selector("groupHardwarePolicy", "group");
  grouping.append(groupWrap);

  const trailWrap = document.createElement("div");
  trailWrap.className = "hardware-policy-wrap render-hardware-policy";
  trailWrap.innerHTML = selector("trailHardwarePolicy", "trail");
  trailCard.append(trailWrap);

  const timelapseWrap = document.createElement("div");
  timelapseWrap.className = "hardware-policy-wrap render-hardware-policy";
  timelapseWrap.innerHTML = selector("timelapseHardwarePolicy", "timelapse");
  timelapseCard.append(timelapseWrap);

  ["groupHardwarePolicy", "trailHardwarePolicy", "timelapseHardwarePolicy"].forEach(wireSegment);
  document.querySelectorAll<HTMLButtonElement>("[data-hardware-info]").forEach((button) => button.addEventListener("click", () => showInfo(button.dataset.hardwareInfo as keyof typeof INFO)));
  qs<HTMLButtonElement>("#startJob")?.addEventListener("click", () => void pushPolicies(), true);
  void pushPolicies();
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
