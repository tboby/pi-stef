import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Value } from "@sinclair/typebox/value";

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

import { PLAN_FOLDER_ROOT, planFolderPathFromRoot } from "../plan/paths";
import type { AgentRun, AgentTask, TeamMember } from "../runtime/types";
import type { ExternalFetchResult, ResearchAnalysis, ResearchExternalContext, ResearchOpenQuestion } from "./types";
import { normalizeAnalysisFields, normalizeExternalEntry, ResearchAnalysisSchema, type ResearchAnalysisFromSchema } from "./schema";

export interface RunResearcherOptions {
  prompt: string;
  externalContext: ExternalFetchResult;
  researcher: TeamMember;
  jiraContextMarkdown?: string;
  /**
   * `widgetAgentId` is forwarded to the orchestrator's `subscribeAgent`.
   * Researcher invocations leave it `undefined` so both rounds share the
   * default `researcher` widget id and the card consolidates: the
   * existing card flips back to `▶ running` with `· round 2` in the
   * title on the rejection retry, instead of stacking a second
   * researcher row in the panel. The arg stays in the signature so test
   * doubles and any future role-specific override remain expressible.
   */
  spawn: (member: TeamMember, task: AgentTask, widgetAgentId?: string) => Promise<AgentRun>;
  ui?: Pick<ExtensionUIContext, "notify">;
  signal?: AbortSignal;
  /**
   * When provided, rejected researcher payloads (raw text + extracted JSON +
   * schema-error list) are written to `ai_plan/<slug>/researcher-rejected-N.md`
   * so the user can post-mortem why validation failed.
   */
  diagnosticsContext?: { repoRoot: string; slug: string };
}

/**
 * Spawn the researcher subprocess, parse its JSON output, validate against
 * the schema. One retry is allowed on validation failure, after which we
 * return `null` and surface a warning via `ui.notify` so the user knows
 * the analysis-driven Q&A path was skipped.
 *
 * Unresolved external refs are merged into the returned `openQuestions`
 * as kind="input" titled "Paste content of <ref>?" so the user has a
 * fallback path even when the researcher itself fails.
 */
