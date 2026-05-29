# Story Tracker: [Plan Title]

## Progress Summary
- **Current Milestone:** M1
- **Stories Complete:** 0/N
- **Milestones Approved:** 0/M
- **Last Updated:** YYYY-MM-DD

---

## Milestones

### M1: [Name]

| Story | Description | Status | Notes |
|-------|-------------|--------|-------|
| S-101 | [Brief description] | pending | |
| S-102 | [Brief description] | pending | |
| S-103 | [Brief description] | pending | |

**Approval Status:** pending

---

### M2: [Name]

| Story | Description | Status | Notes |
|-------|-------------|--------|-------|
| S-201 | [Brief description] | pending | |
| S-202 | [Brief description] | pending | |
| S-203 | [Brief description] | pending | |

**Approval Status:** pending

---

## Status Legend

| Status | Meaning |
|--------|---------|
| `pending` | Not started |
| `in-dev` | Currently being worked on |
| `completed` | Done - include commit hash in Notes |
| `deferred` | Postponed - include reason in Notes |

## Update Instructions (MANDATORY)

Before starting any story:
1. Check `execution-strategy.json` for the current wave and dependency/file-scope safety.
2. Mark story as `in-dev`
3. Update "Last Updated"

After completing any story:
1. Mark story as `completed`
2. Add local commit hash to Notes
3. Update "Stories Complete" and "Last Updated"

At milestone boundary:
1. Run lint/typecheck/tests for changed files
2. Commit (no push)
3. Request feedback
4. Apply feedback, re-check changed files, commit again
5. Mark milestone **Approval Status: approved** only after user confirms
6. Continue only after approval

After all milestones approved:
- Ask permission to push and then mark plan completed.
