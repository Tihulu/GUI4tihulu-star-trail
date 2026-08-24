// SPDX-License-Identifier: AGPL-3.0-only
import "./render-options.css";

type Mode = "run" | "group" | "trail" | "timelapse";
type HelpInfo = { title: string; description: string; behavior: string; advice: string };

const HELP: Record<string, HelpInfo> = {
  trailMinFrames: { title: "Trail minimum frames", description: "Minimum number of frames required before a star-trail image is rendered.", behavior: "Higher values skip tiny groups. Full run shares this value with its optional timelapse because that is how the upstream CLI is defined.", advice: "Keep 2 normally; raise it to ignore very small groups." },
  trailJpegQuality: { title: "Trail JPEG quality", description: "JPEG compression quality for the quick Trail and Full run workflows.", behavior: "Higher values preserve more detail but create larger files.", advice: "95 is the upstream high-quality default. Full Desktop provides PNG/lossless export controls." },
  trailRecursive: { title: "Trail recursive scan", description: "Controls whether standalone Trail searches nested folders.", behavior: "Enabled includes subfolders; disabled uses only the selected folder level.", advice: "Disable it when nested folders contain unrelated sessions." },
  runMakeTimelapse: { title: "Also render timelapse", description: "During Full run, create a timelapse for each detected group in addition to trail images.", behavior: "Adds video encoding time and files without changing grouping.", advice: "Enable when you want both still trails and video from the same grouping pass." },
  timelapseMinFrames: { title: "Timelapse minimum frames", description: "Minimum group size before standalone Timelapse renders a grouped video.", behavior: "Higher values skip tiny groups.", advice: "Keep 2 normally; raise it for cleaner grouped output." },
  timelapseFps: { title: "Timelapse frames per second", description: "Playback frame rate of the generated timelapse.", behavior: "Higher FPS makes the same photo sequence play faster; lower FPS makes it last longer.", advice: "24 is the upstream default; 25 and 30 are common alternatives." },
  timelapseVideoMaxSide: { title: "Timelapse video max side", description: "Longest output video dimension while preserving aspect ratio.", behavior: "Lower values reduce encoding load and file size; 0 keeps original dimensions.", advice: "1920 is a practical Full-HD default; 3840 targets 4K." },
  timelapseCodec: { title: "Timelapse codec", description: "FourCC codec passed to OpenCV for video writing.", behavior: "Availability depends on the platform and OpenCV/FFmpeg build. Unsupported codecs can fail to open the writer.", advice: "Use mp4v first. XVID/MJPG are common alternatives; H.264 options require a compatible encoder." },
  timelapseRecursive: { title: "Timelapse recursive scan", description: "Controls whether standalone Timelapse searches nested folders.", behavior: "Enabled includes subfolders; disabled uses only the selected folder level.", advice: "Disable it when subfolders contain separate sessions." },
};

function qs<T extends Element>(selector: string): T | null { return document.querySelector<T>(selector); }
function activeMode(): Mode {
  const value = qs<HTMLButtonElement>(".mode-tab.active")?.dataset.mode;
  return value === "group" || value === "trail" || value === "timelapse" ? value : "run";
}
function infoButton(key: string): string { return `<button class="render-option-info" type="button" data-render-help="${key}" aria-label="About ${HELP[key].title}">i</button>`; }

function openHelp(key: string): void {
  const info = HELP[key]; if (!info) return;
  let overlay = qs<HTMLDivElement>("#renderHelpOverlay");
  if (!overlay) {
    overlay = document.createElement("div"); overlay.id = "renderHelpOverlay"; overlay.className = "render-help-overlay hidden";
    overlay.innerHTML = `<section class="render-help-dialog" role="dialog" aria-modal="true"><div class="render-help-head"><div><p>PARAMETER INFO</p><h2 id="renderHelpTitle"></h2></div><button class="render-help-close" type="button">×</button></div><div class="render-help-body" id="renderHelpBody"></div></section>`;
    overlay.addEventListener("click", (event) => { if (event.target === overlay || (event.target as HTMLElement).closest(".render-help-close")) overlay?.classList.add("hidden"); });
    document.body.append(overlay);
  }
  overlay.querySelector<HTMLElement>("#renderHelpTitle")!.textContent = info.title;
  overlay.querySelector<HTMLElement>("#renderHelpBody")!.innerHTML = `<p>${info.description}</p><dl><div><dt>What changes?</dt><dd>${info.behavior}</dd></div><div><dt>Recommended use</dt><dd>${info.advice}</dd></div></dl>`;
  overlay.classList.remove("hidden");
}

