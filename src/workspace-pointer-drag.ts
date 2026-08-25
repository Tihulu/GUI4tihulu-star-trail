// SPDX-License-Identifier: AGPL-3.0-only

type DragCandidate = {
  startX: number;
  startY: number;
  paths: string[];
  active: boolean;
  nativeDropHandled: boolean;
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
      nativeDropHandled: false,
      hoverCard: null,
    };
  }, true);

  list.addEventListener("drop", () => {
    if (candidate) candidate.nativeDropHandled = true;
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
    const groupId = card?.dataset.groupId;
    clearHover();
    candidate = null;
    document.documentElement.classList.remove("workspace-pointer-dragging");

    if (!current.active || current.nativeDropHandled || !groupId) return;
    suppressClickUntil = performance.now() + 250;
    event.preventDefault();
    event.stopPropagation();
    void moveToGroup(current.paths, groupId);
  }, true);

  // A pointer fallback drag can otherwise be followed by the synthetic click that
  // browsers emit after mouseup, which would collapse a multi-selection.
  grid.addEventListener("click", (event) => {
    if (performance.now() > suppressClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener("blur", () => {
    clearHover();
    candidate = null;
    document.documentElement.classList.remove("workspace-pointer-dragging");
  });

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
