// SPDX-License-Identifier: AGPL-3.0-only
import "./render-options.css";

type Mode = "run" | "group" | "trail" | "timelapse";

type HelpInfo = {
  title: string;
  description: string;
  behavior: string;
  advice: string;
};

const help: Record<string, HelpInfo> = {
  trailMinFrames: {
    title: "Trail minimum frames",
    description: "Minimum number of frames required before a star-trail image is rendered.",
    behavior: "Higher values skip tiny groups. In Full run this maps to the upstream shared --min-frames value used by both trail and optional timelapse rendering.",
    advice: "Keep 2 for normal use. Raise it when you want to ignore accidental or very small groups.",
  },
  trailJpegQuality: {
    title: "Trail JPEG quality",
    description: "JPEG compression quality used by the quick Trail and Full run workflows.",
    behavior: "Higher values preserve more detail but create larger files. Lower values save disk space but can introduce compression artifacts.",
    advice: "95 is a high-quality default. Use Full Desktop when you need PNG/lossless export controls.",
  },
  trailRecursive: {
    title: "Trail recursive scan",
    description: "Controls whether standalone Trail mode searches image files inside nested folders.",
    behavior: "Enabled includes subfolders. Disabled processes only the directly selected folder level.",
    advice: "Leave enabled for organized session folders; disable it when the selected folder already contains exactly the sequence you want.",
  },
  runMakeTimelapse: {
    title: "Also render timelapse",
    description: "During Full run, render one timelapse for each detected group in addition to trail images.",
    behavior: "This adds video encoding time and output files but does not change grouping.",
    advice: "Enable when you want both still trails and videos from the same grouping pass.",
  },
  timelapseMinFrames: {
    title: "Timelapse minimum frames",
    description: "Minimum number of frames required before standalone Timelapse mode renders a grouped video.",
    behavior: "Higher values skip tiny grouped sequences. For a plain folder sequence the upstream renderer uses all discovered frames.",
    advice: "Use 2 normally; increase it when grouped output contains small groups you do not want encoded.",
  },
  timelapseFps: {
    title: "Timelapse frames per second",
    description: "Playback frame rate of the generated video.",
    behavior: "Higher FPS makes the same photo sequence play faster; lower FPS makes it last longer.",
    advice: "24 fps is the upstream default. 25 or 30 are common alternatives; 60 is useful only for sufficiently long sequences.",
  },
  timelapseVideoMaxSide: {
    title: "Timelapse video max side",
    description: "Maximum width or height used for encoded video frames while preserving aspect ratio.",
    behavior: "Smaller values reduce encoding load and output size. 0 asks the engine to keep original dimensions.",
    advice: "1920 is a practical Full-HD default. Use 3840 for 4K-oriented output when the source and system can handle it.",
  },
  timelapseCodec: {
    title: "Timelapse codec",
    description: "FourCC video codec passed to OpenCV. The quick workflow keeps the normal MP4 output path while codec availability depends on the platform/OpenCV backend.",
    behavior: "mp4v is the safest default. XVID and MJPG are common alternatives. avc1/H264 require a compatible encoder and may be unavailable on some installations.",
    advice: "Start with mp4v. Change only if you need another encoder and your OpenCV/FFmpeg build supports it.",
  },
  timelapseRecursive: {
    title: "Timelapse recursive scan",
    description: "Controls whether standalone Timelapse mode searches nested folders for source frames.",
    behavior: "Enabled includes subfolders; disabled uses only the selected folder level.",
    advice: "Disable it when subfolders contain unrelated frames or separate sessions.",
  },
};

function qs<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function activeMode(): Mode {
  const active = qs<HTMLButtonElement>(".mode-tab.active");
  const value = active?.dataset.mode;
  return value === "group" || value === "trail" || value === "timelapse" ? value : "run";
}

function infoButton(key: keyof typeof help): string {
  return `<button class="render-option-info" type="button" data-render-help="${key}" aria-label="About ${help[key].title}" title="About ${help[key].title}">i</button>`;
}

function installHelpOverlay(): HTMLDivElement {
  const existing = qs<HTMLDivElement>("#renderHelpOverlay");
  if (existing) return existing;
  const overlay = document.createElement("div");
  overlay.id = "renderHelpOverlay";
  overlay.className = "render-help-overlay hidden";
  overlay.innerHTML = `
    <section class="render-help-dialog" role="dialog" aria-modal="true" aria-labelledby="renderHelpTitle">
      <div class="render-help-head">
        <div><p>PARAMETER INFO</p><h2 id="renderHelpTitle">Render option</h2></div>
        <button class="render-help-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="render-help-body" id="renderHelpBody"></div>
    </section>`;
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || (event.target as HTMLElement).closest(".render-help-close")) overlay.classList.add("hidden");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") overlay.classList.add("hidden");
  });
  document.body.append(overlay);
  return overlay;
}

