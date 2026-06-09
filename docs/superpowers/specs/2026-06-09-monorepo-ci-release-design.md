# Monorepo CI & Release System Design

## Overview
- **Goal:** Add a GitHub CI pipeline and interactive version bump script for the pi-stef monorepo, enabling per-package npm publishing.
- **Created:** 2026-06-09
- **Status:** In Progress

## Context

### Requirements
- Independent versioning per package (not lockstep)
- Interactive Node.js script for version bumping (single package or all packages)
- Tag-based CI trigger: push a tag → CI builds and publishes that package to npm
- Per-package CHANGELOG.md files, auto-updated on release
- Test gate: tests must pass before version bump
- 8 packages under `@pi-stef/` scope, managed with pnpm workspaces

### Constraints
- Package manager: pnpm with workspaces
- All packages currently at version 0.2.0
- No existing CI/CD configuration
- No existing `.npmrc` at root
- Packages: agent-workflows, atlassian, catalog, figma, paths, superpowers-adapter, team, web

### Success Criteria
- Developer can run `node scripts/release.mjs` and release one or all packages
- Pushing a tag like `@pi-stef/catalog@1.3.0` triggers CI to build and publish `@pi-stef/catalog` to npm
- Each package has an up-to-date CHANGELOG.md
- All tests pass before any release

## Architecture

### Design Decisions

1. **Approach: Local Release Script + Thin CI Publish**
   - Inspired by rpiv-mono's `release.mjs` and pi-depo's `publish.yml`
   - Local script handles interactive selection, version bump, changelog, test gate, commit, tag, push
   - CI workflow is thin: parse tag, build, publish, create GitHub Release

2. **Tag Format: `@pi-stef/<package>@<version>`**
   - Matches npm scoped package naming
   - Unambiguous: clearly identifies package and version
   - Parseable by regex: `^@pi-stef/([^@]+)@(.+)$`

3. **Independent Versioning**
   - Each package has its own version in its own `package.json`
   - No lockstep enforcement — packages can be at different versions
   - "All packages" mode bumps each with the same bump type but maintains independent version numbers

