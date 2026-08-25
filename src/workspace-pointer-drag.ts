// SPDX-License-Identifier: AGPL-3.0-only

type DragCandidate = {
  startX: number;
  startY: number;
  paths: string[];
  active: boolean;
  moved: boolean;
  hoverCard: HTMLElement | null;
};

let candidate: DragCandidate | null = null;
let suppressClickUntil = 0;

function qs<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function tiles(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("#photoGrid .photo-tile[data-path]"));
}

function selectedPaths(): string[] {
  return tiles()
    .filter((tile) => tile.classList.contains("selected"))
    .map((tile) => tile.dataset.path)
    .filter((path): path is string => Boolean(path));
}

function setSelectedPaths(paths: string[]): void {
  const wanted = new Set(paths);
  for (const tile of tiles()) {
    const path = tile.dataset.path;
    tile.classList.toggle("selected", Boolean(path && wanted.has(path)));
  }
}

function cardAt(x: number, y: number): HTMLElement | null {
  return document.elementFromPoint(x, y)?.closest<HTMLElement>("#studioGroupList .studio-group-card[data-group-id]") ?? null;
}

function clearHover(): void {
  candidate?.hoverCard?.classList.remove("group-drag-over");
  if (candidate) candidate.hoverCard = null;
}

function updateHover(card: HTMLElement | null): void {
  if (!candidate || candidate.hoverCard === card) return;
  candidate.hoverCard?.classList.remove("group-drag-over");
  candidate.hoverCard = card;
  card?.classList.add("group-drag-over");
}

async function moveToGroup(paths: string[], groupId: string): Promise<void> {
  if (!paths.length) return;
  setSelectedPaths(paths);
  const target = qs<HTMLSelectElement>("#studioMoveTarget");
  if (!target) return;
  target.value = groupId;
  target.dispatchEvent(new Event("change", { bubbles: true }));

  // Keep the live filter map in lockstep with Studio's immediate in-memory mutation;
  // its localStorage save is intentionally debounced.
  window.dispatchEvent(new CustomEvent("tihulu:workspace-group-move", {
    detail: { paths: [...paths], groupId },
  }));

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const card = Array.from(document.querySelectorAll<HTMLElement>("#studioGroupList .studio-group-card[data-group-id]"))
    .find((item) => item.dataset.groupId === groupId);
  card?.querySelector<HTMLButtonElement>(".group-open")?.click();
}

function finishMove(card: HTMLElement | null): void {
  const current = candidate;
  const groupId = card?.dataset.groupId;
  if (!current || current.moved || !groupId || !current.paths.length) return;
  current.moved = true;
  const paths = [...current.paths];
  clearHover();
  document.documentElement.classList.remove("workspace-pointer-dragging");
  suppressClickUntil = performance.now() + 300;
  void moveToGroup(paths, groupId);
}

function resetCandidate(): void {
  clearHover();
  candidate = null;
  document.documentElement.classList.remove("workspace-pointer-dragging");
}

function install(): boolean {
  const grid = qs<HTMLElement>("#photoGrid");
  const list = qs<HTMLElement>("#studioGroupList");
  if (!grid || !list) return false;
  if (document.documentElement.dataset.workspacePointerDrag === "ready") return true;
  document.documentElement.dataset.workspacePointerDrag = "ready";

  grid.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const tile = (event.target as HTMLElement).closest<HTMLElement>(".photo-tile[data-path]");
    const path = tile?.dataset.path;
    if (!tile || !path) return;
    const selected = selectedPaths();
    candidate = {
      startX: event.clientX,
      startY: event.clientY,
      paths: selected.includes(path) ? selected : [path],
      active: false,
      moved: false,
      hoverCard: null,
    };
  }, true);

  // Native HTML5 drag can take over after pointerdown and suppress subsequent
  // pointermove/pointerup events in WebKit. Keep the same candidate alive and track
  // the destination through dragover so drop or dragend can complete the move.
  grid.addEventListener("dragstart", (event) => {
    const tile = (event.target as HTMLElement).closest<HTMLElement>(".photo-tile[data-path]");
    const path = tile?.dataset.path;
    if (!tile || !path) return;
    const selected = selectedPaths();
    if (!candidate) {
      candidate = {
        startX: 0,
        startY: 0,
        paths: selected.includes(path) ? selected : [path],
        active: true,
        moved: false,
        hoverCard: null,
      };
    } else {
      candidate.paths = selected.includes(path) ? selected : [path];
      candidate.active = true;
    }
    document.documentElement.classList.add("workspace-pointer-dragging");
  }, true);

  list.addEventListener("dragover", (event) => {
    if (!candidate?.paths.length) return;
    const card = (event.target as HTMLElement).closest<HTMLElement>(".studio-group-card[data-group-id]");
    if (!card) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    updateHover(card);
  }, true);

  // This module is loaded before workspace-parity, so it owns cross-group drops.
  // Stop propagation to avoid duplicate history entries from the older parity handler.
  list.addEventListener("drop", (event) => {
    if (!candidate?.paths.length) return;
    const card = (event.target as HTMLElement).closest<HTMLElement>(".studio-group-card[data-group-id]") ?? candidate.hoverCard;
    if (!card) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    finishMove(card);
    window.setTimeout(resetCandidate, 0);
  }, true);

  grid.addEventListener("dragend", () => {
    const current = candidate;
    if (!current) return;
    // Some WebKit/X11 combinations emit dragover + dragend without a usable drop.
    // The last hovered group is still an unambiguous destination, so complete it here.
    if (!current.moved && current.active && current.hoverCard) finishMove(current.hoverCard);
    window.setTimeout(resetCandidate, 0);
  }, true);

  window.addEventListener("pointermove", (event) => {
    if (!candidate) return;
    if (!candidate.active) {
      const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
      if (distance < 8) return;
      candidate.active = true;
      document.documentElement.classList.add("workspace-pointer-dragging");
    }
    updateHover(cardAt(event.clientX, event.clientY));
  }, true);

  window.addEventListener("pointerup", (event) => {
    const current = candidate;
    if (!current) return;
    const card = cardAt(event.clientX, event.clientY) ?? current.hoverCard;
    if (current.active && !current.moved && card) {
      event.preventDefault();
      event.stopPropagation();
      finishMove(card);
    }
    window.setTimeout(resetCandidate, 0);
  }, true);

  // A fallback drag can otherwise be followed by the synthetic click browsers emit
  // after mouseup, which would collapse a multi-selection.
  grid.addEventListener("click", (event) => {
    if (performance.now() > suppressClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener("blur", resetCandidate);
  return true;
}

function start(): void {
  if (install()) return;
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 200) window.clearInterval(timer);
  }, 50);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();

export {};