function openHelp(key: string): void {
  const info = help[key];
  if (!info) return;
  const overlay = installHelpOverlay();
  const title = overlay.querySelector<HTMLElement>("#renderHelpTitle");
  const body = overlay.querySelector<HTMLElement>("#renderHelpBody");
  if (!title || !body) return;
  title.textContent = info.title;
  body.innerHTML = `
    <p>${info.description}</p>
    <dl>
      <div><dt>What changes?</dt><dd>${info.behavior}</dd></div>
      <div><dt>Recommended use</dt><dd>${info.advice}</dd></div>
    </dl>`;
  overlay.classList.remove("hidden");
}

function install(): boolean {
  const advancedBody = qs<HTMLElement>(".advanced-body");
  const legacyMinFrames = qs<HTMLInputElement>("#minFrames");
  const legacyJpegQuality = qs<HTMLInputElement>("#jpegQuality");
  const legacyRecursive = qs<HTMLInputElement>("#recursive");
  const legacyMakeTimelapse = qs<HTMLInputElement>("#makeTimelapse");
  const legacyFps = qs<HTMLInputElement>("#fps");
  const legacyVideoMaxSide = qs<HTMLInputElement>("#videoMaxSide");
  const legacyCodec = qs<HTMLInputElement>("#codec");
  if (!advancedBody || !legacyMinFrames || !legacyJpegQuality || !legacyRecursive || !legacyMakeTimelapse || !legacyFps || !legacyVideoMaxSide || !legacyCodec) return false;
  if (qs("#renderOptionsStudio")) return true;

  const legacyRenderSection = legacyMinFrames.closest<HTMLElement>(".settings-section");
  const legacyTimelapseSection = legacyFps.closest<HTMLElement>(".settings-section");
  legacyRenderSection?.classList.add("legacy-render-options-hidden");
  legacyTimelapseSection?.classList.add("legacy-render-options-hidden");

  const engineSection = qs("#customExecutable")?.closest<HTMLElement>(".settings-section");
  const studio = document.createElement("div");
  studio.id = "renderOptionsStudio";
  studio.className = "render-options-studio";
  studio.innerHTML = `
    <section class="settings-section render-options-card" id="trailOptionsCard">
      <div class="render-options-head">
        <div><span class="render-options-badge">TRAIL</span><strong>Star-trail output</strong><small>Still-image stacking options</small></div>
        <span class="render-options-engine">tihulu trail / run</span>
      </div>
      <div class="settings-grid three render-options-grid">
        <label class="field">
          <span id="trailMinFramesLabel">Minimum frames ${infoButton("trailMinFrames")}</span>
          <input id="trailMinFrames" type="number" min="2" step="1" value="${legacyMinFrames.value}">
          <small id="trailMinFramesHint">Skip groups smaller than this value</small>
        </label>
        <label class="field">
          <span>JPEG quality ${infoButton("trailJpegQuality")}</span>
          <input id="trailJpegQuality" type="number" min="1" max="100" step="1" value="${legacyJpegQuality.value}">
          <small>1–100 · upstream default 95</small>
        </label>
        <label class="switch-field inline-switch" id="trailRecursiveWrap">
          <input id="trailRecursive" type="checkbox" ${legacyRecursive.checked ? "checked" : ""}>
          <span class="switch"></span>
          <span><strong>Recursive scan ${infoButton("trailRecursive")}</strong><small>Standalone Trail mode only</small></span>
        </label>
      </div>
      <p class="render-options-note" id="trailOptionsNote"></p>
    </section>

    <section class="settings-section render-options-card" id="timelapseOptionsCard">
      <div class="render-options-head">
        <div><span class="render-options-badge cyan">TIMELAPSE</span><strong>Timelapse video</strong><small>Playback, resolution and codec options</small></div>
        <span class="render-options-engine">tihulu timelapse / run</span>
      </div>
      <label class="switch-field render-options-enable" id="runTimelapseWrap">
        <input id="runMakeTimelapse" type="checkbox" ${legacyMakeTimelapse.checked ? "checked" : ""}>
        <span class="switch"></span>
        <span><strong>Also render timelapse ${infoButton("runMakeTimelapse")}</strong><small>Create one video per detected group during Full run</small></span>
      </label>
      <div class="settings-grid four render-options-grid">
        <label class="field" id="timelapseMinFramesWrap">
          <span>Minimum frames ${infoButton("timelapseMinFrames")}</span>
          <input id="timelapseMinFrames" type="number" min="2" step="1" value="${legacyMinFrames.value}">
          <small>Grouped timelapses</small>
        </label>
        <label class="field">
          <span>Frames / second ${infoButton("timelapseFps")}</span>
          <input id="timelapseFps" type="number" min="0.1" step="0.1" value="${legacyFps.value}">
          <small>24 fps default</small>
        </label>
        <label class="field">
          <span>Video max side ${infoButton("timelapseVideoMaxSide")}</span>
          <select id="timelapseVideoMaxSide">
            <option value="1280">1280 · HD-ish</option>
            <option value="1920" selected>1920 · Full HD</option>
            <option value="2560">2560 · QHD</option>
            <option value="3840">3840 · 4K</option>
            <option value="0">Original size</option>
          </select>
          <small>Longest output side</small>
        </label>
        <label class="field">
          <span>Codec ${infoButton("timelapseCodec")}</span>
          <select id="timelapseCodec">
            <option value="mp4v">mp4v · MPEG-4 (recommended)</option>
            <option value="XVID">XVID · Xvid MPEG-4</option>
            <option value="MJPG">MJPG · Motion JPEG</option>
            <option value="avc1">avc1 · H.264/AVC if available</option>
            <option value="H264">H264 · H.264 if available</option>
            <option value="custom">Custom FourCC…</option>
          </select>
          <small>Availability depends on OpenCV/OS</small>
        </label>
      </div>
      <div class="render-options-subrow">
        <label class="switch-field" id="timelapseRecursiveWrap">
          <input id="timelapseRecursive" type="checkbox" ${legacyRecursive.checked ? "checked" : ""}>
          <span class="switch"></span>
          <span><strong>Recursive scan ${infoButton("timelapseRecursive")}</strong><small>Standalone Timelapse mode only</small></span>
        </label>
        <label class="field custom-codec-field hidden" id="customCodecWrap">
          <span>Custom FourCC</span>
          <input id="customCodec" type="text" maxlength="4" minlength="4" placeholder="e.g. DIVX" value="">
          <small>Exactly four characters</small>
        </label>
      </div>
      <p class="render-options-note" id="timelapseOptionsNote"></p>
    </section>`;

  if (engineSection) advancedBody.insertBefore(studio, engineSection);
  else advancedBody.append(studio);

  const trailMinFrames = qs<HTMLInputElement>("#trailMinFrames")!;
  const trailJpegQuality = qs<HTMLInputElement>("#trailJpegQuality")!;
  const trailRecursive = qs<HTMLInputElement>("#trailRecursive")!;
  const runMakeTimelapse = qs<HTMLInputElement>("#runMakeTimelapse")!;
  const timelapseMinFrames = qs<HTMLInputElement>("#timelapseMinFrames")!;
  const timelapseFps = qs<HTMLInputElement>("#timelapseFps")!;
  const timelapseVideoMaxSide = qs<HTMLSelectElement>("#timelapseVideoMaxSide")!;
  const timelapseCodec = qs<HTMLSelectElement>("#timelapseCodec")!;
  const customCodec = qs<HTMLInputElement>("#customCodec")!;
  const timelapseRecursive = qs<HTMLInputElement>("#timelapseRecursive")!;

  const initialMaxSide = legacyVideoMaxSide.value;
  if ([...timelapseVideoMaxSide.options].some((option) => option.value === initialMaxSide)) timelapseVideoMaxSide.value = initialMaxSide;
  else timelapseVideoMaxSide.value = "1920";

  const knownCodec = [...timelapseCodec.options].some((option) => option.value === legacyCodec.value && option.value !== "custom");
  if (knownCodec) timelapseCodec.value = legacyCodec.value;
  else {
    timelapseCodec.value = "custom";
    customCodec.value = legacyCodec.value.slice(0, 4);
  }

  function syncHidden(): void {
    const mode = activeMode();
    if (mode === "trail" || mode === "run") {
      legacyMinFrames.value = trailMinFrames.value;
      legacyJpegQuality.value = trailJpegQuality.value;
    } else if (mode === "timelapse") {
      legacyMinFrames.value = timelapseMinFrames.value;
    }
    legacyMakeTimelapse.checked = mode === "run" && runMakeTimelapse.checked;
    legacyFps.value = timelapseFps.value;
    legacyVideoMaxSide.value = timelapseVideoMaxSide.value;
    legacyCodec.value = timelapseCodec.value === "custom" ? customCodec.value.trim() : timelapseCodec.value;
    if (mode === "trail") legacyRecursive.checked = trailRecursive.checked;
    if (mode === "timelapse") legacyRecursive.checked = timelapseRecursive.checked;
  }

  function updateModeUi(): void {
    const mode = activeMode();
    const trailCard = qs<HTMLElement>("#trailOptionsCard")!;
    const timelapseCard = qs<HTMLElement>("#timelapseOptionsCard")!;
    const trailRecursiveWrap = qs<HTMLElement>("#trailRecursiveWrap")!;
    const runTimelapseWrap = qs<HTMLElement>("#runTimelapseWrap")!;
    const timelapseMinFramesWrap = qs<HTMLElement>("#timelapseMinFramesWrap")!;
    const timelapseRecursiveWrap = qs<HTMLElement>("#timelapseRecursiveWrap")!;
    const trailLabel = qs<HTMLElement>("#trailMinFramesLabel")!;
    const trailHint = qs<HTMLElement>("#trailMinFramesHint")!;
    const trailNote = qs<HTMLElement>("#trailOptionsNote")!;
    const timelapseNote = qs<HTMLElement>("#timelapseOptionsNote")!;

    trailCard.classList.toggle("hidden", mode === "group" || mode === "timelapse");
    timelapseCard.classList.toggle("hidden", mode === "group" || mode === "trail");
    trailRecursiveWrap.classList.toggle("hidden", mode !== "trail");
    runTimelapseWrap.classList.toggle("hidden", mode !== "run");
    timelapseMinFramesWrap.classList.toggle("hidden", mode === "run");
    timelapseRecursiveWrap.classList.toggle("hidden", mode !== "timelapse");

    if (mode === "run") {
      trailLabel.childNodes[0].textContent = "Minimum frames (shared) ";
      trailHint.textContent = "Used by trail + optional timelapse in Full run";
      trailNote.textContent = "Full run follows the upstream CLI: one --min-frames value is shared by trail and optional timelapse outputs.";
      timelapseNote.textContent = "Codec choices are FourCC values. mp4v is the safest default; H.264 options only work when your OpenCV/FFmpeg backend provides an encoder.";
    } else {
      trailLabel.childNodes[0].textContent = "Minimum frames ";
      trailHint.textContent = "Skip groups smaller than this value";
      trailNote.textContent = mode === "trail" ? "Standalone Trail exposes the upstream trail-specific minimum-frame, JPEG-quality and recursive-scan options." : "";
      timelapseNote.textContent = mode === "timelapse" ? "Standalone Timelapse keeps its own minimum-frame and recursive-scan values, independent from Trail mode." : "";
    }

    const timelapseControlsEnabled = mode === "timelapse" || runMakeTimelapse.checked;
    [timelapseFps, timelapseVideoMaxSide, timelapseCodec, customCodec].forEach((control) => { control.disabled = !timelapseControlsEnabled; });
    qs<HTMLElement>("#timelapseOptionsCard")?.classList.toggle("options-disabled", mode === "run" && !runMakeTimelapse.checked);
    qs<HTMLElement>("#customCodecWrap")?.classList.toggle("hidden", timelapseCodec.value !== "custom");
    syncHidden();
  }

  studio.querySelectorAll<HTMLElement>("[data-render-help]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openHelp(button.dataset.renderHelp ?? "");
    });
  });

  [trailMinFrames, trailJpegQuality, trailRecursive, runMakeTimelapse, timelapseMinFrames, timelapseFps, timelapseVideoMaxSide, timelapseCodec, customCodec, timelapseRecursive].forEach((control) => {
    control.addEventListener("input", () => { syncHidden(); updateModeUi(); });
    control.addEventListener("change", () => { syncHidden(); updateModeUi(); });
  });

  document.querySelectorAll<HTMLButtonElement>(".mode-tab").forEach((button) => {
    button.addEventListener("click", () => window.setTimeout(updateModeUi, 0));
  });

  qs<HTMLButtonElement>("#startJob")?.addEventListener("click", () => syncHidden(), true);
  updateModeUi();
  return true;
}

function start(): void {
  if (install()) return;
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 100) window.clearInterval(timer);
  }, 50);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
