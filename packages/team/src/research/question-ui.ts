import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import { CURSOR_MARKER, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

import type { ResearchOpenQuestion } from "./types";

export const OTHER_DESCRIBE_LABEL = "Other (describe)";

export interface CreateResearchQuestionComponentArgs {
  title: string;
  signal?: AbortSignal;
  tui: TUI;
  theme: Theme;
  done: (answer: string | undefined) => void;
}

export interface CreateResearchSelectComponentArgs extends CreateResearchQuestionComponentArgs {
  options: string[];
}

export interface CreateResearchInputComponentArgs extends CreateResearchQuestionComponentArgs {
  required: boolean;
}

function normalizeOptionLabel(option: string): string {
  return option.trim().replace(/\s+/g, " ").toLowerCase();
}

export function withOtherDescribeOption(options: string[]): string[] {
  const cleaned = options.map((option) => option.trim()).filter(Boolean);
  const result = cleaned.filter((option) => normalizeOptionLabel(option) !== normalizeOptionLabel(OTHER_DESCRIBE_LABEL));
  result.push(OTHER_DESCRIBE_LABEL);
  return result;
}

export function usableSelectOptions(question: ResearchOpenQuestion): string[] {
  const cleaned = cleanedSelectOptions(question);
  return cleaned.length > 0 ? withOtherDescribeOption(cleaned) : [];
}

export function isOptionalInputQuestion(question: ResearchOpenQuestion): boolean {
  return question.kind === "input" && question.optional === true;
}

export function createResearchSelectComponent(
  args: CreateResearchSelectComponentArgs,
): Component & Focusable & { dispose?(): void } {
  const options = withOtherDescribeOption(args.options);
  let selectedIndex = 0;
  let inputMode = false;
  let draft = "";
  let notice: string | undefined;
  let cachedLines: string[] | undefined;
  let cachedWidth: number | undefined;
  let focused = true;
  const completion = createCompletionGuard(args.done, args.signal);

  function refresh() {
    cachedLines = undefined;
    cachedWidth = undefined;
    args.tui.requestRender();
  }

  function handleInput(data: string) {
    if (completion.completed) return;

    if (inputMode) {
      if (matchesKey(data, Key.escape)) {
        inputMode = false;
        draft = "";
        notice = undefined;
        refresh();
        return;
      }
      if (matchesKey(data, Key.enter)) {
        const answer = draft.trim();
        if (answer) {
          completion.finish(answer);
        } else {
          notice = "Describe the other answer before continuing.";
          refresh();
        }
        return;
      }
      if (removeLastPrintable(data)) {
        draft = draft.slice(0, -1);
        notice = undefined;
        refresh();
        return;
      }
      const text = printableText(data);
      if (text !== undefined) {
        draft += text;
        notice = undefined;
        refresh();
      }
      return;
    }

    if (matchesKey(data, Key.up)) {
      selectedIndex = Math.max(0, selectedIndex - 1);
      notice = undefined;
      refresh();
      return;
    }
    if (matchesKey(data, Key.down)) {
      selectedIndex = Math.min(options.length - 1, selectedIndex + 1);
      notice = undefined;
      refresh();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const selected = options[selectedIndex];
      if (selected === OTHER_DESCRIBE_LABEL) {
        inputMode = true;
        draft = "";
        notice = undefined;
        refresh();
      } else {
        completion.finish(selected);
      }
      return;
    }
    if (matchesKey(data, Key.escape)) {
      notice = "Select an answer before continuing.";
      refresh();
    }
  }

  function render(width: number): string[] {
    if (cachedLines && cachedWidth === width) return cachedLines;
    const lines: string[] = [];
    const safeWidth = Math.max(1, width);
    const add = (line: string) => lines.push(truncateToWidth(line, safeWidth));

    add(args.theme.fg("accent", args.title));
    lines.push("");
    for (let i = 0; i < options.length; i++) {
      const selected = i === selectedIndex;
      const prefix = selected ? "> " : "  ";
      const label = `${i + 1}. ${options[i]}`;
      add(prefix + (selected ? args.theme.fg("accent", label) : args.theme.fg("text", label)));
    }
    if (inputMode) {
      lines.push("");
      add(args.theme.fg("muted", "Other answer:"));
      add(renderEditableLine("  ", draft, focused));
    }
    if (notice) {
      lines.push("");
      add(args.theme.fg("warning", notice));
    }
    lines.push("");
    add(args.theme.fg("dim", inputMode ? "Enter submits; Esc returns to options." : "Enter selects an answer."));

    cachedLines = lines;
    cachedWidth = width;
    return lines;
  }

  return {
    get focused() {
      return focused;
    },
    set focused(value: boolean) {
      focused = value;
      cachedLines = undefined;
      cachedWidth = undefined;
    },
    render,
    invalidate: () => {
      cachedLines = undefined;
      cachedWidth = undefined;
    },
    handleInput,
    dispose: completion.dispose,
  } satisfies Component & Focusable & { dispose?(): void };
}

export function createResearchInputComponent(
  args: CreateResearchInputComponentArgs,
): Component & Focusable & { dispose?(): void } {
  let draft = "";
  let notice: string | undefined;
  let cachedLines: string[] | undefined;
  let cachedWidth: number | undefined;
  let focused = true;
  const completion = createCompletionGuard(args.done, args.signal);

  function refresh() {
    cachedLines = undefined;
    cachedWidth = undefined;
    args.tui.requestRender();
  }

  function handleInput(data: string) {
    if (completion.completed) return;

    if (matchesKey(data, Key.escape)) {
      if (args.required) {
        notice = "Enter an answer before continuing.";
        refresh();
      } else {
        completion.finish(undefined);
      }
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const answer = draft.trim();
      if (answer) {
        completion.finish(answer);
      } else if (args.required) {
        notice = "Enter an answer before continuing.";
        refresh();
      } else {
        completion.finish(undefined);
      }
      return;
    }
    if (removeLastPrintable(data)) {
      draft = draft.slice(0, -1);
      notice = undefined;
      refresh();
      return;
    }
    const text = printableText(data);
    if (text !== undefined) {
      draft += text;
      notice = undefined;
      refresh();
    }
  }

  function render(width: number): string[] {
    if (cachedLines && cachedWidth === width) return cachedLines;
    const lines: string[] = [];
    const safeWidth = Math.max(1, width);
    const add = (line: string) => lines.push(truncateToWidth(line, safeWidth));

    add(args.theme.fg("accent", args.title));
    lines.push("");
    add(renderEditableLine("> ", draft, focused));
    if (notice) {
      lines.push("");
      add(args.theme.fg("warning", notice));
    }
    lines.push("");
    add(args.theme.fg("dim", args.required ? "Enter submits an answer." : "Enter submits; Esc skips."));

    cachedLines = lines;
    cachedWidth = width;
    return lines;
  }

  return {
    get focused() {
      return focused;
    },
    set focused(value: boolean) {
      focused = value;
      cachedLines = undefined;
      cachedWidth = undefined;
    },
    render,
    invalidate: () => {
      cachedLines = undefined;
      cachedWidth = undefined;
    },
    handleInput,
    dispose: completion.dispose,
  } satisfies Component & Focusable & { dispose?(): void };
}

export async function askResearchQuestion(
  ui: ExtensionUIContext,
  question: ResearchOpenQuestion,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const baseSelectOptions = cleanedSelectOptions(question);
  if (baseSelectOptions.length > 0) {
    const selectOptions = withOtherDescribeOption(baseSelectOptions);
    const customResult = await askWithCustom(ui, (tui, theme, done) =>
      createResearchSelectComponent({
        title: question.title,
        options: baseSelectOptions,
        signal,
        tui,
        theme,
        done,
      }),
    );
    if (customResult.kind === "answered" && (customResult.answer !== undefined || signal?.aborted)) {
      return customResult.answer;
    }
    return askBuiltInSelect(ui, question.title, selectOptions, signal);
  }

  const required = !isOptionalInputQuestion(question);
  const customResult = await askWithCustom(ui, (tui, theme, done) =>
    createResearchInputComponent({
      title: question.title,
      required,
      signal,
      tui,
      theme,
      done,
    }),
  );
  if (customResult.kind === "answered") {
    if (customResult.answer !== undefined || signal?.aborted || !required) return customResult.answer;
  }
  return askBuiltInInput(ui, question.title, required, signal);
}

function cleanedSelectOptions(question: ResearchOpenQuestion): string[] {
  if (question.kind !== "select") return [];
  return (question.options ?? []).map((option) => option.trim()).filter(Boolean);
}

function createCompletionGuard(done: (answer: string | undefined) => void, signal?: AbortSignal) {
  let completed = false;
  let abortListener: (() => void) | undefined;

  function dispose() {
    if (signal && abortListener) {
      signal.removeEventListener("abort", abortListener);
      abortListener = undefined;
    }
  }

  function finish(answer: string | undefined) {
    if (completed) return;
    completed = true;
    dispose();
    done(answer);
  }

  if (signal) {
    abortListener = () => finish(undefined);
    if (signal.aborted) {
      queueMicrotask(abortListener);
    } else {
      signal.addEventListener("abort", abortListener, { once: true });
    }
  }

  return {
    get completed() {
      return completed;
    },
    finish,
    dispose,
  };
}

function removeLastPrintable(data: string): boolean {
  return matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b";
}

function printableText(data: string): string | undefined {
  if (data.length === 0) return undefined;
  if (data.includes("\x1b") || data.includes("\r") || data.includes("\n")) return undefined;
  return [...data].every((char) => char >= " ") ? data : undefined;
}

function renderEditableLine(prefix: string, draft: string, focused: boolean): string {
  if (!focused) return `${prefix}${draft}`;
  return `${prefix}${draft}${CURSOR_MARKER}\x1b[7m \x1b[27m`;
}

type ResearchCustomFactory = (
  tui: TUI,
  theme: Theme,
  done: (answer: string | undefined) => void,
) => Component & { dispose?(): void };

type ResearchCustomUi = {
  custom?<T>(
    factory: (
      tui: TUI,
      theme: Theme,
      keybindings: unknown,
      done: (result: T) => void,
    ) => Component & { dispose?(): void },
  ): Promise<T>;
};

type AskWithCustomResult =
  | { kind: "unavailable" }
  | { kind: "answered"; answer: string | undefined };

async function askWithCustom(ui: ExtensionUIContext, factory: ResearchCustomFactory): Promise<AskWithCustomResult> {
  const maybeCustom = (ui as ResearchCustomUi).custom;
  if (typeof maybeCustom !== "function") return { kind: "unavailable" };
  const answer = await maybeCustom<string | undefined>((tui, theme, _keybindings, done) => factory(tui, theme, done));
  return { kind: "answered", answer };
}

async function askBuiltInSelect(
  ui: ExtensionUIContext,
  title: string,
  options: string[],
  signal?: AbortSignal,
): Promise<string | undefined> {
  while (!signal?.aborted) {
    const selected = await ui.select(title, options, { signal });
    if (signal?.aborted) return undefined;
    if (selected === undefined) continue;
    if (selected !== OTHER_DESCRIBE_LABEL) return selected;

    const customAnswer = await askBuiltInInput(ui, "Describe other answer", true, signal);
    if (customAnswer !== undefined || signal?.aborted) return customAnswer;
  }
  return undefined;
}

async function askBuiltInInput(
  ui: ExtensionUIContext,
  title: string,
  required: boolean,
  signal?: AbortSignal,
): Promise<string | undefined> {
  while (!signal?.aborted) {
    const answer = await ui.input(title, undefined, { signal });
    if (signal?.aborted) return undefined;
    const trimmed = answer?.trim() ?? "";
    if (trimmed) return trimmed;
    if (!required) return undefined;
  }
  return undefined;
}