export async function runResearcher(opts: RunResearcherOptions): Promise<ResearchAnalysis | null> {
  const buildTask = (round: 1 | 2): string => {
    const lines: string[] = [];
    if (round === 2) {
      lines.push(
        "PREVIOUS ATTEMPT INVALID. You MUST return ONLY a JSON object matching the schema below — no prose, no markdown fences, just the raw JSON object.",
        "",
      );
    }
    lines.push("RETURN ONLY A SINGLE JSON OBJECT. No prose. No markdown fences. No preamble. Just the raw JSON.");
    lines.push("");
    lines.push("EXACT SHAPE:");
    lines.push('{');
    lines.push('  "knownFacts":     [{ "id": "stable-slug", "summary": "what you established" }, ...],');
    lines.push('  "ambiguities":    [{ "id": "stable-slug", "summary": "what is unclear" }, ...],');
    lines.push('  "openQuestions":  [{ "id": "stable-slug", "kind": "input"|"select", "title": "?", "options": ["..."]?, "optional": true? }, ...],');
    lines.push('  "external":       [{ "url": "...", "summary": "..." }, ...],');
    lines.push('  "notes":          "optional free-form for the planner"');
    lines.push('}');
    lines.push("");
    lines.push("FIELD NAMES MATTER. Use `summary` (not `fact` / `ambiguity` / `description` / `text`) inside knownFacts and ambiguities entries. Use `kind` exactly \"input\" or \"select\". `options` is required when kind=\"select\" and forbidden when kind=\"input\".");
    lines.push("Questions are required by default. Set `optional: true` only for kind=\"input\" questions where proceeding without an answer is acceptable.");
    lines.push('Example optional input question: { "id": "extra-context", "kind": "input", "title": "Anything else?", "optional": true }.');
    lines.push("Never include \"Other (describe)\" in `options`; the orchestrator adds that inline-entry option when presenting select questions to the user.");
    lines.push("");
    lines.push("YOUR JOB: read the user's prompt + external context, scan the repo with your read-only tools (read, grep, find, ls), and produce the JSON. knownFacts = what you established. ambiguities = what you noticed but couldn't resolve. openQuestions = questions whose answers materially affect the planner.");
    lines.push("");
    lines.push("USER PROMPT:");
    lines.push(opts.prompt);
    const jiraMarkdown = (opts.jiraContextMarkdown ?? "").trim();
    if (jiraMarkdown.length > 0) {
      lines.push("");
      lines.push("## Atlassian Ticket Context");
      lines.push("This context was already fetched by the orchestrator; treat it as authoritative.");
      lines.push("Do not fetch Jira or Atlassian again for these ticket details. Use this context plus read-only repo tools to produce deeper implementation research.");
      lines.push(jiraMarkdown.length > 4000 ? `${jiraMarkdown.slice(0, 4000)}\n...[truncated]` : jiraMarkdown);
    }
    if (opts.externalContext.resolved.length > 0) {
      lines.push("");
      lines.push("EXTERNAL CONTEXT (resolved by orchestrator):");
      for (const hit of opts.externalContext.resolved) {
        lines.push(`- ${hit.ref.kind}:${hit.ref.id}${hit.title ? ` — ${hit.title}` : ""}`);
        const trimmed = hit.content.length > 4000 ? `${hit.content.slice(0, 4000)}\n…[truncated]` : hit.content;
        lines.push(trimmed);
      }
    }
    if (opts.externalContext.unresolved.length > 0) {
      lines.push("");
      lines.push("UNRESOLVED REFERENCES (orchestrator could not fetch — please add as openQuestions of kind=\"input\" titled \"Paste content of <ref>?\"):");
      for (const miss of opts.externalContext.unresolved) {
        lines.push(`- ${miss.ref.kind}:${miss.ref.id} — ${miss.reason}`);
      }
    }
    return lines.join("\n");
  };

  for (const round of [1, 2] as const) {
    const task: AgentTask = { task: buildTask(round), signal: opts.signal };
    // Both rounds share the default `researcher` widget id so the card
    // consolidates: when round 1 is rejected and round 2 spawns, the
    // existing card flips back to `▶ running` with `· round 2` in the
    // title (rendered by agent-card.ts) instead of stacking a second
    // researcher row in the panel. The unambiguous `· round 2` indicator
    // tells the user this is a retry — researcher does not participate
    // in review loops, so round semantics here are always failure-retry.
    const run = await opts.spawn(opts.researcher, task);
    if (run.state !== "completed" || run.finalText.trim().length === 0) {
      await persistRejection(opts.diagnosticsContext, round, {
        rawText: run.finalText,
        parsed: undefined,
        reason: `agent run state=${run.state}${run.reason ? ` (${run.reason})` : ""}; finalText length=${run.finalText.trim().length}`,
        errors: [],
      });
      continue;
    }
    const parsed = parseLooseJson(run.finalText);
    if (!parsed) {
      await persistRejection(opts.diagnosticsContext, round, {
        rawText: run.finalText,
        parsed: undefined,
        reason: "no parseable JSON object found in agent output (looked for {…} substring; markdown fences stripped)",
        errors: [],
      });
      continue;
    }
    if (Value.Check(ResearchAnalysisSchema, parsed)) {
      const validated = parsed as ResearchAnalysisFromSchema;
      const { knownFacts, ambiguities } = normalizeAnalysisFields(validated);
      const normalized: ResearchAnalysis = {
        knownFacts,
        ambiguities,
        openQuestions: validated.openQuestions,
        external: validated.external.map(normalizeExternalEntry) as ResearchExternalContext[],
        notes: validated.notes,
      };
      return mergeUnresolvedAsQuestions(normalized, opts.externalContext);
    }
    // Parsed as JSON but failed schema. Capture which fields rejected it.
    const errors = collectSchemaErrors(parsed);
    await persistRejection(opts.diagnosticsContext, round, {
      rawText: run.finalText,
      parsed,
      reason: `schema validation rejected ${errors.length} field(s)`,
      errors,
    });
  }

  // Both rounds failed validation — fall back gracefully.
  if (opts.ui?.notify) {
    let diagPath = "";
    if (opts.diagnosticsContext) {
      const planRoot = path.join(opts.diagnosticsContext.repoRoot, PLAN_FOLDER_ROOT); // migration-allowed: legacy
      diagPath = ` See ${planFolderPathFromRoot(planRoot, opts.diagnosticsContext.slug)}/researcher-rejected-{1,2}.md for the raw output.`;
    }
    opts.ui.notify(
      `researcher fallback engaged: validation failed twice; proceeding without analysis-driven Q&A.${diagPath}`,
      "warning",
    );
  }
  return null;
}

