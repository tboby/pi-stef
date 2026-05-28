import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { VerificationCommand, VerificationPhase } from "./config";

const PACKAGE_MANAGER_INPUTS = [
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  ".pnp.cjs",
  ".pnp.loader.mjs",
  ".yarn/install-state.gz",
  "node_modules/.modules.yaml",
  "node_modules/.package-lock.json",
] as const;

export interface VerificationFingerprintInput {
  cwd: string;
  toolName: string;
  phase: VerificationPhase;
  commands: VerificationCommand[];
}

export function fingerprintVerificationInputs(input: VerificationFingerprintInput): string {
  const hash = createHash("sha256");
  addJson(hash, {
    version: 1,
    cwd: path.resolve(input.cwd),
    toolName: input.toolName,
    phase: input.phase,
    commands: input.commands.map((command) => ({
      label: command.label,
      cmd: command.cmd,
      args: command.args,
      script: command.script,
    })),
  });

  for (const rel of PACKAGE_MANAGER_INPUTS) {
    addFileIfPresent(hash, input.cwd, rel);
  }

  addGitSignal(hash, input.cwd, "HEAD", ["rev-parse", "HEAD"]);
  addGitSignal(hash, input.cwd, "status", ["status", "--porcelain=v1"]);
  addGitSignal(hash, input.cwd, "diff", ["diff", "--no-ext-diff", "--binary"]);
  addGitSignal(hash, input.cwd, "diff-cached", ["diff", "--cached", "--no-ext-diff", "--binary"]);
  addUntrackedFiles(hash, input.cwd);
  return hash.digest("hex");
}

function addJson(hash: ReturnType<typeof createHash>, value: unknown): void {
  hash.update(JSON.stringify(value));
  hash.update("\0");
}

function addFileIfPresent(hash: ReturnType<typeof createHash>, cwd: string, rel: string): void {
  const abs = path.join(cwd, rel);
  if (!existsSync(abs)) return;
  hash.update(`file:${rel}\0`);
  hash.update(readFileSync(abs));
  hash.update("\0");
}

function addGitSignal(hash: ReturnType<typeof createHash>, cwd: string, label: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 25 * 1024 * 1024,
  });
  if (result.status !== 0) return;
  hash.update(`git:${label}\0`);
  hash.update(result.stdout);
  hash.update("\0");
}

function addUntrackedFiles(hash: ReturnType<typeof createHash>, cwd: string): void {
  const result = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd,
    encoding: "buffer",
    maxBuffer: 25 * 1024 * 1024,
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) return;
  for (const rel of result.stdout.toString("utf8").split("\0").filter(Boolean)) {
    const abs = path.join(cwd, rel);
    try {
      if (!statSync(abs).isFile()) continue;
      hash.update(`untracked:${rel}\0`);
      hash.update(readFileSync(abs));
      hash.update("\0");
    } catch {
      // File disappeared between ls-files and read; ignore and let the next
      // fingerprint observe the new state.
    }
  }
}
