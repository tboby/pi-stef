# team

`@pi-stef/team` runs a small **team of role-agents** (planner, developer, reviewer, researcher) as `pi` subprocesses to drive plan / implement / task / auto / followup workflows.

Use it for larger code changes where you want a durable plan folder, reviewer-approved milestones, resumable orchestration, configurable verification gates, and optional tmux side panes.

## Installation

```bash
pi install npm:@pi-stef/team
```

## Workflows

| Workflow | Start tool | Description |
| --- | --- | --- |
| Plan only | `sf_team_plan` | Researcher → Q&A → planner-draft → reviewer loop → 5-file plan folder |
| Implement | `sf_team_implement` | Read plan → worktree → milestone lanes → reviewer → verify → commit |
| Task | `sf_team_task` | Full end-to-end single-task: plan → implement → review → verify → commit |
| Auto | `sf_team_auto` | Chains plan + implement, no human gates |
| Follow-up | `sf_team_followup` | Creates a follow-up plan against a completed plan |
| Resume | `sf_team_resume` | Resumes any interrupted workflow |
| Steer | `sf_team_steer` | Sends instructions to an active workflow |

## Quickstart

```bash
# Install
pi install npm:@pi-stef/team

# Draft a plan
sf_team_plan title="Add per-org rate limiting" brief="..."

# Implement the plan
sf_team_implement slug=2026-05-01-add-per-org-rate-limiting

# Or chain plan + implement autonomously
sf_team_auto title="Refactor auth module"

# Single-task end-to-end
sf_team_task title="Fix race in cache eviction"

# Resume an interrupted workflow
sf_team_resume resume=2026-05-06-refactor-auth
```

## Natural Language Usage

The agent understands natural-language requests:

```text
"Plan out adding per-org rate limiting with milestones and reviewer approval."
"Fix the cache eviction race: reproduce it, add a regression test, fix it, get review, and commit."
"Plan and implement adding per-org rate limiting with no human gates."
```

## Configuration

Layered global + project config, with project winning at field level:

- Global: `~/.pi/sf/team/config.json`
- Project: `<repo>/.pi/sf/team/config.json`

### Agent Models

```jsonc
{
  "agents": {
    "planner":    { "model": "claude-sonnet-4-6", "thinking": "medium" },
    "reviewer":   { "model": "claude-sonnet-4-6", "thinking": "high" },
    "developer":  { "model": "claude-sonnet-4-6", "thinking": "medium" },
    "researcher": { "model": "claude-haiku-4-5", "thinking": "low" }
  }
}
```

### Verification Policy

```jsonc
{
  "implement": {
    "verification": {
      "timing": "after",
      "mode": "commands",
      "stages": ["typecheck", "test"],
      "cache": { "mode": "run" },
      "maxAttempts": 2
    }
  }
}
```

### Headless Mode

```jsonc
{
  "workflow": { "profile": "headless" }
}
```

Disables interactive UI, tmux panes, and applies faster review defaults.

## Safety Properties

- **Reviewer subprocess isolation** — immutable argv profile
- **Universal secret scan** — enforced on every role spawn
- **Dirty-worktree guard** — baseline captured + strict staging
- **Mandatory revise callback** — findings fed back into fresh agent spawn
- **Per-folder lock** — atomic acquire via `mkdir`
- **Process-tree cleanup on abort** — SIGTERM → SIGKILL

## Full Documentation

See the [team README](https://github.com/sfiorini/pi-stef/blob/main/packages/team/README.md) for the complete reference including TDD policy, tmux integration, parallel execution, steering, and all configuration options.
