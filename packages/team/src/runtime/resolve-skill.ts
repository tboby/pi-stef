import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Resolve a skill name to an on-disk path. Searches, in order:
 *   1. ~/.pi/skills/<name>(/SKILL.md|.md|.yaml|/)
 *   2. <repoRoot>/skills/<name>
 *   3. any directory under <repoRoot>/skills whose SKILL.md frontmatter name matches
 *   4. <repoRoot>/packages/{*}/skills/<name>
 *   5. additional skill roots passed in `extraRoots`
 *
 * Returns the resolved absolute path on success, or `undefined` on miss.
 * The orchestrator's pre-flight check warns once per missing skill and
 * proceeds (warn-and-continue, locked decision #5).
 */
export function resolveSkillPath(
  name: string,
  opts: { homeDir?: string; repoRoot?: string; extraRoots?: string[] } = {},
): string | undefined {
  if (name.length === 0) return undefined;
  const home = opts.homeDir ?? os.homedir();
  const repoRoot = opts.repoRoot ?? process.cwd();
  const candidates: string[] = [];

  // 1) ~/.pi/skills
  candidates.push(path.join(home, ".pi", "skills", name));

  // 2) repo-local source-of-truth skills/<name>
  const repoSkillsDir = path.join(repoRoot, "skills");
  candidates.push(path.join(repoSkillsDir, name));

  // 3) packages/*/skills/<name>
  const packagesDir = path.join(repoRoot, "packages");
  if (existsSync(packagesDir)) {
    try {
      const entries = readdirSync(packagesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          candidates.push(path.join(packagesDir, entry.name, "skills", name));
        }
      }
    } catch {
      // ignore — no packages dir
    }
  }

  // 4) extra roots
  for (const root of opts.extraRoots ?? []) {
    candidates.push(path.join(root, name));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const s = statSync(candidate);
        if (s.isDirectory() || s.isFile()) return candidate;
      } catch {
        // ignore stale entries
      }
    }
  }

  // 5) Recursive Agent Skills discovery for canonical repo skill trees such as
  // skills/mobile/testing/SKILL.md whose frontmatter name is `mobile-testing`.
  for (const root of [repoSkillsDir, ...(opts.extraRoots ?? [])]) {
    const resolved = findSkillByFrontmatterName(root, name);
    if (resolved) return resolved;
  }

  return undefined;
}

function findSkillByFrontmatterName(root: string, name: string): string | undefined {
  if (!existsSync(root)) return undefined;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const skillFile = entries.find((entry) => entry.isFile() && entry.name === "SKILL.md");
    if (skillFile) {
      const skillName = readSkillName(path.join(dir, skillFile.name));
      if (skillName === name) return dir;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
    }
  }
  return undefined;
}

function readSkillName(skillPath: string): string | undefined {
  let content: string;
  try {
    content = readFileSync(skillPath, "utf8");
  } catch {
    return undefined;
  }

  const match = /^---\s*\n([\s\S]*?)\n---/.exec(content);
  if (!match) return undefined;
  const nameLine = match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("name:"));
  return nameLine?.slice("name:".length).trim().replace(/^['"]|['"]$/g, "");
}
