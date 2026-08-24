// SPDX-License-Identifier: AGPL-3.0-only
import "./parameter-info.css";

type ParameterInfo = {
  selector: string;
  title: string;
  defaultValue: string;
  description: string;
  behavior: string;
  advice: string;
};

const parameters: ParameterInfo[] = [
  {
    selector: "#threshold",
    title: "Grouping threshold",
    defaultValue: "0.42",
    description: "Controls how similar two frames must be before they are accepted as the same camera angle.",
    behavior: "Higher values are stricter and can split borderline frames into separate groups. Lower values are more permissive and can merge visually similar angles.",
    advice: "Keep 0.42 for normal use. Raise it when different camera angles are being mixed; lower it slightly when one real angle is being split too aggressively.",
  },
  {
    selector: "#minMatches",
    title: "Minimum matches",
    defaultValue: "18",
    description: "Minimum number of geometric feature correspondences required for a frame-to-frame angle match.",
    behavior: "Higher values are more conservative but may reject dark, blurred or low-detail frames. Lower values accept weaker matches but increase false-match risk.",
    advice: "18 is a balanced starting point. Increase it for clean, detailed frames; reduce it carefully for difficult low-feature sequences.",
  },
  {
    selector: "#maxSide",
    title: "Analysis max side",
    defaultValue: "1000 px",
    description: "Downscales the longest image side for feature analysis only. It does not reduce the final trail or video resolution.",
    behavior: "Smaller values use less CPU and RAM and analyze faster. Larger values preserve more small features but cost more processing time and memory.",
    advice: "1000 px is normally enough. Increase it only when matching fails because useful stars or landmarks become too small during analysis.",
  },
  {
    selector: "#nfeatures",
    title: "ORB features",
    defaultValue: "2500",
    description: "Maximum number of ORB keypoints the grouping stage tries to extract from each analysis frame.",
    behavior: "More features can improve matching in difficult scenes, but increase CPU work and temporary memory. Fewer features are faster but may weaken matching.",
    advice: "Use 2500 unless grouping quality is poor. Increase gradually for sparse or difficult images instead of jumping to very large values.",
  },
  {
    selector: "#timeMetadata",
    title: "Use capture time",
    defaultValue: "Off",
    description: "Adds capture/file time as a guard while grouping so frames far apart in time are not linked only because they look similar.",
    behavior: "Useful when one folder contains multiple sessions or repeated camera positions. When disabled, grouping relies on the image matching rules alone.",
    advice: "Enable it for mixed-night archives or long sessions where the same view may return much later.",
  },
  {
    selector: "#timeWindowHours",
    title: "Time window",
    defaultValue: "6 hours",
    description: "Sets the allowed time separation used by the capture-time grouping guard.",
    behavior: "A shorter window isolates sessions more aggressively. A longer window allows visually matching frames taken farther apart to remain eligible for the same group.",
    advice: "Six hours fits many single-night shoots. Shorten it for clearly separated sessions; lengthen it for very long continuous captures.",
  },
  {
    selector: "#linkMode",
    title: "Grouped output link mode",
    defaultValue: "Copy",
    description: "Controls how grouped source frames are represented in the output folders.",
    behavior: "Copy is portable but uses extra disk space. Symlink uses almost no extra space but depends on the originals staying put. Hardlink avoids duplication but usually requires the same filesystem. Manifest only creates grouping metadata without materializing image files.",
    advice: "Use Copy for the safest portable project. Use Symlink or Hardlink when disk usage matters and you understand the filesystem trade-offs.",
  },
  {
    selector: "#minFrames",
    title: "Minimum frames",
    defaultValue: "2",
    description: "Minimum sequence/group size required before a trail or timelapse is rendered.",
    behavior: "Higher values skip tiny groups and accidental matches. Lower values keep very short sequences.",
    advice: "Raise this when you want to ignore small groups that are not useful as final outputs.",
  },
  {
    selector: "#jpegQuality",
    title: "JPEG quality",
    defaultValue: "95",
    description: "Compression quality used for JPEG trail exports.",
    behavior: "Higher values preserve more detail but create larger files. Lower values reduce file size and can introduce compression artifacts.",
    advice: "95 is a high-quality default. PNG export in Full Desktop is preferable when you need lossless output.",
  },
  {
    selector: "#recursive",
    title: "Recursive scan",
    defaultValue: "On",
    description: "Includes supported photos found inside subfolders of the selected input folder.",
    behavior: "Disable it when only files directly inside the chosen folder should be processed.",
    advice: "Leave it enabled for organized night folders that contain nested camera or session directories.",
  },
  {
    selector: "#makeTimelapse",
    title: "Also render timelapse",
    defaultValue: "Off",
    description: "During Full run, creates a timelapse for each detected group in addition to the star-trail image.",
    behavior: "Enabling it adds video encoding time and output files but does not change grouping itself.",
    advice: "Enable only when you want both still trails and videos from the same run.",
  },
  {
    selector: "#fps",
    title: "Frames per second",
    defaultValue: "24 fps",
    description: "Playback frame rate of the generated timelapse.",
    behavior: "Higher FPS makes the same number of photos play faster and more smoothly; lower FPS makes the sequence last longer.",
    advice: "24 fps is cinematic and broadly compatible. Use 25/30/60 only when that timing matches your intended output.",
  },
  {
    selector: "#videoMaxSide",
    title: "Video max side",
    defaultValue: "1920 px",
    description: "Maximum width or height of generated video frames while preserving aspect ratio.",
    behavior: "Lower values reduce encoding load and file size. A value of 0 keeps the original image dimensions where the engine/output codec permits it.",
    advice: "1920 is a practical Full-HD-oriented default. Use 0 only when original-resolution video is really needed.",
  },
  {
    selector: "#codec",
    title: "Video codec FourCC",
    defaultValue: "mp4v",
    description: "Four-character codec identifier passed to the video writer for direct timelapse recording.",
    behavior: "Codec availability varies by platform and OpenCV build. An unsupported FourCC can prevent the writer from opening.",
    advice: "Keep mp4v for broad compatibility unless you know a different FourCC is available on your system.",
  },
  {
    selector: "#customExecutable",
    title: "Custom tihulu executable",
    defaultValue: "Auto-detect",
    description: "Overrides automatic engine discovery and points the GUI at a specific installed tihulu executable.",
    behavior: "When empty, the GUI searches PATH and standard install locations. A custom path is useful for development builds or isolated environments.",
    advice: "Leave this empty unless automatic detection fails or you intentionally want a different engine installation.",
  },
  {
    selector: "#quiet",
    title: "Quiet engine output",
    defaultValue: "Off",
    description: "Reduces progress messages produced by the tihulu engine in the activity console.",
    behavior: "It changes logging verbosity only; it does not change processing quality or performance settings.",
    advice: "Keep it off while diagnosing a job. Enable it when you want a cleaner console during routine processing.",
  },
];

