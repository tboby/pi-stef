import { describe, expect, it } from "vitest";

import { buildPiArgv } from "../src/runtime/argv";
import type { TeamMember } from "../src/runtime/types";

describe("researcher argv profile (read-only)", () => {
  const researcher: TeamMember = { role: "researcher", model: "claude-haiku-4-5", thinking: "medium" };

  it("uses JSON mode + no-session + isolation flags", () => {
    const argv = buildPiArgv(researcher, "analyze this");
    expect(argv).toContain("--mode");
    expect(argv).toContain("json");
    expect(argv).toContain("--no-session");
    expect(argv).toContain("--no-prompt-templates");
    expect(argv).toContain("--no-extensions");
    expect(argv).toContain("--no-context-files");
  });

  it("constrains tools to read,grep,find,ls — NEVER bash/edit/write", () => {
    const argv = buildPiArgv(researcher, "analyze");
    const toolsIdx = argv.indexOf("--tools");
    expect(toolsIdx).toBeGreaterThan(-1);
    const toolsValue = argv[toolsIdx + 1];
    expect(toolsValue).toBe("read,grep,find,ls");
    // Belt-and-suspenders: assert dangerous tool names appear nowhere in argv.
    const argvStr = argv.join(" ");
    expect(argvStr).not.toMatch(/\bbash\b/);
    expect(argvStr).not.toMatch(/\bedit\b/);
    expect(argvStr).not.toMatch(/\bwrite\b/);
  });

  it("ignores skills[] for the researcher role (skills are pinned by the argv profile)", () => {
    const m: TeamMember = { ...researcher, skills: ["brainstorming", "writing-plans"] };
    const argv = buildPiArgv(m, "analyze");
    expect(argv.includes("--skill")).toBe(false);
  });

  it("includes model + thinking flags", () => {
    const argv = buildPiArgv(researcher, "analyze");
    expect(argv).toContain("--model");
    expect(argv).toContain("claude-haiku-4-5");
    expect(argv).toContain("--thinking");
    expect(argv).toContain("medium");
  });

  it("ends with -p and the task as positional", () => {
    const argv = buildPiArgv(researcher, "analyze the prompt");
    expect(argv[argv.length - 2]).toBe("-p");
    expect(argv[argv.length - 1]).toBe("analyze the prompt");
  });
});
