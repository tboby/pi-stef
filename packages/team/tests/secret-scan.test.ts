import { describe, expect, it } from "vitest";

import { scanForSecrets, SecretsInPayloadError } from "../src/review/secret-scan";

describe("M4 scanForSecrets fixtures", () => {
  it("clean text produces no hits", () => {
    expect(scanForSecrets("hello world\nno secrets here").hits).toEqual([]);
  });

  it("empty / non-string returns empty hits", () => {
    expect(scanForSecrets("").hits).toEqual([]);
    expect(scanForSecrets(undefined as unknown as string).hits).toEqual([]);
  });

  it("AWS access key id (AKIA / ASIA prefix)", () => {
    const r = scanForSecrets("token=AKIAIOSFODNN7EXAMPLE in config");
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].kind).toBe("aws-access-key-id");
    expect(r.hits[0].preview).toMatch(/^AKIA\*\*\*\*$/);
  });

  it("AWS secret access key", () => {
    const r = scanForSecrets("aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    expect(r.hits.some((h) => h.kind === "aws-secret-access-key")).toBe(true);
  });

  it("GitHub PAT classic and fine-grained", () => {
    const text = `ghp_${"x".repeat(40)} and github_pat_${"y".repeat(64)}`;
    const r = scanForSecrets(text);
    const kinds = r.hits.map((h) => h.kind);
    expect(kinds).toContain("github-pat");
    expect(kinds).toContain("github-pat-fg");
  });

  it("Slack tokens (xoxb / xoxa / xoxr / xoxs / xoxp)", () => {
    expect(scanForSecrets("xoxb-12345-abcdef-extra-chars").hits.some((h) => h.kind === "slack-token")).toBe(true);
    expect(scanForSecrets("xoxa-1-foobar-baz-quux-token").hits.some((h) => h.kind === "slack-token")).toBe(true);
  });

  it("OpenAI API keys (sk- and sk-proj-)", () => {
    expect(scanForSecrets("sk-abcdefghijklmnopqrstuvwxyz").hits.some((h) => h.kind === "openai-key")).toBe(true);
    expect(scanForSecrets("sk-proj-abcdefghijklmnopqrstuvwxyz").hits.some((h) => h.kind === "openai-key")).toBe(true);
  });

  it("Anthropic API keys", () => {
    const key = `sk-ant-${"x".repeat(50)}`;
    expect(scanForSecrets(`use ${key} please`).hits.some((h) => h.kind === "anthropic-key")).toBe(true);
  });

  it("JWT tokens", () => {
    const jwt = "eyJabcdefghij.eyJpayload01.signature99";
    expect(scanForSecrets(jwt).hits.some((h) => h.kind === "jwt")).toBe(true);
  });

  it("PEM private key blocks", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIE...";
    expect(scanForSecrets(pem).hits.some((h) => h.kind === "pem-private-key")).toBe(true);

    const generic = "-----BEGIN PRIVATE KEY-----";
    expect(scanForSecrets(generic).hits.some((h) => h.kind === "pem-private-key-generic")).toBe(true);
  });

  it("dotenv-style assignments to *_KEY / *_TOKEN / *_SECRET / *_PASSWORD", () => {
    const r = scanForSecrets("\nDATABASE_PASSWORD=hunter22-supersecret-value-of-len22");
    expect(r.hits.some((h) => h.kind === "dotenv-assignment")).toBe(true);
  });

  it("preview is redacted to first 4 chars + ****", () => {
    const r = scanForSecrets("AKIAIOSFODNN7EXAMPLE");
    expect(r.hits[0].preview).toBe("AKIA****");
    expect(r.hits[0].preview).not.toContain("EXAMPLE");
  });

  it("multiple hits in the same payload all report", () => {
    const text = "AKIAIOSFODNN7EXAMPLE and ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const r = scanForSecrets(text);
    expect(r.hits.length).toBeGreaterThanOrEqual(2);
  });
});

describe("M4 SecretsInPayloadError", () => {
  it("composes a friendly message naming the role and listing redacted hits", () => {
    const err = new SecretsInPayloadError("reviewer", [
      { kind: "openai-key", preview: "sk-a****", offset: 0 },
      { kind: "github-pat", preview: "ghp_****", offset: 100 },
    ]);
    expect(err.message).toContain("reviewer");
    expect(err.message).toContain("openai-key=sk-a****");
    expect(err.message).toContain("github-pat=ghp_****");
    expect(err.hits).toHaveLength(2);
  });
});
