import { describe, expect, it, vi } from "vitest";

import {
  askResearchQuestion,
  createResearchInputComponent,
  createResearchSelectComponent,
  isOptionalInputQuestion,
  OTHER_DESCRIBE_LABEL,
  usableSelectOptions,
  withOtherDescribeOption,
} from "../src/research/question-ui";
import type { ResearchOpenQuestion } from "../src/research/types";

const DOWN = "\x1b[B";
const ENTER = "\r";
const ESCAPE = "\x1b";
const CURSOR_MARKER = "\x1b_pi:c\x07";

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

describe("research question UI helpers", () => {
  it("appends the inline Other option to select answers", () => {
    expect(withOtherDescribeOption(["A", "B"])).toEqual(["A", "B", OTHER_DESCRIBE_LABEL]);
  });

  it("does not duplicate an existing Other describe option regardless of casing or spacing", () => {
    expect(withOtherDescribeOption(["A", " other   (DESCRIBE) "])).toEqual(["A", OTHER_DESCRIBE_LABEL]);
  });

  it("keeps a generic Other answer and still appends the inline Other describe option", () => {
    expect(withOtherDescribeOption(["A", "Other"])).toEqual(["A", "Other", OTHER_DESCRIBE_LABEL]);
  });

  it("returns no select options when researcher options are missing, empty, or blank-only", () => {
    const noOptions: ResearchOpenQuestion = { id: "missing", kind: "select", title: "Missing?" };
    const emptyOptions: ResearchOpenQuestion = { id: "empty", kind: "select", title: "Empty?", options: [] };
    const blankOptions: ResearchOpenQuestion = {
      id: "blank",
      kind: "select",
      title: "Blank?",
      options: ["  ", "\t"],
    };

    expect(usableSelectOptions(noOptions)).toEqual([]);
    expect(usableSelectOptions(emptyOptions)).toEqual([]);
    expect(usableSelectOptions(blankOptions)).toEqual([]);
  });

  it("detects optional free-text questions only", () => {
    expect(isOptionalInputQuestion({ id: "input", kind: "input", title: "Details?", optional: true })).toBe(true);
    expect(isOptionalInputQuestion({ id: "input-required", kind: "input", title: "Details?" })).toBe(false);
    expect(isOptionalInputQuestion({ id: "select", kind: "select", title: "Pick?", optional: true })).toBe(false);
  });
});

