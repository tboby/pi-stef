# [Plan Title]

## Overview
- **Goal:** [One sentence describing the end state]
- **Created:** YYYY-MM-DD
- **Status:** In Progress | Complete

## Context

### Requirements
[Gathered requirements from user questions]

### Constraints
[Technical, business, or timeline constraints]

### Success Criteria
[How we know this is complete]

## Architecture

### Design Decisions
[Key architectural choices and rationale]

### Component Relationships
[How pieces fit together]

### Data Flow
[How data moves through the system]

## Milestones

### M1: [Name]
**Description:** [What this milestone achieves]

**Acceptance Criteria:**
- [ ] [Criterion 1]
- [ ] [Criterion 2]

**Stories:** S-101, S-102, S-103...

**Milestone Completion Rule (MANDATORY):**
- Run lint/typecheck/tests for changed files.
- Commit locally (DO NOT push).
- Stop and ask user for feedback.
- Apply feedback, re-check changed files, commit again.
- Move to next milestone only after user approval.

---

### M2: [Name]
**Description:** [What this milestone achieves]

**Acceptance Criteria:**
- [ ] [Criterion 1]
- [ ] [Criterion 2]

**Stories:** S-201, S-202, S-203...

**Milestone Completion Rule (MANDATORY):**
- Run lint/typecheck/tests for changed files.
- Commit locally (DO NOT push).
- Stop and ask user for feedback.
- Apply feedback, re-check changed files, commit again.
- Move to next milestone only after user approval.

---

## Execution Strategy

The generated `execution-strategy.json` mirrors this section. Use it to decide which milestone/story waves can run in parallel and which must wait for dependencies.

```json
{
  "version": 1,
  "maxParallelMilestones": 1,
  "maxParallelStoriesPerMilestone": 1,
  "milestoneWaves": [
    {
      "id": "W1",
      "milestones": ["M1"],
      "maxParallel": 1
    },
    {
      "id": "W2",
      "milestones": ["M2"],
      "dependsOn": ["W1"],
      "maxParallel": 1
    }
  ],
  "stories": {
    "M1": {
      "storyWaves": [
        {
          "id": "M1-W1",
          "stories": ["S-101"],
          "writeSets": {
            "S-101": ["path/to/file.ts"]
          }
        }
      ]
    }
  }
}
```

## Technical Specifications

### Types & Interfaces
```typescript
// Key type definitions
```

### API Contracts
```typescript
// Endpoint signatures, request/response shapes
```

### Constants & Enums
```typescript
// Shared constants
```

## Files Inventory

| File | Purpose | Milestone |
|------|---------|-----------|
| `path/to/file.ts` | [What it does] | M1 |
| `path/to/other.ts` | [What it does] | M2 |

---

## Related Plan Files

This file is part of the plan folder under `ai_plan/`:
- `original-plan.md` - Original approved plan (reference for original intent)
- `final-transcript.md` - Final planning transcript (reference for rationale/context)
- `milestone-plan.md` - This file (full specification)
- `execution-strategy.json` - Parallel-safe milestone/story waves and file-scope metadata
- `story-tracker.md` - Status tracking (must be kept up to date)
- `continuation-runbook.md` - Resume/execution context (read first)
