/**
 * Parse a reviewer's verdict text into a structured report.
 *
 * Verdict contract (locked):
 *   ## Summary
 *   ## Findings
 *   ### P0 | ### P1 | ### P2 | ### P3
 *   ## Verdict
 *   VERDICT: APPROVED | VERDICT: REVISE
 *
 * `- None.` (with the trailing dot) is the canonical empty marker for a
 * severity. Verdict parsing reads the LAST `VERDICT: <X>` line in the text so
 * a payload that quotes the words won't poison the result.
 */

export type VerdictDecision = "APPROVED" | "REVISE" | "UNKNOWN";

export interface FindingsBySeverity {
  P0: string[];
  P1: string[];
  P2: string[];
  P3: string[];
}

export interface ReviewerVerdict {
  summary: string;
  findings: FindingsBySeverity;
  verdict: VerdictDecision;
}

// Match through end-of-line so qualifiers like `### P2 (must fix)` don't
// leak into findings.
const SEV_HEADERS: { name: keyof FindingsBySeverity; pattern: RegExp }[] = [
  { name: "P0", pattern: /^###\s*P0\b[^\n]*$/im },
  { name: "P1", pattern: /^###\s*P1\b[^\n]*$/im },
  { name: "P2", pattern: /^###\s*P2\b[^\n]*$/im },
  { name: "P3", pattern: /^###\s*P3\b[^\n]*$/im },
];

export function parseReviewerVerdict(text: string): ReviewerVerdict {
  const findings: FindingsBySeverity = { P0: [], P1: [], P2: [], P3: [] };
  // Track which strict severity headers were actually present (regardless
  // of whether their bodies had real findings or `- None.`). An explicit
  // strict `### P2\n- None.` MUST beat any fuzzy `### Required revisions`
  // appendix — otherwise a quoted/example revisions block elsewhere in
  // the text could override an explicit "no P2" decision.
  const strictPresent: Record<keyof FindingsBySeverity, boolean> = { P0: false, P1: false, P2: false, P3: false };
  const summary = sectionBody(text, /^##\s*Summary\s*$/im, /^##\s*Findings\s*$/im).trim();

  // Findings block: bounded by ## Findings and ## Verdict (or end-of-text).
  const findingsBlock = sectionBody(text, /^##\s*Findings\s*$/im, /^##\s*Verdict\s*$/im);

  // Strict pass: P0 / P1 / P2 / P3 sections inside ## Findings.
  for (let i = 0; i < SEV_HEADERS.length; i += 1) {
    const head = SEV_HEADERS[i];
    if (head.pattern.test(findingsBlock)) {
      strictPresent[head.name] = true;
      const next = SEV_HEADERS[i + 1];
      const sub = sectionBody(findingsBlock, head.pattern, next?.pattern);
      findings[head.name] = parseFindingItems(sub);
    }
  }

  let verdict = extractVerdict(text);

  // Fuzzy fallback ALWAYS runs — a reviewer can emit `VERDICT: APPROVED`
  // AND a free-form `### Required revisions` outside `## Findings`. We
  // merge fuzzy hits into severities the strict pass DIDN'T explicitly
  // emit. Strict `- None.` (presence with no items) blocks fuzzy from
  // overriding.
  const fuzzy = parseFuzzyVerdict(text);
  if (fuzzy) {
    if (verdict === "UNKNOWN") verdict = fuzzy.verdict;
    if (!strictPresent.P2 && fuzzy.findings.P2.length > 0) findings.P2 = fuzzy.findings.P2;
    if (!strictPresent.P3 && fuzzy.findings.P3.length > 0) findings.P3 = fuzzy.findings.P3;
  }

  return { summary, findings, verdict };
}

function sectionBody(text: string, start: RegExp, end?: RegExp): string {
  const startMatch = start.exec(text);
  if (!startMatch) return "";
  const after = startMatch.index + startMatch[0].length;
  if (!end) return text.slice(after);
  const tail = text.slice(after);
  const endMatch = end.exec(tail);
  if (!endMatch) return tail;
  return tail.slice(0, endMatch.index);
}

function parseFindingItems(block: string): string[] {
  const lines = block.split("\n");
  const items: string[] = [];
  let current: string | undefined;
  let sawNoneMarker = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // Stop at any markdown heading — defensive in case sectionBody passed
    // through a later severity header (e.g. partial sections where the
    // intermediate "### P1" or "### P2" was missing).
    if (/^#{1,6}\s/.test(trimmed)) break;
    if (/^- None\.?$/i.test(trimmed)) {
      sawNoneMarker = true;
      continue;
    }
    // Accept either bullet (`- foo`) or numbered (`1. foo` / `2) foo`) list items.
    const bullet = trimmed.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      if (current !== undefined) items.push(current.trim());
      current = bullet[1];
    } else if (current !== undefined) {
      current += `\n${trimmed}`;
    } else {
      items.push(trimmed);
    }
  }
  if (current !== undefined) items.push(current.trim());
  // `- None.` is canonical empty marker — but ONLY when it is the sole content
  // of the block. If the reviewer also listed real findings, those wins.
  if (sawNoneMarker && items.length === 0) return [];
  return items;
}

export function extractVerdict(text: string): VerdictDecision {
  const upper = text.toUpperCase();
  const matches = [...upper.matchAll(/VERDICT:\s*(APPROVED|REVISE)/g)];
  if (matches.length === 0) return "UNKNOWN";
  return matches[matches.length - 1][1] as VerdictDecision;
}

/**
 * Fallback parser for reviewers that ignore our `### P0/P1/P2/P3` template
 * and produce free-form output. Recognizes:
 *
 *   - "Verdict: Approve" / "Verdict: Reject" / "Verdict: Revise" intent in
 *     a `## Verdict` heading or a verdict-prefixed line, even with markdown
 *     emphasis (`**Approve with minor revisions**`).
 *   - `### Required revisions` (or "Required changes" / "Must fix" / "Blockers")
 *     → P2 findings.
 *   - `### Optional improvements` (or "Nice to have" / "Suggestions" /
 *     "Recommendations") → P3 findings.
 *
 * Returns null when the text is too sparse to reliably interpret.
 */
// Headers that map to P2 (must-fix). Match through end-of-line so qualifiers
// like `(small)` are consumed and don't leak into the findings body.
const FUZZY_P2_HEADER = /^#{1,6}\s*(?:Required revisions|Required changes|Required fixes|Must[- ]fix(?:es)?|Blockers?)[^\n]*$/gim;
const FUZZY_P3_HEADER = /^#{1,6}\s*(?:Optional improvements|Nice[- ]to[- ]have|Suggestions?|Recommendations?)[^\n]*$/gim;

export function parseFuzzyVerdict(text: string): { verdict: VerdictDecision; findings: FindingsBySeverity } | null {
  const verdict = extractFuzzyVerdict(text);
  // Merge ALL matching sections. A reviewer that emits
  //   ### Required fixes
  //   - foo
  //   ### Blockers
  //   - bar
  // produces P2 = [foo, bar]. Codex P1: previously only the FIRST match
  // was parsed — if the first section was empty (`- None.`) and a later
  // section had real findings, those got dropped silently.
  const p2 = collectFuzzySections(text, FUZZY_P2_HEADER);
  const p3 = collectFuzzySections(text, FUZZY_P3_HEADER);

  // If neither verdict signal nor a recognizable severity section exists,
  // give up rather than hallucinate.
  if (verdict === "UNKNOWN" && p2.length === 0 && p3.length === 0) return null;

  return {
    verdict,
    findings: { P0: [], P1: [], P2: p2, P3: p3 },
  };
}

function collectFuzzySections(text: string, headerRe: RegExp): string[] {
  // Reset lastIndex so reuse across calls is safe.
  headerRe.lastIndex = 0;
  const stopHeader = /\n#{1,6}\s+\S/;
  const items: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(text)) !== null) {
    const after = m.index + m[0].length;
    const tail = text.slice(after);
    const stop = stopHeader.exec(tail);
    const body = stop ? tail.slice(0, stop.index) : tail;
    items.push(...parseFindingItems(body));
  }
  return items;
}

function extractFuzzyVerdict(text: string): VerdictDecision {
  // Find any line under a verdict-like heading or starting with "Verdict:".
  const verdictLineMatch =
    text.match(/^##?\s*Verdict\s*:?\s*(.*)$/im) ??
    text.match(/^Verdict\s*:\s*(.*)$/im) ??
    text.match(/\*\*Bottom line[:.]?\*\*\s*(.*)$/im);
  if (!verdictLineMatch) return "UNKNOWN";
  const body = verdictLineMatch[1].toLowerCase();

  // 1. Hard REVISE signals (explicit rejection words).
  if (/\b(reject|block|cannot (?:approve|ship)|do not (?:approve|ship)|revise|needs (?:rework|revisions?|changes?|fixes?))\b/.test(body)) return "REVISE";

  // 2. Negated approval — `not approved`, `can't approve`, `should not ship`,
  // `don't approve`, `not yet ready to ship`, `doesn't look good`, etc.
  // Must run BEFORE the approval-token branch so a negated phrase isn't
  // misread as approval. Two patterns: bare negation words, and auxiliary
  // contractions ("don't", "isn't", etc.).
  const APPROVE_TOKEN = /(?:approve(?:d|s)?|approving|ship(?:\s+it)?|lgtm|looks?\s+good)/.source;
  const negBare = new RegExp(`\\b(?:not|never|nothing)\\s+(?:yet\\s+)?(?:ready\\s+to\\s+)?${APPROVE_TOKEN}\\b`);
  const negAux = new RegExp(`\\b(?:cannot|can(?:'|’)?t|won(?:'|’)?t|wouldn(?:'|’)?t|shouldn(?:'|’)?t|don(?:'|’)?t|doesn(?:'|’)?t|isn(?:'|’)?t|aren(?:'|’)?t)\\s+(?:yet\\s+)?(?:ready\\s+to\\s+)?${APPROVE_TOKEN}\\b`);
  if (negBare.test(body) || negAux.test(body)) return "REVISE";

  // 3. Approval-intent tokens.
  const approvalRe = /\b(approve(?:d|s)?|approving|ship\s+it|lgtm|looks good)\b/;
  if (!approvalRe.test(body)) return "UNKNOWN";

  // 4. CONDITIONAL approval = REVISE. We check the whole verdict line for a
  // conditional qualifier, but back off when the qualifier is preceded by a
  // negation ("no pending", "without revisions", "without changes") — those
  // are AFFIRMATIONS that there's nothing pending, not conditions on
  // approval.
  //
  // Why not clause-split: "Approve, contingent on lint cleanup" looks like
  // two clauses on the comma but is genuinely conditional. Negation-aware
  // matching is more reliable than clause boundaries.
  const conditionalRe = /\b(with (?:minor )?(?:revisions?|changes?|fixes?|nits?)|after|once|if|contingent|subject\s+to|provided|pending|when)\b/g;
  const conditionalMatches = [...body.matchAll(conditionalRe)];
  for (const m of conditionalMatches) {
    // Look back ~25 chars from the match to see if it's negated.
    const back = body.slice(Math.max(0, m.index! - 25), m.index!);
    if (/\b(no|without|nothing)\s+\w*\s*$/.test(back) || /\b(no|without|nothing)\s*$/.test(back)) {
      continue; // negated → benign
    }
    return "REVISE";
  }

  return "APPROVED";
}

/**
 * Returns true when a verdict can be considered APPROVED — i.e. the trailing
 * decision is APPROVED AND no P0/P1/P2 findings remain. P3 findings are
 * non-blocking. Used by `runReviewLoop` to decide whether to terminate.
 */
export function isApproved(verdict: ReviewerVerdict): boolean {
  if (verdict.verdict !== "APPROVED") return false;
  return verdict.findings.P0.length === 0 && verdict.findings.P1.length === 0 && verdict.findings.P2.length === 0;
}
