import type { ExternalFetchResult, ResearchAnalysis } from "./types";

export interface ComposeEnrichedBriefInput {
  originalBrief: string | undefined;
  analysis: ResearchAnalysis | null;
  answers: Record<string, string>;
  externalContext: ExternalFetchResult;
  /**
   * Optional rendered markdown from the Atlassian context walker. When
   * non-empty, an `## Atlassian Ticket Context` section is inserted ahead
   * of `## Researcher findings`. Empty/whitespace-only values produce
   * byte-identical output to the no-Jira-context case.
   */
  jiraContextMarkdown?: string;
}

/**
 * Pure function. Builds the planner-task string with explicit named
 * sections so the planner has a clear separation between the original
 * brief, fetched external context, Atlassian ticket context, researcher
 * findings, and user answers.
 *
 * Sections (in order, only emitted if non-empty):
 *   ## Original brief
 *   ## External context
 *   ## Atlassian Ticket Context
 *   ## Researcher findings
 *   ## User answers
 */
export function composeEnrichedBrief(input: ComposeEnrichedBriefInput): string {
  const lines: string[] = [];
  const original = (input.originalBrief ?? "").trim();
  if (original.length > 0) {
    lines.push("## Original brief", original, "");
  }
  if (input.externalContext.resolved.length > 0) {
    lines.push("## External context (fetched by orchestrator)");
    for (const hit of input.externalContext.resolved) {
      const head = `### ${hit.ref.kind}:${hit.ref.id}${hit.title ? ` — ${hit.title}` : ""}`;
      lines.push(head);
      const body = hit.content.length > 4000 ? `${hit.content.slice(0, 4000)}\n…[truncated]` : hit.content;
      lines.push(body, "");
    }
  }
  const jiraMarkdown = (input.jiraContextMarkdown ?? "").trim();
  if (jiraMarkdown.length > 0) {
    lines.push("## Atlassian Ticket Context", jiraMarkdown, "");
  }
  if (input.analysis) {
    lines.push("## Researcher findings");
    if (input.analysis.knownFacts.length > 0) {
      lines.push("### Known facts");
      for (const f of input.analysis.knownFacts) lines.push(`- ${f}`);
    }
    if (input.analysis.ambiguities.length > 0) {
      lines.push("### Ambiguities");
      for (const a of input.analysis.ambiguities) lines.push(`- ${a}`);
    }
    if (input.analysis.notes && input.analysis.notes.trim().length > 0) {
      lines.push("### Notes", input.analysis.notes);
    }
    lines.push("");
  }
  const answerEntries = Object.entries(input.answers);
  if (answerEntries.length > 0 && input.analysis) {
    lines.push("## User answers");
    for (const q of input.analysis.openQuestions) {
      const a = input.answers[q.id];
      if (a !== undefined && a.trim().length > 0) {
        lines.push(`### ${q.title}`);
        lines.push(a, "");
      }
    }
  }
  return lines.join("\n").trimEnd();
}
