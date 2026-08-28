// SPDX-License-Identifier: AGPL-3.0-only
import "./hardware-options.css";
import { listen } from "@tauri-apps/api/event";

type HardwareMode = "auto" | "cpu" | "gpu" | "hybrid";
type HardwareKind = "group" | "trail" | "timelapse";
type LogPayload = { stream: "stdout" | "stderr"; line: string };
const INFO: Record<HardwareKind, { title: string; body: string }> = {
  group: {
    title: "Grouping compute",
    body: "Auto chooses the best available backend and may fall back to CPU. CPU forces processor-only operation. GPU requires a working CUDA/OpenCL backend and uses GPU-capable preprocessing/feature work where OpenCV supports it. GPU + CPU keeps matching and geometry on CPU while accelerating transferable work. Explicit GPU modes now stop with a clear error instead of silently pretending to use the GPU when acceleration is unavailable.",
  },
  trail: {
    title: "Trail compute",
    body: "Controls hardware used by star-trail resize and lighten/max stacking. Auto may use CUDA/OpenCL and may fall back to CPU. CPU forces processor-only operation. Explicit GPU or GPU + CPU requires a working accelerator backend and stops with a diagnostic if acceleration is unavailable or fails, so a GPU selection cannot silently become a CPU job.",
  },
  timelapse: {
    title: "Timelapse compute",
    body: "Controls hardware used while preparing timelapse frames. CUDA/OpenCL can accelerate resize work; video encoding and I/O still use the CPU/codec backend. Auto may fall back to CPU. Explicit GPU or GPU + CPU requires an available accelerator backend and stops if it cannot use one.",
  },
};

let previousJobLogLine = "";

function qs<T extends Element>(selector: string): T | null { return document.querySelector<T>(selector); }

function selector(id: string, kind: HardwareKind): string {
  return `
    <div class="hardware-policy-field">
      <div class="hardware-policy-title"><span>Compute</span><button type="button" class="hardware-info" data-hardware-info="${kind}" aria-label="About ${INFO[kind].title}">i</button></div>
      <div class="hardware-policy-segmented" id="${id}" role="group" aria-label="${INFO[kind].title}">
        <button type="button" data-value="auto" class="selected">Auto</button>
        <button type="button" data-value="cpu">CPU</button>
        <button type="button" data-value="gpu">GPU</button>
        <button type="button" data-value="hybrid">GPU + CPU</button>
      </div>
      <small>Auto may fall back · explicit GPU modes require CUDA/OpenCL</small>
      <small class="hardware-effective" id="${id}Effective">Effective backend: run a job to verify</small>
    </div>`;
}

function selected(id: string): HardwareMode {
  const value = qs<HTMLButtonElement>(`#${id} button.selected`)?.dataset.value;
  return value === "cpu" || value === "gpu" || value === "hybrid" ? value : "auto";
}

function effectiveNode(kind: HardwareKind): HTMLElement | null {
  const id = kind === "group" ? "groupHardwarePolicy" : kind === "trail" ? "trailHardwarePolicy" : "timelapseHardwarePolicy";
  return qs<HTMLElement>(`#${id}Effective`);
}

function activeMode(): "run" | HardwareKind {
  const value = qs<HTMLButtonElement>(".mode-tab.active")?.dataset.mode;
  return value === "group" || value === "trail" || value === "timelapse" ? value : "run";
}

function setEffective(kind: HardwareKind, value: string): void {
  const node = effectiveNode(kind);
  if (node) node.textContent = `Effective backend: ${value}`;
}

function resetEffectiveForActiveJob(): void {
  previousJobLogLine = "";
  const mode = activeMode();
  const kinds: HardwareKind[] = mode === "run" ? ["group", "trail", "timelapse"] : [mode];
  kinds.forEach((kind) => setEffective(kind, "checking…"));
}

function classifyBackendLine(line: string, previousLine: string): HardwareKind | null {
  if (/^Grouping Hardware acceleration:/i.test(line)) return "group";
  const mode = activeMode();
  if (mode === "trail" || mode === "timelapse") return mode;
  if (mode === "group") return "group";
  if (/timelapse/i.test(previousLine)) return "timelapse";
  if (/star[_ -]?trail|stacking|Rendering .*trail/i.test(previousLine)) return "trail";
  return null;
}

function consumeBackendLine(line: string): void {
  const normalized = line.trim();
  const match = normalized.match(/(?:Grouping )?Hardware acceleration:\s*(.+)$/i);
  if (match) {
    const kind = classifyBackendLine(normalized, previousJobLogLine);
    if (kind) setEffective(kind, match[1].trim());
  }
  if (/acceleration was explicitly requested/i.test(normalized) || /no usable CUDA or OpenCL backend/i.test(normalized)) {
    const mode = activeMode();
    if (mode === "run") ["group", "trail", "timelapse"].forEach((kind) => {
      if (effectiveNode(kind as HardwareKind)?.textContent?.includes("checking")) setEffective(kind as HardwareKind, "unavailable · job stopped");
    });
    else setEffective(mode, "unavailable · job stopped");
  }
  previousJobLogLine = normalized;
}

function installBackendListener(): void {
  const root = document.documentElement;
  if (root.dataset.hardwareBackendListening === "true") return;
  root.dataset.hardwareBackendListening = "true";
  void listen<LogPayload>("job-log", (event) => consumeBackendLine(event.payload.line)).catch((error) => {
    root.dataset.hardwareBackendListening = "failed";
    console.warn("Hardware backend listener unavailable", error);
  });
}

function wireSegment(id: string): void {
  const root = qs<HTMLElement>(`#${id}`);
  if (!root) return;
  root.querySelectorAll<HTMLButtonElement>("button[data-value]").forEach((button) => {
    button.addEventListener("click", () => {
      root.querySelectorAll("button").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      const status = qs<HTMLElement>(`#${id}Effective`);
      if (status) status.textContent = "Effective backend: run a job to verify";
    });
  });
}

function showInfo(kind: HardwareKind): void {
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
  if (qs("#groupHardwarePolicy")) { installBackendListener(); return true; }

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
  document.querySelectorAll<HTMLButtonElement>("[data-hardware-info]").forEach((button) => button.addEventListener("click", () => showInfo(button.dataset.hardwareInfo as HardwareKind)));
  qs<HTMLButtonElement>("#startJob")?.addEventListener("click", resetEffectiveForActiveJob, true);
  installBackendListener();
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
