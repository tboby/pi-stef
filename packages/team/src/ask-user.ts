/**
 * Resolution-chain-aware wrapper around `pi.ui.{select,input,confirm}`.
 *
 * Locked plan decision #11: Q&A is the safety net in the resolution chain
 *   prompt → project config → global config → Q&A → hard default
 *
 * Each `askUser.*` call accepts pre-resolved values from the higher tiers and
 * only calls `pi.ui.*` when the chain falls through. Successful answers are
 * cached for the lifetime of the AskUser instance (typically one tool call)
 * so the orchestrator never re-asks the same question twice.
 *
 * `AbortSignal` is forwarded into `pi.ui.*` so user cancel propagates.
 */
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export interface AskBaseOptions {
  /** Stable cache key per logical question. Required so re-entry short-circuits. */
  key: string;
  /** Pre-resolved value from prompt args. Highest precedence; askUser will not display UI. */
  prompt?: unknown;
  /** Pre-resolved value from project config. */
  project?: unknown;
  /** Pre-resolved value from global config. */
  global?: unknown;
  /** AbortSignal forwarded to pi.ui.*. */
  signal?: AbortSignal;
}

export interface AskSelectOptions extends AskBaseOptions {
  title: string;
  options: string[];
  prompt?: string;
  project?: string;
  global?: string;
  /** Hard fallback when chain falls through and pi.ui.select returns undefined. */
  default?: string;
}

export interface AskInputOptions extends AskBaseOptions {
  title: string;
  placeholder?: string;
  prompt?: string;
  project?: string;
  global?: string;
  default?: string;
}

export interface AskConfirmOptions extends AskBaseOptions {
  title: string;
  message: string;
  prompt?: boolean;
  project?: boolean;
  global?: boolean;
  default?: boolean;
}

export class AskUser {
  private readonly cache = new Map<string, unknown>();

  constructor(private readonly ui: ExtensionUIContext) {}

  async select(opts: AskSelectOptions): Promise<string | undefined> {
    const cached = this.peekCache<string>(opts.key);
    if (cached !== undefined) return cached;

    const resolved = pickFromChain<string>(opts);
    if (resolved !== undefined) {
      this.cache.set(opts.key, resolved);
      return resolved;
    }

    // Pre-aborted signal — honor opts.default rather than dropping silently.
    if (opts.signal?.aborted) return opts.default;
    const answer = await this.ui.select(opts.title, opts.options, { signal: opts.signal });
    const final = answer ?? opts.default;
    if (final !== undefined) this.cache.set(opts.key, final);
    return final;
  }

  async input(opts: AskInputOptions): Promise<string | undefined> {
    const cached = this.peekCache<string>(opts.key);
    if (cached !== undefined) return cached;

    const resolved = pickFromChain<string>(opts);
    if (resolved !== undefined) {
      this.cache.set(opts.key, resolved);
      return resolved;
    }

    if (opts.signal?.aborted) return opts.default;
    const answer = await this.ui.input(opts.title, opts.placeholder, { signal: opts.signal });
    const final = answer ?? opts.default;
    if (final !== undefined) this.cache.set(opts.key, final);
    return final;
  }

  async confirm(opts: AskConfirmOptions): Promise<boolean | undefined> {
    const cached = this.peekCache<boolean>(opts.key);
    if (cached !== undefined) return cached;

    const resolved = pickFromChain<boolean>(opts);
    if (resolved !== undefined) {
      this.cache.set(opts.key, resolved);
      return resolved;
    }

    if (opts.signal?.aborted) return opts.default;
    // pi.ui.confirm returns Promise<boolean>; nullish-coalesce is a no-op for
    // a real answer (false stays false), so opts.default only fires for the
    // pre-aborted-signal path above.
    const answer = await this.ui.confirm(opts.title, opts.message, { signal: opts.signal });
    const final: boolean | undefined = answer ?? opts.default;
    if (final !== undefined) this.cache.set(opts.key, final);
    return final;
  }

  /** Peek the cache without invalidating. Test-only convenience. */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Seed the cache with a previously-answered key/value pair so subsequent
   * `select`/`input`/`confirm` calls for that key short-circuit without
   * touching the UI. Used by the research-Q&A resume layer.
   */
  seed(key: string, value: unknown): void {
    this.cache.set(key, value);
  }

  private peekCache<T>(key: string): T | undefined {
    const v = this.cache.get(key);
    return v as T | undefined;
  }
}

function pickFromChain<T>(opts: { prompt?: T; project?: T; global?: T }): T | undefined {
  if (opts.prompt !== undefined) return opts.prompt;
  if (opts.project !== undefined) return opts.project;
  if (opts.global !== undefined) return opts.global;
  return undefined;
}
