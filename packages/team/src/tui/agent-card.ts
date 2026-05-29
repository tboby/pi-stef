import type { AgentCard, AgentState, WidgetState } from "./state";

const ROLE_ICONS: Record<AgentCard["role"], string> = {
  planner: "📐",
  developer: "🛠 ",
  reviewer: "🔎",
  researcher: "🔬",
  "steering-decider": "🧭",
};

const STATE_GLYPHS: Record<AgentState, string> = {
  idle: "·",
  running: "▶",
  stalled: "⏸",
  completed: "✓",
  failed: "✗",
  aborted: "⊘",
};

const STATE_COLORS: Record<AgentState, string> = {
  // ANSI codes; tests verify presence of the right family.
  idle: "\x1b[90m", // grey
  running: "\x1b[36m", // cyan
  stalled: "\x1b[33m", // yellow
  completed: "\x1b[32m", // green
  failed: "\x1b[31m", // red
  aborted: "\x1b[35m", // magenta
};
const RESET = "\x1b[0m";

/**
 * Render the full set of agent cards as string[] lines suitable for
 * `pi.ui.setWidget(...)` (string-array form). Tree-indents nested spawns:
 * children of a `parentId` are listed under their parent with a `└─ ` prefix.
 */
export function renderAgentCards(state: WidgetState, opts: { now?: number; useColor?: boolean } = {}): string[] {
  const now = opts.now ?? Date.now();
  const useColor = opts.useColor ?? process.stdout.isTTY === true;

  const known = new Set(state.agents.map((a) => a.id));
  const tops = state.agents.filter((a) => !a.parentId || !known.has(a.parentId));
  const childrenByParent = new Map<string, AgentCard[]>();
  for (const a of state.agents) {
    if (a.parentId && known.has(a.parentId)) {
      const list = childrenByParent.get(a.parentId) ?? [];
      list.push(a);
      childrenByParent.set(a.parentId, list);
    }
  }

  if (state.agents.length === 0) return ["(no active agents)"];
  const lines: string[] = [];
  for (const top of tops) {
    renderSubtree(top, "", "", lines, now, useColor, childrenByParent);
  }
  return lines;
}

/**
 * `headPrefix` decorates the head line of `card` (e.g. "├─ " for a non-last
 * sibling). `continuationPrefix` decorates any line below the head — the
 * activity line on this card, AND every line of every descendant.
 */
function renderSubtree(
  card: AgentCard,
  headPrefix: string,
  continuationPrefix: string,
  lines: string[],
  now: number,
  useColor: boolean,
  childrenByParent: Map<string, AgentCard[]>,
): void {
  const block = renderOne(card, now, useColor, headPrefix);
  lines.push(block[0]);
  if (block.length > 1) {
    // The activity line indents under the continuation prefix.
    lines.push(continuationPrefix + block[1].slice(headPrefix.length));
  }
  const kids = childrenByParent.get(card.id) ?? [];
  for (let i = 0; i < kids.length; i += 1) {
    const isLast = i === kids.length - 1;
    const branch = `${continuationPrefix}${isLast ? "└─ " : "├─ "}`;
    const cont = `${continuationPrefix}${isLast ? "   " : "│  "}`;
    renderSubtree(kids[i], branch, cont, lines, now, useColor, childrenByParent);
  }
}

/**
 * Render an agent card's head line as a plain string (no ANSI colors,
 * no tree-prefix). Used by:
 *   1. The widget renderer below (which wraps it in colors + prefix).
 *   2. The tmux pane manager — pane titles must be plain text and
 *      should match exactly what the user sees in the main widget.
 *
 * Single source of truth: the widget and the tmux pane title cannot
 * drift apart because both call this same function.
 */
export function renderAgentCardTitle(card: AgentCard, now: number = Date.now()): string {
  const isTerminal =
    card.state === "completed" ||
    card.state === "failed" ||
    card.state === "aborted" ||
    card.state === "stalled";
  const endRef = isTerminal && card.endedAtMs ? card.endedAtMs : now;
  const elapsed = card.startedAtMs ? formatElapsed(endRef - card.startedAtMs) : "—";
  const glyph = STATE_GLYPHS[card.state];
  const milestoneSuffix = renderMilestoneStorySuffix(card);
  // Round display: every multi-round agent renders `· round N` when N > 1.
  // The previous "attempt" wording for non-milestone roles (planner,
  // reviewer in the plan phase) was misleading — round 2 of the
  // planner-reviewer loop is a NORMAL revise round, not a
  // failure-retry. "Attempt" implies the prior run failed; "round"
  // describes the same review-loop semantics that already work for
  // the milestone-bound developer-reviewer loop.
  let roundSuffix = "";
  const round = card.round ?? 1;
  if (round > 1) {
    roundSuffix = ` · round ${round}`;
  }
  return `${ROLE_ICONS[card.role]} ${glyph} ${card.role} (${card.model}) [${elapsed}]${milestoneSuffix}${roundSuffix}`;
}

function renderMilestoneStorySuffix(card: AgentCard): string {
  if (!card.milestoneId) return "";
  const storyLabel = card.storyId ? formatStoryLabel(card.storyId) : "";
  return ` · ${card.milestoneId}${storyLabel ? ` - ${storyLabel}` : ""}`;
}

function formatStoryLabel(storyId: string): string {
  const safe = storyId.replace(/[^A-Za-z0-9]/g, "");
  return safe || storyId.trim();
}

function renderOne(card: AgentCard, now: number, useColor: boolean, prefix: string): string[] {
  // Single source of truth: get the plain title from renderAgentCardTitle
  // (used by both the widget AND the tmux pane manager) and decorate it
  // with the tree prefix + ANSI colors at this layer. Without this, the
  // widget and tmux titles can drift apart.
  const plain = renderAgentCardTitle(card, now);
  const color = useColor ? STATE_COLORS[card.state] : "";
  const reset = useColor ? RESET : "";
  const errorBorder = useColor && (card.state === "failed" || card.state === "aborted") ? "\x1b[41m " + reset : "";
  // We re-inject color around the state glyph by surgically replacing
  // the glyph in the plain string with `<color><glyph><reset>`.
  // The plain title's shape is `<role-icon> <glyph> <role> (<model>) [<elapsed>]...`
  // so the glyph is always at index `(role-icon).length + 1`.
  const glyph = STATE_GLYPHS[card.state];
  const colored = useColor
    ? plain.replace(` ${glyph} `, ` ${color}${glyph}${reset} `)
    : plain;
  const head = `${errorBorder}${prefix}${colored}`;
  const lines = [head];
  // Activity line aligns under the head's prefix (the caller will fix
  // continuation indenting if needed for nested rendering).
  if (card.activity) lines.push(`${prefix}   ${card.activity}`);
  return lines;
}

function formatElapsed(ms: number): string {
  if (ms < 0) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m${String(r).padStart(2, "0")}s`;
}
