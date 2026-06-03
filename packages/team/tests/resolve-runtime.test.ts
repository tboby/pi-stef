import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/schema";
import { resolveRuntime, type RuntimeResolutionInput } from "../src/config/resolve-runtime";

const repoRoot = "/workspace/project";
const defaults = DEFAULT_CONFIG;

function makeInput(overrides: Partial<RuntimeResolutionInput> = {}): RuntimeResolutionInput {
  return {
    prompt: {},
    defaults,
    repoRoot,
    ...overrides,
  };
}

describe("resolveRuntime — resolution chain", () => {
  it("(a) prompt gitMode wins over project config", () => {
    const result = resolveRuntime(
      makeInput({
        prompt: { gitMode: "off" },
        defaults: { ...defaults, paths: { git_mode: "on" } },
        __testGitProbe: () => true,
      }),
    );
    expect(result.gitMode).toBe("off");
  });

  it("(b) project config wins over global default when prompt absent", () => {
    const result = resolveRuntime(
      makeInput({
        prompt: {},
        defaults: { ...defaults, paths: { git_mode: "off" } },
        __testGitProbe: () => true,
      }),
    );
    expect(result.gitMode).toBe("off");
  });

  it("(c) global default wins over hard DEFAULT when prompt+project absent", () => {
    const result = resolveRuntime(
      makeInput({
        prompt: {},
        defaults: { ...defaults, paths: { git_mode: "off" } },
        __testGitProbe: () => false,
      }),
    );
    expect(result.gitMode).toBe("off");
  });

  it("(d) gitMode='auto' + git-repo cwd → resolved 'on'", () => {
    const result = resolveRuntime(
      makeInput({
        prompt: { gitMode: "auto" },
        __testGitProbe: () => true,
      }),
    );
    expect(result.gitMode).toBe("on");
  });

  it("(e) gitMode='auto' + non-git cwd → resolved 'off'", () => {
    const result = resolveRuntime(
      makeInput({
        prompt: { gitMode: "auto" },
        __testGitProbe: () => false,
      }),
    );
    expect(result.gitMode).toBe("off");
  });

  it("(f) gitMode='auto' + git-repo cwd + external aiPlanPath → STILL 'on' (D9)", () => {
    const result = resolveRuntime(
      makeInput({
        prompt: { gitMode: "auto", aiPlanPath: "/Users/me/notes/plans" },
        __testGitProbe: () => true,
      }),
    );
    expect(result.gitMode).toBe("on");
    expect(result.planRoot).toBe("/Users/me/notes/plans");
  });

  it("(g) explicit gitMode='off' wins regardless of git probe", () => {
    const result = resolveRuntime(
      makeInput({
        prompt: { gitMode: "off" },
        __testGitProbe: () => true,
      }),
    );
    expect(result.gitMode).toBe("off");
  });
});

describe("resolveRuntime — raw fields", () => {
  it("(h1) explicit gitMode omitted → raw.gitMode === undefined", () => {
    const result = resolveRuntime(makeInput({ prompt: {}, __testGitProbe: () => false }));
    expect(result.raw.gitMode).toBeUndefined();
  });

  it("(h2) explicit gitMode='auto' → raw.gitMode === 'auto'", () => {
    const result = resolveRuntime(makeInput({ prompt: { gitMode: "auto" }, __testGitProbe: () => false }));
    expect(result.raw.gitMode).toBe("auto");
  });

  it("(h3) explicit gitMode='on' → raw.gitMode === 'on'", () => {
    const result = resolveRuntime(makeInput({ prompt: { gitMode: "on" }, __testGitProbe: () => false }));
    expect(result.raw.gitMode).toBe("on");
  });

  it("raw.aiPlanPath carries prompt value verbatim", () => {
    const result = resolveRuntime(
      makeInput({ prompt: { aiPlanPath: "/some/path" }, __testGitProbe: () => false }),
    );
    expect(result.raw.aiPlanPath).toBe("/some/path");
  });

  it("raw.tddMode carries prompt value verbatim", () => {
    const result = resolveRuntime(
      makeInput({ prompt: { tddMode: "off" }, __testGitProbe: () => false }),
    );
    expect(result.raw.tddMode).toBe("off");
  });
});

describe("resolveRuntime — persisted (resume precedence)", () => {
  it("(i) persisted gitMode='off' + raw undefined → resolved 'off' even in git-repo cwd", () => {
    const result = resolveRuntime(
      makeInput({
        prompt: {},
        persisted: { gitMode: "off" },
        __testGitProbe: () => true,
      }),
    );
    expect(result.gitMode).toBe("off");
  });

  it("(i2) persisted gitMode='off' + raw='auto' → resolved 'off' (auto treated as unset)", () => {
    const result = resolveRuntime(
      makeInput({
        prompt: { gitMode: "auto" },
        persisted: { gitMode: "off" },
        __testGitProbe: () => true,
      }),
    );
    expect(result.gitMode).toBe("off");
  });

  it("(j) persisted gitMode='off' + raw='on' → resolved 'on'; raw.gitMode==='on' signals conflict", () => {
    const result = resolveRuntime(
      makeInput({
        prompt: { gitMode: "on" },
        persisted: { gitMode: "off" },
        __testGitProbe: () => false,
      }),
    );
    expect(result.gitMode).toBe("on");
    expect(result.raw.gitMode).toBe("on");
  });

  it("(tdd) prompt tddMode='auto' + config mode='off' → resolved 'auto' (prompt wins)", () => {
    const result = resolveRuntime(
      makeInput({
        prompt: { tddMode: "auto" },
        defaults: { ...defaults, tdd: { mode: "off" } },
        __testGitProbe: () => false,
      }),
    );
    expect(result.tddMode).toBe("auto");
  });

  it("planRoot falls back to default when no aiPlanPath or persisted", () => {
    const result = resolveRuntime(makeInput({ prompt: {}, __testGitProbe: () => false }));
    expect(result.planRoot).toBe(path.join(repoRoot, "ai_plan"));
  });

  it("persisted planRootPath is used when prompt aiPlanPath is absent", () => {
    const result = resolveRuntime(
      makeInput({
        prompt: {},
        persisted: { planRootPath: "/persisted/plans" },
        __testGitProbe: () => false,
      }),
    );
    expect(result.planRoot).toBe("/persisted/plans");
  });
});