interface SchemaError {
  path: string;
  message: string;
  receivedValue: string;
}

function collectSchemaErrors(parsed: unknown): SchemaError[] {
  const errors: SchemaError[] = [];
  // TypeBox 1.x's union of error variants doesn't expose `path`/`value`
  // uniformly at the type level, but the runtime fields are present. We
  // index defensively so a future TypeBox shape change doesn't crash.
  for (const e of Value.Errors(ResearchAnalysisSchema, parsed)) {
    const rec = e as unknown as Record<string, unknown>;
    const errPath = typeof rec.path === "string" ? rec.path : "";
    const errMsg = typeof rec.message === "string" ? rec.message : "(no message)";
    errors.push({
      path: errPath || "(root)",
      message: errMsg,
      receivedValue: previewValue(rec.value),
    });
    if (errors.length >= 50) break; // cap so a runaway error list can't blow up the file
  }
  return errors;
}

function previewValue(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch (_err) {
    return String(v);
  }
}

async function persistRejection(
  ctx: { repoRoot: string; slug: string } | undefined,
  round: 1 | 2,
  detail: { rawText: string; parsed: unknown | undefined; reason: string; errors: SchemaError[] },
): Promise<void> {
  if (!ctx) return;
  const planRoot = path.join(ctx.repoRoot, PLAN_FOLDER_ROOT); // migration-allowed: legacy
  const folder = planFolderPathFromRoot(planRoot, ctx.slug);
  const file = path.join(folder, `researcher-rejected-${round}.md`);
  const lines: string[] = [
    `# researcher-rejected-${round}`,
    "",
    `## Reason`,
    detail.reason,
    "",
  ];
  if (detail.errors.length > 0) {
    lines.push("## Schema errors");
    for (const e of detail.errors) {
      lines.push(`- **${e.path}** — ${e.message} (got: ${e.receivedValue})`);
    }
    lines.push("");
  }
  if (detail.parsed !== undefined) {
    lines.push("## Extracted JSON");
    lines.push("```json");
    try {
      lines.push(JSON.stringify(detail.parsed, null, 2));
    } catch (_err) {
      lines.push(String(detail.parsed));
    }
    lines.push("```");
    lines.push("");
  }
  lines.push("## Raw agent output");
  lines.push("```");
  lines.push(detail.rawText);
  lines.push("```");
  try {
    await mkdir(folder, { recursive: true });
    await writeFile(file, lines.join("\n"), "utf8");
  } catch (_err) {
    // best-effort; missing diagnostics shouldn't break the run
  }
}

/**
 * Append unresolved external refs as openQuestions so the user can paste
 * content manually even when the researcher itself worked.
 */
function mergeUnresolvedAsQuestions(
  analysis: ResearchAnalysis,
  ext: ExternalFetchResult,
): ResearchAnalysis {
  const have = new Set(analysis.openQuestions.map((q) => q.id));
  const extras: ResearchOpenQuestion[] = [];
  for (const miss of ext.unresolved) {
    const id = `ext:${miss.ref.kind}:${miss.ref.id}`;
    if (have.has(id)) continue;
    extras.push({
      id,
      kind: "input",
      title: `Paste content of ${miss.ref.kind}:${miss.ref.id}? (orchestrator couldn't fetch — ${miss.reason})`,
    });
  }
  if (extras.length === 0) return analysis;
  return { ...analysis, openQuestions: [...analysis.openQuestions, ...extras] };
}

/**
 * Tolerant JSON parser: strips ```json fences, leading prose, trailing
 * commentary. Returns the parsed value or null on failure.
 */
function parseLooseJson(text: string): unknown {
  const trimmed = text.trim();
  // Strip a markdown code fence if present.
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  // Find the first '{' and the matching last '}' (greedy slice).
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  const slice = candidate.slice(first, last + 1);
  try {
    return JSON.parse(slice);
  } catch (_err) {
    return null;
  }
}