4. **Per-Package Changelogs**
   - Each package maintains `packages/<name>/CHANGELOG.md`
   - Format: Keep a Changelog (https://keepachangelog.com/)
   - Release script manages `[Unreleased]` → `[version] - date` transitions

5. **Raw TypeScript Publishing**
   - Packages publish raw `.ts` source files (no build/compile step)
   - `exports` field points directly to `./src/index.ts`
   - `files` field includes `src/` directory
   - CI workflow skips build step entirely

6. **Private Flag Handling**
   - Packages are developed with `"private": true` to prevent accidental publishes
   - Release script removes the `private` field when preparing a release
   - This change is committed as part of the release commit

### Component Relationships

```
scripts/release.mjs          .github/workflows/publish.yml
        │                              │
        ▼                              ▼
  Interactive menu              Triggered by tag push
        │                              │
        ▼                              ▼
  Bump package.json             Parse tag → package + version
  Remove private flag                   │
        │                              ▼
        ▼                      Verify version matches package.json
  Update CHANGELOG.md                   │
        │                              ▼
        ▼                      pnpm install
  Run tests (gate)                      │
        │                              ▼
        ▼                      pnpm publish to npm (raw TS)
  Git commit + tag                      │
        │                              ▼
        ▼                      Create GitHub Release
  Push to origin
```

### Data Flow

1. **Release script → Git:** Commits version bumps and changelog updates, creates tags
2. **Git → CI:** Tag push triggers the publish workflow
3. **CI → npm:** Workflow publishes the package to npm registry
4. **CI → GitHub:** Workflow creates a GitHub Release with changelog body

## Components

### 1. Release Script (`scripts/release.mjs`)

**Location:** `scripts/release.mjs` (ESM, Node.js)

**Dependencies:** Node.js built-ins only (`fs`, `path`, `child_process`, `readline`)

**Interactive Flow:**

1. **Package Selection**
   - Lists all packages with current versions:
     ```
     ? Select a package to release:
       1) agent-workflows (0.2.0)
       2) atlassian (0.2.0)
       3) catalog (0.2.0)
       ...
       all) Release all packages
       q) Quit
     ```
   - Accepts number, `all`, or `q`

2. **Bump Type Selection**
   - For single package: `? Bump type for catalog: major / minor / patch`
   - For all packages: `? Bump type for all packages: major / minor / patch`

3. **Pre-flight Checks**
   - Verify clean git working directory (no uncommitted changes)
   - Run `pnpm test` — abort if any test fails

4. **Version Update**
   - Read `packages/<name>/package.json`
   - Calculate new version based on bump type
   - Write updated `version` field
   - Remove `"private": true` if present (required for npm publishing)

5. **Changelog Update**
   - Read `packages/<name>/CHANGELOG.md`
   - Replace `## [Unreleased]` with:
     ```
     ## [Unreleased]

     ## [X.Y.Z] - YYYY-MM-DD
     ### Changed
     - Version bump
     ```
   - If file doesn't exist, create it with header + version section
   - If `[Unreleased]` section doesn't exist, prepend after `# Changelog`

6. **Git Operations**
   - Stage changed files: `packages/<name>/package.json`, `packages/<name>/CHANGELOG.md`
   - Commit message: `release(<pkg>): v<version>` (single package) or `release(all): v<version>` (all packages)
   - Create tag: `@pi-stef/<pkg>@<version>`
   - For `all` packages: one commit with all package changes, one tag per package

7. **Push**
   - Push commits to `origin main`
   - Push all tags to `origin`

**Error Handling:**

| Scenario | Behavior |
|---|---|
| Dirty working directory | Abort: "Commit or stash changes first" |
| Tests fail | Abort: "Tests must pass before releasing" |
| Package not found | Abort with clear message |
| Tag already exists | Abort: "Tag @pi-stef/<pkg>@<version> already exists" |
| Changelog not found | Create new changelog file |
| `[Unreleased]` missing | Prepend version section after header |

### 2. CI Workflow (`.github/workflows/publish.yml`)

**Trigger:** Push tags matching `@pi-stef/*@*`

**Permissions:** `contents: write` (for GitHub Releases), `id-token: write` (for npm provenance)

**Job: `publish`**

| Step | Action | Details |
|---|---|---|
| 1. Checkout | `actions/checkout@v4` | `fetch-depth: 0` for full history |
| 2. Parse tag | Shell script | Extract package name and version from `$GITHUB_REF_NAME` |
| 3. Verify version | Shell script | Read `packages/<name>/package.json`, compare `version` field |
| 4. Setup pnpm | `pnpm/action-setup@v4` | |
| 5. Setup Node | `actions/setup-node@v4` | `registry-url: https://registry.npmjs.org` |
| 6. Install | `pnpm install --frozen-lockfile` | |
| 7. Test | `pnpm test` | Quality gate |
| 8. Publish | `pnpm --filter @pi-stef/<name> publish --access public --no-git-checks` | Uses `NODE_AUTH_TOKEN`. Packages publish raw TypeScript (no build step). |
| 10. GitHub Release | `gh release create` | Uses changelog excerpt as body |

**Environment/Secrets:**
- `NODE_AUTH_TOKEN` — npm publish token (GitHub repository secret)

**"All packages" behavior:** When releasing all packages, the script creates one tag per package. Each tag triggers a separate CI run. The runs execute in parallel naturally.

### 3. Changelog Format

**Location:** `packages/<name>/CHANGELOG.md`

**Format:** [Keep a Changelog](https://keepachangelog.com/)

```markdown
# Changelog

## [Unreleased]

## [1.3.0] - 2026-06-09
### Changed
- Version bump

## [1.2.0] - 2026-06-01
### Added
- Initial release
```

**Sections:** `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`

**Release script behavior:**
- On release: `## [Unreleased]` → `## [X.Y.Z] - YYYY-MM-DD`
- New `## [Unreleased]` inserted above the released version
- The `### Changed` content is a placeholder — developers can add notes before running the release

## Files to Create/Modify

| File | Action | Purpose |
|---|---|---|
| `scripts/release.mjs` | Create | Interactive version bump script |
| `.github/workflows/publish.yml` | Create | CI publish workflow |
| `packages/*/CHANGELOG.md` | Create (8 files) | Per-package changelogs |
| `package.json` | Modify | Add `release` script alias |
| `packages/*/package.json` | Modify at release time | Remove `private: true`, bump version |

## Execution Rules

- Run lint/typecheck/tests after each milestone.
- Prefer linting changed files only for speed.
- Commit locally after each completed milestone (**do not push**).
- Stop and ask user for feedback.
- Apply feedback, rerun checks, and commit again.
- Move to next milestone only after user approval.
- After all milestones are completed and approved, ask permission to push.
- Only after approved push: mark plan as completed.
