/**
 * S-512: Focused unit tests — resume precedence rule for gitMode and tddMode.
 *
 * When workflow.json persists gitMode/tddMode, those values must override
 * config/auto-detection UNLESS the user explicitly provides 'on'/'off' in
 * the prompt. The 'auto' value is treated as "unset" for resume purposes.
 */
import { describe, expect, it } from "vitest";

import { resolveRuntime } from "../src/config/resolve-runtime";
import { DEFAULT_CONFIG } from "../src/config/schema";

const gitRepoProbe = () => true;
const nonGitProbe = () => false;

const defaults = DEFAULT_CONFIG;

describe("resume precedence: persisted gitMode wins over auto-detection when prompt is unset/auto", () => {
  it("(a) persisted gitMode='off' + cwd=git-repo + no prompt arg → resolved='off'", () => {
    const result = resolveRuntime({
      prompt: { gitMode: undefined },
      defaults,
      repoRoot: "/any",
      persisted: { gitMode: "off", tddMode: "auto" },
      __testGitProbe: gitRepoProbe,
    });
    expect(result.gitMode).toBe("off");
    expect(result.raw.gitMode).toBeUndefined();
  });

  it("(b) persisted gitMode='off' + prompt gitMode='auto' → still resolved='off' (auto is treated as unset)", () => {
    const result = resolveRuntime({
      prompt: { gitMode: "auto" },
      defaults,
      repoRoot: "/any",
      persisted: { gitMode: "off", tddMode: "auto" },
      __testGitProbe: gitRepoProbe,
    });
    expect(result.gitMode).toBe("off");
    expect(result.raw.gitMode).toBe("auto");
  });

  it("(c) persisted gitMode='off' + explicit prompt gitMode='on' → resolved='on' (explicit wins)", () => {
    const result = resolveRuntime({
      prompt: { gitMode: "on" },
      defaults,
      repoRoot: "/any",
      persisted: { gitMode: "off", tddMode: "auto" },
      __testGitProbe: gitRepoProbe,
    });
    // Explicit 'on' overrides persisted 'off'
    expect(result.gitMode).toBe("on");
    expect(result.raw.gitMode).toBe("on");
  });
});

describe("resume precedence: persisted tddMode wins when prompt is unset", () => {
  it("persisted tddMode='off' + no prompt arg → resolved='off'", () => {
    const result = resolveRuntime({
      prompt: { tddMode: undefined },
      defaults,
      repoRoot: "/any",
      persisted: { gitMode: "on", tddMode: "off" },
      __testGitProbe: gitRepoProbe,
    });
    expect(result.tddMode).toBe("off");
  });

  it("persisted tddMode='on' + explicit prompt tddMode='off' → resolved='off' (explicit wins)", () => {
    const result = resolveRuntime({
      prompt: { tddMode: "off" },
      defaults,
      repoRoot: "/any",
      persisted: { gitMode: "on", tddMode: "on" },
      __testGitProbe: gitRepoProbe,
    });
    expect(result.tddMode).toBe("off");
  });
});

describe("resume precedence: no persisted values → falls through to normal cascade", () => {
  it("no persisted values + auto probe from git-repo cwd → gitMode='on'", () => {
    const result = resolveRuntime({
      prompt: {},
      defaults,
      repoRoot: "/any",
      persisted: undefined,
      __testGitProbe: gitRepoProbe,
    });
    expect(result.gitMode).toBe("on");
  });

  it("no persisted values + auto probe from non-git cwd → gitMode='off'", () => {
    const result = resolveRuntime({
      prompt: {},
      defaults,
      repoRoot: "/any",
      persisted: undefined,
      __testGitProbe: nonGitProbe,
    });
    expect(result.gitMode).toBe("off");
  });
});