let activeParameter: ParameterInfo | null = null;
let overlay: HTMLDivElement | null = null;

function buildOverlay(): HTMLDivElement {
  const root = document.createElement("div");
  root.className = "parameter-info-overlay hidden";
  root.setAttribute("role", "presentation");
  root.innerHTML = `
    <section class="parameter-info-dialog" role="dialog" aria-modal="true" aria-labelledby="parameterInfoTitle">
      <div class="parameter-info-head">
        <div><p class="parameter-info-kicker">PARAMETER INFO</p><h2 id="parameterInfoTitle">Parameter guide</h2></div>
        <button class="parameter-info-close" type="button" aria-label="Close parameter information">×</button>
      </div>
      <div class="parameter-info-body" id="parameterInfoBody"></div>
    </section>`;
  root.addEventListener("click", (event) => {
    if (event.target === root || (event.target as HTMLElement).closest(".parameter-info-close")) closeOverlay();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !root.classList.contains("hidden")) closeOverlay();
  });
  document.body.append(root);
  return root;
}

function parameterCard(info: ParameterInfo): string {
  return `
    <article class="parameter-info-card${activeParameter === info ? " focused" : ""}">
      <div class="parameter-info-card-title"><h3>${escapeHtml(info.title)}</h3><span>Default: ${escapeHtml(info.defaultValue)}</span></div>
      <p>${escapeHtml(info.description)}</p>
      <dl><div><dt>What changes?</dt><dd>${escapeHtml(info.behavior)}</dd></div><div><dt>Recommended use</dt><dd>${escapeHtml(info.advice)}</dd></div></dl>
    </article>`;
}

function openOverlay(info?: ParameterInfo): void {
  activeParameter = info ?? null;
  overlay ??= buildOverlay();
  const body = overlay.querySelector<HTMLElement>("#parameterInfoBody");
  const title = overlay.querySelector<HTMLElement>("#parameterInfoTitle");
  if (!body || !title) return;
  title.textContent = info ? info.title : "Parameter guide";
  body.innerHTML = info ? parameterCard(info) : parameters.map(parameterCard).join("");
  overlay.classList.remove("hidden");
  document.body.classList.add("parameter-info-open");
  overlay.querySelector<HTMLButtonElement>(".parameter-info-close")?.focus();
}

function closeOverlay(): void {
  overlay?.classList.add("hidden");
  document.body.classList.remove("parameter-info-open");
  activeParameter = null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function infoAnchor(control: Element): HTMLElement | null {
  const label = control.closest("label");
  if (label instanceof HTMLElement) {
    if (label.classList.contains("switch-field")) return label.querySelector<HTMLElement>("strong") ?? label;
    return label.querySelector<HTMLElement>("span") ?? label;
  }
  const section = control.closest(".settings-section");
  return section?.querySelector<HTMLElement>(".settings-title > span") ?? null;
}

function addInfoButton(info: ParameterInfo): void {
  const control = document.querySelector(info.selector);
  if (!control || control.getAttribute("data-parameter-info-installed") === "true") return;
  const anchor = infoAnchor(control);
  if (!anchor) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "parameter-info-dot";
  button.textContent = "i";
  button.title = `About ${info.title}`;
  button.setAttribute("aria-label", `About ${info.title}`);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openOverlay(info);
  });
  anchor.append(" ", button);
  control.setAttribute("data-parameter-info-installed", "true");
}

function addGuideButton(): void {
  const advancedBody = document.querySelector<HTMLElement>(".advanced-body");
  if (!advancedBody || document.querySelector("#parameterGuideButton")) return;
  const guide = document.createElement("div");
  guide.className = "parameter-guide-strip";
  guide.innerHTML = `<div><strong>Not sure what a parameter does?</strong><span>See defaults, performance impact and when to change each setting.</span></div><button id="parameterGuideButton" type="button">Parameter guide</button>`;
  guide.querySelector<HTMLButtonElement>("#parameterGuideButton")?.addEventListener("click", () => openOverlay());
  advancedBody.prepend(guide);
}

function install(): boolean {
  if (!document.querySelector("#advancedCard")) return false;
  parameters.forEach(addInfoButton);
  addGuideButton();
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