describe("research question custom components", () => {
  it("returns a selected normal option", () => {
    const answers: Array<string | undefined> = [];
    const component = createResearchSelectComponent({
      title: "Which database?",
      options: ["Postgres", "SQLite"],
      tui: fakeTui() as never,
      theme: fakeTheme as never,
      done: (answer) => answers.push(answer),
    });

    component.handleInput?.(ENTER);

    expect(answers).toEqual(["Postgres"]);
  });

  it("renders the title, selected option, and inline Other input label", () => {
    const component = createResearchSelectComponent({
      title: "Which database?",
      options: ["Postgres", "SQLite"],
      tui: fakeTui() as never,
      theme: fakeTheme as never,
      done: () => undefined,
    });

    expect(component.render(80)).toContain("> 1. Postgres");
    expect(component.render(80)).toContain("Which database?");

    component.handleInput?.(DOWN);
    component.handleInput?.(DOWN);
    component.handleInput?.(ENTER);

    expect(component.render(80)).toContain("Other answer:");
  });

  it("renders a cursor in inline Other input mode", () => {
    const component = createResearchSelectComponent({
      title: "Which database?",
      options: ["Postgres", "SQLite"],
      tui: fakeTui() as never,
      theme: fakeTheme as never,
      done: () => undefined,
    });

    component.handleInput?.(DOWN);
    component.handleInput?.(DOWN);
    component.handleInput?.(ENTER);
    sendText(component, "Cockroach");

    expect(component.render(80).join("\n")).toContain(CURSOR_MARKER);
  });

  it("re-renders cached output when the render width changes", () => {
    const component = createResearchSelectComponent({
      title: "Which database should the generated plan use?",
      options: ["Postgres"],
      tui: fakeTui() as never,
      theme: fakeTheme as never,
      done: () => undefined,
    });

    const narrowTitle = component.render(12)[0];
    const wideTitle = component.render(80)[0];

    expect(narrowTitle).not.toBe(wideTitle);
    expect(wideTitle).toBe("Which database should the generated plan use?");
  });

  it("lets the user pick Other describe and submit inline text", () => {
    const answers: Array<string | undefined> = [];
    const component = createResearchSelectComponent({
      title: "Which database?",
      options: ["Postgres", "SQLite"],
      tui: fakeTui() as never,
      theme: fakeTheme as never,
      done: (answer) => answers.push(answer),
    });

    component.handleInput?.(DOWN);
    component.handleInput?.(DOWN);
    component.handleInput?.(ENTER);
    sendText(component, "CockroachDB");
    component.handleInput?.(ENTER);

    expect(answers).toEqual(["CockroachDB"]);
  });

  it("does not complete required select questions on Escape", () => {
    const answers: Array<string | undefined> = [];
    const component = createResearchSelectComponent({
      title: "Which database?",
      options: ["Postgres", "SQLite"],
      tui: fakeTui() as never,
      theme: fakeTheme as never,
      done: (answer) => answers.push(answer),
    });

    component.handleInput?.(ESCAPE);

    expect(answers).toEqual([]);
  });

  it("requires non-empty input for required free-text questions", () => {
    const answers: Array<string | undefined> = [];
    const component = createResearchInputComponent({
      title: "Which port?",
      required: true,
      tui: fakeTui() as never,
      theme: fakeTheme as never,
      done: (answer) => answers.push(answer),
    });

    component.handleInput?.(ESCAPE);
    component.handleInput?.(ENTER);
    sendText(component, "  8080  ");
    component.handleInput?.(ENTER);

    expect(answers).toEqual(["8080"]);
  });

  it("renders a cursor in free-text input mode", () => {
    const component = createResearchInputComponent({
      title: "Which port?",
      required: true,
      tui: fakeTui() as never,
      theme: fakeTheme as never,
      done: () => undefined,
    });

    sendText(component, "8080");

    expect(component.render(80).join("\n")).toContain(CURSOR_MARKER);
  });

  it("allows optional free-text questions to be skipped with Escape", () => {
    const answers: Array<string | undefined> = [];
    const component = createResearchInputComponent({
      title: "Any extra context?",
      required: false,
      tui: fakeTui() as never,
      theme: fakeTheme as never,
      done: (answer) => answers.push(answer),
    });

    component.handleInput?.(ESCAPE);

    expect(answers).toEqual([undefined]);
  });

  it("aborts once and prevents later duplicate completion", () => {
    const answers: Array<string | undefined> = [];
    const controller = new AbortController();
    const component = createResearchSelectComponent({
      title: "Which database?",
      options: ["Postgres"],
      signal: controller.signal,
      tui: fakeTui() as never,
      theme: fakeTheme as never,
      done: (answer) => answers.push(answer),
    });

    controller.abort();
    component.handleInput?.(ENTER);
    controller.abort();
    component.dispose?.();

    expect(answers).toEqual([undefined]);
  });

  it("defers completion when created with an already-aborted signal", async () => {
    const answers: Array<string | undefined> = [];
    const controller = new AbortController();
    controller.abort();

    const component = createResearchSelectComponent({
      title: "Which database?",
      options: ["Postgres"],
      signal: controller.signal,
      tui: fakeTui() as never,
      theme: fakeTheme as never,
      done: (answer) => answers.push(answer),
    });

    expect(answers).toEqual([]);
    await Promise.resolve();
    component.handleInput?.(ENTER);

    expect(answers).toEqual([undefined]);
  });

  it("treats select questions marked optional as required", async () => {
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
          let resolved = false;
          let result: string | undefined;
          const component = factory(fakeTui() as never, fakeTheme as never, undefined as never, (answer) => {
            resolved = true;
            result = answer;
          });

          component.handleInput?.(ESCAPE);
          expect(resolved).toBe(false);
          component.handleInput?.(ENTER);
          expect(resolved).toBe(true);
          return result;
        },
      ),
    };

    await expect(
      askResearchQuestion(
        ui as never,
        { id: "db", kind: "select", title: "Which database?", options: ["Postgres"], optional: true },
      ),
    ).resolves.toBe("Postgres");
  });

  it("prompts optional free-text questions when custom UI is unavailable", async () => {
    const ui = {
      input: vi.fn(async () => "  extra context  "),
      select: vi.fn(),
    };

    await expect(
      askResearchQuestion(ui as never, {
        id: "extra",
        kind: "input",
        title: "Any extra context?",
        optional: true,
      }),
    ).resolves.toBe("extra context");
    expect(ui.input).toHaveBeenCalledWith("Any extra context?", undefined, { signal: undefined });
    expect(ui.select).not.toHaveBeenCalled();
  });

  it("falls back to required free text for select questions with blank-only options", async () => {
    const ui = {
      input: vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce("fallback answer"),
      select: vi.fn(),
    };

    await expect(
      askResearchQuestion(ui as never, {
        id: "blank",
        kind: "select",
        title: "Which option?",
        options: [" ", "\t"],
      }),
    ).resolves.toBe("fallback answer");
    expect(ui.input).toHaveBeenCalledTimes(2);
    expect(ui.select).not.toHaveBeenCalled();
  });
});
