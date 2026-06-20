# Task Plan: [Short Title]

> **Variant guardrail (Pi):** When generating or updating this file, the agent MUST be out of plan mode. Sub-skills (`brainstorming`, `test-driven-development`, `verification-before-completion`) are loaded by the spawned developer via the native `--skill` flag — no shell wrappers. The orchestrator owns the commit (and worktree creation when applicable); the developer must not run `git commit` itself.

## Metadata

| Field | Value |
|-------|-------|
| Created | YYYY-MM-DD |
| Slug | YYYY-MM-DD-<slug> |
| Runtime | pi |
| Reviewer CLI | pi |
| Reviewer Model | <model> |
| MAX_ROUNDS | 10 |
| Branch Strategy | current-branch \| worktree |
| Branch Name | <current branch name, or new branch name when worktree is used> |
| Worktree Path | <absolute path to worktree dir; blank when Branch Strategy = current-branch> |
| Status | draft |

### Status Enum (authoritative)

| Value | Meaning |
|-------|---------|
| `draft` | Newly created; plan review not yet started |
| `plan-approved` | Plan review loop returned APPROVED |
| `implementation-in-progress` | Phase 6 executing |
| `implementation-approved` | Phase 8 review loop returned APPROVED; awaiting commit |
| `pushed` | Committed + pushed to remote |
| `local-only` | Committed locally; user declined push |
| `aborted-plan-review` | MAX_ROUNDS reached in Phase 5; user aborted |
| `aborted-impl-review` | MAX_ROUNDS reached in Phase 8; user aborted |
| `aborted-verification` | Phase 7 retries exhausted; user aborted |
| `failed` | Hard tooling failure |

---

## Prompt

<!-- Exact user prompt, verbatim. -->

## Interpretation

<!-- Short restatement of goal + out-of-scope items. -->

## Assumptions

<!-- Anything we're assuming and needs confirmation. Empty list OK after clarifying questions. -->

## Files

<!-- Files expected to be created / modified / deleted. Paths are absolute or repo-relative. -->

| Action | Path | Why |
|--------|------|-----|
|        |      |     |

## Approach

<!-- 3-10 bullets describing implementation order. -->

## TDD Approach

<!-- One of:
  (a) **TDD applies** — list the failing test(s) to write first, then implementation, then confirm green.
  (b) **TDD auto-skipped** — reason must be exactly one of:
      - `pure-documentation`
      - `pure-comment-whitespace-rename`
  (c) **TDD user-approved skip** — user explicitly approved skipping TDD for this task.
      Record the approval timestamp (ISO-8601) and the specific reason (e.g., `pure-config-addition`).
-->

## Acceptance Criteria

- [ ] <criterion 1>
- [ ] <criterion 2>

## Verification

<!-- Commands to run:
  lint: <cmd>
  typecheck: <cmd>
  tests: <cmd>
-->

## Rollback

<!-- How to undo: `git revert <hash>`, or manual steps if the change is not easily revertable. -->

---

## Runtime State

<!-- Updated by the skill at runtime. Used to detect resume and to persist reviewer session IDs across rounds. -->

```yaml
plan_review_round: 0
implementation_review_round: 0
PI_PLAN_SESSION_ID:
PI_IMPL_SESSION_ID:
last_phase_entered:
last_round_ts:
last_scan_outcome_plan:
last_scan_outcome_impl:
verification_attempts: 0
tests_added_count: 0
tdd_used: false
```

## Review History

<!-- Append one entry per reviewer round, both loops. -->

| Timestamp (ISO-8601) | Loop | Round | Verdict | Summary |
|----------------------|------|-------|---------|---------|
|                      |      |       |         |         |

## Final Status

<!-- Filled at the terminal outcome (phase 9/10). Populate at least:
  - Terminal status (one of the 10 Status enum values)
  - Commit hash (if any)
  - Plan-review rounds used / MAX_ROUNDS
  - Implementation-review rounds used / MAX_ROUNDS
  - TDD used (true|false)
  - Tests added count
  - Verification attempts used
  - Last round ISO-8601 timestamp
  - Notes (anything the user should know when revisiting)
-->


---

## Guardrails (do NOT remove)

- This file is the single persistent artifact for `do-task`. Do not split it or delete it on success.
- `Status` must always match one of the 10 enum values.
- `Runtime State` is updated by the skill, not by the user.
- Review History is append-only.
- `last_scan_outcome_plan` and `last_scan_outcome_impl` record the most recent secret-scan result for each loop. They are informational; the scan itself runs per-payload with no caching.
