import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { ResearchAnalysisSchema } from "../src/research/schema";

describe("ResearchAnalysisSchema", () => {
  it("accepts a well-formed payload", () => {
    const ok = {
      knownFacts: ["uses Express"],
      ambiguities: ["which port?"],
      openQuestions: [
        { id: "q1", kind: "input", title: "What port?" },
        { id: "q2", kind: "select", title: "DB?", options: ["pg", "sqlite"] },
      ],
      external: [{ url: "https://x.com", title: "x", summary: "blah" }],
      notes: "fine",
    };
    expect(Value.Check(ResearchAnalysisSchema, ok)).toBe(true);
  });

  it("accepts payload without optional fields (notes)", () => {
    const minimal = { knownFacts: [], ambiguities: [], openQuestions: [], external: [] };
    expect(Value.Check(ResearchAnalysisSchema, minimal)).toBe(true);
  });

  it("accepts optional free-text questions", () => {
    const ok = {
      knownFacts: [],
      ambiguities: [],
      openQuestions: [{ id: "extra-context", kind: "input", title: "Anything else?", optional: true }],
      external: [],
    };
    expect(Value.Check(ResearchAnalysisSchema, ok)).toBe(true);
  });

  it("accepts free-text questions without optional as required-by-default", () => {
    const ok = {
      knownFacts: [],
      ambiguities: [],
      openQuestions: [{ id: "required-context", kind: "input", title: "What context is required?" }],
      external: [],
    };
    expect(Value.Check(ResearchAnalysisSchema, ok)).toBe(true);
  });

  it("keeps empty select options schema-compatible for runtime fallback", () => {
    const ok = {
      knownFacts: [],
      ambiguities: [],
      openQuestions: [{ id: "empty-select", kind: "select", title: "Which option?", options: [] }],
      external: [],
    };
    expect(Value.Check(ResearchAnalysisSchema, ok)).toBe(true);
  });

  it("accepts optional=true on select questions for compatibility", () => {
    const ok = {
      knownFacts: [],
      ambiguities: [],
      openQuestions: [{ id: "select", kind: "select", title: "Which option?", options: ["a"], optional: true }],
      external: [],
    };
    expect(Value.Check(ResearchAnalysisSchema, ok)).toBe(true);
  });

  it("rejects missing openQuestions array", () => {
    const bad = { knownFacts: [], ambiguities: [], external: [] };
    expect(Value.Check(ResearchAnalysisSchema, bad)).toBe(false);
  });

  it("rejects non-string question id", () => {
    const bad = {
      knownFacts: [],
      ambiguities: [],
      openQuestions: [{ id: 42, kind: "input", title: "x" }],
      external: [],
    };
    expect(Value.Check(ResearchAnalysisSchema, bad)).toBe(false);
  });

  it("rejects unknown kind value", () => {
    const bad = {
      knownFacts: [],
      ambiguities: [],
      openQuestions: [{ id: "q1", kind: "checkbox", title: "x" }],
      external: [],
    };
    expect(Value.Check(ResearchAnalysisSchema, bad)).toBe(false);
  });

  it("accepts extra properties on the root (intentional — future-proof)", () => {
    const ok = {
      knownFacts: [],
      ambiguities: [],
      openQuestions: [],
      external: [],
      confidence: 0.9, // model could add this; we tolerate it
    };
    expect(Value.Check(ResearchAnalysisSchema, ok)).toBe(true);
  });

  it("accepts knownFacts as an array of tagged objects (Opus's natural format)", () => {
    const ok = {
      knownFacts: [
        { id: "repo.layout", fact: "pnpm workspace at root" },
        { id: "repo.cli", fact: "CLI lives in src/cli/" },
      ],
      ambiguities: [],
      openQuestions: [],
      external: [],
    };
    expect(Value.Check(ResearchAnalysisSchema, ok)).toBe(true);
  });

  it("accepts ambiguities as an array of tagged objects", () => {
    const ok = {
      knownFacts: [],
      ambiguities: [
        { id: "scope.behaviorPreservation", summary: "M3 changes could be backwards-incompatible" },
      ],
      openQuestions: [],
      external: [],
    };
    expect(Value.Check(ResearchAnalysisSchema, ok)).toBe(true);
  });

  it("accepts knownFacts as a mix of strings and tagged objects", () => {
    const ok = {
      knownFacts: ["plain string", { id: "x", fact: "tagged" }],
      ambiguities: [],
      openQuestions: [],
      external: [],
    };
    expect(Value.Check(ResearchAnalysisSchema, ok)).toBe(true);
  });
});
