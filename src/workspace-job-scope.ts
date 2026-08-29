// SPDX-License-Identifier: AGPL-3.0-only

// The Photo Workspace keeps every scanned frame in one backing array so group
// switching is instant. When a Studio group is active, tiles outside that group
// are hidden with .studio-group-hidden. The core job builder stages included
// frames, so make the active visual scope authoritative immediately before a
// process starts. Capture phase runs before main.ts's #startJob handler.
function scopeJobToVisibleGroup(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target.closest("#startJob") : null;
  if (!target) return;

  const tiles = Array.from(document.querySelectorAll<HTMLElement>("#photoGrid .photo-tile[data-path]"));
  if (tiles.length === 0 || !tiles.some((tile) => tile.classList.contains("studio-group-hidden"))) return;

  const paths = tiles
    .filter((tile) => !tile.classList.contains("studio-group-hidden"))
    .map((tile) => tile.dataset.path)
    .filter((path): path is string => Boolean(path));

  if (paths.length === 0) return;
  window.dispatchEvent(new CustomEvent("tihulu:workspace-visible-scope", {
    detail: { paths, includeAll: false, excludeOutside: true },
  }));
}

document.addEventListener("click", scopeJobToVisibleGroup, { capture: true });