function install(): boolean {
  const advancedBody = qs<HTMLElement>(".advanced-body");
  const minFramesMaybe = qs<HTMLInputElement>("#minFrames");
  const jpegMaybe = qs<HTMLInputElement>("#jpegQuality");
  const recursiveMaybe = qs<HTMLInputElement>("#recursive");
  const makeTimelapseMaybe = qs<HTMLInputElement>("#makeTimelapse");
  const fpsMaybe = qs<HTMLInputElement>("#fps");
  const videoMaxMaybe = qs<HTMLInputElement>("#videoMaxSide");
  const codecMaybe = qs<HTMLInputElement>("#codec");
  if (!advancedBody || !minFramesMaybe || !jpegMaybe || !recursiveMaybe || !makeTimelapseMaybe || !fpsMaybe || !videoMaxMaybe || !codecMaybe) return false;
  if (qs("#renderOptionsStudio")) return true;

  const legacy = {
    minFrames: minFramesMaybe,
    jpegQuality: jpegMaybe,
    recursive: recursiveMaybe,
    makeTimelapse: makeTimelapseMaybe,
    fps: fpsMaybe,
    videoMaxSide: videoMaxMaybe,
    codec: codecMaybe,
  };

  legacy.minFrames.closest<HTMLElement>(".settings-section")?.classList.add("legacy-render-options-hidden");
  legacy.fps.closest<HTMLElement>(".settings-section")?.classList.add("legacy-render-options-hidden");

  const studio = document.createElement("div"); studio.id = "renderOptionsStudio"; studio.className = "render-options-studio";
  studio.innerHTML = `
    <section class="settings-section render-options-card" id="trailOptionsCard">
      <div class="render-options-head"><div><span class="render-options-badge">TRAIL</span><strong>Star-trail output</strong><small>Still-image stacking options</small></div><span class="render-options-engine">tihulu trail / run</span></div>
      <div class="settings-grid three render-options-grid">
        <label class="field"><span id="trailMinFramesLabel">Minimum frames ${infoButton("trailMinFrames")}</span><input id="trailMinFrames" type="number" min="2" step="1" value="${legacy.minFrames.value}"><small id="trailMinFramesHint">Skip groups smaller than this value</small></label>
        <label class="field"><span>JPEG quality ${infoButton("trailJpegQuality")}</span><input id="trailJpegQuality" type="number" min="1" max="100" step="1" value="${legacy.jpegQuality.value}"><small>1–100 · upstream default 95</small></label>
        <label class="switch-field inline-switch" id="trailRecursiveWrap"><input id="trailRecursive" type="checkbox" ${legacy.recursive.checked ? "checked" : ""}><span class="switch"></span><span><strong>Recursive scan ${infoButton("trailRecursive")}</strong><small>Standalone Trail mode only</small></span></label>
      </div><p class="render-options-note" id="trailOptionsNote"></p>
    </section>
    <section class="settings-section render-options-card" id="timelapseOptionsCard">
      <div class="render-options-head"><div><span class="render-options-badge cyan">TIMELAPSE</span><strong>Timelapse video</strong><small>Playback, resolution and codec options</small></div><span class="render-options-engine">tihulu timelapse / run</span></div>
      <label class="switch-field render-options-enable" id="runTimelapseWrap"><input id="runMakeTimelapse" type="checkbox" ${legacy.makeTimelapse.checked ? "checked" : ""}><span class="switch"></span><span><strong>Also render timelapse ${infoButton("runMakeTimelapse")}</strong><small>Create one video per detected group during Full run</small></span></label>
      <div class="settings-grid four render-options-grid">
        <label class="field" id="timelapseMinFramesWrap"><span>Minimum frames ${infoButton("timelapseMinFrames")}</span><input id="timelapseMinFrames" type="number" min="2" step="1" value="${legacy.minFrames.value}"><small>Grouped timelapses</small></label>
        <label class="field"><span>Frames / second ${infoButton("timelapseFps")}</span><input id="timelapseFps" type="number" min="0.1" step="0.1" value="${legacy.fps.value}"><small>24 fps default</small></label>
        <label class="field"><span>Video max side ${infoButton("timelapseVideoMaxSide")}</span><select id="timelapseVideoMaxSide"><option value="1280">1280 · HD</option><option value="1920">1920 · Full HD</option><option value="2560">2560 · QHD</option><option value="3840">3840 · 4K</option><option value="0">Original size</option></select><small>Longest output side</small></label>
        <label class="field"><span>Codec ${infoButton("timelapseCodec")}</span><select id="timelapseCodec"><option value="mp4v">mp4v · MPEG-4 (recommended)</option><option value="XVID">XVID · Xvid MPEG-4</option><option value="MJPG">MJPG · Motion JPEG</option><option value="avc1">avc1 · H.264/AVC if available</option><option value="H264">H264 · H.264 if available</option><option value="custom">Custom FourCC…</option></select><small>Availability depends on OpenCV/OS</small></label>
      </div>
      <div class="render-options-subrow"><label class="switch-field" id="timelapseRecursiveWrap"><input id="timelapseRecursive" type="checkbox" ${legacy.recursive.checked ? "checked" : ""}><span class="switch"></span><span><strong>Recursive scan ${infoButton("timelapseRecursive")}</strong><small>Standalone Timelapse mode only</small></span></label><label class="field custom-codec-field hidden" id="customCodecWrap"><span>Custom FourCC</span><input id="customCodec" type="text" maxlength="4" minlength="4" placeholder="e.g. DIVX"><small>Exactly four ASCII characters</small></label></div>
      <p class="render-options-note" id="timelapseOptionsNote"></p>
    </section>`;
  const engineSection = qs("#customExecutable")?.closest<HTMLElement>(".settings-section");
  if (engineSection) advancedBody.insertBefore(studio, engineSection); else advancedBody.append(studio);

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

  if ([...timelapseVideoMaxSide.options].some((option) => option.value === legacy.videoMaxSide.value)) timelapseVideoMaxSide.value = legacy.videoMaxSide.value; else timelapseVideoMaxSide.value = "1920";
  const knownCodec = [...timelapseCodec.options].some((option) => option.value === legacy.codec.value && option.value !== "custom");
  if (knownCodec) timelapseCodec.value = legacy.codec.value; else { timelapseCodec.value = "custom"; customCodec.value = legacy.codec.value.slice(0, 4); }

  function syncHidden(): void {
    const mode = activeMode();
    if (mode === "run" || mode === "trail") { legacy.minFrames.value = trailMinFrames.value; legacy.jpegQuality.value = trailJpegQuality.value; }
    if (mode === "timelapse") legacy.minFrames.value = timelapseMinFrames.value;
    legacy.makeTimelapse.checked = mode === "run" && runMakeTimelapse.checked;
    legacy.fps.value = timelapseFps.value;
    legacy.videoMaxSide.value = timelapseVideoMaxSide.value;
    legacy.codec.value = timelapseCodec.value === "custom" ? customCodec.value.trim() : timelapseCodec.value;
    if (mode === "trail") legacy.recursive.checked = trailRecursive.checked;
    if (mode === "timelapse") legacy.recursive.checked = timelapseRecursive.checked;
  }

  function updateModeUi(): void {
    const mode = activeMode();
    const trailCard = qs<HTMLElement>("#trailOptionsCard")!; const timelapseCard = qs<HTMLElement>("#timelapseOptionsCard")!;
    qs<HTMLElement>("#trailRecursiveWrap")!.classList.toggle("hidden", mode !== "trail");
    qs<HTMLElement>("#runTimelapseWrap")!.classList.toggle("hidden", mode !== "run");
    qs<HTMLElement>("#timelapseMinFramesWrap")!.classList.toggle("hidden", mode === "run");
    qs<HTMLElement>("#timelapseRecursiveWrap")!.classList.toggle("hidden", mode !== "timelapse");
    trailCard.classList.toggle("hidden", mode === "group" || mode === "timelapse");
    timelapseCard.classList.toggle("hidden", mode === "group" || mode === "trail");
    qs<HTMLElement>("#trailOptionsNote")!.textContent = mode === "run" ? "Full run shares Minimum frames between trail and optional timelapse, matching the upstream CLI." : mode === "trail" ? "Standalone Trail keeps its own minimum-frame, JPEG-quality and recursive-scan settings." : "";
    qs<HTMLElement>("#timelapseOptionsNote")!.textContent = mode === "timelapse" ? "Standalone Timelapse keeps its own minimum frames, FPS, resolution, codec and recursive scan." : "Codec availability depends on the installed OpenCV/FFmpeg backend.";
    const enabled = mode === "timelapse" || runMakeTimelapse.checked;
    [timelapseFps, timelapseVideoMaxSide, timelapseCodec, customCodec].forEach((control) => { control.disabled = !enabled; });
    timelapseCard.classList.toggle("options-disabled", mode === "run" && !runMakeTimelapse.checked);
    qs<HTMLElement>("#customCodecWrap")!.classList.toggle("hidden", timelapseCodec.value !== "custom");
    syncHidden();
  }

  studio.querySelectorAll<HTMLButtonElement>("[data-render-help]").forEach((button) => button.addEventListener("click", (event) => { event.preventDefault(); openHelp(button.dataset.renderHelp ?? ""); }));
  [trailMinFrames, trailJpegQuality, trailRecursive, runMakeTimelapse, timelapseMinFrames, timelapseFps, timelapseVideoMaxSide, timelapseCodec, customCodec, timelapseRecursive].forEach((control) => { control.addEventListener("input", updateModeUi); control.addEventListener("change", updateModeUi); });
  document.querySelectorAll<HTMLButtonElement>(".mode-tab").forEach((button) => button.addEventListener("click", () => window.setTimeout(updateModeUi, 0)));
  qs<HTMLButtonElement>("#startJob")?.addEventListener("click", syncHidden, true);
  updateModeUi();
  return true;
}

function start(): void {
  if (install()) return;
  let attempts = 0; const timer = window.setInterval(() => { attempts += 1; if (install() || attempts >= 100) window.clearInterval(timer); }, 50);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
