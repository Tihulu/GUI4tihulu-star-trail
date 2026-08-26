// SPDX-License-Identifier: AGPL-3.0-only
import "./main";

type Loader = () => Promise<unknown>;

async function loadFeature(name: string, loader: Loader): Promise<void> {
  try {
    await loader();
    document.documentElement.dataset[`module${name}`] = "ready";
  } catch (error) {
    console.error(`[Tihulu Studio] ${name} failed to load`, error);
    document.documentElement.dataset[`module${name}`] = "failed";
    window.dispatchEvent(new CustomEvent("tihulu:module-load-error", {
      detail: { name, message: error instanceof Error ? error.message : String(error) },
    }));
  }
}

async function bootFeatures(): Promise<void> {
  // Keep the core shell in main.ts. Everything below is isolated so one optional
  // workspace feature can never prevent branding, readiness or the other tools
  // from starting in a packaged Tauri build.
  await loadFeature("Branding", () => import("./branding"));
  await loadFeature("RenderOptions", () => import("./render-options"));
  await loadFeature("HardwareOptions", () => import("./hardware-options"));
  await loadFeature("EngineCompat", () => import("./engine-compat"));
  await loadFeature("ParameterInfo", () => import("./parameter-info"));
  await loadFeature("PhotoThumbnailManager", () => import("./photo-thumbnail-manager"));
  await loadFeature("StudioEditor", () => import("./studio-editor"));
  await loadFeature("StudioEditorSelectionSync", () => import("./studio-editor-selection-sync"));
  await loadFeature("WorkspaceImportBridge", () => import("./workspace-import-bridge"));
  // Register the unified native/pointer drop owner before the older parity helpers so
  // one physical drop creates exactly one group-history operation.
  await loadFeature("WorkspacePointerDrag", () => import("./workspace-pointer-drag"));
  await loadFeature("WorkspaceParity", () => import("./workspace-parity"));
  await loadFeature("WorkspaceFilterGuard", () => import("./workspace-filter-guard"));
  await loadFeature("WorkflowPolish", () => import("./workflow-polish"));
  await loadFeature("EngineGroupSync", () => import("./engine-group-sync"));
  await loadFeature("Readiness", () => import("./readiness"));

  document.documentElement.dataset.tihuluBootstrap = "ready";
  window.dispatchEvent(new CustomEvent("tihulu:bootstrap-ready"));
}

void bootFeatures();
