import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { askResearchQuestions } from "../src/research/qa";
import type { ResearchAnalysis } from "../src/research/types";

const ENTER = "\r";
const ESCAPE = "\x1b";

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

const ANALYSIS: ResearchAnalysis = {
  knownFacts: [],
  ambiguities: [],
  openQuestions: [
    { id: "q1", kind: "input", title: "Port?" },
    { id: "q2", kind: "input", title: "DB?" },
  ],
  external: [],
};

describe("askResearchQuestions resume-stable cache", () => {
  it("persists answers to research-answers.json (dotless) under the plan folder", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qa-cache-"));
    try {
      mkdirSync(path.join(root, "ai_plan", "demo"), { recursive: true });
      const ui = {
        select: async () => undefined,
        input: vi.fn(async () => "answer"),
        confirm: async () => true,
        notify: () => undefined,
      } as never;
      const answers = await askResearchQuestions(ANALYSIS, ui, { repoRoot: root, slug: "demo" });
      expect(answers).toEqual({ q1: "answer", q2: "answer" });
      const cachePath = path.join(root, "ai_plan", "demo", "research-answers.json");
      const persisted = JSON.parse(readFileSync(cachePath, "utf8"));
      expect(persisted).toEqual({ q1: "answer", q2: "answer" });
      // The legacy dotted file must NOT be created by the writer.
      expect(existsSync(path.join(root, "ai_plan", "demo", ".research-answers.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads existing dotless cache on resume; does NOT re-prompt for cached answers", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qa-resume-"));
    try {
      const folder = path.join(root, "ai_plan", "demo");
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        path.join(folder, "research-answers.json"),
        JSON.stringify({ q1: "previously-answered" }),
      );
      const inputCalls: string[] = [];
      const ui = {
        select: async () => undefined,
        input: vi.fn(async (title: string) => {
          inputCalls.push(title);
          return "fresh-answer";
        }),
        confirm: async () => true,
        notify: () => undefined,
      } as never;
      const answers = await askResearchQuestions(ANALYSIS, ui, { repoRoot: root, slug: "demo" });
      // q1 came from cache; only q2 was prompted.
      expect(inputCalls).toEqual(["DB?"]);
      expect(answers).toEqual({ q1: "previously-answered", q2: "fresh-answer" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to legacy .research-answers.json when only the dotted file exists", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qa-legacy-"));
    try {
      const folder = path.join(root, "ai_plan", "demo");
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        path.join(folder, ".research-answers.json"),
        JSON.stringify({ q1: "from-legacy" }),
      );
      const inputCalls: string[] = [];
      const ui = {
        select: async () => undefined,
        input: vi.fn(async (title: string) => {
          inputCalls.push(title);
          return "fresh-answer";
        }),
        confirm: async () => true,
        notify: () => undefined,
      } as never;
      const answers = await askResearchQuestions(ANALYSIS, ui, { repoRoot: root, slug: "demo" });
      expect(inputCalls).toEqual(["DB?"]);
      expect(answers).toEqual({ q1: "from-legacy", q2: "fresh-answer" });
      // Subsequent persistence migrates the data to the dotless filename and
      // leaves the legacy file untouched (so a rollback still works).
      expect(JSON.parse(readFileSync(path.join(folder, "research-answers.json"), "utf8"))).toEqual({
        q1: "from-legacy",
        q2: "fresh-answer",
      });
      expect(existsSync(path.join(folder, ".research-answers.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores legacy .research-answers.json when the dotless file exists (precedence)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qa-precedence-"));
    try {
      const folder = path.join(root, "ai_plan", "demo");
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        path.join(folder, "research-answers.json"),
        JSON.stringify({ q1: "from-dotless" }),
      );
      writeFileSync(
        path.join(folder, ".research-answers.json"),
        JSON.stringify({ q1: "from-legacy-stale" }),
      );
      const ui = {
        select: async () => undefined,
        input: vi.fn(async () => "ignored"),
        confirm: async () => true,
        notify: () => undefined,
      } as never;
      const answers = await askResearchQuestions(
        { ...ANALYSIS, openQuestions: [{ id: "q1", kind: "input", title: "?" }] },
        ui,
        { repoRoot: root, slug: "demo" },
      );
      expect(answers).toEqual({ q1: "from-dotless" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT silently fall back to legacy when the dotless file exists but is corrupt", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qa-corrupt-"));
    try {
      const folder = path.join(root, "ai_plan", "demo");
      mkdirSync(folder, { recursive: true });
      // Dotless exists but is corrupt JSON; legacy exists with stale answers.
      writeFileSync(path.join(folder, "research-answers.json"), "{not-json");
      writeFileSync(
        path.join(folder, ".research-answers.json"),
        JSON.stringify({ q1: "stale-from-legacy", q2: "stale-from-legacy" }),
      );
      const inputCalls: string[] = [];
      const ui = {
        select: async () => undefined,
        input: vi.fn(async (title: string) => {
          inputCalls.push(title);
          return "fresh-answer";
        }),
        confirm: async () => true,
        notify: () => undefined,
      } as never;
      const answers = await askResearchQuestions(ANALYSIS, ui, { repoRoot: root, slug: "demo" });
      // Both questions must be re-prompted: the corrupt dotless cache does
      // NOT silently surface legacy data. Otherwise stale data would skip
      // user prompts.
      expect(inputCalls).toEqual(["Port?", "DB?"]);
      expect(answers).toEqual({ q1: "fresh-answer", q2: "fresh-answer" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("when repoRoot/slug NOT provided, behaves like the legacy in-memory-only mode", async () => {
    const ui = {
      select: async () => undefined,
      input: vi.fn(async () => "x"),
      confirm: async () => true,
      notify: () => undefined,
    } as never;
    const answers = await askResearchQuestions(ANALYSIS, ui, {});
    expect(answers).toEqual({ q1: "x", q2: "x" });
    // No persistence; nothing on disk to check.
  });

  it("does not persist skipped optional free-text answers", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qa-optional-skip-"));
    try {
      mkdirSync(path.join(root, "ai_plan", "demo"), { recursive: true });
      let customCalls = 0;
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
            customCalls += 1;
            if (customCalls === 1) {
              component.handleInput?.(ESCAPE);
            } else {
              sendText(component, "required answer");
              component.handleInput?.(ENTER);
            }
            return result;
          },
        ),
        select: vi.fn(),
        input: vi.fn(async () => "unexpected"),
        confirm: async () => true,
        notify: () => undefined,
      };
      const answers = await askResearchQuestions(
        {
          knownFacts: [],
          ambiguities: [],
          openQuestions: [
            { id: "extra", kind: "input", title: "Any extra context?", optional: true },
            { id: "required", kind: "input", title: "Required context?" },
          ],
          external: [],
        },
        ui as never,
        { repoRoot: root, slug: "demo" },
      );

      expect(answers).toEqual({ required: "required answer" });
      const persisted = JSON.parse(readFileSync(path.join(root, "ai_plan", "demo", "research-answers.json"), "utf8"));
      expect(persisted).toEqual({ required: "required answer" });
      expect(ui.input).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
