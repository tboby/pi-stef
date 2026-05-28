import type { ResumeBanner } from "./state";

/** Render the resume banner when the orchestrator detects in-dev stories. */
export function renderResumeBanner(banner: ResumeBanner): string[] {
  if (!banner.show) return [];
  const text = banner.text ?? "Resuming previous run — review the in-dev stories above.";
  return [`⏵ ${text}`];
}
