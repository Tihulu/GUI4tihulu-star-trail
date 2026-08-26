// SPDX-License-Identifier: AGPL-3.0-only
export type HardwareMode = "auto" | "cpu" | "gpu" | "hybrid";
export type JobMode = "run" | "group" | "trail" | "timelapse";

export function normalizeHardwareMode(value: string | undefined): HardwareMode {
  return value === "cpu" || value === "gpu" || value === "hybrid" ? value : "auto";
}

export function safeOutputStem(value: string, fallback: string): string {
  const trimmed = value.trim().replace(/\.(?:jpe?g|mp4)$/i, "");
  const cleaned = trimmed.replace(/[\\/:*?"<>|]+/g, "_").replace(/^\.+$/, "").slice(0, 120);
  return cleaned || fallback;
}

export function buildOutputPath(mode: JobMode, directory: string, customName = ""): string {
  if (!directory || mode === "run" || mode === "group") return directory;
  const stem = safeOutputStem(customName, mode === "trail" ? "star_trail" : "timelapse");
  const extension = mode === "trail" ? ".jpg" : ".mp4";
  const hasWindowsSeparator = directory.includes("\\") && !directory.includes("/");
  const separator = directory.endsWith("/") || directory.endsWith("\\") ? "" : hasWindowsSeparator ? "\\" : "/";
  return `${directory}${separator}${stem}${extension}`;
}
