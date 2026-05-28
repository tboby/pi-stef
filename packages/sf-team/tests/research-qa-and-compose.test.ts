import { describe, expect, it, vi } from "vitest";

import { askResearchQuestions } from "../src/research/qa";
import { composeEnrichedBrief } from "../src/research/compose";
import type { ResearchAnalysis } from "../src/research/types";

const DOWN = "\x1b[B";
const ENTER = "\r";

interface TestComponent {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate(): void;
  dispose?(): void;
}

function fakeTui() {
  return { requestRender: vi.fn() };
}

const fakeTheme = {
  fg: (_color: string, value: string) => value,
  bold: (value: string) => value,
};

function sendText(component: TestComponent, text: string) {
  for (const char of text) {
    component.handleInput?.(char);
  }
}

describe("askResearchQuestions", () => {
  it("calls ui.input for kind='input' and ui.select for kind='select'", async () => {
    const inputCalls: string[] = [];
    const selectCalls: string[] = [];
    const ui = {
      input: vi.fn(async (title: string) => {
        inputCalls.push(title);
        return `answer-${inputCalls.length}`;
      }),
      select: vi.fn(async (title: string) => {
        selectCalls.push(title);
        return "pg";
      }),
      confirm: async () => true,
      notify: () => undefined,
    } as never;
    const analysis: ResearchAnalysis = {
      knownFacts: [],
      ambiguities: [],
      openQuestions: [
        { id: "q1", kind: "input", title: "What port?" },
        { id: "q2", kind: "select", title: "Which DB?", options: ["pg", "sqlite"] },
        { id: "q3", kind: "input", title: "Region?" },
      ],
      external: [],
    };
    const answers = await askResearchQuestions(analysis, ui, {});
    expect(inputCalls).toEqual(["What port?", "Region?"]);
    expect(selectCalls).toEqual(["Which DB?"]);
    expect(answers).toEqual({ q1: "answer-1", q2: "pg", q3: "answer-2" });
  });

  it("uses inline Other describe text as the select answer", async () => {
    const ui = {
      custom: vi.fn(
        async (
          factory: (
            tui: never,
            theme: never,
            keybindings: never,
            done: (answer: string | undefined) => void,
          ) => TestComponent,
        ) => {
          let result: string | undefined;
          const component = factory(fakeTui() as never, fakeTheme as never, undefined as never, (answer) => {
            result = answer;
          });
          component.handleInput?.(DOWN);
          component.handleInput?.(DOWN);
          component.handleInput?.(ENTER);
          sendText(component, "CockroachDB");
          component.handleInput?.(ENTER);
          return result;
        },
      ),
      input: vi.fn(),
      select: vi.fn(),
      confirm: async () => true,
      notify: () => undefined,
    };
    const analysis: ResearchAnalysis = {
      knownFacts: [],
      ambiguities: [],
      openQuestions: [{ id: "db", kind: "select", title: "Which DB?", options: ["pg", "sqlite"] }],
      external: [],
    };

    const answers = await askResearchQuestions(analysis, ui as never, {});

    expect(answers).toEqual({ db: "CockroachDB" });
    expect(ui.custom).toHaveBeenCalledTimes(1);
    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.input).not.toHaveBeenCalled();
  });

  it("does not re-ask duplicate question ids after an answer is recorded", async () => {
    const calls: string[] = [];
    const ui = {
      input: vi.fn(async (title: string) => {
        calls.push(title);
        return "x";
      }),
      select: vi.fn(),
      confirm: async () => true,
      notify: () => undefined,
    } as never;
    const analysis: ResearchAnalysis = {
      knownFacts: [],
      ambiguities: [],
      openQuestions: [
        { id: "dup", kind: "input", title: "First copy" },
        { id: "dup", kind: "input", title: "Second copy (same id)" },
      ],
      external: [],
    };
    const answers = await askResearchQuestions(analysis, ui, {});
    // The second question with the same id is skipped by the answers map.
    expect(calls).toEqual(["First copy"]);
    expect(answers).toEqual({ dup: "x" });
  });
});

