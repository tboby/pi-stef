import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// src/notify/telegram.ts -> ../../bin/notify-telegram.sh
const BUNDLED_HELPER = path.resolve(HERE, "..", "..", "bin", "notify-telegram.sh");

export interface TelegramOptions {
  enabled: boolean;
  /** Optional override of the helper path (test injection). */
  helperPath?: string;
}

export interface TelegramResult {
  attempted: boolean;
  ok: boolean;
  reason?: string;
}

/**
 * Fire a Telegram message via the bundled `notify-telegram.sh` helper.
 *
 * Locked plan decision #20: opt-in via config (default off); reuses the
 * bundled helper. Failures NEVER throw — Telegram is non-load-bearing
 * — but the result is reported so callers can surface to the user.
 */
export function notifyTelegram(message: string, opts: TelegramOptions): TelegramResult {
  if (!opts.enabled) return { attempted: false, ok: false, reason: "telegram disabled in config" };
  const helperPath = opts.helperPath ?? BUNDLED_HELPER;
  if (!existsSync(helperPath)) {
    return { attempted: false, ok: false, reason: `bundled helper missing at ${helperPath}` };
  }
  const env = process.env;
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return {
      attempted: false,
      ok: false,
      reason: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set",
    };
  }
  const r = spawnSync(helperPath, ["--message", message], { encoding: "utf8", env });
  if (r.status === 0) return { attempted: true, ok: true };
  return {
    attempted: true,
    ok: false,
    reason: `helper exited ${r.status}; stderr: ${(r.stderr ?? "").trim().slice(0, 500)}`,
  };
}

export const _internal = { BUNDLED_HELPER };
