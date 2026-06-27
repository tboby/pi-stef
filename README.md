# @pi-stef/catalog

Declarative package manager for the [pi](https://pi.dev) coding agent. Manage your skills and extensions from a single `cat.yaml` file in a local git repository.

## Installation

```bash
pi install npm:@pi-stef/catalog
```

## Quick Start

```bash
# 1. Initialize catalog from installed packages
/ct init

# 2. Add packages
/ct add npm:@pi-stef/team

# 3. Verify status
/ct status
```

The catalog directory (`~/.pi/sf/catalog/`) is a plain local directory. To version-control it, initialise a git repo:

```bash
git -C ~/.pi/sf/catalog init
git -C ~/.pi/sf/catalog add cat.yaml catalog.lock.json
git -C ~/.pi/sf/catalog commit -m "initial catalog"
```

## Hot-Reload

Commands that install, update, or remove packages (`add`, `update`, `remove`, `disable`) automatically reload extensions after a successful operation. This means new or updated tools are available immediately without restarting pi.

If the reload fails or is not available (e.g., when invoked via an LLM tool), you'll see a message asking you to restart pi for changes to take effect.

## Command Reference

All commands are invoked as `/ct <subcommand>` inside pi, or via the shorthand `/ct-<subcommand>`.

| Subcommand | Alias | Description | Flags |
|---|---|---|---|
| `init` | — | Initialize catalog from installed packages | — |
| `add` | `a` | Add a package to the catalog and install it | `--type=<t>`, `-s <t>`, `--scope=@pi-stef` |
| `remove` | `rm` | Remove a package from the catalog | `--yes`, `--scope=@pi-stef` |
| `toggle` | — | Toggle a package's enabled state (enabled ↔ disabled) | — |
| `enable` | — | Enable a disabled package | — |
| `disable` | — | Disable a package and uninstall it | — |
| `update` | `up` | Update packages to latest versions | `--all` |
| `status` | — | Show catalog status with package listing | — |
| `verify` | — | Verify catalog integrity | — |
| `profiles` | — | List all profiles with active indicator | — |
| `profile` | — | Show or switch active profile | — |
| `reset` | — | Uninstall all @pi-stef packages and delete config | `--yes` |

### Adding Packages

```bash
# Add from a git source (name auto-derived)
/ct add git:github.com/user/repo#packages/my-skill

# Add an npm package
/ct add npm:lodash

# Add all @pi-stef packages at once
/ct add --scope=@pi-stef
```

### Removing Packages

```bash
/ct remove my-skill
/ct remove --scope=@pi-stef
```

### Enabling and Disabling

```bash
/ct enable my-skill      # Enable a disabled package
/ct disable my-skill     # Disable a package (uninstalls it)
/ct toggle my-skill      # Toggle enabled ↔ disabled
```

## `cat.yaml` Format

The catalog is stored in `cat.yaml`. Example:

```yaml
meta:
  pi_version: "0.70.0"
  activeProfile: default

packages:
  pair:
    source: "git:github.com/sfiorini/pi-stef#packages/pair"
    type: skill
  team:
    source: "git:github.com/sfiorini/pi-stef#packages/team"
    type: skill
  atlassian:
    source: "git:github.com/sfiorini/pi-stef#packages/atlassian"
    type: skill
    enabled: false
```

### Package Fields

| Field | Required | Description |
|---|---|---|
| `source` | ✓ | Package source URL (`npm:…` or `git:…`) |
| `type` | — | `skill` or `pi-native` |
| `profile` | — | Profile name this package belongs to |
| `enabled` | — | `true` (default) or `false` |
| `companions` | — | Array of companion source strings to auto-install |

### Companions

A package can declare required companion packages in its own `package.json`:

```json
{
  "pi": {
    "companions": ["git:github.com/obra/superpowers"]
  }
}
```

When `ct add` installs such a package, it also installs each companion that
isn't already installed. Companions resolve transitively (a companion may
declare its own companions) up to a depth of 3, with de-duplication so each
source installs at most once.

### Examples

**NPM source:**
```yaml
packages:
  lodash:
    source: "npm:lodash"
```

**Git source:**
```yaml
packages:
  my-extension:
    source: "git:github.com/user/repo#packages/my-extension"
    type: pi-native
```

## Setup Detection

Packages can include a `.pi-setup.json` file declaring requirements (environment variables, config files, CLI tools). After install or update, the catalog checks these requirements and warns if anything is missing.

```json
{
  "env": ["API_TOKEN"],
  "files": ["config.json"],
  "cli": ["docker"]
}
```

## Profiles

Profiles let you maintain different package sets for different machines or contexts (e.g., work vs. personal).

```yaml
meta:
  pi_version: "0.70.0"
  activeProfile: work

packages:
  pair:
    source: "git:github.com/sfiorini/pi-stef#packages/pair"

profiles:
  work:
    packages:
      atlassian:
        source: "git:github.com/sfiorini/pi-stef#packages/atlassian"
  personal:
    packages:
      figma:
        source: "git:github.com/sfiorini/pi-stef#packages/figma"
```

**Profile commands:**
- `/ct profiles` — list all profiles (shows active with a marker)
- `/ct profile <name>` — switch active profile

The `default` profile always exists and uses the base `packages` section. Profile packages override base packages with the same key.

## Configuration

### File Locations

| File | Path | Purpose |
|---|---|---|
| Catalog | `~/.pi/sf/catalog/cat.yaml` | Declarative package manifest |
| Lock file | `~/.pi/sf/catalog/catalog.lock.json` | Installed versions and hashes |

## Development

```bash
pnpm install          # Install dependencies
pnpm -F @pi-stef/catalog test    # Run tests
pnpm -F @pi-stef/catalog typecheck  # Type check
```

## License

MIT