describe("composeEnrichedBrief", () => {
  it("emits all four sections when each has content", () => {
    const out = composeEnrichedBrief({
      originalBrief: "Add /healthz",
      analysis: {
        knownFacts: ["repo uses pnpm"],
        ambiguities: ["which port?"],
        openQuestions: [{ id: "q1", kind: "input", title: "What port?" }],
        external: [],
        notes: "use existing express server",
      },
      answers: { q1: "8080" },
      externalContext: {
        resolved: [
          { ref: { kind: "url", raw: "https://x.com", id: "https://x.com" }, content: "page body", title: "X Docs" },
        ],
        unresolved: [],
      },
    });
    expect(out).toContain("## Original brief");
    expect(out).toContain("Add /healthz");
    expect(out).toContain("## External context (fetched by orchestrator)");
    expect(out).toContain("X Docs");
    expect(out).toContain("page body");
    expect(out).toContain("## Researcher findings");
    expect(out).toContain("- repo uses pnpm");
    expect(out).toContain("- which port?");
    expect(out).toContain("use existing express server");
    expect(out).toContain("## User answers");
    expect(out).toContain("### What port?");
    expect(out).toContain("8080");
  });

  it("omits empty sections (no original brief, no external)", () => {
    const out = composeEnrichedBrief({
      originalBrief: "",
      analysis: { knownFacts: [], ambiguities: [], openQuestions: [], external: [] },
      answers: {},
      externalContext: { resolved: [], unresolved: [] },
    });
    expect(out).not.toContain("## Original brief");
    expect(out).not.toContain("## External context");
    expect(out).not.toContain("## User answers");
    // analysis still emits a section header but with empty subsections.
    expect(out).toContain("## Researcher findings");
  });

  it("returns a deterministic string for the same input", () => {
    const input = {
      originalBrief: "X",
      analysis: { knownFacts: ["a"], ambiguities: [], openQuestions: [], external: [] } as ResearchAnalysis,
      answers: {},
      externalContext: { resolved: [], unresolved: [] },
    };
    expect(composeEnrichedBrief(input)).toBe(composeEnrichedBrief(input));
  });

  it("inserts the Atlassian Ticket Context section before Researcher findings when jiraContextMarkdown is provided", () => {
    const out = composeEnrichedBrief({
      originalBrief: "Fix ABC-123",
      analysis: {
        knownFacts: ["repo uses pnpm"],
        ambiguities: [],
        openQuestions: [],
        external: [],
      },
      answers: {},
      externalContext: { resolved: [], unresolved: [] },
      jiraContextMarkdown: "# ABC-123\nRendered Jira summary.",
    });
    expect(out).toContain("## Atlassian Ticket Context");
    expect(out).toContain("# ABC-123");
    expect(out).toContain("Rendered Jira summary.");
    // Ordering: Atlassian Ticket Context appears before Researcher findings.
    const atlassianIdx = out.indexOf("## Atlassian Ticket Context");
    const researcherIdx = out.indexOf("## Researcher findings");
    expect(atlassianIdx).toBeGreaterThan(-1);
    expect(researcherIdx).toBeGreaterThan(-1);
    expect(atlassianIdx).toBeLessThan(researcherIdx);
  });

  it("produces byte-identical output to today when jiraContextMarkdown is undefined or empty", () => {
    const inputWithoutJira = {
      originalBrief: "Add /healthz",
      analysis: {
        knownFacts: ["a"],
        ambiguities: ["b"],
        openQuestions: [],
        external: [],
      } as ResearchAnalysis,
      answers: {},
      externalContext: { resolved: [], unresolved: [] },
    };
    const baseline = composeEnrichedBrief(inputWithoutJira);
    expect(composeEnrichedBrief({ ...inputWithoutJira, jiraContextMarkdown: undefined })).toBe(baseline);
    expect(composeEnrichedBrief({ ...inputWithoutJira, jiraContextMarkdown: "" })).toBe(baseline);
    expect(composeEnrichedBrief({ ...inputWithoutJira, jiraContextMarkdown: "   \n  " })).toBe(baseline);
  });
});
