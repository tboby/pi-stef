import { describe, expect, it } from "vitest";

import { fetchExternalContext, scanRefs } from "../src/research/external-fetch";

describe("scanRefs", () => {
  it("extracts URLs and Jira keys; deduplicates", () => {
    const refs = scanRefs("see https://example.com/foo and PROJ-123 and PROJ-123 again");
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({ kind: "url", raw: "https://example.com/foo", id: "https://example.com/foo" });
    expect(refs[1]).toEqual({ kind: "jira", raw: "PROJ-123", id: "PROJ-123" });
  });

  it("strips trailing punctuation from URLs", () => {
    const refs = scanRefs("look at https://x.com.");
    expect(refs[0].id).toBe("https://x.com");
  });

  it("extracts a Jira browse URL as both a URL ref and a Jira key", () => {
    const refs = scanRefs("See https://firsthorizon.atlassian.net/browse/DIGENG-17720.");
    expect(refs).toEqual([
      {
        kind: "url",
        raw: "https://firsthorizon.atlassian.net/browse/DIGENG-17720.",
        id: "https://firsthorizon.atlassian.net/browse/DIGENG-17720",
      },
      { kind: "jira", raw: "DIGENG-17720", id: "DIGENG-17720" },
    ]);
  });
});

describe("fetchExternalContext", () => {
  it("default no-op fetcher: every ref ends up in unresolved with reason 'no fetcher configured'", async () => {
    const r = await fetchExternalContext("see https://x.com and PROJ-1");
    expect(r.resolved).toHaveLength(0);
    expect(r.unresolved).toHaveLength(2);
    expect(r.unresolved.every((u) => u.reason === "no fetcher configured")).toBe(true);
  });

  it("injected stub fetcher resolves all refs", async () => {
    const stub = async () => ({ content: "stub body", title: "t" });
    const r = await fetchExternalContext("see https://x.com and PROJ-1", { fetcher: stub });
    expect(r.resolved).toHaveLength(2);
    expect(r.unresolved).toHaveLength(0);
    expect(r.resolved.every((h) => h.content === "stub body")).toBe(true);
  });

  it("mixed stub: resolves URLs but returns null for Jira", async () => {
    const stub = async (ref: { kind: string }) => (ref.kind === "url" ? { content: "url body" } : null);
    const r = await fetchExternalContext("see https://x.com and PROJ-1", { fetcher: stub });
    expect(r.resolved).toHaveLength(1);
    expect(r.resolved[0].ref.kind).toBe("url");
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0].ref.kind).toBe("jira");
    expect(r.unresolved[0].reason).toBe("fetcher returned null");
  });

  it("fetcher throws → caught and treated as unresolved with the error message", async () => {
    const stub = async () => {
      throw new Error("nope");
    };
    const r = await fetchExternalContext("see https://x.com", { fetcher: stub });
    expect(r.resolved).toHaveLength(0);
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0].reason).toBe("nope");
  });

  it("hard timeout per ref", async () => {
    const stub = async () => new Promise<{ content: string }>((resolve) => setTimeout(() => resolve({ content: "late" }), 100));
    const r = await fetchExternalContext("see https://x.com", { fetcher: stub, perRefTimeoutMs: 20 });
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0].reason).toMatch(/timeout/i);
  });
});
