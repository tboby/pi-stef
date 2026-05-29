# Continuation Runbook: [Plan Title]

## Reference Files (START HERE)

Upon resumption, these files in this folder are the ONLY source of truth:

| File | Purpose | When to Use |
|------|---------|-------------|
| `continuation-runbook.md` | Full context reproduction + execution workflow | Read FIRST |
| `execution-strategy.json` | Parallel milestone/story waves, dependencies, and file-scope safety metadata | Read before choosing work order |
| `story-tracker.md` | Current progress and status | Check/update BEFORE and AFTER every story |
| `milestone-plan.md` | Complete plan with specifications | Reference implementation details |
| `original-plan.md` | Original approved plan | Reference original intent |
| `final-transcript.md` | Final planning transcript | Reference reasoning/context |

Do NOT reference planner-private files during implementation.

---

## Quick Resume Instructions

1. Read this runbook completely.
2. Check `execution-strategy.json` for parallel waves and dependencies.
3. Check `story-tracker.md`.
4. Find next `pending` story and mark as `in-dev` before starting.
5. Implement the story.
6. Update tracker immediately after each change.

---

## Mandatory Execution Workflow

Work from this folder (`ai_plan/YYYY-MM-DD-<short-title>/`) and always follow this order:

1. Read `continuation-runbook.md` first.
2. Read `execution-strategy.json`; use its milestone/story waves for safe parallel execution. If it is missing in an old plan folder, use the implement tool's sequential fallback.
3. Execute stories according to the strategy. Without parallel waves, execute milestone by milestone.
4. After completing a milestone:
   - Run lint/typecheck/tests, prioritizing changed files for speed.
   - Commit locally (**DO NOT PUSH**).
   - Stop and ask user for feedback.
5. If feedback is provided:
   - Apply feedback changes.
   - Re-run checks for changed files.
   - Commit locally again.
   - Ask for milestone approval.
6. Only move to next milestone wave after explicit approval.
7. After all milestones are completed and approved:
   - Ask permission to push.
   - If approved, push.
   - Mark plan status as `completed`.

---

## Git Note

`ai_plan/` is intentionally local and must stay gitignored. Do not treat inability to commit plan-file updates inside `ai_plan/` as an error.

---

## Full Context Reproduction

### Project Overview
[What this project/feature is about]

### User Requirements
[All gathered requirements]

### Scope
[In scope / out of scope]

### Dependencies
[External dependencies, prerequisites, related systems]

---

## Key Specifications

### Type Definitions
```typescript
// Copy-paste ready type definitions
```

### Enums & Constants
```typescript
// All enums/constants needed
```

### API Endpoints
```typescript
// Request/response shapes
```

---

## Critical Design Decisions

| Decision | Chosen Approach | Alternatives Rejected | Rationale |
|----------|-----------------|----------------------|-----------|
| [Topic] | [What we chose] | [Other options] | [Why] |

---

## Verification Commands

### Lint (changed files first)
```bash
# example: pnpm eslint <changed-file-1> <changed-file-2>
```

### Typecheck
```bash
# example: pnpm tsc --noEmit
```

### Tests (target changed scope first)
```bash
# example: pnpm test -- <related spec/file>
```

---

## File Quick Reference

| File | Purpose |
|------|---------|
| `original-plan.md` | Original approved plan |
| `final-transcript.md` | Final planning transcript |
| `milestone-plan.md` | Full specification |
| `execution-strategy.json` | Parallel-safe implementation strategy |
| `story-tracker.md` | Current progress tracker |
| `continuation-runbook.md` | This runbook |
