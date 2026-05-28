import type { MilestoneProgress } from "./state";

/**
 * Compact milestone progression strip:
 *   M0[██████]   M1[████··]   M2[······]
 *
 * Each block represents `total` stories; filled-in for completed, `~` for
 * in-dev, `·` for pending.
 */
export function renderMilestoneStrip(milestones: MilestoneProgress[]): string[] {
  if (milestones.length === 0) return ["(no milestones)"];
  return milestones.map((m) => {
    const total = Math.max(1, m.total);
    const completed = Math.max(0, Math.min(total, m.completed));
    const inDev = Math.max(0, Math.min(total - completed, m.inDev));
    const pending = total - completed - inDev;
    const bar = "█".repeat(completed) + "~".repeat(inDev) + "·".repeat(pending);
    const status = m.approvalStatus ? ` (${m.approvalStatus})` : "";
    return `${m.id}[${bar}]${status} ${m.title}`;
  });
}
